from types import SimpleNamespace

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ChatRun, Conversation, Message
from app.services.agent_harness.run_rollout import (
    begin_chat_rollout,
    finalize_chat_rollout,
)


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_chat_rollout_creates_and_finalizes_first_class_run_projection() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation = Conversation(title="Projection test")
        session.add(conversation)
        session.flush()
        session.add(Message(conversation_id=conversation.id, role="user", content="private request"))
        session.commit()
        conversation_id = int(conversation.id)

    runtime = SimpleNamespace(
        conv_id=conversation_id,
        project_id=None,
        context_manifest={},
        selected_model="provider-model",
        chat_mode="project_chat",
        action_policy="direct_answer",
        skill_id=None,
        skill_name="",
    )
    task_id = begin_chat_rollout(engine, runtime, "private request", "run_projection")

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == "run_projection")).one()
        assert run.task_run_id == task_id
        assert run.status == "running"
        assert run.display_mode == "quiet"
        assert run.request_sha256
        assert "private request" not in str(run)

    snapshot = finalize_chat_rollout(
        engine,
        task_id,
        status="completed",
        phase="persist",
    )
    assert snapshot["status"] == "completed"

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == "run_projection")).one()
        assert run.status == "completed"
        assert run.phase == "persist"
        assert run.completed_at is not None
        assert run.duration_ms >= 0
