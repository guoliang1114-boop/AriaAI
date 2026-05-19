"""Chat session state — mutable shared state across streaming phases."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ChatSessionState:
    """Mutable state that accumulates across P0 → P1 → P2 → P3 → P4.

    The orchestrator instantiates this once and passes it to every phase.
    Each phase reads/writes the fields it owns.
    """

    # ------------------------------------------------------------------
    # Cross-phase text accumulation
    # ------------------------------------------------------------------
    full_text: str = ""

    # ------------------------------------------------------------------
    # P1 outputs
    # ------------------------------------------------------------------
    text_buffer: str = ""
    tool_use_blocks: list[dict] = field(default_factory=list)
    reasoning_content: str = ""
    p1_truncated: bool = False
    p1_double_truncated: bool = False

    # ------------------------------------------------------------------
    # P3 outputs
    # ------------------------------------------------------------------
    follow_up_text: str = ""
    p3_tool_use_blocks: list[dict] = field(default_factory=list)
    p3_reasoning_content: str = ""
    p3_truncated: bool = False
    p3_double_truncated: bool = False

    # ------------------------------------------------------------------
    # P2/P3 shared: tool execution
    # ------------------------------------------------------------------
    tool_result_blocks: list[dict] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Tool / artifact / markdown tracking
    # ------------------------------------------------------------------
    tool_call_events: list[dict] = field(default_factory=list)
    artifacts: list[dict] = field(default_factory=list)
    pending_markdown_saves: list[dict] = field(default_factory=list)
    workflow_started: bool = False

    # ------------------------------------------------------------------
    # Timing & metrics
    # ------------------------------------------------------------------
    stage_timings: dict[str, int | str] = field(default_factory=dict)
    first_model_event_recorded: bool = False

    # ------------------------------------------------------------------
    # Durable-task early-return
    # ------------------------------------------------------------------
    durable_task_completed: bool = False

    # ------------------------------------------------------------------
    # Title generation
    # ------------------------------------------------------------------
    need_title: bool = False
