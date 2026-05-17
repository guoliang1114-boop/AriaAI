from __future__ import annotations

import asyncio

from sqlmodel import Session, SQLModel, select

from app.models.db import Project, TaskArtifact, TaskEvent, TaskRun, TaskStep
from app.services import task_orchestrator
from app.services.task_orchestrator import (
    create_task_run,
    execute_task_run_in_session,
    serialize_task_run,
)
from tests.test_database import create_test_engine, drop_all_tables


def _setup_engine():
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    return engine


def test_create_task_run_persists_ordered_steps():
    engine = _setup_engine()
    try:
        with Session(engine) as session:
            project = Project(name="PPT Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)

            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_client_ppt",
                goal="给客户准备介绍 PPT",
            )
            payload = serialize_task_run(session, task, include_events=True)

        assert payload["status"] == "pending"
        assert [step["key"] for step in payload["steps"]] == [
            "collect_context",
            "draft_slide_spec",
            "create_deck",
            "summarize_result",
        ]
        assert payload["events"][0]["event_type"] == "task_created"
    finally:
        engine.dispose()


def test_execute_task_run_completes_and_records_artifact(monkeypatch):
    engine = _setup_engine()

    async def fake_write_project_office_document(**kwargs):
        assert kwargs["project_id"]
        assert kwargs["file_type"] == "pptx"
        assert kwargs["slides"]
        return {
            "ok": True,
            "id": None,
            "name": kwargs["file_name"],
            "file_type": "pptx",
            "path": "projects/1/generated/client-intro.pptx",
        }

    monkeypatch.setattr(task_orchestrator, "write_project_office_document", fake_write_project_office_document)
    try:
        with Session(engine) as session:
            project = Project(name="PPT Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_client_ppt",
                goal="给客户准备介绍 PPT",
                input_data={"file_name": "client-intro.pptx"},
            )

            asyncio.run(execute_task_run_in_session(session, task.id))
            session.refresh(task)
            steps = session.exec(select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)).all()
            artifacts = session.exec(select(TaskArtifact).where(TaskArtifact.task_run_id == task.id)).all()
            events = session.exec(select(TaskEvent).where(TaskEvent.task_run_id == task.id)).all()

        assert task.status == "completed"
        assert all(step.status == "completed" for step in steps)
        assert artifacts and artifacts[0].file_type == "pptx"
        assert any(event.event_type == "task_completed" for event in events)
    finally:
        engine.dispose()


def test_execute_task_run_fails_only_current_step(monkeypatch):
    engine = _setup_engine()

    async def fake_write_project_office_document(**kwargs):
        raise RuntimeError("template unavailable")

    monkeypatch.setattr(task_orchestrator, "write_project_office_document", fake_write_project_office_document)
    try:
        with Session(engine) as session:
            project = Project(name="PPT Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_client_ppt",
                goal="给客户准备介绍 PPT",
            )

            asyncio.run(execute_task_run_in_session(session, task.id))
            session.refresh(task)
            steps = session.exec(select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)).all()

        assert task.status == "failed"
        assert [step.status for step in steps] == ["completed", "completed", "failed", "pending"]
        assert steps[2].error_message == "template unavailable"
        assert steps[2].retryable is True
    finally:
        engine.dispose()
