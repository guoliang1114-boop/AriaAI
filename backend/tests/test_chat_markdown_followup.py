from __future__ import annotations

import tempfile
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import Conversation, Message, Project, ProjectFile
from app.services.chat.markdown_followup import (
    is_save_previous_answer_as_markdown_request,
    save_previous_answer_as_markdown,
)
from app.services.project_documents import read_project_document_content


def _engine():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return engine


def test_detects_short_markdown_save_followups():
    assert is_save_previous_answer_as_markdown_request("要，保存成 Markdown")
    assert is_save_previous_answer_as_markdown_request("把刚才的风险分析保存为 md")
    assert is_save_previous_answer_as_markdown_request("save as markdown")


def test_does_not_treat_long_inline_generation_prompt_as_previous_answer_save():
    content = "请根据以下内容生成 Markdown 报告：\n\n# 新报告\n\n这里是正文内容，不要保存上一条。"

    assert not is_save_previous_answer_as_markdown_request(content)


def test_save_previous_answer_as_markdown_uses_latest_assistant_content():
    engine = _engine()
    with tempfile.TemporaryDirectory() as tmp:
        with Session(engine) as session:
            project = Project(name="Alpha", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            conversation = Conversation(project_id=project.id, title="风险对话")
            session.add(conversation)
            session.commit()
            session.refresh(conversation)
            session.add(Message(conversation_id=conversation.id, role="user", content="这个项目的风险是什么？"))
            session.add(
                Message(
                    conversation_id=conversation.id,
                    role="assistant",
                    content="## 项目风险\n\n- 风险 A：客户决策链尚未明确。\n- 风险 B：交付节奏存在压缩。",
                )
            )
            session.commit()

            result = save_previous_answer_as_markdown(
                bind=engine,
                conversation_id=conversation.id,
                project_id=project.id,
                user_content="要，保存成 Markdown",
                uploads_dir=Path(tmp),
            )

            assert result is not None
            assert result["ok"] is True
            assert result["name"].startswith("项目风险分析_")
            project_file = session.exec(select(ProjectFile).where(ProjectFile.id == result["project_file_id"])).one()
            content = read_project_document_content(project_file, uploads_dir=Path(tmp))

        assert "客户决策链尚未明确" in content
        assert "交付节奏存在压缩" in content
        assert "要，保存成 Markdown" not in content
