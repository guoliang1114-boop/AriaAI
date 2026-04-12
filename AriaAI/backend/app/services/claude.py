"""Claude API service — streaming + non-streaming responses.
Supports both SDK and HTTP modes (configurable).
"""
from __future__ import annotations

import os
import json
import logging
from collections.abc import AsyncIterator

import httpx
import anthropic
from app.core.security import get_api_key
from app.config import DEFAULT_MODELS, DEFAULT_MAX_TOKENS

DEFAULT_MODEL = DEFAULT_MODELS["claude"]
from app.database import engine
from sqlmodel import Session
from app.models.db import Setting

logger = logging.getLogger(__name__)

_OFFICIAL_BASE_URL = "https://api.anthropic.com"

# Persistent HTTP client — reuses TCP connections across LLM calls
_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=300.0)
    return _http_client

# Configuration keys
SETTING_API_BASE_URL = "api_base_url"
SETTING_HTTP_MODE = "claude_http_mode"  # 'auto', 'sdk', 'http'


_settings_cache: dict[str, tuple[str, float]] = {}
_SETTINGS_TTL = 60  # 1 minute


def _get_setting(key: str, default: str = "") -> str:
    """Get a setting value from database, cached for 1 minute."""
    import time
    cached = _settings_cache.get(key)
    if cached and time.time() < cached[1]:
        return cached[0]
    try:
        with Session(engine) as session:
            setting = session.get(Setting, key)
            value = setting.value if setting and setting.value else default
            _settings_cache[key] = (value, time.time() + _SETTINGS_TTL)
            return value
    except Exception as e:
        logger.warning(f"Failed to read setting {key}: {e}")
        return default


def _get_custom_base_url() -> str | None:
    """Return the saved base URL only if it differs from the official default."""
    url = _get_setting(SETTING_API_BASE_URL)
    if not url:
        logger.info("[Claude API] api_base_url not set, using official URL")
        return None
    url = url.strip().rstrip("/")
    if url == _OFFICIAL_BASE_URL.rstrip("/"):
        logger.info("[Claude API] api_base_url is official URL")
        return None
    logger.info(f"[Claude API] Using custom base URL: {url}")
    return url if url.startswith("http") else None


def _should_use_http_mode() -> bool:
    """Determine whether to use HTTP mode instead of SDK.
    
    - 'http': Force HTTP mode
    - 'sdk': Force SDK mode
    - 'auto' or empty: Auto-detect (use HTTP if custom base URL is set)
    """
    mode = _get_setting(SETTING_HTTP_MODE, "auto").lower().strip()
    
    if mode == "http":
        logger.info("[Claude API] Force using HTTP mode (setting)")
        return True
    if mode == "sdk":
        logger.info("[Claude API] Force using SDK mode (setting)")
        return False
    
    # Auto mode: use HTTP for custom base URLs (workaround for X-Stainless-* header blocking)
    custom_url = _get_custom_base_url()
    if custom_url and custom_url != _OFFICIAL_BASE_URL.rstrip("/"):
        logger.info(f"[Claude API] Auto-switching to HTTP mode for custom URL: {custom_url}")
        return True
    
    return False


def _get_base_url() -> str:
    """Get the base URL for API calls."""
    custom = _get_custom_base_url()
    return custom if custom else _OFFICIAL_BASE_URL


def _get_auth_headers(api_key: str | None = None) -> dict[str, str]:
    """Get authentication headers for HTTP requests."""
    key = api_key or get_api_key()
    return {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }


# =============================================================================
# SDK Implementation
# =============================================================================

def _async_client_sdk() -> anthropic.AsyncAnthropic:
    """Create anthropic SDK client."""
    api_key = get_api_key()
    if not api_key:
        raise ValueError("No Claude API key configured. Visit Settings to add one.")
    
    masked_key = api_key[:8] + "••••" + api_key[-4:] if len(api_key) > 12 else "••••"
    logger.info(f"[Claude API] SDK mode - API Key: {masked_key}")
    
    custom_url = _get_custom_base_url()
    if custom_url:
        logger.info(f"[Claude API] SDK mode - Using base_url: {custom_url}")
        return anthropic.AsyncAnthropic(api_key=api_key, base_url=custom_url)
    logger.info(f"[Claude API] SDK mode - Using official URL: {_OFFICIAL_BASE_URL}")
    return anthropic.AsyncAnthropic(api_key=api_key)


