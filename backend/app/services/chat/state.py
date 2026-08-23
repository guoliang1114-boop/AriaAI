"""Chat session state — mutable shared state for one agent-loop run."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.agent_harness.tool_execution_record import (
    append_tool_execution_record,
    normalize_tool_execution_records,
)
from app.services.chat.agent_step import AgentStep
from app.tools.capabilities import (
    TOOL_CAPABILITY_MANIFEST_VERSION,
    resolve_tool_capability,
)


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
    rollout_finalized: bool = False
    turn_budget: Any = field(default=None, repr=False)
    budget_exhausted: bool = False
    budget_exhaustion: dict[str, Any] = field(default_factory=dict)
    run_evaluation: dict[str, Any] = field(default_factory=dict)
    context_manifest: dict[str, Any] = field(default_factory=dict)

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

    def record_tool_execution(self, event: dict[str, Any]) -> dict[str, Any]:
        """Append one canonical, bounded ToolExecutionRecord v1."""
        normalized_event = dict(event)
        tool_name = str(normalized_event.get("tool_name") or normalized_event.get("name") or "")
        raw_input = normalized_event.get("tool_input") or normalized_event.get("input")
        capability = resolve_tool_capability(
            tool_name,
            raw_input if isinstance(raw_input, dict) else None,
        )
        normalized_event.setdefault("capability_version", TOOL_CAPABILITY_MANIFEST_VERSION)
        normalized_event.setdefault("tool_effect", capability.effect.value)
        normalized_event.setdefault("result_kind", capability.result_kind.value)
        normalized_event.setdefault("retry_mode", capability.retry_mode.value)
        normalized_event.setdefault("product_event", capability.product_event.value)
        return append_tool_execution_record(self.tool_call_events, normalized_event)

    def replace_tool_execution_records(self, events: list[dict[str, Any]]) -> None:
        """Normalize records received from a durable/legacy execution path."""
        enriched: list[dict[str, Any]] = []
        for event in events:
            if not isinstance(event, dict):
                continue
            payload = dict(event)
            tool_name = str(payload.get("tool_name") or payload.get("name") or "")
            capability = resolve_tool_capability(tool_name)
            payload.setdefault("capability_version", TOOL_CAPABILITY_MANIFEST_VERSION)
            payload.setdefault("tool_effect", capability.effect.value)
            payload.setdefault("result_kind", capability.result_kind.value)
            payload.setdefault("retry_mode", capability.retry_mode.value)
            payload.setdefault("product_event", capability.product_event.value)
            enriched.append(payload)
        self.tool_call_events = normalize_tool_execution_records(enriched)

    def record_tool_use_via_text(self, stage: str, block: dict, *, status: str) -> None:
        """Record provider fallback tool JSON parsed from normal text."""
        step_index: int | None = None
        if stage.startswith("step_"):
            try:
                step_index = int(stage.removeprefix("step_").split("_", 1)[0])
            except ValueError:
                step_index = None
        event = {
            "tool_name": str(block.get("name") or ""),
            "tool_use_id": str(block.get("id") or ""),
            "tool_input": block.get("input") if isinstance(block.get("input"), dict) else {},
            "status": status,
            "source": "text_fallback",
            "message": (
                "已从模型普通文本中识别出工具计划。"
                if status == "planned"
                else "模型普通文本中的工具计划被权限策略阻止。"
            ),
        }
        if step_index is not None:
            event["step_index"] = step_index
        self.record_tool_execution(event)
        self.record_trace_event(
            "tool_use_via_text",
            stage=stage,
            tool_name=str(block.get("name") or ""),
            tool_use_id=str(block.get("id") or ""),
            status=status,
            source="text_fallback",
            tool_use_via_text=True,
        )
