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
    "不能",
    "保持",
    "统一",
    "保存为",
    "写入",
    "输出为",
    "正式",
    "深度",
    "辩证",
    "Markdown",
    ".md",
)


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


def _extract_constraint(user_content: str) -> str:
    text = _compact(user_content, 300)
    if not text:
        return ""
    return text if any(term.lower() in text.lower() for term in _CONSTRAINT_TERMS) else ""


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

    constraints = _loads(state.user_constraints_json, [])
    constraint = _extract_constraint(user_content)
    if constraint:
        constraints = [item for item in constraints if item != constraint]
        constraints.insert(0, constraint)
        constraints = constraints[:12]

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