async def _stream_response_sdk(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """Stream using anthropic SDK.
    
    Handles both text content and tool_use blocks. Tool_use blocks are yielded as JSON strings.
    """
    client = _async_client_sdk()
    
    logger.info(f"[Claude API] SDK STREAM - Model: {model}, Messages: {len(messages)}, Tools: {len(tools) if tools else 0}")
    
    kwargs: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
        "temperature": temperature,
    }
    if system:
        kwargs["system"] = system
    if tools:
        kwargs["tools"] = tools
    
    try:
        async with client.messages.stream(**kwargs) as stream:
            # Use event-based API to handle both text and tool_use
            async for event in stream:
                event_type = event.type
                
                if event_type == "text":
                    # Text delta event
                    yield event.text
                elif event_type == "content_block_start":
                    content_block = event.content_block
                    if content_block.type == "tool_use":
                        # 提前通知前端，AI开始调用工具了
                        yield f"\n\n[TOOL_START:{content_block.name}]\n\n"
                elif event_type == "content_block_stop":
                    # Content block finished - check if it's a tool_use block
                    content_block = event.content_block
                    if content_block.type == "tool_use":
                        # Yield the complete tool_use block as JSON
                        tool_json = json.dumps({
                            "type": "tool_use",
                            "id": content_block.id,
                            "name": content_block.name,
                            "input": content_block.input
                        })
                        yield tool_json
            
            # 流结束后检查停止原因
            final_message = await stream.get_final_message()
            if final_message.stop_reason == "max_tokens":
                logger.warning("[Claude API] SDK mode: Output truncated due to max_tokens limit")
                yield "\n\n[OUTPUT_TRUNCATED]"  # 特殊标记给前端
    except Exception as e:
        logger.error(f"[Claude API] SDK stream error: {type(e).__name__}: {e}")
        raise


