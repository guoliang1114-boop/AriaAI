import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine

from app.models.db import ChatRun, ChatTrace, Conversation, Message, TaskRun
from app.routers import chat_diagnostics
from app.services.chat.latency_report import build_latency_report


def test_latency_separates_outcomes_missing_measurements_and_malformed_data():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conversation = Conversation(title="private business topic")
        session.add(conversation)
        session.flush()
        for index, (status, duration, timings) in enumerate([
            ("completed", 100, {"provider_text_ms": 20}),
            ("completed", 200, {"provider_text_ms": 60}),
            ("failed", 60000, {"provider_headers_ms": 500}),
            ("cancelled", 5000, {"provider_text_ms": True, "provider_tool_ms": -10}),
            ("waiting_confirmation", 800, {"provider_tool_ms": 100}),
        ]):
            message = Message(conversation_id=conversation.id, role="assistant", content="SECRET_ANSWER")
            session.add(message)
            task = TaskRun(conversation_id=conversation.id, task_type="chat_rollout", status=status)
            session.add(task)
            session.flush()
            session.add(ChatRun(run_id=f"latency-{index}", task_run_id=task.id, conversation_id=conversation.id, assistant_message_id=message.id,
                                model="test-model", status=status, duration_ms=duration))
            session.add(ChatTrace(trace_id=f"trace-{index}", conversation_id=conversation.id, message_id=message.id,
                                  stage_timings_json=json.dumps(timings), metadata_json='{"secret":"PRIVATE_CONTEXT"}'))
        session.flush()
        report = build_latency_report(session)
        completed = next(row for row in report["groups"] if row["status"] == "completed")
        assert completed["metrics"]["provider_text_ms"] == {"sample_count": 2, "p50_ms": 20, "p95_ms": 60}
        failed = next(row for row in report["groups"] if row["status"] == "failed")
        assert failed["metrics"]["provider_text_ms"] == {"sample_count": 0, "p50_ms": None, "p95_ms": None}
        assert report["outcomes"] == {"waiting_confirmation": 1, "cancelled": 1, "failed": 1, "completed": 2}
        waiting = next(row for row in report["groups"] if row["status"] == "waiting_confirmation")
        assert waiting["metrics"]["provider_tool_ms"]["p50_ms"] == 100
        assert "SECRET" not in json.dumps(report) and "PRIVATE" not in json.dumps(report)
        assert build_latency_report(session, limit=2)["truncated"] is True
    engine.dispose()


def test_latency_endpoint_requires_admin_before_any_database_read():
    app = FastAPI()
    app.include_router(chat_diagnostics.router)
    # No auth token is available. Native require_admin must reject the call.
    response = TestClient(app).get("/diagnostics/latency")
    assert response.status_code in (401, 403)


def test_latency_endpoint_rejects_authenticated_member_before_report_query(monkeypatch):
    from app.models.db import User
    from app.services.chat import latency_report

    app = FastAPI()
    app.include_router(chat_diagnostics.router)
    app.dependency_overrides[chat_diagnostics.get_current_user] = lambda: User(
        id=1, email="member@example.invalid", password_hash="x", is_active=True, is_admin=False,
    )
    reads = []
    monkeypatch.setattr(latency_report, "build_latency_report", lambda *args, **kwargs: reads.append(True))
    response = TestClient(app).get("/diagnostics/latency")
    assert response.status_code == 403
    assert reads == []
