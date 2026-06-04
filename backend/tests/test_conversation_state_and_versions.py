from __future__ import annotations

import json
from unittest.mock import patch

from sqlmodel import Session, SQLModel, select

from app.models.db import Conversation, ConversationState, Message, Project, ProjectFileVersion
from app.services.chat_store import persist_assistant_message
from app.services.conversation_state import get_conversation_state_payload
from app.services.project_documents import create_project_document_record, update_project_document_record
from app.services.project_core import init_default_project_folders
from tests.test_database import create_test_engine, drop_all_tables


def _engine():
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    return engine


def test_persist_assistant_message_updates_conversation_state():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Project", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            conv = Conversation(project_id=project.id)
            session.add(conv)
            session.commit()
            session.refresh(conv)
            project_id = project.id
            conv_id = conv.id

        metadata = {
            "project_id": project_id,
            "artifacts": [{"project_file_id": 18, "name": "项目背景.md", "file_type": "md"}],
            "tool_calls": [{"tool_name": "update_project_markdown_document", "status": "completed", "summary": "Updated 项目背景.md"}],
        }
        persist_assistant_message(
            engine,
            conv_id,
            "已更新项目 Markdown 文件：项目背景.md",
            "内容必须更深度，并写入项目背景.md",
            metadata,
        )

        with Session(engine) as session:
            state = session.exec(select(ConversationState).where(ConversationState.conversation_id == conv_id)).first()
            payload = get_conversation_state_payload(session, conv_id)

        assert state is not None
        assert payload["current_artifact"]["name"] == "项目背景.md"
        assert payload["active_file_ids"] == [18]
        assert payload["user_constraints"]
        assert payload["decisions"][0]["summary"] == ["Updated 项目背景.md"]
    finally:
        engine.dispose()


def test_persist_assistant_message_records_state_update_failure():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Project", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            conv = Conversation(project_id=project.id)
            session.add(conv)
            session.commit()
            session.refresh(conv)
            conv_id = conv.id

        with patch("app.services.conversation_state.upsert_conversation_state_from_metadata") as mocked_upsert:
            mocked_upsert.side_effect = RuntimeError("state write failed")
            persist_assistant_message(
                engine,
                conv_id,
                "已生成项目风险提纲",
                "帮我准备项目风险提纲",
                {"project_id": 1},
            )

        with Session(engine) as session:
            message = session.exec(
                select(Message).where(Message.conversation_id == conv_id, Message.role == "assistant")
            ).one()
            metadata = json.loads(message.metadata_json)

        assert metadata["conversation_state_error"]["type"] == "RuntimeError"
        assert "state write failed" in metadata["conversation_state_error"]["message"]
    finally:
        engine.dispose()


def test_persist_assistant_message_replaces_numbered_placeholder_title():
    engine = _engine()
    try:
        with Session(engine) as session:
            conv = Conversation(title="对话 #286")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            conv_id = conv.id

        persist_assistant_message(
            engine,
            conv_id,
            "可以，我来梳理。",
            "梳理一下新疆项目当前风险和下一步动作",
            {},
        )

        with Session(engine) as session:
            updated = session.get(Conversation, conv_id)

        assert updated is not None
        assert updated.title == "梳理一下新疆项目当前风险和下一步动作"
    finally:
        engine.dispose()


def test_project_document_updates_create_version_snapshots(tmp_path):
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Project", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            project_file = create_project_document_record(
                session=session,
                project_id=project.id,
                name="项目背景.md",
                content="# 项目背景\n\n初始内容",
                uploads_dir=tmp_path,
                init_default_folders=init_default_project_folders,
            )
            update_project_document_record(
                session,
                project.id,
                project_file.id,
                uploads_dir=tmp_path,
                init_default_folders=init_default_project_folders,
                content="# 项目背景\n\n第二版内容",
            )
            versions = session.exec(
                select(ProjectFileVersion)
                .where(ProjectFileVersion.project_file_id == project_file.id)
                .order_by(ProjectFileVersion.version_number)
            ).all()

        assert [version.version_number for version in versions] == [1, 2]
        assert "初始内容" in versions[0].content_snapshot
        assert "第二版内容" in versions[1].content_snapshot
        assert len({version.content_hash for version in versions}) == 2
    finally:
        engine.dispose()
