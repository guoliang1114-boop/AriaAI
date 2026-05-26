from __future__ import annotations

import asyncio
from types import SimpleNamespace

from sqlmodel import Session, SQLModel, select

from app.models.db import Conversation, PendingToolAction, Project, ProjectFile
from app.services.chat.phases import p0_durable_task
from app.services.chat.phases.p0_durable_task import run_p0_durable_task
from app.services.chat.state import ChatSessionState
from app.services.project_documents import create_markdown_project_file
from tests.test_database import create_test_engine, drop_all_tables


async def _collect(async_iterable):
    return [item async for item in async_iterable]


def test_p0_continuation_requires_confirmation_before_updating_markdown(monkeypatch, tmp_path):
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(p0_durable_task, "UPLOADS_DIR", tmp_path)

    async def fake_complete(*args, **kwargs):
        return "# 项目背景\n\n这是新版内容。" + "它显著补充了背景、风险、判断和下一步建议。" * 8

    try:
        with Session(engine) as session:
            project = Project(name="Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            conv = Conversation(project_id=project.id)
            session.add(conv)
            session.commit()
            session.refresh(conv)
            project_file = create_markdown_project_file(
                session,
                project.id,
                "项目背景.md",
                "# 项目背景\n\n旧内容，需要加强。",
                uploads_dir=tmp_path,
            )
            project_id = project.id
            conversation_id = conv.id
            project_file_id = project_file.id

        runtime = SimpleNamespace(
            conv_id=conversation_id,
            project_id=project_id,
            selected_model="test-model",
            max_tokens=2000,
            temperature=0.2,
            action_policy="modify_existing_file",
            llm=SimpleNamespace(complete=fake_complete),
            working_memory={
                "current_artifact": {
                    "project_file_id": project_file_id,
                    "name": "项目背景.md",
                    "file_type": "md",
                },
                "continuation_requested": True,
                "explicit_target_filename": "",
            },
        )
        req = SimpleNamespace(project_id=project_id, content="内容不够深刻，继续加强")
        state = ChatSessionState()

        events = asyncio.run(_collect(run_p0_durable_task(runtime, req, engine, state)))

        with Session(engine) as session:
            refreshed = session.get(ProjectFile, project_file_id)
            saved_content = (tmp_path / refreshed.path).read_text(encoding="utf-8")
            pending_action = session.exec(
                select(PendingToolAction).where(PendingToolAction.conversation_id == conversation_id)
            ).first()

        assert state.durable_task_completed is True
        assert "还没有写入文件" in state.full_text
        assert "旧内容" in saved_content
        assert "新版内容" not in saved_content
        assert pending_action is not None
        assert pending_action.status == "pending"
        assert pending_action.tool_name == "update_project_markdown_document"
        assert pending_action.message_id is not None
        assert any('"status": "confirmation_required"' in event for event in events)
    finally:
        engine.dispose()
