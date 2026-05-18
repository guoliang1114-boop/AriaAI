from __future__ import annotations

import asyncio
import json

from sqlmodel import Session, SQLModel, select

from app.models.db import Project, TaskArtifact, TaskEvent, TaskRun, TaskStep
from app.services import task_orchestrator
from app.services.task_orchestrator import (
    cancel_task_run_in_session,
    create_task_run,
    detect_project_task_type,
    execute_task_run_in_session,
    pause_task_run_in_session,
    resume_task_run_in_session,
    route_project_task_request,
    serialize_task_run,
    task_run_chat_brief,
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


def test_rule_router_routes_text_artifacts_without_file_output():
    assert detect_project_task_type("帮我整理一份项目风险清单") == "create_text_artifact"


def test_llm_router_uses_structured_plan():
    async def fake_complete(*args, **kwargs):
        return json.dumps(
            {
                "task_type": "create_text_artifact",
                "confidence": 0.91,
                "reason": "structured text deliverable",
                "title": "项目风险清单",
                "output_kind": "text",
                "plan_steps": [
                    {"key": "collect", "title": "收集上下文", "step_type": "collect_project_context", "retryable": True},
                    {"key": "draft", "title": "生成风险清单", "step_type": "draft_text_artifact", "retryable": True},
                    {"key": "finish", "title": "整理结果", "step_type": "summarize_result", "retryable": False},
                ],
            },
            ensure_ascii=False,
        )

    route = asyncio.run(route_project_task_request("帮我整理一份项目风险清单", llm_complete=fake_complete, model="test"))

    assert route.task_type == "create_text_artifact"
    assert route.title == "项目风险清单"
    assert [step.step_type for step in route.plan_steps] == [
        "collect_project_context",
        "draft_text_artifact",
        "summarize_result",
    ]


def test_llm_router_normalizes_common_step_aliases():
    async def fake_complete(*args, **kwargs):
        return json.dumps(
            {
                "task_type": "generate_project_excel",
                "confidence": 0.92,
                "reason": "excel deliverable",
                "title": "访谈 Q&A",
                "output_kind": "xlsx",
                "plan_steps": [
                    {"key": "context", "title": "收集访谈背景", "step_type": "collect_context"},
                    {"key": "build_spec", "title": "构建Q&A文档规格", "step_type": "build_spec"},
                    {"key": "write", "title": "生成Excel文件", "step_type": "create_file"},
                    {"key": "finish", "title": "汇总生成结果", "step_type": "finalize", "retryable": False},
                ],
            },
            ensure_ascii=False,
        )

    route = asyncio.run(route_project_task_request("我想要准备一个访谈的excel", llm_complete=fake_complete, model="test"))

    assert route.task_type == "generate_project_excel"
    assert [step.step_type for step in route.plan_steps] == [
        "collect_project_context",
        "build_document_spec",
        "write_project_office_document",
        "summarize_result",
    ]


def test_task_run_chat_summary_mentions_steps_and_retry_hint():
    payload = {
        "id": 7,
        "goal": "给客户准备 PPT",
        "status": "failed",
        "steps": [
            {"id": 11, "title": "收集项目上下文", "status": "completed"},
            {"id": 12, "title": "生成并保存 PPT", "status": "failed", "error_message": "template unavailable"},
        ],
        "events": [
            {
                "event_type": "task_created",
                "message": "任务已创建",
                "payload": {"task_type": "generate_client_ppt"},
                "created_at": "2026-05-18T10:00:00",
            },
            {
                "step_id": 11,
                "event_type": "step_completed",
                "message": "收集项目上下文完成",
                "payload": {"project": {"name": "PPT Project", "client": "Client"}},
                "created_at": "2026-05-18T10:00:01",
            },
            {
                "step_id": 12,
                "event_type": "step_failed",
                "message": "生成并保存 PPT失败：template unavailable",
                "payload": {"error_code": "RuntimeError", "retryable": True},
                "created_at": "2026-05-18T10:00:02",
            },
        ],
        "artifacts": [],
    }

    summary = task_run_chat_summary(payload)

    assert "任务 ID：7" in summary
    assert "收集项目上下文：完成" in summary
    assert "生成并保存 PPT：失败" in summary
    assert "详细执行日志" in summary
    assert "任务类型：generate_client_ppt" in summary
    assert "项目：PPT Project；客户：Client" in summary
    assert "RuntimeError，可重试" in summary
    assert "失败步骤重试" in summary


def test_task_run_chat_brief_points_failed_tasks_to_task_panel():
    payload = {
        "goal": "我想要准备一个访谈的excel",
        "status": "failed",
        "steps": [
            {"sort_order": 1, "title": "收集访谈背景", "status": "completed"},
            {"sort_order": 2, "title": "构建Q&A文档规格", "status": "failed", "error_message": "Unsupported step"},
        ],
        "artifacts": [],
    }

    brief = task_run_chat_brief(payload)

    assert "第 2 步" in brief
    assert "构建Q&A文档规格" in brief
    assert "打开任务面板处理" in brief
    assert "编排日志" not in brief


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
        assert len(kwargs["sheets"][0]["data"]) >= 8
        sheet_names = {sheet["name"] for sheet in kwargs["sheets"]}
        assert "关键干系人" in sheet_names
        assert "项目上下文" in sheet_names
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


def test_execute_text_artifact_task_records_text_artifact():
    engine = _setup_engine()
    try:
        with Session(engine) as session:
            project = Project(name="Text Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="create_text_artifact",
                goal="帮我整理一份项目风险清单",
            )

            asyncio.run(execute_task_run_in_session(session, task.id))
            session.refresh(task)
            steps = session.exec(select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)).all()
            artifacts = session.exec(select(TaskArtifact).where(TaskArtifact.task_run_id == task.id)).all()

        assert task.status == "completed"
        assert [step.key for step in steps] == ["collect_context", "draft_text_artifact", "summarize_result"]
        assert artifacts and artifacts[0].file_type == "text"
        metadata = json.loads(artifacts[0].metadata_json)
        assert "项目风险清单" in metadata["title"]
        assert metadata["content"].startswith("#")
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


