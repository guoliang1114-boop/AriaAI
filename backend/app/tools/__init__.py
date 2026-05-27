"""Tools registry for Claude Function Calling.

This module provides a registry for tools that can be called by Claude
using the Function Calling API. Tools are registered with their schema
and handler functions.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Protocol
from dataclasses import dataclass


class ToolHandler(Protocol):
    """Protocol for tool handler functions."""
    
    async def __call__(self, **kwargs) -> dict[str, Any]:
        """Execute the tool with given parameters."""
        ...


@dataclass
class ToolDefinition:
    """Claude standard tool definition."""
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: ToolHandler
    
    def to_anthropic_schema(self) -> dict[str, Any]:
        """Convert to Anthropic API format."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


class ToolRegistry:
    """Registry for Claude tools."""
    
    def __init__(self):
        self._tools: dict[str, ToolDefinition] = {}
    
    def register(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
    ) -> Callable[[ToolHandler], ToolHandler]:
        """Decorator to register a tool handler.
        
        Example:
            @registry.register(
                name="generate_ppt",
                description="Generate a PowerPoint presentation",
                input_schema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "slides": {"type": "array", ...}
                    },
                    "required": ["title", "slides"]
                }
            )
            async def generate_ppt_handler(title: str, slides: list) -> dict:
                ...
        """
        def decorator(handler: ToolHandler) -> ToolHandler:
            self._tools[name] = ToolDefinition(
                name=name,
                description=description,
                input_schema=input_schema,
                handler=handler,
            )
            return handler
        return decorator
    
    def get(self, name: str) -> ToolDefinition | None:
        """Get a tool definition by name."""
        return self._tools.get(name)
    
    def list_tools(self) -> list[ToolDefinition]:
        """List all registered tools."""
        return list(self._tools.values())
    
    def get_schemas(self) -> list[dict[str, Any]]:
        """Get all tool schemas in Anthropic format."""
        return [tool.to_anthropic_schema() for tool in self._tools.values()]

    def _validate_input(self, tool: ToolDefinition, input_data: Any) -> tuple[dict[str, Any], dict[str, Any] | None]:
        if not isinstance(input_data, dict):
            return {}, {
                "type": "tool_result",
                "tool_name": tool.name,
                "status": "error",
                "error_type": "invalid_tool_input",
                "error": "Tool input must be a JSON object.",
                "missing_required": [],
            }
        schema = tool.input_schema if isinstance(tool.input_schema, dict) else {}
        required = schema.get("required") if isinstance(schema.get("required"), list) else []
        missing = [
            str(key)
            for key in required
            if key not in input_data or input_data.get(key) is None or input_data.get(key) == ""
        ]
        if missing:
            return input_data, {
                "type": "tool_result",
                "tool_name": tool.name,
                "status": "error",
                "error_type": "invalid_tool_input",
                "error": f"Missing required tool input: {', '.join(missing)}",
                "missing_required": missing,
            }
        return input_data, None
    
    async def execute(self, name: str, input_data: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool by name with given input."""
        tool = self._tools.get(name)
        if not tool:
            raise ValueError(f"Tool not found: {name}")

        input_data, validation_error = self._validate_input(tool, input_data)
        if validation_error:
            return validation_error
        
        try:
            result = await tool.handler(**input_data)
            return {
                "type": "tool_result",
                "tool_name": name,
                "status": "success",
                "output": result,
            }
        except Exception as e:
            return {
                "type": "tool_result",
                "tool_name": name,
                "status": "error",
                "error": str(e),
            }


# Global registry instance
registry = ToolRegistry()
