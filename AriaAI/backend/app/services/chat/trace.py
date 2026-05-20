"""Chat trace persistence and diagnostics helpers.

The trace is the auditable contract for a chat turn: routing decision, action
policy, prompt layers, tool decisions, generated artifacts and timings. It keeps
debugging out of ad-hoc logs and makes UX regressions testable.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from enum import Enum
from typing import Any

from sqlmodel import Session, select

from app.models.db import ChatTrace
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime


def _json_default(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    return str(value)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=_json_default)


def _enum_value(value: Any) -> str:
    if isinstance(value, Enum):
        return str(value.value)
    return str(value or "")


def _build_prompt_layers(runtime: ChatRuntime) -> list[dict]:
    return [
        {
            "name": "system",
            "chars": len(runtime.system or ""),
            "present": bool((runtime.system or "").strip()),
        },
        {
            "name": "history",
            "message_count": len(runtime.api_messages or []),
        },
        {
            "name": "tools",
            "tool_count": len(runtime.tools or []),
            "tool_names": [
                str(tool.get("name") or tool.get("function", {}).get("name") or "")
                for tool in (runtime.tools or [])
                if isinstance(tool, dict)
            ],
        },
        {
            "name": "rag_sources",
            "source_count": len(runtime.rag_sources or []),
        },
    ]


def _build_fallback_events(state: ChatSessionState) -> list[dict]:
    events: list[dict] = [event for event in state.trace_events if isinstance(event, dict)]
    if state.p1_double_truncated:
        events.append({"type": "p1_double_truncated"})
    if state.p3_double_truncated:
        events.append({"type": "p3_double_truncated"})
    for event in state.tool_call_events:
        if not isinstance(event, dict):
            continue
        status = str(event.get("status") or "")
        if status in {"blocked", "skipped", "failed"}:
            events.append(
                {
                    "type": f"tool_{status}",
                    "tool_name": event.get("tool_name") or event.get("name") or "",
                    "reason": event.get("reason") or event.get("error") or event.get("message") or "",
                }
            )
    return events


def build_chat_trace_payload(runtime: ChatRuntime, state: ChatSessionState) -> dict:
    """Build a JSON-safe trace payload for tests and diagnostics."""

    return {
        "trace_id": uuid.uuid4().hex,
        "conversation_id": runtime.conv_id,
        "project_id": runtime.project_id,
        "chat_mode": _enum_value(runtime.chat_mode),
        "action_policy": _enum_value(runtime.action_policy),
        "intent_method": runtime.intent_method or "",
        "intent_reason": runtime.intent_reason or "",
        "model_used": runtime.selected_model or "",
        "prompt_layers": _build_prompt_layers(runtime),
        "tool_decisions": state.tool_call_events,
        "artifacts": state.artifacts,
        "stage_timings": state.stage_timings,
        "fallback_events": _build_fallback_events(state),
        "metadata": {
            "workflow_started": state.workflow_started,
            "tool_use_count": len(state.tool_use_blocks) + len(state.p3_tool_use_blocks),
            "full_text_chars": len(state.full_text or ""),
            "prepare_metrics": runtime.prepare_metrics or {},
        },
    }


def persist_chat_trace(
    bind,
    runtime: ChatRuntime,
    state: ChatSessionState,
    *,
    message_id: int | None = None,
) -> ChatTrace:
    payload = build_chat_trace_payload(runtime, state)
    with Session(bind) as session:
        record = ChatTrace(
            trace_id=payload["trace_id"],
            conversation_id=payload["conversation_id"],
            message_id=message_id,
            project_id=payload.get("project_id"),
            chat_mode=payload["chat_mode"],
            action_policy=payload["action_policy"],
            intent_method=payload["intent_method"],
            intent_reason=payload["intent_reason"],
            model_used=payload["model_used"],
            prompt_layers_json=_json_dumps(payload["prompt_layers"]),
            tool_decisions_json=_json_dumps(payload["tool_decisions"]),
            artifacts_json=_json_dumps(payload["artifacts"]),
            stage_timings_json=_json_dumps(payload["stage_timings"]),
            fallback_events_json=_json_dumps(payload["fallback_events"]),
            metadata_json=_json_dumps(payload["metadata"]),
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def get_latest_chat_trace(
    session: Session,
    conversation_id: int,
    *,
    message_id: int | None = None,
) -> dict | None:
    stmt = select(ChatTrace).where(ChatTrace.conversation_id == conversation_id)
    if message_id is not None:
        stmt = stmt.where(ChatTrace.message_id == message_id)
    stmt = stmt.order_by(ChatTrace.created_at.desc(), ChatTrace.id.desc()).limit(1)
    record = session.exec(stmt).first()
    return record.get_payload() if record else None
