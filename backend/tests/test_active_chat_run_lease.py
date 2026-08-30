from __future__ import annotations

import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ChatRun, ChatRunInput, Conversation, Message, TaskEvent, TaskRun
from app.services.agent_harness.active_run_lease import (
    LEASE_EXPIRED_ERROR_CODE,
    ChatRunLeaseError,
    heartbeat_chat_run_lease,
    new_chat_run_lease,
    reap_stale_chat_runs,
)
from app.services.agent_harness.run_rollout import (
    attach_chat_run_assistant_message,
    begin_chat_rollout,
    finalize_chat_rollout,
)
from app.services.time_utils import utc_now_naive


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _runtime(engine):
    with Session(engine) as session:
        conversation = Conversation(title="Lease contract")
        session.add(conversation)
        session.flush()
        session.add(
            Message(
                conversation_id=int(conversation.id),
                role="user",
                content="private lease request",
            )
        )
        session.commit()
        conversation_id = int(conversation.id)
    return SimpleNamespace(
        conv_id=conversation_id,
        project_id=None,
        selected_model="provider-model",
        chat_mode="agent",
        action_policy="read_only_tool",
        context_manifest={},
        skill_id=None,
        skill_name="",
    )


def test_active_chat_run_lease_heartbeats_and_releases_on_terminal_commit() -> None:
    engine = _engine()
    runtime = _runtime(engine)
    lease = new_chat_run_lease(owner="worker_test", ttl_seconds=60)
    task_id = begin_chat_rollout(
        engine,
        runtime,
        "private lease request",
        "run_lease_lifecycle",
        lease=lease,
    )

    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_lease_lifecycle")
        ).one()
        first_expiry = run.lease_expires_at
        assert run.lease_owner == "worker_test"
        assert len(run.lease_token) == 64
        assert run.lease_token == lease.token
        assert run.lease_generation == 1
        assert run.last_heartbeat_at is not None

    renewed_at = utc_now_naive() + timedelta(seconds=1)
    second_expiry = heartbeat_chat_run_lease(
        engine,
        run_id="run_lease_lifecycle",
        lease=lease,
        now=renewed_at,
    )
    assert second_expiry > first_expiry

    snapshot = finalize_chat_rollout(
        engine,
        task_id,
        status="completed",
        phase="persist",
        lease=lease,
    )
    assert snapshot["status"] == "completed"
    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_lease_lifecycle")
        ).one()
        assert run.status == "completed"
        assert run.lease_owner == ""
        assert run.lease_token == ""
        assert run.lease_expires_at is None
        assert run.lease_generation == 1
        assert run.last_heartbeat_at == renewed_at


def test_wrong_worker_generation_cannot_finalize_or_append_terminal_event() -> None:
    engine = _engine()
    runtime = _runtime(engine)
    owner = new_chat_run_lease(owner="worker_owner")
    intruder = new_chat_run_lease(owner="worker_intruder")
    task_id = begin_chat_rollout(
        engine,
        runtime,
        "private lease request",
        "run_lease_fenced",
        lease=owner,
    )

    with pytest.raises(ChatRunLeaseError, match="another worker"):
        finalize_chat_rollout(
            engine,
            task_id,
            status="completed",
            phase="persist",
            lease=intruder,
        )

    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_lease_fenced")
        ).one()
        events = session.exec(
            select(TaskEvent).where(TaskEvent.task_run_id == task_id)
        ).all()
        assert run.status == "running"
        assert run.lease_token == owner.token
        assert [event.event_type for event in events] == ["run_started"]


