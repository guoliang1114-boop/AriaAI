from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import CHAT_RECOVERY_RESERVATION_TTL_SECONDS
from app.models.db import (
    ChatRun,
    ChatRunInput,
    Conversation,
    Message,
    Milestone,
    Project,
    TaskEvent,
    TaskRun,
)
from app.routers.chat import send_message
from app.routers.chat_diagnostics import get_conversation_recovery_preview
from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.project_world_state import build_project_world_state_manifest
from app.services.agent_harness.conversation_capsule import build_conversation_capsule
from app.services.agent_harness.run_rollout import (
    activate_prepared_chat_rollout,
    reserve_prepared_chat_rollout,
)
from app.services.chat.runtime import (
    _api_messages_with_recovery_steering,
    _validated_turn_recovery,
    _visible_history_messages,
)
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat_store import persist_user_message
from app.services.chat.working_memory import build_working_memory
from app.services.chat_tools import ChatRuntime
from app.services.chat.turn_recovery import (
    TurnRecoveryConflict,
    build_turn_recovery_preview,
    find_existing_recovery_child,
    resolve_recovery_world_state,
)
from app.services.agent_harness.durable_run_inputs import (
    RecoverySteeringMessage,
    content_sha256,
    recovery_run_identity_from_runtime,
)


def _seed_recovery(session: Session) -> tuple[int, int, int]:
    project = Project(name="Recovery project", client="Test client")
    session.add(project)
    session.flush()
    conversation = Conversation(title="Recovery", project_id=project.id)
    session.add(conversation)
    session.flush()
    baseline = build_project_world_state_manifest(session, int(project.id or 0))
    source_user = Message(conversation_id=int(conversation.id or 0), role="user", content="start")
    source_user.set_metadata({"project_world_state": baseline})
    session.add(source_user)
    session.flush()
    source_assistant = Message(conversation_id=int(conversation.id or 0), role="assistant", content="partial")
    source_assistant.set_metadata({"run_rollout": {"run_id": "run_source"}})
    session.add(source_assistant)
    task = TaskRun(
        conversation_id=conversation.id,
        task_type="chat_rollout",
        goal="test",
        status="failed",
    )
    session.add(task)
    session.flush()
    run = ChatRun(
        run_id="run_source",
        task_run_id=int(task.id or 0),
        conversation_id=int(conversation.id or 0),
        project_id=int(project.id or 0),
        source_message_id=int(source_user.id or 0),
        assistant_message_id=int(source_assistant.id or 0),
        status="failed",
    )
    session.add(run)
    session.commit()
    return int(project.id or 0), int(conversation.id or 0), int(source_assistant.id or 0)


def _rollout() -> dict:
    return {
        "run_id": "run_source",
        "status": "interrupted",
        "snapshot_sha256": "a" * 64,
        "steps": [{"step_index": 0, "status": "completed", "tool_calls": []}],
        "run_outputs": [],
        "recovery": {"can_resume": True, "can_retry": False},
    }


def test_recovery_preview_rejects_boolean_project_world_state_identity() -> None:
    fingerprint = "a" * 64
    preview = build_turn_recovery_preview(
        _rollout(),
        source_message_id=1,
        current_project_world_state={
            "schema_version": 1,
            "project_id": True,
            "version": fingerprint[:12],
            "fingerprint": fingerprint,
        },
    )

    assert preview["project_world_state"] == {}


