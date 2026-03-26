"""Tool execution service for Claude Function Calling.

This service handles the tool_use → tool_result loop for Claude's
function calling feature. It manages tool invocation and result formatting.
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator

from app.tools import registry


async def handle_tool_use(
    tool_use_block: dict[str, Any]
) -> dict[str, Any]:
    """Handle a tool_use block from Claude.
    
    Args:
        tool_use_block: The tool_use block from Claude API
        
    Returns:
        A tool_result block to send back to Claude
    """
    tool_name = tool_use_block.get("name")
    tool_input = tool_use_block.get("input", {})
    tool_use_id = tool_use_block.get("id")
    
    # Execute the tool
    result = await registry.execute(tool_name, tool_input)
    
    # Format result for Claude
    return {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": json.dumps(result, ensure_ascii=False),
    }


def format_tools_for_claude(tools: list[dict]) -> list[dict]:
    """Format tool definitions for Claude API.
    
    Validates and normalizes tool schemas for Claude compatibility.
    """
    formatted = []
    for tool in tools:
        if isinstance(tool, str):
            # Legacy: tool name only, look up in registry
            tool_def = registry.get(tool)
            if tool_def:
                formatted.append(tool_def.to_anthropic_schema())
        elif isinstance(tool, dict):
            # Full tool definition
            formatted.append(tool)
    return formatted


async def stream_with_tools(
    stream: AsyncIterator[str],
    tool_callback: callable | None = None,
) -> AsyncIterator[str]:
    """Process stream and handle tool_use blocks.
    
    This generator yields text chunks normally, and when it detects
    a tool_use block, it executes the tool and yields the result.
    
    Args:
        stream: The original stream from Claude
        tool_callback: Optional callback for tool results
        
    Yields:
        Text chunks or tool result markers
    """
    buffer = ""
    in_tool_use = False
    current_tool_block = ""
    
    async for chunk in stream:
        # Simple approach: look for JSON tool_use blocks
        buffer += chunk
        
        # Check for complete tool_use block in buffer
        if "type\": \"tool_use\"" in buffer or '"type": "tool_use"' in buffer:
            # Try to extract complete tool_use
            try:
                # Find JSON object boundaries
                start_idx = buffer.find('{')
                end_idx = buffer.rfind('}')
                
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    json_str = buffer[start_idx:end_idx+1]
                    data = json.loads(json_str)
                    
                    if data.get("type") == "tool_use":
                        # Execute tool
                        result = await handle_tool_use(data)
                        
                        # Notify callback if provided
                        if tool_callback:
                            await tool_callback(data, result)
                        
                        # Yield result marker (frontend can handle this)
                        yield f"\n[TOOL_RESULT:{json.dumps(result, ensure_ascii=False)}]\n"
                        
                        # Clear buffer
                        buffer = buffer[end_idx+1:]
                        continue
            except json.JSONDecodeError:
                # Incomplete JSON, continue buffering
                pass
        
        # Yield normal text
        if len(buffer) > 1000:  # Prevent infinite buffering
            yield buffer
            buffer = ""
    
    # Yield remaining buffer
    if buffer:
        yield buffer


def extract_tool_calls(content: list[dict]) -> list[dict]:
    """Extract tool_use blocks from Claude response content.
    
    Args:
        content: The content array from Claude response
        
    Returns:
        List of tool_use blocks
    """
    tools = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            tools.append(block)
    return tools


async def execute_tool_sequence(
    content: list[dict]
) -> list[dict]:
    """Execute all tools in content and return tool_results.
    
    Args:
        content: Claude response content with tool_use blocks
        
    Returns:
        List of tool_result blocks
    """
    tool_calls = extract_tool_calls(content)
    results = []
    
    for tool_call in tool_calls:
        result = await handle_tool_use(tool_call)
        results.append(result)
    
    return results


def create_tool_message(
    tool_results: list[dict]
) -> dict[str, Any]:
    """Create a tool result message for Claude.
    
    Args:
        tool_results: List of tool_result blocks
        
    Returns:
        Message dict to add to conversation
    """
    return {
        "role": "user",
        "content": tool_results,
    }


def should_continue_with_tools(response: dict) -> bool:
    """Check if we need to continue the tool_use loop.
    
    Args:
        response: Claude API response
        
    Returns:
        True if there are tool_use blocks and stop_reason is tool_use
    """
    stop_reason = response.get("stop_reason")
    content = response.get("content", [])
    
    if stop_reason != "tool_use":
        return False
    
    return any(
        isinstance(block, dict) and block.get("type") == "tool_use"
        for block in content
    )
