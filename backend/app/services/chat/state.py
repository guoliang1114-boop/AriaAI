"""Chat session state — mutable shared state across streaming phases."""
from __future__ import annotations

from dataclasses import dataclass, field

from app.services.chat.agent_step import AgentStep


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
    pending_tool_confirmations: list[dict] = field(default_factory=list)
    pending_tool_actions: list[dict] = field(default_factory=list)  # HITAS: server-side persisted actions
    trace_events: list[dict] = field(default_factory=list)
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
    confirmation_requested: bool = False

    # ------------------------------------------------------------------
    # Title generation
    # ------------------------------------------------------------------
    need_title: bool = False

    # ------------------------------------------------------------------
    # Agent loop (new path; populated only when CHAT_USE_AGENT_LOOP=1)
    # ------------------------------------------------------------------
    steps: list[AgentStep] = field(default_factory=list)

    def record_trace_event(self, event_type: str, **payload) -> None:
        """Record an internal decision for diagnostics without changing chat UI."""
        self.trace_events.append({"type": event_type, **payload})

    def record_tool_use_via_text(self, stage: str, block: dict, *, status: str) -> None:
        """Record provider fallback tool JSON parsed from normal text."""
        self.record_trace_event(
            "tool_use_via_text",
            stage=stage,
            tool_name=str(block.get("name") or ""),
            tool_use_id=str(block.get("id") or ""),
            status=status,
            source="text_fallback",
            tool_use_via_text=True,
        )