def test_preview_digest_succeeds_then_project_change_rejects(monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project_id, conversation_id, assistant_id = _seed_recovery(session)
            state = resolve_recovery_world_state(
                session,
                conversation_id=conversation_id,
                source_run_id="run_source",
                requested_project_id=project_id,
            )
            preview = build_turn_recovery_preview(
                _rollout(),
                source_message_id=assistant_id,
                current_project_world_state=state["current_world_state"],
                project_world_state_change=state["world_state_change"],
            )
            monkeypatch.setattr("app.services.chat.runtime.get_chat_rollout", lambda *_a, **_k: _rollout())
            req = SendMessageRequest(
                conversation_id=conversation_id,
                project_id=project_id,
                content="continue",
                turn_recovery={
                    "schema_version": 2,
                    "source_run_id": "run_source",
                    "source_message_id": assistant_id,
                    "contract_sha256": preview["contract_sha256"],
                },
            )
            accepted = _validated_turn_recovery(session, req, conversation_id=conversation_id)
            assert accepted["contract_sha256"] == preview["contract_sha256"]
            assert accepted["strategy"] == "replan_from_checkpoint"

            session.add(Milestone(project_id=project_id, title="state changed"))
            session.commit()
            with pytest.raises(TurnRecoveryConflict, match="contract changed"):
                _validated_turn_recovery(session, req, conversation_id=conversation_id)
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_recovery_contract_preserves_all_cumulative_steering_ids(monkeypatch) -> None:
    """A valid multi-step Run may cumulatively claim more than queue capacity."""

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project_id, conversation_id, assistant_id = _seed_recovery(session)
            parent = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_source")
            ).one()
            applied_message_ids: list[int] = []
            for sequence in range(1, 41):
                content = f"cumulative steering {sequence}"
                message = Message(
                    conversation_id=conversation_id,
                    role="user",
                    content=content,
                )
                session.add(message)
                session.flush()
                message.set_metadata(
                    {
                        "run_steering": {
                            "schema_version": "aria.run_steering.v1",
                            "status": "accepted",
                            "run_id": parent.run_id,
                            "expected_run_id": parent.run_id,
                            "steering_id": f"steer_cumulative_{sequence}",
                            "sequence": sequence,
                            "input_id": None,
                        }
                    }
                )
                session.add(message)
                item = ChatRunInput(
                        run_id=parent.run_id,
                        chat_run_id=int(parent.id or 0),
                        conversation_id=conversation_id,
                        message_id=int(message.id or 0),
                        kind="steering",
                        sequence=sequence,
                        content_sha256=content_sha256(content),
                        status="applied",
                        applied_at=parent.updated_at,
                    )
                session.add(item)
                session.flush()
                metadata = message.get_metadata()
                metadata["run_steering"]["input_id"] = int(item.id or 0)
                message.set_metadata(metadata)
                session.add(message)
                applied_message_ids.append(int(message.id or 0))
            session.commit()

            state = resolve_recovery_world_state(
                session,
                conversation_id=conversation_id,
                source_run_id=parent.run_id,
                requested_project_id=project_id,
            )
            preview = build_turn_recovery_preview(
                _rollout(),
                source_message_id=assistant_id,
                current_project_world_state=state["current_world_state"],
                project_world_state_change=state["world_state_change"],
                unapplied_input_message_ids=state["unapplied_input_message_ids"],
                applied_input_message_ids=state["applied_input_message_ids"],
            )
            assert preview["applied_input_message_ids"] == applied_message_ids
            assert len(preview["applied_input_message_ids"]) == 40

            monkeypatch.setattr(
                "app.services.chat.runtime.get_chat_rollout",
                lambda *_args, **_kwargs: _rollout(),
            )
            request = SendMessageRequest(
                conversation_id=conversation_id,
                project_id=project_id,
                content="continue after cumulative steering",
                turn_recovery={
                    "schema_version": 2,
                    "source_run_id": parent.run_id,
                    "source_message_id": assistant_id,
                    "contract_sha256": preview["contract_sha256"],
                },
            )
            accepted = _validated_turn_recovery(
                session,
                request,
                conversation_id=conversation_id,
            )
            assert accepted["applied_input_message_ids"] == applied_message_ids

            identity = recovery_run_identity_from_runtime(
                SimpleNamespace(
                    conv_id=conversation_id,
                    prepare_metrics={"turn_recovery": accepted},
                ),
                conversation_id=conversation_id,
            )
            assert identity.applied_message_ids == tuple(applied_message_ids)
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_send_maps_recovery_conflict_to_http_409(monkeypatch) -> None:
    req = SendMessageRequest(content="continue")
    fake_session = SimpleNamespace(rollback=lambda: None)
    fake_user = SimpleNamespace(id=3)
    monkeypatch.setattr("app.routers.chat.require_chat_request_access", lambda *_a, **_k: None)

    async def conflict(*_args, **_kwargs):
        raise TurnRecoveryConflict("stale recovery")

    monkeypatch.setattr("app.routers.chat.prepare_chat_runtime", conflict)
    with pytest.raises(HTTPException) as captured:
        asyncio.run(send_message(req, session=fake_session, current_user=fake_user))
    assert captured.value.status_code == 409
    assert captured.value.detail == "stale recovery"


