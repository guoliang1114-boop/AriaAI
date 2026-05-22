"""Pending action helpers for chat approval flows."""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Any

from sqlmodel import Session, select

from app.models.db import ProjectFile
from app.services.chat.mode_registry import ActionPolicy
from app.tools.office_documents import MANAGE_PROJECT_FILES_TOOL_NAME


_CLEANUP_TERMS = (
    "垃圾",
    "清理",
    "清除",
    "删除",
    "删掉",
    "移除",
    "cleanup",
    "clean up",
    "delete",
    "remove",
)
_FILE_SPACE_TERMS = (
    "文件",
    "文档",
    "空间",
    "项目空间",
    "file",
    "files",
    "document",
    "documents",
    "space",
)
_OBVIOUS_JUNK_NAME_TERMS = (
    "找不到该文件",
    "untitled",
    "未命名",
    "tmp",
    "temp",
    "test",
    "垃圾",
)
_FINAL_NAME_TERMS = (
    "最终",
    "final",
    "定稿",
    "正式",
    "完整版",
)


def _normalize_text(value: str) -> str:
    return "".join(str(value or "").lower().split())


def user_requested_project_file_cleanup(content: str) -> bool:
    text = _normalize_text(content)
    if not text:
        return False
    return any(term in text for term in _CLEANUP_TERMS) and any(term in text for term in _FILE_SPACE_TERMS)


def tool_confirmation_token(tool_name: str, tool_input: dict) -> str:
    operation = str(
        tool_input.get("mode")
        or tool_input.get("action")
        or tool_input.get("operation")
        or ""
    ).strip()
    normalized = json.dumps(tool_input or {}, ensure_ascii=False, sort_keys=True, default=str)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    parts = ["tool", tool_name]
    if operation:
        parts.append(operation)
    parts.append(digest)
    return ":".join(parts)


def _file_sort_key(project_file: ProjectFile) -> tuple:
    return (project_file.uploaded_at, project_file.id or 0)


def _normalized_dedupe_stem(name: str) -> str:
    value = _normalize_text(name)
    value = re.sub(r"\.(pptx|docx|xlsx|xls|pdf|md|txt|csv|json)$", "", value)
    value = re.sub(r"(\(\d+\)|（\d+）|-\d+|_\d+)$", "", value)
    value = value.replace("副本", "").replace("copy", "")
    return value


def _project_cleanup_candidates(session: Session, project_id: int, *, limit: int = 25) -> tuple[list[int], list[str]]:
    files = session.exec(
        select(ProjectFile)
        .where(ProjectFile.project_id == project_id)
        .order_by(ProjectFile.uploaded_at.desc(), ProjectFile.id.desc())
    ).all()
    if not files:
        return [], []

    reasons_by_id: dict[int, list[str]] = defaultdict(list)

    by_name: dict[str, list[ProjectFile]] = defaultdict(list)
    by_stem: dict[str, list[ProjectFile]] = defaultdict(list)
    for project_file in files:
        by_name[_normalize_text(project_file.name)].append(project_file)
        by_stem[_normalized_dedupe_stem(project_file.name)].append(project_file)

    for same_name_files in by_name.values():
        if len(same_name_files) <= 1:
            continue
        keep = max(same_name_files, key=_file_sort_key)
        for project_file in same_name_files:
            if project_file.id is not None and project_file.id != keep.id:
                reasons_by_id[project_file.id].append(f"与文件 {keep.id} 同名重复，保留较新的版本")

    for same_stem_files in by_stem.values():
        if len(same_stem_files) <= 1:
            continue
        keep = max(same_stem_files, key=_file_sort_key)
        for project_file in same_stem_files:
            if project_file.id is not None and project_file.id != keep.id:
                reasons_by_id[project_file.id].append(f"疑似同主题重复文件，保留较新的版本 {keep.id}")

    for project_file in files:
        if project_file.id is None:
            continue
        normalized_name = _normalize_text(project_file.name)
        if any(term in normalized_name for term in _OBVIOUS_JUNK_NAME_TERMS):
            reasons_by_id[project_file.id].append("文件名疑似临时/无效文件")
        if project_file.origin == "ai_generated" and any(term in normalized_name for term in ("草稿", "draft")):
            reasons_by_id[project_file.id].append("AI 生成草稿文件")

    ai_generated_files = [
        item
        for item in files
        if item.id is not None
        and item.origin == "ai_generated"
        and not any(term in _normalize_text(item.name) for term in _FINAL_NAME_TERMS)
    ]
    if len(ai_generated_files) > 12:
        keep_ids = {item.id for item in sorted(ai_generated_files, key=_file_sort_key, reverse=True)[:8]}
        for project_file in ai_generated_files:
            if project_file.id not in keep_ids:
                reasons_by_id[project_file.id].append("较早的 AI 生成文件，项目空间生成物数量偏多")

    ordered_ids = sorted(reasons_by_id, key=lambda file_id: next((index for index, item in enumerate(files) if item.id == file_id), 10**6))
    ordered_ids = ordered_ids[:limit]
    details: list[str] = []
    file_by_id = {item.id: item for item in files if item.id is not None}
    for file_id in ordered_ids:
        project_file = file_by_id.get(file_id)
        if not project_file:
            continue
        reason = "；".join(dict.fromkeys(reasons_by_id[file_id]))
        details.append(f"{file_id} · {project_file.name} · {reason}")
    return ordered_ids, details


def build_project_file_cleanup_pending_action(
    session: Session,
    *,
    project_id: int | None,
    user_content: str,
    action_policy: ActionPolicy | str,
    require_candidates: bool = True,
) -> dict[str, Any] | None:
    current_policy = ActionPolicy(action_policy) if isinstance(action_policy, str) else action_policy
    if project_id is None or current_policy != ActionPolicy.DESTRUCTIVE_ACTION:
        return None
    if not user_requested_project_file_cleanup(user_content):
        return None

    file_ids, details = _project_cleanup_candidates(session, project_id)
    if not file_ids and require_candidates:
        return None

    tool_input = {
        "project_id": project_id,
        "action": "delete",
        "file_ids": file_ids,
        "reason": "批量清理项目空间中的重复或明显无效文件",
    }
    token = tool_confirmation_token(MANAGE_PROJECT_FILES_TOOL_NAME, tool_input)
    summary = "需要用户确认后才能删除项目空间中的文件。"
    return {
        "confirmation_token": token,
        "tool_name": MANAGE_PROJECT_FILES_TOOL_NAME,
        "tool_input": tool_input if file_ids else None,
        "tool_use_id": f"cleanup-{token[-12:]}",
        "details": details or ["暂未找到可自动判定为安全删除的文件。请先查看空间文件清单，或指定要删除的文件。"],
        "summary": summary if file_ids else "没有找到可自动安全删除的候选文件。",
        "stage": "deterministic_cleanup_preview",
        "can_confirm": bool(file_ids),
    }
