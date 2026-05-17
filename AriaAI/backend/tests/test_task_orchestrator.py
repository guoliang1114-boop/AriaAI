from __future__ import annotations

import asyncio
import json

from sqlmodel import Session, SQLModel, select

from app.models.db import Project, TaskArtifact, TaskEvent, TaskRun, TaskStep
from app.services import task_orchestrator
from app.services.task_orchestrator import (
    create_task_run,
    detect_project_task_type,
    execute_task_run_in_session,
    serialize_task_run,
    task_run_chat_summary,
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
        json.dumps(payload, ensure_ascii=False)
        assert isinstance(payload["created_at"], str)
        assert isinstance(payload["steps"][0]["created_at"], str)
        assert isinstance(payload["events"][0]["created_at"], str)
        assert [step["key"] for step in payload["steps"]] == [
            "collect_context",
            "draft_slide_spec",
            "create_deck",
            "summarize_result",
        ]
        assert payload["events"][0]["event_type"] == "task_created"
    finally:
        engine.dispose()


def test_detect_project_task_type_routes_ppt_creation_requests():
    assert detect_project_task_type("给客户准备一个 PPT 介绍") == "generate_client_ppt"
    assert detect_project_task_type("please create a powerpoint deck for the client") == "generate_client_ppt"
    assert detect_project_task_type("我想要准备一个访谈的excel") == "generate_project_excel"
    assert detect_project_task_type("帮我生成一份项目总结word文档") == "generate_project_docx"
    assert detect_project_task_type("输出一个客户沟通pdf") == "generate_project_pdf"
    assert detect_project_task_type("这个项目风险是什么") is None
    assert detect_project_task_type("介绍一下这个报告的重点") is None


def test_task_run_chat_summary_mentions_steps_and_retry_hint():
    payload = {
        "id": 7,
        "goal": "给客户准备 PPT",
        "status": "failed",
        "steps": [
            {"title": "收集项目上下文", "status": "completed"},
            {"title": "生成并保存 PPT", "status": "failed", "error_message": "template unavailable"},
        ],
        "artifacts": [],
    }

    summary = task_run_chat_summary(payload)

    assert "任务 ID：7" in summary
    assert "收集项目上下文：完成" in summary
    assert "生成并保存 PPT：失败" in summary
    assert "失败步骤重试" in summary


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


def test_execute_project_excel_task_uses_durable_document_steps(monkeypatch):
    engine = _setup_engine()

    async def fake_write_project_office_document(**kwargs):
        assert kwargs["project_id"]
        assert kwargs["file_type"] == "xlsx"
        assert kwargs["sheets"][0]["name"] == "访谈计划"
        return {
            "ok": True,
            "id": None,
            "name": kwargs["file_name"],
            "file_type": "xlsx",
            "path": "projects/1/generated/interview.xlsx",
        }

    monkeypatch.setattr(task_orchestrator, "write_project_office_document", fake_write_project_office_document)
    try:
        with Session(engine) as session:
            project = Project(name="Excel Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_project_excel",
                goal="我想要准备一个访谈的excel",
                input_data={"file_name": "interview.xlsx"},
            )

            asyncio.run(execute_task_run_in_session(session, task.id))
            session.refresh(task)
            steps = session.exec(select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)).all()
            artifacts = session.exec(select(TaskArtifact).where(TaskArtifact.task_run_id == task.id)).all()

        assert task.status == "completed"
        assert [step.key for step in steps] == ["collect_context", "draft_document_spec", "create_document", "summarize_result"]
        assert all(step.status == "completed" for step in steps)
        assert artifacts and artifacts[0].file_type == "xlsx"
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
