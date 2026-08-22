"""Chat session state — mutable shared state for one agent-loop run."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.chat.agent_step import AgentStep


@dataclass
class ChatSessionState:
    """Mutable state accumulated across a single agent-loop run.

    The orchestrator instantiates this once and passes it to the agent loop,
    the tool executor, and the persist step. Fields are grouped by the concern
    that owns them.
    """

    # ------------------------------------------------------------------
    # AI Run identity (Product Run Event v1, see product_run_events.py)
    # ------------------------------------------------------------------
    run_id: str = ""
    rollout_task_id: int | None = None
    rollout_bind: Any = field(default=None, repr=False)
    assistant_message_id: int | None = None

    # ------------------------------------------------------------------
    # User-visible text (assembled by the agent loop)
    # ------------------------------------------------------------------
    full_text: str = ""

    # ------------------------------------------------------------------
    # Tool execution: last batch of results fed back to the LLM
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
    # ``time.perf_counter()`` value captured the moment ``stream_chat_events``
    # was entered. Used by persist to compute ``total_stream_ms`` correctly.
    # Stays 0.0 until the orchestrator stamps it; persist treats 0.0 as
    # "not stamped" and falls back to its own timer.
    stream_started_at: float = 0.0

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
