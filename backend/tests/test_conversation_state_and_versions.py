from __future__ import annotations

from sqlmodel import Session, SQLModel, select

from app.models.db import Conversation, ConversationState, Project, ProjectFileVersion
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