def test_cancel_task_run_marks_pending_steps_skipped():
    engine = _setup_engine()
    try:
        with Session(engine) as session:
            project = Project(name="Cancel Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_project_excel",
                goal="准备访谈 Excel",
            )

            payload = cancel_task_run_in_session(session, task.id)

        assert payload is not None
        assert payload["status"] == "canceled"
        assert payload["error_code"] == "canceled"
        assert all(step["status"] == "skipped" for step in payload["steps"])
        assert any(event["event_type"] == "task_canceled" for event in payload["events"])
    finally:
        engine.dispose()


def test_cancel_task_run_keeps_running_step_until_executor_stops():
    engine = _setup_engine()
    try:
        with Session(engine) as session:
            project = Project(name="Cancel Running Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_project_excel",
                goal="准备访谈 Excel",
            )
            step = session.exec(select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)).first()
            step.status = "running"
            session.add(step)
            session.commit()

            payload = cancel_task_run_in_session(session, task.id)

        assert payload is not None
        assert payload["status"] == "canceled"
        assert payload["steps"][0]["status"] == "running"
        assert all(step["status"] == "skipped" for step in payload["steps"][1:])
    finally:
        engine.dispose()


def test_pause_task_run_records_event_without_skipping_steps():
    engine = _setup_engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pause Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_project_excel",
                goal="准备访谈 Excel",
            )

            payload = pause_task_run_in_session(session, task.id)

        assert payload is not None
        assert payload["status"] == "paused"
        assert all(step["status"] == "pending" for step in payload["steps"])
        assert any(event["event_type"] == "task_paused" for event in payload["events"])
    finally:
        engine.dispose()


def test_resume_task_run_sets_pending_and_records_event():
    engine = _setup_engine()
    try:
        with Session(engine) as session:
            project = Project(name="Resume Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            task = create_task_run(
                session,
                project_id=project.id,
                task_type="generate_project_excel",
                goal="准备访谈 Excel",
            )
            pause_task_run_in_session(session, task.id)

            payload = resume_task_run_in_session(session, task.id)

        assert payload is not None
        assert payload["status"] == "pending"
        assert any(event["event_type"] == "task_resumed" for event in payload["events"])
    finally:
        engine.dispose()
