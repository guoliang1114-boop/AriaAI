from __future__ import annotations

import asyncio
import json
import re

from sqlmodel import Session, SQLModel, select

from app.models.db import Project, ProjectFile, TaskArtifact, TaskEvent, TaskRun, TaskStep
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


def test_rule_router_routes_markdown_artifacts():
    assert detect_project_task_type("帮我整理一份项目风险清单") == "create_text_artifact"
    assert detect_project_task_type("这个故事线 不行 至少有 10个章节 需要1级和2级目录") == "create_text_artifact"
    assert detect_project_task_type("帮我做一个 MECE 问题树，拆成一级和二级议题") == "create_text_artifact"


def test_router_keeps_diagnostic_chat_as_direct_answer():
    route = asyncio.run(route_project_task_request("你看这个聊天记录生成的内容是不是有问题？"))

    assert route.task_type is None
    assert route.reason == "rule:direct_diagnostic"


def test_router_keeps_structured_memory_overview_as_direct_answer():
    content = "请基于当前项目的结构化记忆，给我一个 5 条以内的项目概览摘要，覆盖当前阶段、关键进展、风险和下一步动作。"
    route = asyncio.run(route_project_task_request(content))

    assert route.task_type is None
    assert route.reason == "rule:direct_memory_summary"


def test_router_allows_memory_summary_when_user_explicitly_asks_for_file():
    content = "请基于当前项目的结构化记忆，生成一个 md 文档，整理项目概览摘要和风险。"
    route = asyncio.run(route_project_task_request(content))

    assert route.task_type == "create_text_artifact"


def test_ppt_slide_count_request_is_extracted_and_used():
    assert task_orchestrator._extract_requested_slide_count("内容不够丰富，页数要求20页以上") == 20
    assert task_orchestrator._extract_requested_slide_count("make at least 22 slides") == 22
    assert task_orchestrator._extract_requested_slide_count("准备一个 50 页的 PPT") == 50

    context = {
        "project": {"name": "东阿阿胶新业务进入机会和策略", "client": "东阿阿胶股份有限公司"},
        "memory": {"project_brief": "探索功能性护肤品/医美抗衰赛道的新业务机会。"},
        "client_memory": {},
        "meeting_card": {},
    }
    slides = task_orchestrator._build_client_ppt_slides(
        context,
        "内容不够丰富，对这个 PPT 进行全面丰富 页数要求20页以上",
    )

    assert len(slides) >= 20
    assert slides[0]["title"] == "东阿阿胶新业务进入机会和策略客户沟通建议"
    assert any(slide["title"] == "资料收集计划" for slide in slides)
    assert any(slide["title"] == "商业验证假设" for slide in slides)
    assert any(slide.get("layout_key") == "roadmap" for slide in slides)
    assert any(slide.get("layout_key") == "prioritization_matrix" for slide in slides)
    assert all(slide.get("insight") for slide in slides if slide.get("layout_key"))


def test_large_ppt_request_generates_distinct_story_pages_without_filler_titles():
    context = {
        "project": {"name": "东阿阿胶新业务进入机会和策略", "client": "东阿阿胶股份有限公司"},
        "memory": {
            "project_brief": "探索功能性护肤品/医美抗衰赛道的新业务机会。",
            "recent_progress": ["已完成项目需求梳理。"],
        },
        "client_memory": {"sensitive_topics": ["品牌高端化战略调整背景下需注意品牌调性一致性"]},
        "meeting_card": {"avoid": ["品牌高端化战略调整背景下需注意品牌调性一致性"]},
    }

    slides = task_orchestrator._build_client_ppt_slides(
        context,
        "准备一个 50 页的 PPT 和客户沟通，要求适合大前期的战略沟通",
    )
    titles = [slide["title"] for slide in slides]

    assert len(slides) >= 50
    assert len(titles) == len(set(titles))
    assert not any("补充视角" in title for title in titles)
    assert "赛道宏观吸引力" in titles
    assert "最小验证路径" in titles
    assert "决策门与退出条件" in titles
    assert all(slide.get("insight") for slide in slides if slide.get("layout_key"))


