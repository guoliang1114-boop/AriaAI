"""AgentStep — per-iteration record of the agent loop.

One ``AgentStep`` corresponds to one round-trip of ``LLM stream → tool execution``
inside ``agent_loop.run_agent_loop``. Steps are appended to ``ChatSessionState.steps``
in order and serialized into the assistant message metadata at persist time,
giving diagnostics and the frontend a faithful timeline of what the model did.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AgentStep:
    """Audit record for a single LLM/tool round-trip inside the agent loop."""

    index: int
    model_text: str = ""
    reasoning: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    tool_results: list[dict] = field(default_factory=list)
    truncated: bool = False
    duration_ms: int = 0
    error: str = ""
    status: str = "running"
    retryable: bool = False
    retry_count: int = 0


def serialize_steps(steps: list[AgentStep]) -> list[dict]:
    """Compact JSON-friendly view of the agent steps for message metadata."""
    return [
        {
            "index": step.index,
            "tool_names": [str(tc.get("name") or "") for tc in step.tool_calls],
            "tool_count": len(step.tool_calls),
            "result_count": len(step.tool_results),
            "duration_ms": step.duration_ms,
            "truncated": step.truncated,
            "had_reasoning": bool(step.reasoning),
            "had_text": bool(step.model_text.strip()),
            "error": step.error or None,
            "status": step.status,
            "retryable": step.retryable,
            "retry_count": step.retry_count,
        }
        for step in steps
    ]


def build_agent_step_event(step: AgentStep) -> dict:
    """SSE payload emitted to the frontend after a tool round-trip completes."""
    return {
        "type": "agent_step",
        "index": step.index,
        "tool_names": [str(tc.get("name") or "") for tc in step.tool_calls],
        "duration_ms": step.duration_ms,
        "truncated": step.truncated,
        "status": step.status,
        "retryable": step.retryable,
        "retry_count": step.retry_count,
    }