def test_running_rollout_is_not_recoverable() -> None:
    preview = build_turn_recovery_preview(
        {"run_id": "run_live", "status": "running", "steps": [], "run_outputs": []},
        source_message_id=1,
    )
    assert preview["can_continue"] is False


def test_v2_without_contract_digest_fails_closed(monkeypatch) -> None:
    source_message = SimpleNamespace(
        id=9,
        role="assistant",
        conversation_id=4,
        get_metadata=lambda: {"run_rollout": {"run_id": "run_source"}},
    )
    session = SimpleNamespace(get=lambda *_args: source_message)
    monkeypatch.setattr("app.services.chat.runtime.get_chat_rollout", lambda *_a, **_k: _rollout())
    monkeypatch.setattr(
        "app.services.chat.runtime.resolve_recovery_world_state",
        lambda *_a, **_k: {
            "chat_run": SimpleNamespace(assistant_message_id=9, status="failed"),
            "current_world_state": {},
            "world_state_change": {},
            "source_world_state_available": True,
        },
    )
    req = SendMessageRequest(
        conversation_id=4,
        content="continue",
        turn_recovery={
            "schema_version": 2,
            "source_run_id": "run_source",
            "source_message_id": 9,
        },
    )
    with pytest.raises(TurnRecoveryConflict, match="requires the reviewed contract digest"):
        _validated_turn_recovery(session, req, conversation_id=4)