def test_client_ppt_delivery_title_and_file_name_are_clean():
    context = {
        "project": {"name": "东阿阿胶新业务进入机会和策略", "client": "东阿阿胶股份有限公司"},
    }

    title = task_orchestrator._client_ppt_delivery_title(
        context,
        "好，给我一个初步沟通的方案，生成 PPT 版本",
    )
    enriched_title = task_orchestrator._client_ppt_delivery_title(
        context,
        "内容不够丰富，对这个 PPT 进行全面丰富 页数要求20页以上",
    )
    repeated_project_title = task_orchestrator._client_ppt_delivery_title(
        context,
        "东阿阿胶新业务进入机会和策略 东阿阿胶新业务进入机会和策略 客户沟通建议",
    )

    assert title == "东阿阿胶新业务进入机会和策略-初步沟通方案"
    assert enriched_title == "东阿阿胶新业务进入机会和策略客户沟通建议"
    assert repeated_project_title == "东阿阿胶新业务进入机会和策略客户沟通建议"
    assert task_orchestrator._client_ppt_file_name(enriched_title) == "东阿阿胶新业务进入机会和策略客户沟通建议.pptx"
    assert "内容不够丰富" not in task_orchestrator._client_ppt_file_name(enriched_title)


def test_llm_router_uses_structured_plan():
    async def fake_complete(*args, **kwargs):
        return json.dumps(
            {
                "task_type": "create_text_artifact",
                "confidence": 0.91,
                "reason": "structured text deliverable",
                "title": "项目风险清单",
                "output_kind": "md",
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


def test_llm_router_keeps_explicit_ppt_creation_when_llm_says_no_task():
    async def fake_complete(*args, **kwargs):
        return json.dumps(
            {
                "task_type": None,
                "confidence": 0.88,
                "reason": "mistaken ordinary chat",
                "title": "",
                "output_kind": None,
                "plan_steps": [],
            },
            ensure_ascii=False,
        )

    route = asyncio.run(route_project_task_request("好，给我一个初步沟通的方案，生成 PPT 版本", llm_complete=fake_complete, model="test"))

    assert route.task_type == "generate_client_ppt"
    assert route.reason == "rule:ppt"


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


def test_execute_text_artifact_task_records_markdown_project_file(monkeypatch, tmp_path):
    engine = _setup_engine()
    monkeypatch.setattr(task_orchestrator, "UPLOADS_DIR", tmp_path)
    goal = (
        "请帮我准备一次客户会议。项目：东阿阿胶新业务进入机会和策略，客户：东阿阿胶股份有限公司。"
        "请输出：1）开场话术；2）关键议题顺序；3）每个关键人应关注的表达方式；4）会后行动清单。"
    )
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
                goal=goal,
            )

            asyncio.run(execute_task_run_in_session(session, task.id))
            session.refresh(task)
            steps = session.exec(select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)).all()
            artifacts = session.exec(select(TaskArtifact).where(TaskArtifact.task_run_id == task.id)).all()
            project_files = session.exec(select(ProjectFile).where(ProjectFile.project_id == project.id)).all()

        assert task.status == "completed"
        assert [step.key for step in steps] == ["collect_context", "draft_text_artifact", "summarize_result"]
        assert artifacts and artifacts[0].file_type == "md"
        assert artifacts[0].project_file_id
        assert artifacts[0].path
        assert project_files and project_files[0].file_type == "md"
        assert project_files[0].name.endswith(".md")
        assert len(project_files[0].name.encode("utf-8")) <= 120
        assert len((tmp_path / project_files[0].path).name.encode("utf-8")) <= 255
        assert (tmp_path / project_files[0].path).is_file()
        metadata = json.loads(artifacts[0].metadata_json)
        assert "客户会议准备" in metadata["title"]
        assert metadata["text_spec"]["strict_sections"] is True
        assert metadata["text_spec"]["sections"] == [
            "开场话术",
            "关键议题顺序",
            "每个关键人应关注的表达方式",
            "会后行动清单",
        ]
        assert "## 开场话术" in metadata["content"]
        assert "## 关键议题顺序" in metadata["content"]
        assert "## 每个关键人应关注的表达方式" in metadata["content"]
        assert "## 会后行动清单" in metadata["content"]
        assert "## 项目背景" not in metadata["content"]
        assert "## 关键风险" not in metadata["content"]
        assert metadata["project_file_id"] == project_files[0].id
        assert metadata["path"] == project_files[0].path
        assert metadata["content"].startswith("#")
    finally:
        engine.dispose()