def test_assistant_projection_survives_reaper_between_message_and_terminal_commit() -> None:
    engine = _engine()
    runtime = _runtime(engine)
    lease = new_chat_run_lease(owner="worker_projection")
    task_id = begin_chat_rollout(
        engine,
        runtime,
        "private lease request",
        "run_lease_message_projection",
        lease=lease,
    )
    with Session(engine) as session:
        message = Message(
            conversation_id=int(runtime.conv_id),
            role="assistant",
            content="partial but durable",
            metadata_json='{"run_rollout":{"run_id":"run_lease_message_projection"}}',
        )
        session.add(message)
        session.commit()
        session.refresh(message)
        message_id = int(message.id)

    attach_chat_run_assistant_message(
        engine,
        run_id="run_lease_message_projection",
        conversation_id=int(runtime.conv_id),
        message_id=message_id,
        lease=lease,
    )
    now = utc_now_naive()
    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(
                ChatRun.run_id == "run_lease_message_projection"
            )
        ).one()
        run.lease_expires_at = now - timedelta(seconds=1)
        session.add(run)
        session.commit()

    with Session(engine) as session:
        assert reap_stale_chat_runs(session, now=now).reaped == 1

    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(
                ChatRun.run_id == "run_lease_message_projection"
            )
        ).one()
        task = session.get(TaskRun, task_id)
        snapshot = json.loads(task.output_json)
        assert run.status == "interrupted"
        assert run.assistant_message_id == message_id
        assert snapshot["status"] == "interrupted"
        assert snapshot["message_id"] == message_id
        assert [
            event.event_type
            for event in session.exec(
                select(TaskEvent)
                .where(TaskEvent.task_run_id == task_id)
                .order_by(TaskEvent.id)
            ).all()
        ] == ["run_started", "message_persisted", "run_interrupted"]


def test_reaper_marks_expired_run_interrupted_and_preserves_unapplied_input() -> None:
    engine = _engine()
    runtime = _runtime(engine)
    lease = new_chat_run_lease(owner="worker_dead")
    task_id = begin_chat_rollout(
        engine,
        runtime,
        "private lease request",
        "run_lease_expired",
        lease=lease,
    )
    now = utc_now_naive()
    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_lease_expired")
        ).one()
        run.lease_expires_at = now - timedelta(seconds=1)
        run.last_heartbeat_at = now - timedelta(minutes=3)
        session.add(run)
        session.add(
            ChatRunInput(
                run_id=run.run_id,
                chat_run_id=int(run.id),
                conversation_id=int(run.conversation_id),
                message_id=None,
                kind="cancel",
                sequence=1,
                content_sha256="a" * 64,
                status="accepted",
            )
        )
        session.commit()

    with Session(engine) as session:
        result = reap_stale_chat_runs(session, now=now)
        assert result.reaped == 1
        assert result.expired == 1

    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_lease_expired")
        ).one()
        task = session.get(TaskRun, task_id)
        mailbox = session.exec(
            select(ChatRunInput).where(ChatRunInput.chat_run_id == int(run.id))
        ).one()
        events = session.exec(
            select(TaskEvent)
            .where(TaskEvent.task_run_id == task_id)
            .order_by(TaskEvent.id)
        ).all()
        snapshot = json.loads(task.output_json)
        assert run.status == "interrupted"
        assert run.phase == "worker_lease_expired"
        assert run.error_code == LEASE_EXPIRED_ERROR_CODE
        assert run.retryable is True
        assert run.completed_at == now
        assert run.lease_token == ""
        assert task.status == "failed"
        assert events[-1].event_type == "run_interrupted"
        assert snapshot["status"] == "interrupted"
        assert snapshot["recovery"]["action"] == "restart_turn"
        assert mailbox.status == "unapplied"


def test_reaper_never_touches_live_or_reserved_chat_runs() -> None:
    engine = _engine()
    runtime = _runtime(engine)
    live_lease = new_chat_run_lease(owner="worker_live")
    begin_chat_rollout(
        engine,
        runtime,
        "private lease request",
        "run_lease_live",
        lease=live_lease,
    )
    now = utc_now_naive()
    with Session(engine) as session:
        live = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_lease_live")
        ).one()
        live.lease_expires_at = now + timedelta(minutes=1)
        reserved_task = TaskRun(
            conversation_id=int(runtime.conv_id),
            task_type="chat_rollout",
            goal="reserved",
            status="pending",
            input_json='{"run_id":"run_reserved_lease"}',
        )
        session.add(reserved_task)
        session.flush()
        reserved = ChatRun(
            run_id="run_reserved_lease",
            task_run_id=int(reserved_task.id),
            conversation_id=int(runtime.conv_id),
            phase="reserved",
            updated_at=now - timedelta(hours=2),
        )
        session.add(live)
        session.add(reserved)
        session.commit()

    with Session(engine) as session:
        result = reap_stale_chat_runs(
            session,
            now=now,
            unleased_grace_seconds=30,
        )
        assert result.reaped == 0

    with Session(engine) as session:
        live = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_lease_live")
        ).one()
        reserved = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_reserved_lease")
        ).one()
        assert live.status == "running"
        assert reserved.status == "running"
        assert reserved.phase == "reserved"
