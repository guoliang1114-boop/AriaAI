from __future__ import annotations

import json
import re
from typing import Any

from sqlmodel import Session, select

from app.models.db import Conversation, ConversationState
from app.services.chat.working_memory import artifact_from_metadata
from app.services.time_utils import utc_now_naive


_CONSTRAINT_TERMS = (
    "必须",
    "不要",
    "不用",
    "无需",
    "取消",
    "改成",
    "改为",
    "不能",
    "保持",
    "统一",
    "保存为",
    "写入",
    "输出为",
    "正式",
    "口语",
    "简洁",
    "详细",
    "只回答",
    "不要修改",
    "深度",
    "辩证",
    "Markdown",
    ".md",
)

_CONSTRAINT_DIMENSIONS = {
    "tone": ("正式", "口语", "语气", "专业"),
    "detail": ("简洁", "详细", "辩证", "深度", "简短", "展开"),
    "format": ("markdown", ".md", "ppt", "pptx", "docx", "xlsx", "pdf", "格式", "输出为"),
    "action": ("写入", "保存", "修改", "更新", "覆盖", "只回答", "只分析", "不要修改"),
    "length": ("篇幅", "长度", "页", "字"),
    "language": ("中文", "英文", "中英", "语言"),
}


def _loads(value: str, fallback):
    try:
        parsed = json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return fallback
    return parsed if isinstance(parsed, type(fallback)) else fallback


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _compact(text: str, limit: int = 500) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    return value[:limit]


def _extract_constraints(user_content: str) -> list[str]:
    text = _compact(user_content, 300)
    if not text:
        return []
    clauses = re.split(r"[\n，,；;。]+", text)
    constraints: list[str] = []
    for clause in clauses:
        normalized = re.sub(r"^(?:并且|而且|同时|并|且)\s*", "", clause.strip())
        if not normalized:
            continue
        if any(term.lower() in normalized.lower() for term in _CONSTRAINT_TERMS):
            constraints.append(normalized)
    return constraints


def _constraint_dimensions(text: str) -> set[str]:
    normalized = str(text or "").lower()
    return {
        dimension
        for dimension, terms in _CONSTRAINT_DIMENSIONS.items()
        if any(term.lower() in normalized for term in terms)
    }


def merge_user_constraints(
    existing: list[Any] | None,
    current_content: str,
    *,
    structured_constraints: list[Any] | None = None,
    limit: int = 12,
) -> list[str]:
    """Merge durable user constraints while retiring explicitly superseded ones.

    Historical requirements are retained by default. A current turn only
    retires requirements in a dimension it explicitly restates, such as tone,
    output format, language, or write policy. This gives current user
    instructions a deterministic override boundary without treating every
    topic change as a preference reset.
    """

    normalized_existing: list[str] = []
    for item in list(existing or []):
        if item is None or not str(item).strip() or str(item).strip().lower() == "none":
            continue
        split_items = _extract_constraints(str(item))
        normalized_existing.extend(split_items or [str(item).strip()])

    explicit_constraints: list[str] = []
    for item in list(structured_constraints or []):
        normalized = _compact(str(item or ""), 160)
        if normalized and normalized.lower() != "none" and normalized not in explicit_constraints:
            explicit_constraints.append(normalized)

    current_constraints = list(dict.fromkeys([
        *explicit_constraints,
        *_extract_constraints(current_content),
    ]))
    if not current_constraints:
        return list(dict.fromkeys(normalized_existing))[: max(1, limit)]

    current_dimensions: set[str] = set()
    for constraint in current_constraints:
        current_dimensions.update(_constraint_dimensions(constraint))
    if current_dimensions:
        normalized_existing = [
            item
            for item in normalized_existing
            if not (_constraint_dimensions(item) & current_dimensions)
        ]

    merged = [*current_constraints, *normalized_existing]
    return list(dict.fromkeys(merged))[: max(1, limit)]


def _task_from_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    task = metadata.get("task_run")
    if not isinstance(task, dict) or not task.get("id"):
        return {}
    return {
        "id": task.get("id"),
        "task_type": task.get("task_type") or metadata.get("task_type"),
        "status": task.get("status"),
        "goal": task.get("goal"),
    }


