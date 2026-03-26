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
    
    async def execute(self, name: str, input_data: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool by name with given input."""
        tool = self._tools.get(name)
        if not tool:
            raise ValueError(f"Tool not found: {name}")
        
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
