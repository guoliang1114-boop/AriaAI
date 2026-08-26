"""Build a user-visible, privacy-safe receipt of Aria's turn context.

The receipt exposes only source presence, counts, freshness, and Skill routing
decisions. It never includes project text, retrieved chunks, prompts, tool
arguments, hidden reasoning, or provider state.
"""
from __future__ import annotations

from typing import Any


def _dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def build_context_receipt(run_id: str, runtime: Any) -> dict[str, Any]:
    """Return ``context_receipt`` from one fully prepared ChatRuntime."""

    # Lazy imports avoid the conversation_state -> chat package -> receipt
    # initialization cycle while keeping these validators as the source of
    # truth once runtime preparation is underway.
    from app.services.agent_harness.conversation_capsule import (
        conversation_capsule_reference,
    )
    from app.services.chat.product_run_events import context_receipt
    from app.services.context_builder.assembly import context_manifest_reference

    base = _dict(getattr(runtime, "context_receipt", None))
    metrics = _dict(getattr(runtime, "prepare_metrics", None))
    memory = _dict(base.get("memory"))
    evidence = _dict(base.get("evidence"))

    skill_reason = str(
        getattr(runtime, "skill_activation_reason", "")
        or metrics.get("skill_decision")
        or ""
    )
    skill_name = str(getattr(runtime, "skill_name", "") or "").strip()
    if skill_name:
        skill_status = "applied"
        usage_mode = "advisory" if "advisory_match" in skill_reason else "workflow"
    elif "ambiguous" in skill_reason:
        skill_status = "ambiguous"
        usage_mode = "none"
    else:
        skill_status = "not_used"
        usage_mode = "none"

    candidates = []
    if skill_status == "ambiguous":
        for item in list(metrics.get("skill_top_candidates") or [])[:3]:
            if not isinstance(item, dict):
                continue
            candidates.append(
                {
                    "id": item.get("skill_id"),
                    "name": item.get("skill_name"),
                    "score": item.get("score"),
                }
            )

    skill = {
        "status": skill_status,
        "usage_mode": usage_mode,
        "id": getattr(runtime, "skill_id", None),
        "name": skill_name,
        "source": str(getattr(runtime, "skill_activation_source", "") or ""),
        "reason": skill_reason,
        "confidence": metrics.get("skill_decision_confidence", 0.0),
        "candidates": candidates,
    }

    manifest_ref = context_manifest_reference(
        getattr(runtime, "context_manifest", None)
    )
    capsule_ref = conversation_capsule_reference(
        getattr(runtime, "conversation_capsule", None)
    )
    evidence.update(
        {
            "knowledge_reference_count": len(
                getattr(runtime, "rag_sources", None) or []
            ),
            "history_message_count": int(
                metrics.get("history_message_count_loaded") or 0
            ),
            "conversation_capsule": bool(capsule_ref.get("valid")),
            "user_preferences": bool(metrics.get("user_memory_injected", False)),
            "compacted": bool(manifest_ref.get("compacted", False)),
        }
    )

    warnings: list[str] = []
    memory_status = str(memory.get("status") or "not_applicable")
    if memory_status == "missing":
        warnings.append("project_memory_missing")
    elif memory_status == "stale":
        warnings.append("project_memory_stale")
    if bool(memory.get("truncated", False)):
        warnings.append("memory_retrieval_truncated")
    if skill_status == "ambiguous":
        warnings.append("skill_match_ambiguous")
    if evidence["compacted"]:
        warnings.append("context_compacted")

    world_state_manifest = _dict(metrics.get("project_world_state"))
    world_state_change = _dict(metrics.get("project_world_state_change"))
    world_state = None
    if world_state_manifest and world_state_change:
        world_state = {
            **world_state_change,
            "truncated": bool(world_state_manifest.get("truncated", False)),
        }
        if bool(world_state_change.get("changed", False)):
            warnings.append("project_world_state_changed")
        if world_state["truncated"]:
            warnings.append("project_world_state_truncated")

    return context_receipt(
        run_id,
        scope=str(base.get("scope") or "chat"),
        project=_dict(base.get("project")) or None,
        memory=memory
        or {
            "status": "not_applicable",
            "version": 0,
            "raw_context_available": False,
        },
        skill=skill,
        evidence=evidence,
        world_state=world_state,
        warnings=warnings,
    )
