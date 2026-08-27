"""Provider-neutral display-mode policy shared by live and durable run views."""
from __future__ import annotations

from typing import Any


class DisplayMode:
    QUIET = "quiet"
    CONTEXTUAL = "contextual"
    TASK = "task"
    SKILL = "skill"
    CONFIRMATION = "confirmation"
    DEBUG = "debug"


def resolve_run_display_mode(
    action_policy: Any,
    *,
    has_skill: bool = False,
) -> str:
    """Map Aria's execution policy to one stable product display mode."""

    if has_skill:
        return DisplayMode.SKILL
    policy = str(getattr(action_policy, "value", action_policy) or "").strip()
    if policy == "durable_task":
        return DisplayMode.TASK
    if policy == "destructive_action":
        return DisplayMode.CONFIRMATION
    if policy == "read_only_tool":
        return DisplayMode.CONTEXTUAL
    if policy in {"write_artifact", "modify_existing_file"}:
        return DisplayMode.TASK
    return DisplayMode.QUIET
