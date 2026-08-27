from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ChatRun,
    Conversation,
    Message,
    Project,
    ProjectMember,
    TaskRun,
    User,
)
from app.routers import chat as chat_router_module
from app.routers import chat_diagnostics as chat_diagnostics_module
from app.services.agent_harness.run_rollout import (
    begin_chat_rollout,
    checkpoint_chat_rollout,
    finalize_chat_rollout,
)
from app.services.chat_store import delete_conversation_with_messages


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_chat_run_projects_content_free_lifecycle() -> None:
    engine = _engine()
    with Session(engine) as session:
        project = Project(name="Run test", client="Client")
        session.add(project)
        session.flush()
        conversation = Conversation(project_id=project.id, title="Lifecycle")
        session.add(conversation)
        session.flush()
        source = Message(conversation_id=conversation.id, role="user", content="secret request")
        session.add(source)
        session.commit()
        project_id = int(project.id)
        conversation_id = int(conversation.id)

    runtime = SimpleNamespace(
        conv_id=conversation_id,
        project_id=project_id,
        selected_model="provider-model",
        chat_mode="agent",
        action_policy="read_only_tool",
        context_manifest={},
        skill_id=None,
        skill_name="",
    )
    task_id = begin_chat_rollout(engine, runtime, "secret request", "run_lifecycle")

    step = SimpleNamespace(
        index=0,
        status="completed",
        retryable=False,
        retry_count=0,
        duration_ms=25,
        truncated=False,
        error="",
        model_text="private model answer",
        tool_calls=[{"id": "tool_1", "name": "read_project_file", "input": {"file_id": 7}}],
    )
    state = SimpleNamespace(
        tool_call_events=[{
            "tool_use_id": "tool_1",
            "tool_name": "read_project_file",
            "step_index": 0,
            "status": "success",
        }],
    )
    checkpoint_chat_rollout(engine, task_id, step, state)
    snapshot = finalize_chat_rollout(
        engine,
        task_id,
        status="completed",
        phase="persist",
        run_outputs=[{"output_id": "output_1", "output_type": "artifact"}],
    )

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == "run_lifecycle")).one()
        assert run.status == "completed"
        assert run.display_mode == "contextual"
        assert run.step_count == 1
        assert run.tool_call_count == 1
        assert run.output_count == len(snapshot["run_outputs"])
        assert run.completed_at is not None
        serialized = str(run.model_dump())
        assert "secret request" not in serialized
        assert "private model answer" not in serialized
        assert len(run.request_sha256) == 64


def test_chat_run_records_waiting_confirmation_as_non_terminal_view_state() -> None:
    engine = _engine()
    with Session(engine) as session:
        project = Project(name="Run test", client="Client")
        session.add(project)
        session.flush()
        conversation = Conversation(project_id=project.id)
        session.add(conversation)
        session.flush()
        session.add(Message(conversation_id=conversation.id, role="user", content="delete file"))
        session.commit()
        runtime = SimpleNamespace(
            conv_id=int(conversation.id),
            project_id=int(project.id),
            selected_model="model",
            chat_mode="agent",
            action_policy="destructive_action",
            context_manifest={},
            skill_id=None,
            skill_name="",
        )

    task_id = begin_chat_rollout(engine, runtime, "delete file", "run_confirm_projection")
    finalize_chat_rollout(engine, task_id, status="waiting_confirmation", phase="persist")

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == "run_confirm_projection")).one()
        assert run.status == "waiting_confirmation"
        assert run.display_mode == "confirmation"
        assert run.retryable is False


def test_chat_run_routes_enforce_project_and_conversation_access() -> None:
    engine = _engine()
    with Session(engine) as session:
        owner = User(email="run-owner@example.com", password_hash="x")
        outsider = User(email="run-outsider@example.com", password_hash="x")
        session.add(owner)
        session.add(outsider)
        session.flush()
        project = Project(name="Private run project", client="Client")
        session.add(project)
        session.flush()
        session.add(ProjectMember(project_id=project.id, user_id=owner.id, role="owner"))
        conversation = Conversation(
            project_id=project.id,
            owner_user_id=owner.id,
            title="Private run",
        )
        session.add(conversation)
        session.flush()
        source = Message(
            conversation_id=conversation.id,
            role="user",
            content="confidential source request",
        )
        session.add(source)
        session.flush()
        task = TaskRun(
            conversation_id=conversation.id,
            task_type="chat_rollout",
            status="completed",
        )
        session.add(task)
        session.flush()
        session.add(
            ChatRun(
                run_id="run_private_route",
                task_run_id=task.id,
                conversation_id=conversation.id,
                project_id=project.id,
                owner_user_id=owner.id,
                source_message_id=source.id,
                status="completed",
                request_sha256="a" * 64,
            )
        )
        session.commit()
        owner_id = int(owner.id)
        outsider_id = int(outsider.id)
        project_id = int(project.id)

    current_user_id = [owner_id]

    def get_test_session():
        with Session(engine) as session:
            yield session

    def get_test_user():
        with Session(engine) as session:
            return session.get(User, current_user_id[0])

    app = FastAPI()
    app.include_router(chat_router_module.router)
    app.dependency_overrides[chat_diagnostics_module.get_session] = get_test_session
    app.dependency_overrides[chat_diagnostics_module.get_current_user] = get_test_user

    with TestClient(app) as client:
        project_response = client.get(f"/chat/projects/{project_id}/runs")
        assert project_response.status_code == 200, project_response.text
        assert project_response.json()["runs"][0]["run_id"] == "run_private_route"
        assert "request_sha256" not in project_response.json()["runs"][0]
        assert "confidential source request" not in project_response.text

        run_response = client.get("/chat/runs/run_private_route")
        assert run_response.status_code == 200, run_response.text

        current_user_id[0] = outsider_id
        assert client.get(f"/chat/projects/{project_id}/runs").status_code == 403
        assert client.get("/chat/runs/run_private_route").status_code == 403

    engine.dispose()


def test_deleting_conversation_removes_run_projection_and_detaches_task() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation = Conversation(title="Disposable run")
        session.add(conversation)
        session.flush()
        session.add(Message(conversation_id=conversation.id, role="user", content="temporary"))
        session.commit()
        conversation_id = int(conversation.id)

    runtime = SimpleNamespace(
        conv_id=conversation_id,
        project_id=None,
        selected_model="model",
        chat_mode="chat",
        action_policy="direct_answer",
        context_manifest={},
        skill_id=None,
        skill_name="",
    )
    task_id = begin_chat_rollout(engine, runtime, "temporary", "run_delete_conversation")

    with Session(engine) as session:
        delete_conversation_with_messages(session, conversation_id)

    with Session(engine) as session:
        assert session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_delete_conversation")
        ).first() is None
        task = session.get(TaskRun, task_id)
        assert task is not None
        assert task.conversation_id is None

    engine.dispose()
