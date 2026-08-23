"""Persist-time serializer for the Run Activity Timeline (Product Run Event v1).

At end-of-run, ``persist.run_persist`` calls :func:`build_activity_timeline` to
snapshot the agent's actual execution into a JSON-safe dict matching the
frontend's ``RunActivityTimeline`` shape (see ``web/src/stores/runActivityReducer.ts``).
The dict is stored at ``message.metadata['activity_timeline']`` so the persisted
view can re-render the same activity timeline the user saw while streaming.

This is a one-shot snapshot derived from existing state fields, not a mirror of
the live SSE reducer — fields that only make sense mid-run (live ``status``,
pending ``confirmation``) are intentionally omitted.
"""
from __future__ import annotations

from typing import Any

from app.services.agent_harness.tool_execution_record import (
    ToolExecutionOutcome,
    tool_event_outcome,
)


_ARTIFACT_TYPE_V1_MAP = {
    "pptx": "pptx",
    "docx": "docx",
    "xlsx": "xlsx",
    "pdf": "pdf",
    "md": "markdown",
    "markdown": "markdown",
}


def _v1_item_status(raw: Any) -> str:
    """Coerce a tool-event status string into the v1 ToolProgressStatus enum."""
    s = str(raw or "").lower()
    if s in {"completed", "success", "done"}:
        return "completed"
    if s in {"failed", "error", "blocked"}:
        return "failed"
    if s in {"running", "in_progress"}:
        return "running"
    if s == "confirmation_required":
        return "running"  # never reached the terminal state in this run
    return "pending"


def _v1_tool_event_status(event: dict[str, Any]) -> str:
    outcome = tool_event_outcome(event)
    if outcome is ToolExecutionOutcome.SUCCEEDED:
        return "completed"
    if outcome is ToolExecutionOutcome.FAILED:
        return "failed"
    if outcome is ToolExecutionOutcome.WAITING_CONFIRMATION:
        return "running"
    return _v1_item_status(event.get("status"))


def _build_step(step: Any, tool_events: list[dict]) -> dict:
    step_tool_calls = list(getattr(step, "tool_calls", None) or [])
    tool_names: list[str] = []
    for tc in step_tool_calls:
        if isinstance(tc, dict):
            name = str(tc.get("name") or "").strip()
            if name:
                tool_names.append(name)

    # Group by tool_name: one item per unique tool the step planned. Status
    # comes from the most informative matching event we can find.
    items: list[dict] = []
    seen: set[str] = set()
    for name in tool_names:
        if name in seen:
            continue
        seen.add(name)
        matching = [
            ev
            for ev in tool_events
            if isinstance(ev, dict) and str(ev.get("tool_name") or "") == name
        ]
        status = "completed" if matching else "pending"
        detail: str | None = None
        for ev in matching:
            ev_status = _v1_tool_event_status(ev)
            # Terminal statuses (failed/completed) override running/pending.
            if ev_status in {"completed", "failed"} or status not in {"completed", "failed"}:
                status = ev_status
            msg = ev.get("summary") or ev.get("message")
            if isinstance(msg, str) and msg.strip():
                detail = msg.strip()
        item: dict[str, Any] = {"tool_name": name, "status": status}
        if detail:
            item["detail"] = detail
        items.append(item)

    title = "、".join(tool_names) if tool_names else f"第 {(getattr(step, 'index', 0) or 0) + 1} 步"
    step_status = "failed" if any(it.get("status") == "failed" for it in items) else "completed"
    entry: dict[str, Any] = {
        "index": (getattr(step, "index", 0) or 0) + 1,
        "title": title,
        "status": step_status,
        "duration_ms": int(getattr(step, "duration_ms", 0) or 0),
        "items": items,
    }
    if getattr(step, "truncated", False):
        entry["truncated"] = True
    return entry


def _build_artifacts(state_artifacts: Any) -> list[dict]:
    out: list[dict] = []
    for art in state_artifacts or []:
        if not isinstance(art, dict):
            continue
        artifact_id = art.get("id") or art.get("project_file_id")
        if not artifact_id:
            continue
        raw_kind = str(art.get("file_type") or art.get("output_kind") or "").lower().lstrip(".")
        v1_kind = _ARTIFACT_TYPE_V1_MAP.get(raw_kind)
        if not v1_kind:
            continue
        out.append({"id": str(artifact_id), "type": v1_kind})
    return out


def _build_skill(runtime: Any) -> dict | None:
    name = str(getattr(runtime, "skill_name", "") or "").strip()
    if not name:
        return None
    payload: dict[str, Any] = {"name": name}
    skill_id = getattr(runtime, "skill_id", None)
    if not skill_id:
        prepare_metrics = getattr(runtime, "prepare_metrics", None)
        if isinstance(prepare_metrics, dict):
            skill_id = prepare_metrics.get("effective_skill_id")
    if skill_id:
        payload["id"] = str(skill_id)
    return payload


def build_activity_timeline(state: Any, runtime: Any, *, full_text: str = "") -> dict | None:
    """Return the persisted timeline dict, or ``None`` if there is no run_id."""
    run_id = str(getattr(state, "run_id", "") or "")
    if not run_id:
        return None

    tool_events = list(getattr(state, "tool_call_events", None) or [])
    steps = [_build_step(step, tool_events) for step in getattr(state, "steps", None) or []]
    artifacts = _build_artifacts(getattr(state, "artifacts", None))
    evaluation = getattr(state, "run_evaluation", None)
    evaluation_verdict = (
        str(evaluation.get("verdict") or "") if isinstance(evaluation, dict) else ""
    )
    if evaluation_verdict == "failed":
        final_status = "failed"
    elif evaluation_verdict == "waiting_confirmation" or bool(
        getattr(state, "confirmation_requested", False)
    ):
        final_status = "waiting_confirmation"
    else:
        final_status = "completed"

    timeline: dict[str, Any] = {
        "run_id": run_id,
        "steps": steps,
        "artifacts": artifacts,
        "final_status": final_status,
        "text": full_text or str(getattr(state, "full_text", "") or ""),
    }

    skill = _build_skill(runtime)
    if skill is not None:
        timeline["skill"] = skill

    return timeline
