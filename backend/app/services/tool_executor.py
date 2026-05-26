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
    """Process a text stream and execute complete JSON tool_use objects.

    This is a legacy compatibility helper. The main chat pipeline uses the
    P1/P2 phase parser, but this function still needs to be safe if called by
    older integrations. It therefore relies on ``JSONDecoder.raw_decode``
    instead of substring matching or fixed buffer cutoffs.
    
    Args:
        stream: The original stream from Claude
        tool_callback: Optional callback for tool results
        
    Yields:
        Text chunks or tool result markers
    """
    buffer = ""
    decoder = json.JSONDecoder()
    max_buffer_chars = 256_000
    
    async for chunk in stream:
        buffer += chunk

        while buffer:
            start_idx = buffer.find("{")
            if start_idx == -1:
                yield buffer
                buffer = ""
                break
            if start_idx > 0:
                yield buffer[:start_idx]
                buffer = buffer[start_idx:]

            try:
                data, end_idx = decoder.raw_decode(buffer)
            except json.JSONDecodeError:
                if len(buffer) > max_buffer_chars:
                    yield buffer[0]
                    buffer = buffer[1:]
                    continue
                break

            json_text = buffer[:end_idx]
            buffer = buffer[end_idx:]
            if isinstance(data, dict) and data.get("type") == "tool_use":
                result = await handle_tool_use(data)
                if tool_callback:
                    await tool_callback(data, result)
                yield f"\n[TOOL_RESULT:{json.dumps(result, ensure_ascii=False)}]\n"
            else:
                yield json_text
    
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
