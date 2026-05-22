"""Direct tool executor for pending actions (no LLM re-generation)."""
from __future__ import annotations

import inspect
import logging
from typing import Any

from app.tools import registry

logger = logging.getLogger(__name__)


async def execute_tool_by_name(tool_name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Execute a registered tool directly by name with the given input.

    This bypasses the LLM planning phase and runs the tool deterministically.
    Used by the Human-in-the-Loop confirmation flow.
    """
    tool_func = registry.get(tool_name)
    if tool_func is None:
        logger.error("[ActionExecutor] tool not found: %s", tool_name)
        return {"success": False, "error": f"Tool '{tool_name}' not found in registry"}

    try:
        # Handle both sync and async tools
        if inspect.iscoroutinefunction(tool_func):
            result = await tool_func(**tool_input)
        else:
            result = tool_func(**tool_input)

        # Normalize result to a dict
        if result is None:
            return {"success": True, "result": None}
        if isinstance(result, dict):
            return {"success": True, **result}
        return {"success": True, "result": result}

    except Exception as exc:
        logger.error("[ActionExecutor] tool execution failed: %s", exc, exc_info=True)
        return {"success": False, "error": str(exc)}