def get_conversation_state_payload(session: Session, conversation_id: int) -> dict[str, Any]:
    state = session.exec(
        select(ConversationState).where(ConversationState.conversation_id == conversation_id)
    ).first()
    if not state:
        return {}
    return {
        "conversation_id": state.conversation_id,
        "project_id": state.project_id,
        "current_artifact": _loads(state.current_artifact_json, {}),
        "current_task": _loads(state.current_task_json, {}),
        "user_constraints": _loads(state.user_constraints_json, []),
        "decisions": _loads(state.decisions_json, []),
        "active_file_ids": _loads(state.active_file_ids_json, []),
        "last_intent": _loads(state.last_intent_json, {}),
        "summary": state.summary,
        "last_user_request": state.last_user_request,
        "last_assistant_summary": state.last_assistant_summary,
        "updated_at": state.updated_at,
    }


def upsert_conversation_state_from_metadata(
    session: Session,
    *,
    conversation_id: int,
    user_content: str,
    assistant_content: str,
    metadata: dict[str, Any] | None,
    message_id: int | None = None,
) -> ConversationState | None:
    conv = session.get(Conversation, conversation_id)
    if not conv:
        return None
    metadata = metadata if isinstance(metadata, dict) else {}
    state = session.exec(
        select(ConversationState).where(ConversationState.conversation_id == conversation_id)
    ).first()
    if state is None:
        state = ConversationState(conversation_id=conversation_id, project_id=conv.project_id)

    current_artifact = artifact_from_metadata(metadata) or _loads(state.current_artifact_json, {})
    current_task = _task_from_metadata(metadata) or _loads(state.current_task_json, {})
    active_file_ids = _loads(state.active_file_ids_json, [])
    if current_artifact and current_artifact.get("project_file_id"):
        file_id = current_artifact.get("project_file_id")
        active_file_ids = [item for item in active_file_ids if item != file_id]
        active_file_ids.insert(0, file_id)
        active_file_ids = active_file_ids[:12]

    turn_contract = metadata.get("turn_contract")
    structured_constraints = (
        turn_contract.get("user_constraints")
        if isinstance(turn_contract, dict) and isinstance(turn_contract.get("user_constraints"), list)
        else None
    )
    constraints = merge_user_constraints(
        _loads(state.user_constraints_json, []),
        user_content,
        structured_constraints=structured_constraints,
    )

    decisions = _loads(state.decisions_json, [])
    tool_calls = metadata.get("tool_calls") if isinstance(metadata.get("tool_calls"), list) else []
    completed_tools = [
        str(item.get("summary") or item.get("message") or item.get("tool_name") or "").strip()
        for item in tool_calls
        if isinstance(item, dict) and str(item.get("status") or "").lower() == "completed"
    ]
    if completed_tools:
        decisions.insert(0, {"message_id": message_id, "summary": completed_tools[:4]})
        decisions = decisions[:12]

    last_intent = {
        "artifact_contract": metadata.get("artifact_contract"),
        "delivery_failed": metadata.get("delivery_failed"),
        "task_run_id": metadata.get("task_run_id"),
        "tool_count": len(tool_calls),
    }
    state.project_id = conv.project_id
    state.current_artifact_json = _dumps(current_artifact or {})
    state.current_task_json = _dumps(current_task or {})
    state.active_file_ids_json = _dumps(active_file_ids)
    state.user_constraints_json = _dumps(constraints)
    state.decisions_json = _dumps(decisions)
    state.last_intent_json = _dumps(last_intent)
    state.last_user_request = _compact(user_content, 1000)
    state.last_assistant_summary = _compact(assistant_content, 1000)
    if current_artifact:
        state.summary = f"当前交付物：{current_artifact.get('name') or '-'}"
    elif current_task:
        state.summary = f"当前任务：{current_task.get('task_type') or '-'} / {current_task.get('status') or '-'}"
    state.updated_at = utc_now_naive()
    session.add(state)
    session.flush()
    return state