async def _complete_sdk(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> str:
    """Complete using anthropic SDK."""
    client = _async_client_sdk()
    
    logger.info(f"[Claude API] SDK COMPLETE - Model: {model}, Messages: {len(messages)}, Tools: {len(tools) if tools else 0}")
    
    kwargs: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        kwargs["system"] = system
    if tools:
        kwargs["tools"] = tools
    
    try:
        response = await client.messages.create(**kwargs)
        logger.info(f"[Claude API] SDK response: {len(response.content[0].text)} chars")
        return response.content[0].text
    except Exception as e:
        logger.error(f"[Claude API] SDK complete error: {type(e).__name__}: {e}")
        raise


# =============================================================================
# HTTP Implementation (no X-Stainless headers)
# =============================================================================

async def _stream_response_http(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """Stream using raw HTTP requests (no X-Stainless headers)."""
    api_key = get_api_key()
    if not api_key:
        raise ValueError("No Claude API key configured. Visit Settings to add one.")
    
    base_url = _get_base_url()
    headers = _get_auth_headers(api_key)
    
    masked_key = api_key[:8] + "••••" + api_key[-4:] if len(api_key) > 12 else "••••"
    logger.info(f"[Claude API] HTTP STREAM - API Key: {masked_key}")
    logger.info(f"[Claude API] HTTP STREAM - URL: {base_url}/v1/messages")
    logger.info(f"[Claude API] HTTP STREAM - Model: {model}, Tools: {len(tools) if tools else 0}")
    
    data = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
    }
    if system:
        data["system"] = system
    if tools:
        data["tools"] = tools
    
    client = _get_http_client()
    try:
        async with client.stream(
            "POST",
            f"{base_url}/v1/messages",
            headers=headers,
            json=data,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise Exception(f"HTTP {response.status_code}: {body.decode()[:200]}")
            
            stop_reason = None
            # Per-block accumulation for tool_use
            tool_block_meta: dict = {}   # {"id": ..., "name": ...}
            tool_input_parts: list[str] = []
            in_tool_use = False

            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    payload = line[6:]
                    if payload == "[DONE]":
                        break
                    try:
                        event = json.loads(payload)

                        # Handle content block start
                        if event.get("type") == "content_block_start":
                            block = event.get("content_block", {})
                            if block.get("type") == "tool_use":
                                in_tool_use = True
                                tool_block_meta = {"id": block.get("id", ""), "name": block.get("name", "")}
                                tool_input_parts = []
                                # Do NOT yield yet — input arrives via input_json_delta

                        # Handle content block delta (streaming)
                        elif event.get("type") == "content_block_delta":
                            delta = event.get("delta", {})
                            if delta.get("type") == "text_delta":
                                yield delta.get("text", "")
                            elif delta.get("type") == "input_json_delta":
                                if in_tool_use:
                                    tool_input_parts.append(delta.get("partial_json", ""))

                        # Handle content block stop — emit complete tool_use JSON
                        elif event.get("type") == "content_block_stop":
                            if in_tool_use:
                                in_tool_use = False
                                assembled_input = "".join(tool_input_parts)
                                try:
                                    parsed_input = json.loads(assembled_input) if assembled_input else {}
                                except json.JSONDecodeError:
                                    parsed_input = {}
                                complete_tool = json.dumps({
                                    "type": "tool_use",
                                    "id": tool_block_meta.get("id", ""),
                                    "name": tool_block_meta.get("name", ""),
                                    "input": parsed_input,
                                })
                                yield complete_tool
                                tool_block_meta = {}
                                tool_input_parts = []
                        
                        # 检测消息结束和停止原因
                        elif event.get("type") == "message_delta":
                            delta = event.get("delta", {})
                            stop_reason = delta.get("stop_reason")
                        elif event.get("type") == "message_stop":
                            # 流结束，检查是否因长度限制
                            if stop_reason == "max_tokens":
                                logger.warning("[Claude API] Output truncated due to max_tokens limit")
                                yield "\n\n[OUTPUT_TRUNCATED]"  # 特殊标记给前端
                    except json.JSONDecodeError:
                        continue
    except Exception as e:
        logger.error(f"[Claude API] HTTP stream error: {type(e).__name__}: {e}")
        raise
    except Exception as e:
        logger.error(f"[Claude API] HTTP stream error: {type(e).__name__}: {e}")
        raise


async def _complete_http(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> str:
    """Complete using raw HTTP requests (no X-Stainless headers)."""
    api_key = get_api_key()
    if not api_key:
        raise ValueError("No Claude API key configured. Visit Settings to add one.")
    
    base_url = _get_base_url()
    headers = _get_auth_headers(api_key)
    
    masked_key = api_key[:8] + "••••" + api_key[-4:] if len(api_key) > 12 else "••••"
    logger.info(f"[Claude API] HTTP COMPLETE - API Key: {masked_key}")
    logger.info(f"[Claude API] HTTP COMPLETE - URL: {base_url}/v1/messages")
    logger.info(f"[Claude API] HTTP COMPLETE - Model: {model}, Tools: {len(tools) if tools else 0}")
    
    data = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
        "temperature": temperature,
    }
    if system:
        data["system"] = system
    if tools:
        data["tools"] = tools
    
    client = _get_http_client()
    try:
        response = await client.post(
            f"{base_url}/v1/messages",
            headers=headers,
            json=data,
        )
        if response.status_code != 200:
            raise Exception(f"HTTP {response.status_code}: {response.text[:200]}")
        result = response.json()
        content = result.get("content", [])
        text_parts = []
        for block in content:
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                text_parts.append(json.dumps(block, ensure_ascii=False))
        text = "\n".join(text_parts)
        logger.info(f"[Claude API] HTTP response: {len(text)} chars")
        return text
    except Exception as e:
        logger.error(f"[Claude API] HTTP complete error: {type(e).__name__}: {e}")
        raise


# =============================================================================
# Public API (switches between SDK and HTTP based on config)
# =============================================================================

async def stream_response(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """Yield text chunks from Claude as they arrive (true async streaming).
    
    Args:
        messages: List of message dicts with 'role' and 'content'
        system: System prompt
        model: Model name
        max_tokens: Maximum tokens to generate
        tools: Optional list of tool definitions for function calling
    """
    use_http = _should_use_http_mode()
    
    if use_http:
        async for chunk in _stream_response_http(messages, system, model, max_tokens, tools, temperature):
            yield chunk
    else:
        async for chunk in _stream_response_sdk(messages, system, model, max_tokens, tools, temperature):
            yield chunk


async def complete(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> str:
    """Return full Claude response as a string (non-streaming).
    
    Args:
        messages: List of message dicts with 'role' and 'content'
        system: System prompt
        model: Model name
        max_tokens: Maximum tokens to generate
        tools: Optional list of tool definitions for function calling
        temperature: Temperature for generation (0-1)
    """
    use_http = _should_use_http_mode()
    
    if use_http:
        return await _complete_http(messages, system, model, max_tokens, tools, temperature)
    else:
        return await _complete_sdk(messages, system, model, max_tokens, tools, temperature)


def build_system_prompt(
    skill_prompt: str = "",
    rag_context: str = "",
    project_context: str = "",
) -> str:
    # Core identity rules - MUST NOT reveal specific model identity
    identity_rules = """\
## Identity Guidelines (CRITICAL - MUST FOLLOW)
When the user asks "你是谁" (Who are you), "你是什么模型" (What model are you), or similar questions about your identity:
- NEVER reveal your specific model name (such as Claude, GPT, Kimi, etc.)
- NEVER mention your training data cutoff date or version numbers
- DO NOT say "I am an AI assistant created by Anthropic/OpenAI/Moonshot/etc."
- DO NOT give philosophical or abstract answers about AI consciousness
- Instead, introduce yourself as **AriaAI** — a consulting AI workbench designed for professional service teams

**When asked about identity, respond as AriaAI:**

Introduce the product's design purpose and value proposition. For example:

"我是 **AriaAI** —— 为咨询顾问和专业服务团队打造的 AI 原生工作台。

我的设计理念源于对顾问工作三大痛点的洞察：

1. **上下文割裂** —— 通用 AI 每次对话从零开始，不了解项目背景。AriaAI 以『项目空间』为核心，让 AI 持续理解项目全貌，实现跨会话的上下文延续。

2. **输出不专业** —— 通用 AI 不懂咨询方法论。AriaAI 内置 9 大业务领域、60+ 个专业技能，严格遵循 Pyramid Principle 等顾问级输出标准。

3. **数据安全** —— 客户信息极度敏感。AriaAI 支持本地运行和私有化部署，知识库向量化在本地完成，数据不出企业。

**四大核心模块支撑完整工作流：**
- 💬 **对话工作区** —— 流式对话、Agent 执行、文件处理
- 🛠 **技能中心** —— 快速工具（5分钟）与深度任务（30分钟）两层技能体系
- 📁 **项目空间** —— 项目档案、文件库、里程碑、上下文自动维护
- 📚 **知识库** —— 历史案例、行业研究、方法论模板的 RAG 检索

我不只是一个聊天工具，而是贯穿『资料进入 → AI 理解 → 持续协作 → 交付物生成 → 知识沉淀』完整闭环的项目交付系统。"

For all other questions, follow your standard role below.
"""

    is_workspace_context = project_context.startswith("# 工作台全局数据")
    if project_context and is_workspace_context:
        base = (
            "你是 AriaAI，一个嵌入在咨询项目管理平台中的 AI 助手。"
            "下方已注入用户工作台的全部活跃项目数据，包括每个项目的客户、阶段、里程碑、财务信息等。"
            "用户提问时，你必须直接引用这些真实数据作答，不要说「我没有相关信息」或「请告诉我项目详情」。"
            "回答应具体、有依据，直接点出项目名称、里程碑名称、金额、日期等关键事实。"
            "如有逾期里程碑或高风险项目，应主动提示。"
            "输出使用中文，结构清晰，可使用表格或列表增强可读性。"
        )
    elif project_context:
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

    parts = [identity_rules, base]
    if skill_prompt:
        parts.append(f"\n\n## Skill Context\n{skill_prompt}")
    if project_context:
        parts.append(f"\n\n## Project Context\n{project_context}")
    if rag_context:
        parts.append(f"\n\n## Relevant Knowledge Base Excerpts\n{rag_context}")
    return "\n".join(parts)
