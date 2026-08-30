from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import (
    ChatRun,
    ChatRunInput,
    Conversation,
    Message,
    Project,
    ProjectMember,
    TaskRun,
    User,
)
from app.routers.chat_diagnostics import get_project_recovery_center
from app.services.chat.recovery_center import build_project_recovery_center


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _task(session: Session, conversation_id: int, status: str = "failed") -> TaskRun:
    task = TaskRun(
        conversation_id=conversation_id,
        task_type="chat_rollout",
        goal="recovery center test",
        status=status,
    )
    session.add(task)
    session.flush()
    return task


def _terminal_run(
    session: Session,
    *,
    project_id: int,
    conversation_id: int,
    run_id: str,
    status: str,
    projection: bool,
    error_code: str = "",
) -> ChatRun:
    source = Message(
        conversation_id=conversation_id,
        role="user",
        content=f"PRIVATE-SOURCE-{run_id}",
    )
    assistant = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=f"PRIVATE-ASSISTANT-{run_id}",
    )
    assistant.set_metadata(
        {"run_rollout": {"run_id": run_id if projection else f"wrong-{run_id}"}}
    )
    session.add(source)
    session.add(assistant)
    session.flush()
    task = _task(session, conversation_id, status=status)
    run = ChatRun(
        run_id=run_id,
        task_run_id=int(task.id or 0),
        conversation_id=conversation_id,
        project_id=project_id,
        source_message_id=int(source.id or 0),
        assistant_message_id=int(assistant.id or 0),
        status=status,
        phase="model_stream",
        error_code=error_code,
        retryable=True,
    )
    session.add(run)
    session.flush()
    return run


def test_recovery_center_indexes_ready_continued_and_missing_runs_without_content() -> None:
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Recovery", client="Client")
            session.add(project)
            session.flush()
            conversation = Conversation(title="关键工作流", project_id=int(project.id or 0))
            session.add(conversation)
            session.flush()
            project_id = int(project.id or 0)
            conversation_id = int(conversation.id or 0)

            ready = _terminal_run(
                session,
                project_id=project_id,
                conversation_id=conversation_id,
                run_id="run_ready",
                status="interrupted",
                projection=True,
                error_code="CHAT_RUN_WORKER_LEASE_EXPIRED",
            )
            steering = Message(
                conversation_id=conversation_id,
                role="user",
                content="PRIVATE-UNAPPLIED-STEERING",
            )
            session.add(steering)
            session.flush()
            steering_id = int(steering.id or 0)
            session.add(
                ChatRunInput(
                    run_id=ready.run_id,
                    chat_run_id=int(ready.id or 0),
                    conversation_id=conversation_id,
                    message_id=steering_id,
                    kind="steering",
                    sequence=1,
                    content_sha256="a" * 64,
                    status="unapplied",
                )
            )

            continued = _terminal_run(
                session,
                project_id=project_id,
                conversation_id=conversation_id,
                run_id="run_continued",
                status="failed",
                projection=True,
                error_code="MODEL_UPSTREAM_TIMEOUT",
            )
            child_task = _task(session, conversation_id, status="completed")
            session.add(
                ChatRun(
                    run_id="run_child",
                    task_run_id=int(child_task.id or 0),
                    parent_run_id=continued.run_id,
                    recovery_snapshot_sha256="b" * 64,
                    conversation_id=conversation_id,
                    project_id=project_id,
                    status="completed",
                    phase="completed",
                )
            )
            _terminal_run(
                session,
                project_id=project_id,
                conversation_id=conversation_id,
                run_id="run_missing",
                status="cancelled",
                projection=False,
            )
            session.commit()

            payload = build_project_recovery_center(session, project_id=project_id)

        by_id = {item["run_id"]: item for item in payload["items"]}
        summary = payload["summary"]
        assert summary["returned_count"] == 3
        assert summary["ready_count"] == 1
        assert summary["continued_count"] == 1
        assert summary["projection_missing_count"] == 1
        assert summary["attention_count"] == 2
        assert summary["unapplied_input_count"] == 1
        assert summary["oldest_attention_at"] in {
            by_id["run_ready"]["updated_at"],
            by_id["run_missing"]["updated_at"],
        }
        assert summary["truncated"] is False
        assert by_id["run_ready"]["recovery_state"] == "ready"
        assert by_id["run_ready"]["reason"] == {
            "category": "worker_lost",
            "code": "CHAT_RUN_WORKER_LEASE_EXPIRED",
        }
        assert by_id["run_ready"]["unapplied_input_message_ids"] == [steering_id]
        assert by_id["run_continued"]["recovery_state"] == "continued"
        assert by_id["run_continued"]["child_run"]["run_id"] == "run_child"
        assert by_id["run_missing"]["recovery_state"] == "projection_missing"
        assert by_id["run_missing"]["reason"]["category"] == "user_cancelled"
        assert payload["privacy"]["includes_message_content"] is False
        serialized = json.dumps(payload, ensure_ascii=False)
        assert "PRIVATE-" not in serialized
        assert '"lease_token":' not in serialized
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_recovery_center_route_enforces_project_access_and_bounds_window() -> None:
    engine = _engine()
    try:
        with Session(engine) as session:
            member = User(email="member@example.com", password_hash="x")
            outsider = User(email="outsider@example.com", password_hash="x")
            project = Project(name="Recovery", client="Client")
            session.add(member)
            session.add(outsider)
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id or 0),
                    user_id=int(member.id or 0),
                    role="viewer",
                )
            )
            conversation = Conversation(title="Shared", project_id=int(project.id or 0))
            session.add(conversation)
            session.flush()
            for index in range(3):
                _terminal_run(
                    session,
                    project_id=int(project.id or 0),
                    conversation_id=int(conversation.id or 0),
                    run_id=f"run_window_{index}",
                    status="failed",
                    projection=True,
                )
            session.commit()

            payload = get_project_recovery_center(
                int(project.id or 0),
                limit=2,
                session=session,
                current_user=member,
            )
            assert len(payload["items"]) == 2
            assert payload["summary"]["truncated"] is True

            with pytest.raises(HTTPException) as exc:
                get_project_recovery_center(
                    int(project.id or 0),
                    session=session,
                    current_user=outsider,
                )
            assert exc.value.status_code == 403
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()
