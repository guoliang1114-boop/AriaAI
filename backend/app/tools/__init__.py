"""Tools registry for Claude Function Calling.

This module provides a registry for tools that can be called by Claude
using the Function Calling API. Tools are registered with their schema
and handler functions.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable, Protocol
from dataclasses import dataclass

from app.tools.capabilities import (
    ToolCapabilityManifest,
    ToolOperationCapability,
    builtin_tool_manifest,
    conservative_tool_manifest,
)


_TOOL_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")


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
    capability_manifest: ToolCapabilityManifest
    
    def to_anthropic_schema(self) -> dict[str, Any]:
        """Convert to Anthropic API format."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }

    def to_capability_manifest(self) -> dict[str, Any]:
        payload = self.capability_manifest.to_dict()
        encoded_schema = json.dumps(
            self.input_schema,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return {
            **payload,
            "input_schema_sha256": hashlib.sha256(encoded_schema).hexdigest(),
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
        capability_manifest: ToolCapabilityManifest | None = None,
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
        normalized_name = str(name or "").strip()
        normalized_description = str(description or "").strip()
        if not _TOOL_NAME_RE.fullmatch(normalized_name):
            raise ValueError(f"Invalid tool name: {name!r}")
        if not normalized_description:
            raise ValueError(f"Tool description is required: {normalized_name}")
        if not isinstance(input_schema, dict) or input_schema.get("type") != "object":
            raise ValueError(f"Tool input_schema must be a JSON object schema: {normalized_name}")
        properties = input_schema.get("properties", {})
        required = input_schema.get("required", [])
        if not isinstance(properties, dict) or not isinstance(required, list):
            raise ValueError(f"Invalid tool input_schema fields: {normalized_name}")
        undeclared_required = [key for key in required if key not in properties]
        if undeclared_required:
            raise ValueError(
                f"Tool required fields are missing from properties: {normalized_name}: "
                f"{', '.join(map(str, undeclared_required))}"
            )

        manifest = capability_manifest or builtin_tool_manifest(normalized_name)
        manifest = manifest or conservative_tool_manifest(normalized_name)
        if manifest.name != normalized_name:
            raise ValueError(
                f"Tool manifest name mismatch: tool={normalized_name} manifest={manifest.name}"
            )

        def decorator(handler: ToolHandler) -> ToolHandler:
            if normalized_name in self._tools:
                raise ValueError(f"Tool already registered: {normalized_name}")
            self._tools[normalized_name] = ToolDefinition(
                name=normalized_name,
                description=normalized_description,
                input_schema=input_schema,
                handler=handler,
                capability_manifest=manifest,
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

    def get_manifest(self, name: str) -> ToolCapabilityManifest | None:
        tool = self.get(name)
        return tool.capability_manifest if tool else None

    def resolve_capability(
        self,
        name: str,
        input_data: dict[str, Any] | None = None,
    ) -> ToolOperationCapability:
        manifest = self.get_manifest(name) or conservative_tool_manifest(name)
        return manifest.resolve(input_data)

    def get_capability_manifests(self) -> list[dict[str, Any]]:
        """Return stable, schema-bound manifests in registration order."""

        return [tool.to_capability_manifest() for tool in self._tools.values()]

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
