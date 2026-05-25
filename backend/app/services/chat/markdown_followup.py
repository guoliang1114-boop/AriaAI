"""Deterministic handling for "save the previous answer as Markdown" follow-ups."""
from __future__ import annotations

import re
from pathlib import Path

from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.models.db import Conversation, Message
from app.services.artifact_intent import primary_user_request_text
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import init_default_project_folders
from app.services.project_documents import build_timestamped_markdown_filename, create_project_document_record
from app.services.time_utils import utc_now_naive


_MARKDOWN_SAVE_TERMS = (
    "保存成markdown",
    "保存为markdown",
    "保存到markdown",
    "保存成md",
    "保存为md",
    "保存到md",
    "存成markdown",
    "存为markdown",
    "存成md",
    "存为md",
    "另存为markdown",
    "另存为md",
    "save as markdown",
    "save to markdown",
    "save as md",
)
_SAVE_TERMS = ("保存", "存成", "存为", "另存", "save")
_MARKDOWN_TERMS = ("markdown", ".md", " md", "md文档")
_PREVIOUS_REFERENCE_TERMS = (
    "上一条",
    "上面的",
    "刚才",
    "方才",
    "这条",
    "这个",
    "它",
    "回答",
    "回复",
    "结果",
    "内容",
    "风险分析",
)
_INLINE_CONTENT_MARKERS = ("以下内容", "如下", "内容是", "正文是", "```")
_CREATE_ARTIFACT_TERMS = (
    "生成",
    "创建",
    "制作",
    "输出",
    "导出",
    "整理",
    "形成",
    "起草",
    "撰写",
    "编写",
    "写一份",
    "写一个",
    "做一份",
    "做一个",
    "准备一份",
    "create",
    "generate",
    "export",
    "draft",
    "write",
)


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip().lower())


def is_save_previous_answer_as_markdown_request(content: str) -> bool:
    """Return true for short follow-ups asking to save the previous answer.

    This intentionally does not classify long prompts such as "请根据以下内容生成
    Markdown 报告". Those should remain normal artifact-generation requests.
    """
    raw = primary_user_request_text(content)
    compact = _compact(raw)
    lowered = (raw or "").strip().lower()
    if not compact:
        return False
    if any(marker in lowered for marker in _INLINE_CONTENT_MARKERS):
        return False
    has_markdown_save_phrase = any(term in compact for term in _MARKDOWN_SAVE_TERMS)
    has_save_and_markdown = any(term in lowered for term in _SAVE_TERMS) and any(term in lowered for term in _MARKDOWN_TERMS)
    if not (has_markdown_save_phrase or has_save_and_markdown):
        return False
    has_previous_reference = any(term in lowered for term in _PREVIOUS_REFERENCE_TERMS)
    has_create_artifact = any(term in lowered for term in _CREATE_ARTIFACT_TERMS)
    if has_create_artifact and not has_previous_reference:
        return False
    if len(lowered) <= 80:
        return True
    return has_previous_reference


def latest_assistant_message(session: Session, conversation_id: int) -> Message | None:
    return session.exec(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.role == "assistant")
        .order_by(Message.created_at.desc(), Message.id.desc())
    ).first()


def suggested_markdown_filename(user_content: str, assistant_content: str, conversation_title: str = "") -> str:
    source = f"{user_content}\n{assistant_content[:300]}\n{conversation_title}".lower()
    if "风险" in source or "risk" in source:
        base = "项目风险分析"
    elif "里程碑" in source or "milestone" in source:
        base = "项目里程碑分析"
    elif conversation_title and conversation_title != "New Workstream":
        base = conversation_title
    else:
        base = "对话回复"
    return build_timestamped_markdown_filename(base, timestamp=utc_now_naive())


def save_previous_answer_as_markdown(
    *,
    bind,
    conversation_id: int,
    project_id: int,
    user_content: str,
    uploads_dir: Path = UPLOADS_DIR,
) -> dict | None:
    """Save the latest assistant message in the conversation as a project MD file.

    Returns a project-file payload when handled, or ``None`` when the request is
    not a previous-answer Markdown save follow-up.
    """
    if not is_save_previous_answer_as_markdown_request(user_content):
        return None

    with Session(bind) as session:
        conv = session.get(Conversation, conversation_id)
        if not conv or conv.project_id != project_id:
            return {
                "ok": False,
                "error": "Conversation does not belong to this project.",
            }
        previous = latest_assistant_message(session, conversation_id)
        if not previous or not previous.content.strip():
            return {
                "ok": False,
                "error": "No previous assistant answer is available to save.",
            }
        filename = suggested_markdown_filename(user_content, previous.content, conv.title)
        project_file = create_project_document_record(
            session=session,
            project_id=project_id,
            name=filename,
            content=previous.content,
            uploads_dir=uploads_dir,
            init_default_folders=init_default_project_folders,
            summary=f"Saved previous chat answer from conversation: {conv.title or 'Untitled Conversation'}",
            auto_assign_folder=True,
        )
        mark_project_memory_stale(session, project_id, trigger="chat_markdown_followup_save")
        return {
            "ok": True,
            "action": "saved_previous_answer",
            "id": project_file.id,
            "project_file_id": project_file.id,
            "name": project_file.name,
            "file_type": project_file.file_type,
            "path": project_file.path,
            "folder_id": project_file.folder_id,
            "size_bytes": project_file.size_bytes,
            "source_message_id": previous.id,
        }
