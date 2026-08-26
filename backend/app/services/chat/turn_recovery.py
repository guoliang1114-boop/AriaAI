"""Safe continuation contracts for interrupted Aria chat turns."""
from __future__ import annotations

from typing import Any


def build_turn_recovery_preview(
    rollout: dict[str, Any],
    *,
    source_message_id: int,
) -> dict[str, Any]:
    status = str(rollout.get("status") or "")
    recovery = rollout.get("recovery") if isinstance(rollout.get("recovery"), dict) else {}
    steps = [item for item in list(rollout.get("steps") or []) if isinstance(item, dict)]
    completed_steps = [
        int(item.get("step_index"))
        for item in steps
        if item.get("status") == "completed" and isinstance(item.get("step_index"), int)
    ][:32]
    completed_tool_calls = sum(
        len(item.get("tool_calls") or [])
        for item in steps
        if item.get("status") == "completed"
    )
    side_effects_possible = completed_tool_calls > 0 or bool(rollout.get("run_outputs"))
    can_continue = status in {"cancelled", "failed", "interrupted", "running"}
    strategy = (
        "resume_from_checkpoint"
        if recovery.get("can_resume")
        else "retry_failed_step"
        if recovery.get("can_retry")
        else "continue_as_new_turn"
    )
    warning_codes: list[str] = []
    if completed_steps:
        warning_codes.append("preserve_completed_steps")
    if side_effects_possible:
        warning_codes.append("inspect_before_side_effects")
    if strategy == "continue_as_new_turn":
        warning_codes.append("no_unsafe_tool_replay")
    return {
        "schema_version": 1,
        "source_run_id": str(rollout.get("run_id") or "")[:80],
        "source_message_id": source_message_id,
        "source_status": status,
        "can_continue": can_continue,
        "strategy": strategy,
        "completed_steps": completed_steps,
        "completed_tool_call_count": completed_tool_calls,
        "side_effects_possible": side_effects_possible,
        "warning_codes": warning_codes,
        "suggested_content": (
            "请基于已保存的中断状态继续：保留已经完成的结果，先核对当前项目状态，"
            "不要重复执行已完成的写入动作，从尚未完成的部分继续。"
        ),
    }


def format_turn_recovery_for_prompt(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    source_run_id = str(value.get("source_run_id") or "")
    strategy = str(value.get("strategy") or "")
    if not source_run_id.startswith("run_") or strategy not in {
        "resume_from_checkpoint",
        "retry_failed_step",
        "continue_as_new_turn",
    }:
        return ""
    completed_steps = [
        int(item)
        for item in list(value.get("completed_steps") or [])[:32]
        if isinstance(item, int) and item >= 0
    ]
    return "\n".join(
        [
            "## Turn Recovery Contract",
            f"Source run: {source_run_id}",
            f"Recovery strategy: {strategy}",
            f"Completed step indexes: {completed_steps}",
            "Continue as a new audited turn. Preserve completed facts and outputs.",
            "Never replay a previous write or destructive action without inspecting current project state and obtaining any confirmation required now.",
        ]
    )