def test_text_artifact_storyline_request_uses_storyline_structure():
    context = {
        "project": {"name": "东阿阿胶新业务进入机会和策略", "client": "东阿阿胶股份有限公司"},
        "memory": {"project_brief": "探索功能性护肤品新业务进入机会。"},
        "client_memory": {},
        "stakeholders": [],
    }

    result = task_orchestrator._build_text_artifact(
        context,
        "给我准备一个和客户沟通的初步大纲storyline",
    )

    assert result["title"] == "东阿阿胶新业务进入机会和策略-客户战略沟通故事线大纲"
    assert "# 01. 项目背景与沟通目标" in result["content"]
    assert "## 1.1 为什么现在讨论" in result["content"]
    assert "## 10.1 24 小时内输出会议纪要" in result["content"]
    assert "## 项目背景" not in result["content"]
    assert "关键风险" not in result["content"]


def test_text_artifact_storyline_respects_requested_chapter_count_and_hierarchy():
    context = {
        "project": {"name": "东阿阿胶新业务进入机会和策略", "client": "东阿阿胶股份有限公司"},
        "memory": {"project_brief": "探索功能性护肤品新业务进入机会。"},
        "client_memory": {},
        "stakeholders": [],
    }

    result = task_orchestrator._build_text_artifact(
        context,
        "这个故事线 不行 至少有 10个章节 需要1级和2级目录",
    )

    h1_chapters = [
        line for line in result["content"].splitlines()
        if re.match(r"^# \d{2}\. ", line)
    ]
    h2_items = [
        line for line in result["content"].splitlines()
        if re.match(r"^## \d+\.\d+ ", line)
    ]

    assert result["title"] == "东阿阿胶新业务进入机会和策略-客户战略沟通故事线大纲"
    assert len(h1_chapters) >= 10
    assert len(h2_items) >= 20
    assert result["text_spec"]["chapter_count"] == 10
    assert result["text_spec"]["hierarchy"] == "h1_h2"
    assert "这个故事线 不行" not in result["title"]
    assert result["text_spec"]["capability_id"] == "consulting_storyline"
    assert "必须有一级和二级目录" in result["text_spec"]["quality_rules"]


def test_text_artifact_uses_consulting_capability_catalog_for_issue_tree():
    context = {
        "project": {"name": "东阿阿胶新业务进入机会和策略", "client": "东阿阿胶股份有限公司"},
        "memory": {"project_brief": "探索功能性护肤品新业务进入机会。"},
        "client_memory": {},
        "stakeholders": [],
    }

    result = task_orchestrator._build_text_artifact(
        context,
        "帮我做一个 MECE 问题树，拆成一级和二级议题",
    )

    assert result["title"] == "东阿阿胶新业务进入机会和策略-问题树拆解"
    assert result["text_spec"]["capability_id"] == "issue_tree"
    assert "## 核心问题" in result["content"]
    assert "## 一级议题" in result["content"]
    assert "## 二级议题" in result["content"]
    assert "层级互斥且穷尽" in result["text_spec"]["quality_rules"]


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