def test_recovery_message_and_child_claim_commit_atomically(monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            conversation = Conversation(title="Atomic recovery")
            session.add(conversation)
            session.flush()
            parent_task = TaskRun(
                conversation_id=conversation.id,
                task_type="chat_rollout",
                goal="parent",
                status="failed",
            )
            session.add(parent_task)
            session.flush()
            session.add(
                ChatRun(
                    run_id="run_parent",
                    task_run_id=int(parent_task.id or 0),
                    conversation_id=int(conversation.id or 0),
                    status="failed",
                )
            )
            session.commit()
            conversation_id = int(conversation.id or 0)

            monkeypatch.setattr("app.routers.chat.require_chat_request_access", lambda *_a, **_k: None)
            cache_invalidations: list[str] = []
            monkeypatch.setattr(
                "app.routers.chat.conversations_cache.delete_prefix",
                lambda prefix: cache_invalidations.append(prefix),
            )
            prepare_calls = 0

            async def prepared(db_session, request, owner_user_id=None):
                nonlocal prepare_calls
                prepare_calls += 1
                current_conversation = db_session.get(Conversation, conversation_id)
                current_conversation.skill_id = 11 if prepare_calls == 1 else 22
                db_session.add(current_conversation)
                db_session.flush()
                message = persist_user_message(
                    db_session,
                    conversation_id,
                    request.content,
                    {"turn_recovery": {"schema_version": 2}},
                    commit=False,
                )
                return ChatRuntime(
                    conv_id=conversation_id,
                    selected_model="test",
                    llm=SimpleNamespace(),
                    system="",
                    api_messages=[],
                    rag_sources=[],
                    tools=[],
                    max_tokens=128,
                    temperature=0.0,
                    action_policy=ActionPolicy.READ_ONLY_TOOL,
                    prepare_metrics={
                        "source_user_message_id": int(message.id or 0),
                        "turn_recovery": {
                            "schema_version": 2,
                            "source_run_id": "run_parent",
                            "contract_sha256": "a" * 64,
                        },
                    },
                )

            monkeypatch.setattr("app.routers.chat.prepare_chat_runtime", prepared)
            request = SendMessageRequest(
                conversation_id=conversation_id,
                content="recover",
                turn_recovery={"source_run_id": "run_parent", "source_message_id": 1},
            )
            asyncio.run(send_message(request, session=session, current_user=SimpleNamespace(id=1)))
            first_message_count = len(session.exec(select(Message)).all())
            assert first_message_count == 1
            assert session.get(Conversation, conversation_id).skill_id == 11
            assert len(session.exec(select(ChatRun).where(ChatRun.parent_run_id == "run_parent")).all()) == 1
            assert cache_invalidations == ["list:"]

            with pytest.raises(HTTPException) as conflict:
                asyncio.run(send_message(request, session=session, current_user=SimpleNamespace(id=1)))
            assert conflict.value.status_code == 409
            assert len(session.exec(select(Message)).all()) == first_message_count
            assert len(session.exec(select(ChatRun).where(ChatRun.parent_run_id == "run_parent")).all()) == 1
            assert cache_invalidations == ["list:"]
            session.expire_all()
            assert session.get(Conversation, conversation_id).skill_id == 11
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_consumed_contract_is_rejected_by_recovery_preview(monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project_id, conversation_id, assistant_id = _seed_recovery(session)
            state = resolve_recovery_world_state(
                session,
                conversation_id=conversation_id,
                source_run_id="run_source",
                requested_project_id=project_id,
            )
            preview = build_turn_recovery_preview(
                _rollout(),
                source_message_id=assistant_id,
                current_project_world_state=state["current_world_state"],
                project_world_state_change=state["world_state_change"],
                unapplied_input_message_ids=state["unapplied_input_message_ids"],
                applied_input_message_ids=state["applied_input_message_ids"],
            )
            identity = recovery_run_identity_from_runtime(
                SimpleNamespace(conv_id=conversation_id, prepare_metrics={"turn_recovery": preview}),
                session=session,
                conversation_id=conversation_id,
            )
            child_task = TaskRun(
                conversation_id=conversation_id,
                task_type="chat_rollout",
                goal="child",
                status="running",
            )
            session.add(child_task)
            session.flush()
            session.add(
                ChatRun(
                    run_id="run_child",
                    task_run_id=int(child_task.id or 0),
                    parent_run_id=identity.parent_run_id,
                    recovery_snapshot_sha256=identity.recovery_snapshot_sha256,
                    conversation_id=conversation_id,
                    project_id=project_id,
                )
            )
            session.commit()
            monkeypatch.setattr("app.routers.chat_diagnostics.require_conversation_access", lambda *_a, **_k: None)
            monkeypatch.setattr("app.routers.chat_diagnostics.get_chat_rollout", lambda *_a, **_k: _rollout())

            with pytest.raises(HTTPException) as conflict:
                get_conversation_recovery_preview(
                    conversation_id,
                    "run_source",
                    message_id=assistant_id,
                    session=session,
                    current_user=SimpleNamespace(id=1),
                )
            assert conflict.value.status_code == 409
            assert "already has a child" in str(conflict.value.detail)
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_recovery_preview_requires_write_permission_before_reconciliation(
    monkeypatch,
) -> None:
    observed: dict[str, object] = {}

    def reject_viewer(_session, conversation_id, _user, *, require_write=False):
        observed["conversation_id"] = conversation_id
        observed["require_write"] = require_write
        raise HTTPException(status_code=403, detail="Project write permission required")

    monkeypatch.setattr(
        "app.routers.chat_diagnostics.require_conversation_access",
        reject_viewer,
    )
    with pytest.raises(HTTPException) as forbidden:
        get_conversation_recovery_preview(
            17,
            "run_source",
            session=object(),
            current_user=SimpleNamespace(id=4),
        )

    assert forbidden.value.status_code == 403
    assert observed == {"conversation_id": 17, "require_write": True}


def test_verified_recovery_steering_is_one_user_message_and_never_system() -> None:
    secret = "STEERING-ORIGINAL-ONCE"
    steering = (
        RecoverySteeringMessage(
            message_id=2,
            sequence=1,
            status="unapplied",
            content=secret,
            content_sha256="a" * 64,
        ),
    )
    history = [
        SimpleNamespace(id=1, role="assistant", content="partial", metadata_json="{}"),
        SimpleNamespace(id=2, role="user", content=secret, metadata_json="{}"),
        SimpleNamespace(id=3, role="user", content="continue", metadata_json="{}"),
    ]
    api_messages = _api_messages_with_recovery_steering(
        history,
        recovery_steering=steering,
        current_user_message_id=3,
    )
    matching = [item for item in api_messages if secret in item["content"]]
    assert len(matching) == 1
    assert matching[0]["role"] == "user"
    assert all(item["role"] != "system" for item in api_messages)
    assert secret not in "system contract without steering bodies"


def test_never_started_reservation_expires_auditably_and_can_be_reclaimed() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            conversation = Conversation(title="Reserved recovery")
            session.add(conversation)
            session.flush()
            parent_task = TaskRun(
                conversation_id=conversation.id,
                task_type="chat_rollout",
                goal="parent",
                status="failed",
            )
            session.add(parent_task)
            session.flush()
            parent = ChatRun(
                run_id="run_reserved_parent",
                task_run_id=int(parent_task.id or 0),
                conversation_id=int(conversation.id or 0),
                status="failed",
            )
            session.add(parent)
            recovery_message = Message(
                conversation_id=int(conversation.id or 0),
                role="user",
                content="continue",
            )
            session.add(recovery_message)
            session.commit()
            conversation_id = int(conversation.id or 0)
            contract = {
                "schema_version": 2,
                "source_run_id": parent.run_id,
                "contract_sha256": "b" * 64,
                "unapplied_input_message_ids": [],
                "applied_input_message_ids": [],
            }
            runtime = ChatRuntime(
                conv_id=conversation_id,
                selected_model="test",
                llm=SimpleNamespace(),
                system="",
                api_messages=[],
                rag_sources=[],
                tools=[],
                max_tokens=128,
                temperature=0.0,
                action_policy=ActionPolicy.READ_ONLY_TOOL,
                prepare_metrics={
                    "source_user_message_id": int(recovery_message.id or 0),
                    "turn_recovery": contract,
                },
            )
            task_id = reserve_prepared_chat_rollout(
                session,
                runtime,
                "continue",
                "run_reserved_child",
            )
            session.commit()
            child = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_reserved_child")
            ).one()
            original_snapshot = child.recovery_snapshot_sha256
            assert child.phase == "reserved"
            assert session.get(TaskRun, task_id).status == "pending"
            session.refresh(recovery_message)
            assert recovery_message.get_metadata()["recovery_reservation"]["status"] == "reserved"
            # Defensively cover a legacy/partially-upgraded accepted row. New
            # remote callers are rejected while the child is still reserved,
            # but expiry must still close any durable mailbox residue.
            pending_cancel = ChatRunInput(
                run_id=child.run_id,
                chat_run_id=int(child.id or 0),
                conversation_id=conversation_id,
                kind="cancel",
                sequence=1,
                content_sha256="d" * 64,
                status="accepted",
            )
            session.add(pending_cancel)
            session.commit()
            assert pending_cancel.status == "accepted"

            ttl_boundary = child.created_at + timedelta(
                seconds=CHAT_RECOVERY_RESERVATION_TTL_SECONDS
            )
            assert find_existing_recovery_child(
                session,
                conversation_id=conversation_id,
                contract=contract,
                reconcile_stale_reservation=True,
                now=ttl_boundary,
            ) is not None
            assert find_existing_recovery_child(
                session,
                conversation_id=conversation_id,
                contract=contract,
                reconcile_stale_reservation=True,
                now=ttl_boundary + timedelta(microseconds=1),
            ) is None
            session.commit()
            session.refresh(child)
            expired_task = session.get(TaskRun, task_id)
            assert child.phase == "reservation_expired"
            assert child.status == "failed"
            assert len(child.recovery_snapshot_sha256) == 64
            assert child.recovery_snapshot_sha256 != original_snapshot
            assert expired_task.status == "failed"
            expired_cancel = session.get(ChatRunInput, int(pending_cancel.id or 0))
            assert expired_cancel is not None
            assert expired_cancel.status == "unapplied"
            assert expired_cancel.applied_at is None
            task_audit = json.loads(expired_task.output_json)
            assert task_audit["original_parent_run_id"] == parent.run_id
            assert task_audit["original_recovery_snapshot_sha256"] == original_snapshot
            assert task_audit["finalized_inputs"] == [
                {"input_id": int(pending_cancel.id or 0), "status": "unapplied"}
            ]
            expiry_event = session.exec(
                select(TaskEvent).where(
                    TaskEvent.task_run_id == task_id,
                    TaskEvent.event_type == "recovery_reservation_expired",
                )
            ).one()
            assert json.loads(expiry_event.payload_json)["ordinal"] == 2
            session.refresh(recovery_message)
            message_audit = recovery_message.get_metadata()["recovery_reservation"]
            assert message_audit["status"] == "expired"
            assert message_audit["reserved_at"]
            assert message_audit["original_parent_run_id"] == parent.run_id
            assert message_audit["original_recovery_snapshot_sha256"] == original_snapshot

            replacement_message = Message(
                conversation_id=conversation_id,
                role="user",
                content="continue after expired claim",
            )
            session.add(replacement_message)
            session.flush()
            runtime.prepare_metrics["source_user_message_id"] = int(replacement_message.id or 0)
            replacement_task_id = reserve_prepared_chat_rollout(
                session,
                runtime,
                replacement_message.content,
                "run_reserved_replacement",
            )
            session.commit()
            replacement = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_reserved_replacement")
            ).one()
            assert replacement.recovery_snapshot_sha256 == original_snapshot
            assert replacement.phase == "reserved"
            session.refresh(replacement_message)
            assert replacement_message.get_metadata()["recovery_reservation"]["status"] == "reserved"

            activate_prepared_chat_rollout(
                engine,
                replacement_task_id,
                replacement.run_id,
            )
            session.expire_all()
            replacement = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_reserved_replacement")
            ).one()
            assert replacement.phase == "run_start"
            assert session.get(TaskRun, replacement_task_id).status == "running"
            session.refresh(replacement_message)
            assert replacement_message.get_metadata()["recovery_reservation"]["status"] == "activated"
            assert find_existing_recovery_child(
                session,
                conversation_id=conversation_id,
                contract=contract,
                reconcile_stale_reservation=True,
                now=replacement.created_at
                + timedelta(seconds=CHAT_RECOVERY_RESERVATION_TTL_SECONDS + 1),
            ).run_id == replacement.run_id
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_reserved_and_expired_recovery_messages_are_audit_only_history() -> None:
    reserved_secret = "RESERVED-RECOVERY-MUST-NOT-INFLUENCE"
    expired_secret = "EXPIRED-RECOVERY-MUST-NOT-INFLUENCE"
    activated_content = "activated recovery remains visible"

    def recovery_message(message_id: int, content: str, status: str) -> Message:
        message = Message(
            id=message_id,
            conversation_id=4,
            role="user",
            content=content,
        )
        message.set_metadata(
            {
                "recovery_reservation": {
                    "schema_version": 1,
                    "run_id": f"run_{status}",
                    "status": status,
                }
            }
        )
        return message

    history = [
        Message(id=1, conversation_id=4, role="assistant", content="prior answer"),
        recovery_message(2, reserved_secret, "reserved"),
        recovery_message(3, expired_secret, "expired"),
        recovery_message(4, activated_content, "activated"),
    ]
    visible = _visible_history_messages(history)
    assert [message.id for message in visible] == [1, 4]

    api_messages = _api_messages_with_recovery_steering(
        history,
        recovery_steering=(),
        current_user_message_id=None,
    )
    working_memory = build_working_memory(visible, "ordinary next turn")
    capsule = build_conversation_capsule(
        conversation_id=4,
        project_id=None,
        history=visible,
        current_content="ordinary next turn",
        working_memory=working_memory,
        turn_contract={"mode": "answer_only", "user_goal": "ordinary next turn"},
    )
    combined = json.dumps(
        {
            "provider": api_messages,
            "working_memory": working_memory.to_dict(),
            "capsule": capsule,
        },
        ensure_ascii=False,
    )
    assert reserved_secret not in combined
    assert expired_secret not in combined
    assert activated_content in combined
    assert 2 not in capsule["source_message_ids"]
    assert 3 not in capsule["source_message_ids"]
