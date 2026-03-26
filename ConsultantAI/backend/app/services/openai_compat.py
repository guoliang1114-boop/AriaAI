"""OpenAI-compatible LLM service — supports Kimi (Moonshot) and any OpenAI-format API.

Implements the same public interface as claude.py so chat.py can swap providers
without any changes to its streaming/tool-calling logic.

Public API (mirrors claude.py):
    stream_response(messages, system, model, max_tokens, tools) -> AsyncIterator[str]
    complete(messages, system, model, max_tokens, tools) -> str
    build_system_prompt(skill_prompt, rag_context, project_context) -> str
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx
from app.database import engine
from sqlmodel import Session
from app.models.db import Setting

logger = logging.getLogger(__name__)

KIMI_BASE_URL = "https://api.moonshot.cn/v1"
DEFAULT_KIMI_MODEL = "moonshot-v1-32k"

SETTING_KIMI_API_KEY = "kimi_api_key"
SETTING_LLM_PROVIDER = "llm_provider"


# =============================================================================
# Config helpers
# =============================================================================

def _get_setting(key: str, default: str = "") -> str:
    try:
        with Session(engine) as session:
            setting = session.get(Setting, key)
            return setting.value if setting and setting.value else default
    except Exception as e:
        logger.warning(f"Failed to read setting {key}: {e}")
        return default


def get_kimi_api_key() -> str | None:
    key = _get_setting(SETTING_KIMI_API_KEY)
    return key if key else None


# =============================================================================
# Message / tool format converters
# =============================================================================

def _to_openai_messages(messages: list[dict], system: str = "") -> list[dict]:
    """Convert Anthropic-format messages to OpenAI-format.

    Handles:
    - Plain string content  →  kept as-is
    - assistant content with tool_use blocks  →  tool_calls
    - user content with tool_result blocks  →  role=tool messages
    """
    result: list[dict] = []
    if system:
        result.append({"role": "system", "content": system})

    for msg in messages:
        role = msg["role"]
        content = msg["content"]

        if isinstance(content, str):
            result.append({"role": role, "content": content})
            continue

        # content is a list of blocks
        if role == "user":
            tool_results = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]
            text_parts   = [b for b in content if isinstance(b, dict) and b.get("type") == "text"]

            for tr in tool_results:
                result.append({
                    "role": "tool",
                    "tool_call_id": tr.get("tool_use_id", ""),
                    "content": tr.get("content", ""),
                })
            if text_parts:
                text = "\n".join(b.get("text", "") for b in text_parts)
                if text:
                    result.append({"role": "user", "content": text})

        elif role == "assistant":
            text_parts = [b for b in content if isinstance(b, dict) and b.get("type") == "text"]
            tool_uses  = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"]
            text_content = "\n".join(b.get("text", "") for b in text_parts)

            if tool_uses:
                tool_calls = [
                    {
                        "id": tu.get("id", f"call_{i}"),
                        "type": "function",
                        "function": {
                            "name": tu.get("name", ""),
                            "arguments": json.dumps(tu.get("input", {}), ensure_ascii=False),
                        },
                    }
                    for i, tu in enumerate(tool_uses)
                ]
                result.append({
                    "role": "assistant",
                    "content": text_content or "",
                    "tool_calls": tool_calls,
                })
            else:
                result.append({"role": "assistant", "content": text_content})

    return result


def _to_openai_tools(tools: list[dict]) -> list[dict]:
    """Convert Claude input_schema tools to OpenAI function format."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.get("name", ""),
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
            },
        }
        for t in tools
    ]


# =============================================================================
# Streaming
# =============================================================================

