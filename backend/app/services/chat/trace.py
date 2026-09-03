"""Chat trace persistence and diagnostics helpers.

The trace is the auditable contract for a chat turn: routing decision, action
policy, prompt layers, tool decisions, generated artifacts and timings. It keeps
debugging out of ad-hoc logs and makes UX regressions testable.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime
from enum import Enum
from typing import Any

from sqlmodel import Session, select

from app.models.db import ChatTrace
from app.services.context_builder.assembly import (
    context_manifest_reference,
    validate_context_assembly_manifest,
)
from app.services.agent_harness.tool_execution_record import (
    tool_event_is_failure,
    tool_event_is_omission_marker,
)
from app.services.agent_harness.knowledge_evidence import knowledge_evidence_reference
from app.services.agent_harness.project_memory_evidence import (
    project_memory_evidence_reference,
)
from app.services.agent_harness.conversation_capsule import conversation_capsule_reference
from app.services.agent_harness.instruction_manifest import instruction_manifest_reference
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime


TRACE_DIAGNOSTIC_SCHEMA_VERSION = 1
MAX_TRACE_DIAGNOSTIC_ITEMS = 50
_TRACE_TIMING_KEYS = (
    "total_stream_ms",
    "agent_loop_ms",
    "save_ms",
    "model_first_event_ms",
    "model_retry_count",
    "model_retry_wait_ms",
)
_SAFE_INTENT_REASON_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,240}$")


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
    manifest = getattr(runtime, "context_manifest", None)
    manifest_valid, _ = validate_context_assembly_manifest(manifest)
    if manifest_valid:
        return [
            {
                "name": str(source.get("source_id") or ""),
                "kind": str(source.get("kind") or ""),
                "trust": str(source.get("trust") or ""),
                "chars": int(source.get("chars") or 0),
                "estimated_tokens": int(source.get("estimated_tokens") or 0),
                "present": bool(source.get("included", False)),
                "content_sha256": str(source.get("content_sha256") or ""),
            }
            for source in manifest.get("sources", [])
            if isinstance(source, dict)
        ]
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
    if any(step.truncated for step in state.steps):
        events.append({"type": "output_truncated"})
    for event in state.tool_call_events:
        if not isinstance(event, dict):
            continue
        if tool_event_is_omission_marker(event):
            continue
        status = str(event.get("status") or "")
        if tool_event_is_failure(event) or status in {"skipped", "suppressed"}:
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

    context_manifest = getattr(runtime, "context_manifest", None)
    return {
        "trace_id": uuid.uuid4().hex,
        "conversation_id": runtime.conv_id,
        "project_id": runtime.project_id,
        "chat_mode": _enum_value(runtime.chat_mode),
        "action_policy": _enum_value(runtime.action_policy),
        "tool_access_policy": _enum_value(runtime.tool_access_policy),
        "intent_method": runtime.intent_method or "",
        "intent_reason": runtime.intent_reason or "",
        "model_used": runtime.selected_model or "",
        "prompt_layers": _build_prompt_layers(runtime),
        "tool_decisions": state.tool_call_events,
        "artifacts": state.delivered_artifacts(),
        "stage_timings": state.stage_timings,
        "fallback_events": _build_fallback_events(state),
        "metadata": {
            "workflow_started": state.workflow_started,
            "tool_use_count": sum(len(step.tool_calls) for step in state.steps),
            "full_text_chars": len(state.full_text or ""),
            "tool_access_policy": _enum_value(runtime.tool_access_policy),
            "prepare_metrics": runtime.prepare_metrics or {},
            "intent_trace": runtime.intent_trace or {},
            "rollout_task_id": state.rollout_task_id,
            "context_manifest": context_manifest or {},
            "context_manifest_ref": context_manifest_reference(context_manifest),
            "conversation_capsule": conversation_capsule_reference(
                getattr(runtime, "conversation_capsule", None)
            ),
            "instruction_manifest": instruction_manifest_reference(
                getattr(runtime, "instruction_manifest", None)
            ),
            "knowledge_evidence": knowledge_evidence_reference(
                getattr(state, "knowledge_evidence", None)
            ),
            "project_memory_evidence": project_memory_evidence_reference(
                getattr(state, "project_memory_evidence", None)
            ),
            "context_receipt": dict(getattr(state, "context_receipt", None) or {}),
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


def _bounded_non_negative_int(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def _safe_intent_reason(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    # Deterministic routers emit stable reason codes. LLM-generated prose can
    # echo user content, so it is deliberately withheld from this projection.
    if _SAFE_INTENT_REASON_RE.fullmatch(normalized):
        return normalized
    return "router_explanation_withheld"


def _context_diagnostic(metadata: Any) -> dict[str, Any]:
    metadata = metadata if isinstance(metadata, dict) else {}
    manifest = metadata.get("context_manifest")
    valid, reason = validate_context_assembly_manifest(manifest)
    summary = manifest.get("summary") if valid and isinstance(manifest, dict) else {}
    summary = summary if isinstance(summary, dict) else {}
    budget = manifest.get("budget") if valid and isinstance(manifest, dict) else {}
    budget = budget if isinstance(budget, dict) else {}
    return {
        "manifest_valid": valid,
        "manifest_reason": reason,
        "compacted": bool(summary.get("compacted", False)) if valid else False,
        "system_compacted": bool(summary.get("system_compacted", False)) if valid else False,
        "history_compacted": bool(summary.get("history_compacted", False)) if valid else False,
        "source_count": _bounded_non_negative_int(summary.get("source_count")) if valid else 0,
        "included_source_count": (
            _bounded_non_negative_int(summary.get("included_source_count")) if valid else 0
        ),
        "history_messages_before": (
            _bounded_non_negative_int(budget.get("history_messages_before")) if valid else 0
        ),
        "history_messages_after": (
            _bounded_non_negative_int(budget.get("history_messages_after")) if valid else 0
        ),
        "summarized_messages": (
            _bounded_non_negative_int(budget.get("summarized_messages")) if valid else 0
        ),
        "truncated_recent_messages": (
            _bounded_non_negative_int(budget.get("truncated_recent_messages")) if valid else 0
        ),
        "estimated_total_before": (
            _bounded_non_negative_int(budget.get("estimated_total_before")) if valid else 0
        ),
        "estimated_total_after": (
            _bounded_non_negative_int(budget.get("estimated_total_after")) if valid else 0
        ),
        "context_window_tokens": (
            _bounded_non_negative_int(budget.get("context_window_tokens")) if valid else 0
        ),
        "compaction_strategy": (
            str(budget.get("compaction_strategy") or "none")[:64] if valid else "unknown"
        ),
        "summary_injected": bool(budget.get("summary_injected", False)) if valid else False,
        "oldest_retained_message_index": (
            _bounded_non_negative_int(budget.get("oldest_retained_message_index"))
            if valid and budget.get("oldest_retained_message_index") is not None
            else None
        ),
    }


def _execution_diagnostic(payload: dict[str, Any]) -> dict[str, Any]:
    tool_decisions = payload.get("tool_decisions")
    tool_decisions = tool_decisions if isinstance(tool_decisions, list) else []
    status_counts: dict[str, int] = {}
    for decision in tool_decisions[:200]:
        if not isinstance(decision, dict):
            continue
        status = str(decision.get("status") or "unknown")[:32]
        status_counts[status] = status_counts.get(status, 0) + 1

    artifacts = payload.get("artifacts")
    artifacts = artifacts if isinstance(artifacts, list) else []
    fallback_events = payload.get("fallback_events")
    fallback_events = fallback_events if isinstance(fallback_events, list) else []
    fallback_types: list[str] = []
    for event in fallback_events[:100]:
        if not isinstance(event, dict):
            continue
        event_type = str(event.get("type") or "unknown")[:48]
        if event_type not in fallback_types:
            fallback_types.append(event_type)
        if len(fallback_types) >= 16:
            break

    timings = payload.get("stage_timings")
    timings = timings if isinstance(timings, dict) else {}
    safe_timings = {
        key: timings[key]
        for key in _TRACE_TIMING_KEYS
        if isinstance(timings.get(key), (int, float))
        and not isinstance(timings.get(key), bool)
    }
    return {
        "tool_decision_count": min(len(tool_decisions), 200),
        "tool_status_counts": status_counts,
        "artifact_count": min(len(artifacts), 200),
        "fallback_count": min(len(fallback_events), 100),
        "fallback_types": fallback_types,
        "timings": safe_timings,
    }


def build_chat_trace_diagnostic(record: ChatTrace) -> dict[str, Any]:
    """Return a bounded, content-free explanation of one persisted turn.

    Raw prompts, message bodies, tool inputs/outputs, artifact paths and hidden
    reasoning deliberately stay out of this user-facing diagnostic projection.
    """

    payload = record.get_payload()
    metadata = payload.get("metadata")
    return {
        "schema_version": TRACE_DIAGNOSTIC_SCHEMA_VERSION,
        "id": record.id,
        "trace_id": record.trace_id,
        "conversation_id": record.conversation_id,
        "message_id": record.message_id,
        "project_id": record.project_id,
        "created_at": record.created_at,
        "routing": {
            "chat_mode": str(record.chat_mode or "")[:64],
            "action_policy": str(record.action_policy or "")[:64],
            "intent_method": str(record.intent_method or "")[:80],
            "intent_reason": _safe_intent_reason(record.intent_reason),
            "model_used": str(record.model_used or "")[:160],
        },
        "context": _context_diagnostic(metadata),
        "execution": _execution_diagnostic(payload),
        "privacy": {
            "includes_prompt_content": False,
            "includes_message_content": False,
            "includes_tool_inputs": False,
            "includes_tool_outputs": False,
            "includes_hidden_reasoning": False,
        },
    }


def list_chat_trace_diagnostics(
    session: Session,
    conversation_id: int,
    *,
    limit: int = 20,
    before_id: int | None = None,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit), MAX_TRACE_DIAGNOSTIC_ITEMS))
    stmt = select(ChatTrace).where(ChatTrace.conversation_id == conversation_id)
    if before_id is not None:
        stmt = stmt.where(ChatTrace.id < int(before_id))
    records = session.exec(
        stmt.order_by(ChatTrace.created_at.desc(), ChatTrace.id.desc()).limit(safe_limit + 1)
    ).all()
    has_more = len(records) > safe_limit
    page = records[:safe_limit]
    return {
        "schema_version": TRACE_DIAGNOSTIC_SCHEMA_VERSION,
        "conversation_id": conversation_id,
        "items": [build_chat_trace_diagnostic(record) for record in page],
        "next_before_id": int(page[-1].id) if has_more and page and page[-1].id else None,
        "has_more": has_more,
    }


def get_chat_trace_diagnostic(
    session: Session,
    conversation_id: int,
    *,
    message_id: int | None = None,
    trace_id: str | None = None,
) -> dict[str, Any] | None:
    stmt = select(ChatTrace).where(ChatTrace.conversation_id == conversation_id)
    if message_id is not None:
        stmt = stmt.where(ChatTrace.message_id == message_id)
    if trace_id is not None:
        stmt = stmt.where(ChatTrace.trace_id == trace_id)
    record = session.exec(
        stmt.order_by(ChatTrace.created_at.desc(), ChatTrace.id.desc()).limit(1)
    ).first()
    return build_chat_trace_diagnostic(record) if record else None


def compare_chat_trace_diagnostics(
    session: Session,
    conversation_id: int,
    *,
    base_trace_id: str,
    target_trace_id: str,
) -> dict[str, Any] | None:
    base = get_chat_trace_diagnostic(
        session,
        conversation_id,
        trace_id=base_trace_id,
    )
    target = get_chat_trace_diagnostic(
        session,
        conversation_id,
        trace_id=target_trace_id,
    )
    if base is None or target is None:
        return None

    changes: list[dict[str, Any]] = []

    def add_change(field: str, before: Any, after: Any) -> None:
        if before != after:
            changes.append({"field": field, "before": before, "after": after})

    for field in ("chat_mode", "action_policy", "intent_method", "model_used"):
        add_change(field, base["routing"][field], target["routing"][field])
    for field in (
        "manifest_valid",
        "compacted",
        "system_compacted",
        "history_compacted",
        "history_messages_before",
        "history_messages_after",
        "summarized_messages",
        "truncated_recent_messages",
        "estimated_total_after",
    ):
        add_change(f"context.{field}", base["context"][field], target["context"][field])
    for field in ("tool_decision_count", "artifact_count", "fallback_count"):
        add_change(f"execution.{field}", base["execution"][field], target["execution"][field])

    warnings: list[str] = []
    if not target["context"]["manifest_valid"]:
        warnings.append("target_context_manifest_invalid")
    if target["context"]["history_compacted"]:
        warnings.append("target_history_compacted")
    if target["context"]["truncated_recent_messages"]:
        warnings.append("target_recent_messages_truncated")
    if target["execution"]["fallback_count"] > base["execution"]["fallback_count"]:
        warnings.append("target_more_fallbacks")
    if target["routing"]["chat_mode"] != base["routing"]["chat_mode"]:
        warnings.append("route_changed")
    if target["routing"]["model_used"] != base["routing"]["model_used"]:
        warnings.append("model_changed")

    return {
        "schema_version": TRACE_DIAGNOSTIC_SCHEMA_VERSION,
        "conversation_id": conversation_id,
        "base": base,
        "target": target,
        "changes": changes,
        "warnings": warnings,
        "privacy": target["privacy"],
    }