async def stream_response(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_KIMI_MODEL,
    max_tokens: int = 4096,
    tools: list[dict] | None = None,
) -> AsyncIterator[str]:
    """Stream Kimi response, yielding same token/tool-use format as claude.py.

    Text chunks are yielded as plain strings.
    Complete tool_use blocks are yielded as JSON strings matching:
        {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
    """
    api_key = get_kimi_api_key()
    if not api_key:
        raise ValueError("No Kimi API key configured. Visit Settings to add one.")

    openai_messages = _to_openai_messages(messages, system)
    openai_tools = _to_openai_tools(tools) if tools else None

    payload: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": openai_messages,
        "stream": True,
    }
    if openai_tools:
        payload["tools"] = openai_tools

    logger.info(f"[Kimi] STREAM model={model} msgs={len(openai_messages)} tools={len(openai_tools) if openai_tools else 0}")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Per-call accumulation state for tool_calls
    # OpenAI streams tool calls as incremental index-keyed deltas
    tool_call_buffers: dict[int, dict] = {}  # index → {id, name, arguments}
    in_tool_call = False

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            async with client.stream(
                "POST",
                f"{KIMI_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    raise Exception(f"Kimi HTTP {response.status_code}: {body.decode()[:300]}")

                finish_reason = None

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload_str = line[6:].strip()
                    if payload_str == "[DONE]":
                        break
                    try:
                        event = json.loads(payload_str)
                    except json.JSONDecodeError:
                        continue

                    choices = event.get("choices", [])
                    if not choices:
                        continue

                    choice = choices[0]
                    finish_reason = choice.get("finish_reason") or finish_reason
                    delta = choice.get("delta", {})

                    # Text content
                    text = delta.get("content")
                    if text:
                        yield text

                    # Tool call deltas
                    tool_call_deltas = delta.get("tool_calls", [])
                    for tc_delta in tool_call_deltas:
                        idx = tc_delta.get("index", 0)
                        if idx not in tool_call_buffers:
                            in_tool_call = True
                            name = tc_delta.get("function", {}).get("name", "")
                            tool_call_buffers[idx] = {
                                "id": tc_delta.get("id", f"call_{idx}"),
                                "name": name,
                                "arguments": "",
                            }
                            if name:
                                yield f"\n\n[TOOL_START:{name}]\n\n"
                        else:
                            # accumulate arguments fragment
                            frag = tc_delta.get("function", {}).get("arguments", "")
                            tool_call_buffers[idx]["arguments"] += frag

                # Emit complete tool_use blocks after stream ends
                if in_tool_call:
                    for buf in tool_call_buffers.values():
                        try:
                            parsed_input = json.loads(buf["arguments"]) if buf["arguments"] else {}
                        except json.JSONDecodeError:
                            parsed_input = {}
                        yield json.dumps({
                            "type": "tool_use",
                            "id": buf["id"],
                            "name": buf["name"],
                            "input": parsed_input,
                        })

                if finish_reason == "length":
                    logger.warning("[Kimi] Output truncated due to max_tokens")
                    yield "\n\n[OUTPUT_TRUNCATED]"

        except Exception as e:
            logger.error(f"[Kimi] stream error: {type(e).__name__}: {e}")
            raise


# =============================================================================
# Non-streaming
# =============================================================================

async def complete(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_KIMI_MODEL,
    max_tokens: int = 4096,
    tools: list[dict] | None = None,
) -> str:
    """Non-streaming Kimi completion. Returns text (and tool_use JSON if applicable)."""
    api_key = get_kimi_api_key()
    if not api_key:
        raise ValueError("No Kimi API key configured. Visit Settings to add one.")

    openai_messages = _to_openai_messages(messages, system)
    openai_tools = _to_openai_tools(tools) if tools else None

    payload: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": openai_messages,
    }
    if openai_tools:
        payload["tools"] = openai_tools

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            response = await client.post(
                f"{KIMI_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            )
            if response.status_code != 200:
                raise Exception(f"Kimi HTTP {response.status_code}: {response.text[:300]}")

            result = response.json()
            choice = result.get("choices", [{}])[0]
            message = choice.get("message", {})
            parts: list[str] = []

            text = message.get("content") or ""
            if text:
                parts.append(text)

            for tc in message.get("tool_calls", []):
                try:
                    parsed = json.loads(tc["function"]["arguments"])
                except (json.JSONDecodeError, KeyError):
                    parsed = {}
                parts.append(json.dumps({
                    "type": "tool_use",
                    "id": tc.get("id", ""),
                    "name": tc.get("function", {}).get("name", ""),
                    "input": parsed,
                }, ensure_ascii=False))

            return "\n".join(parts)
        except Exception as e:
            logger.error(f"[Kimi] complete error: {type(e).__name__}: {e}")
            raise


# =============================================================================
# System prompt builder (same signature as claude.py)
# =============================================================================

def build_system_prompt(
    skill_prompt: str = "",
    rag_context: str = "",
    project_context: str = "",
) -> str:
    """Build system prompt string — identical logic to claude.py."""
    if project_context:
        base = (
            "You are an AI consultant assistant embedded in a project management tool. "
            "The current project's full context is provided below — including status, milestones, "
            "uploaded documents, and financials. "
            "You MUST actively reference this data when answering questions. "
            "When the user asks about the project, immediately use the specific facts from the context "
            "(milestone names, amounts, dates, file names, etc.) — never say you lack context or ask "
            "the user to share information that is already in the project context. "
            "If this is the start of a conversation, briefly summarize the key project status proactively."
        )
    else:
        base = (
            "You are an elite AI consultant assistant for a top-tier consulting firm. "
            "Provide precise, structured, and actionable analysis."
        )

    parts = [base]
    if skill_prompt:
        parts.append(f"\n\n## Skill Context\n{skill_prompt}")
    if project_context:
        parts.append(f"\n\n## Project Context\n{project_context}")
    if rag_context:
        parts.append(f"\n\n## Relevant Knowledge Base Excerpts\n{rag_context}")
    return "\n".join(parts)
