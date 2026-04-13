"""OpenAI-compatible LLM service — supports Kimi (Moonshot) and any OpenAI-format API.

Implements the same public interface as claude.py so chat.py can swap providers
without any changes to its streaming/tool-calling logic.

Public API (mirrors claude.py):
    stream_response(messages, system, model, max_tokens, tools) -> AsyncIterator[str]
    complete(messages, system, model, max_tokens, tools) -> str
    build_system_prompt(skill_prompt, rag_context, project_context) -> str
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
from collections.abc import AsyncIterator

import httpx
from app.database import engine
from sqlmodel import Session
from app.models.db import Setting

logger = logging.getLogger(__name__)

KIMI_BASE_URL = "https://api.moonshot.cn/v1"
BIGMODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"

# Persistent HTTP client for Kimi/OpenAI-compat calls
_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=300.0)
    return _http_client
DEFAULT_KIMI_MODEL = "moonshot-v1-128k"
DEFAULT_BIGMODEL_MODEL = "glm-5.1"

SETTING_KIMI_API_KEY = "kimi_api_key"
SETTING_BIGMODEL_API_KEY = "bigmodel_api_key"
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
    """Retrieve Kimi API key: Keychain → SQLite → env var."""
    # 1. Try Keychain first
    try:
        import keyring
        from app.config import KEYCHAIN_SERVICE, KEYCHAIN_KEY_KIMI
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_KIMI)
        if key:
            return key
    except Exception:
        pass
    
    # 2. Try database
    key = _get_setting(SETTING_KIMI_API_KEY)
    if key:
        return key
    
    # 3. Try environment variable
    import os
    return os.environ.get("MOONSHOT_API_KEY")


def get_bigmodel_api_key() -> str | None:
    """Retrieve BigModel (Zhipu AI) API key: Keychain → SQLite → env var."""
    # 1. Try Keychain first
    try:
        import keyring
        from app.config import KEYCHAIN_SERVICE, KEYCHAIN_KEY_BIGMODEL
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_BIGMODEL)
        if key:
            return key
    except Exception:
        pass
    
    # 2. Try database
    key = _get_setting(SETTING_BIGMODEL_API_KEY)
    if key:
        return key
    
    # 3. Try environment variable
    import os
    return os.environ.get("BIGMODEL_API_KEY")


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
                asst_msg: dict = {
                    "role": "assistant",
                    "content": text_content or "",
                    "tool_calls": tool_calls,
                }
                # Preserve reasoning_content required by kimi-k2.5 multi-turn tool calls
                if msg.get("reasoning_content"):
                    asst_msg["reasoning_content"] = msg["reasoning_content"]
                result.append(asst_msg)
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

async def _stream_with_retry(
    client: httpx.AsyncClient,
    headers: dict,
    payload: dict,
    max_retries: int = 3,
) -> AsyncIterator[str]:
    """Internal stream handler with retry logic for rate limiting."""
    last_error = None
    
    for attempt in range(max_retries):
        try:
            async with client.stream(
                "POST",
                f"{KIMI_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code == 429:
                    # Rate limited - check if we should retry
                    if attempt < max_retries - 1:
                        wait_time = (2 ** attempt) + random.uniform(0, 1)  # exponential backoff
                        logger.warning(f"[Kimi] Rate limited (429), retrying in {wait_time:.1f}s (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        # Last attempt failed with 429
                        body = await response.aread()
                        error_msg = body.decode()[:300]
                        raise Exception(
                            "Kimi 服务当前繁忙，请稍后重试。"
                            f"\n\n详细信息：API 限流 (HTTP 429)"
                        )
                
                if response.status_code != 200:
                    body = await response.aread()
                    error_msg = body.decode()[:300]
                    raise Exception(f"Kimi HTTP {response.status_code}: {error_msg}")
                
                # Stream successful - yield all chunks
                async for line in response.aiter_lines():
                    yield line
                return  # Success, exit retry loop
                
        except Exception as e:
            last_error = e
            # Don't retry on client errors (4xx except 429) or if it's our custom error
            if "Kimi 服务当前繁忙" in str(e):
                raise  # Re-raise our user-friendly error
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"[Kimi] Stream error, retrying in {wait_time:.1f}s: {e}")
                await asyncio.sleep(wait_time)
            else:
                raise
    
    # Should not reach here, but just in case
    if last_error:
        raise last_error


async def stream_response(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_KIMI_MODEL,
    max_tokens: int = 4096,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """Stream OpenAI-compatible response, yielding same token/tool-use format as claude.py.

    Text chunks are yielded as plain strings.
    Complete tool_use blocks are yielded as JSON strings matching:
        {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
    
    Automatically selects the correct provider based on model name.
    """
    # Auto-detect provider from model name
    if model.startswith("glm-"):
        async for chunk in stream_response_bigmodel(messages, system, model, max_tokens, tools, temperature):
            yield chunk
        return
    
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
        "temperature": temperature,
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
    reasoning_buffer = ""  # kimi-k2.5 reasoning_content

    client = _get_http_client()
    finish_reason = None
    
    try:
        async for line in _stream_with_retry(client, headers, payload):
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

            # Reasoning content (kimi-k2.5 thinking) — accumulate, don't stream to user
            reasoning = delta.get("reasoning_content")
            if reasoning:
                reasoning_buffer += reasoning

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
            # Emit reasoning_content so chat.py can attach it to the assistant message
            if reasoning_buffer:
                yield json.dumps({
                    "type": "reasoning_content",
                    "content": reasoning_buffer,
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
    temperature: float = 0.7,
) -> str:
    """Non-streaming OpenAI-compatible completion. Returns text (and tool_use JSON if applicable).
    
    Automatically selects the correct provider based on model name.
    """
    # Auto-detect provider from model name
    if model.startswith("glm-"):
        return await complete_bigmodel(messages, system, model, max_tokens, tools, temperature)
    
    api_key = get_kimi_api_key()
    if not api_key:
        raise ValueError("No Kimi API key configured. Visit Settings to add one.")

    openai_messages = _to_openai_messages(messages, system)
    openai_tools = _to_openai_tools(tools) if tools else None

    payload: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": openai_messages,
        "temperature": temperature,
    }
    if openai_tools:
        payload["tools"] = openai_tools

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    client = _get_http_client()
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
        if not text:
            text = message.get("reasoning_content") or ""
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

    parts = [identity_rules, base]
    if skill_prompt:
        parts.append(f"\n\n## Skill Context\n{skill_prompt}")
    if project_context:
        parts.append(f"\n\n## Project Context\n{project_context}")
    if rag_context:
        parts.append(f"\n\n## Relevant Knowledge Base Excerpts\n{rag_context}")
    return "\n".join(parts)


# =============================================================================
# BigModel (Zhipu AI) Streaming
# =============================================================================

async def _stream_bigmodel_with_retry(
    client: httpx.AsyncClient,
    headers: dict,
    payload: dict,
    max_retries: int = 3,
) -> AsyncIterator[str]:
    """Internal stream handler with retry logic for rate limiting."""
    last_error = None
    
    for attempt in range(max_retries):
        try:
            async with client.stream(
                "POST",
                f"{BIGMODEL_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        wait_time = (2 ** attempt) + random.uniform(0, 1)
                        logger.warning(f"[BigModel] Rate limited (429), retrying in {wait_time:.1f}s (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        body = await response.aread()
                        error_msg = body.decode()[:300]
                        raise Exception(
                            "BigModel 服务当前繁忙，请稍后重试。"
                            f"\n\n详细信息：API 限流 (HTTP 429)"
                        )
                
                if response.status_code != 200:
                    body = await response.aread()
                    error_msg = body.decode()[:300]
                    raise Exception(f"BigModel HTTP {response.status_code}: {error_msg}")
                
                async for line in response.aiter_lines():
                    yield line
                return
                
        except Exception as e:
            last_error = e
            if "BigModel 服务当前繁忙" in str(e):
                raise
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"[BigModel] Stream error, retrying in {wait_time:.1f}s: {e}")
                await asyncio.sleep(wait_time)
            else:
                raise
    
    if last_error:
        raise last_error


async def stream_response_bigmodel(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_BIGMODEL_MODEL,
    max_tokens: int = 4096,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """Stream BigModel response, yielding same token/tool-use format as claude.py."""
    api_key = get_bigmodel_api_key()
    if not api_key:
        raise ValueError("No BigModel API key configured. Visit Settings to add one.")

    openai_messages = _to_openai_messages(messages, system)
    openai_tools = _to_openai_tools(tools) if tools else None

    payload: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": openai_messages,
        "stream": True,
        "temperature": temperature,
    }
    if openai_tools:
        payload["tools"] = openai_tools

    logger.info(f"[BigModel] STREAM model={model} msgs={len(openai_messages)} tools={len(openai_tools) if openai_tools else 0}")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    tool_call_buffers: dict[int, dict] = {}
    in_tool_call = False

    client = _get_http_client()
    finish_reason = None
    
    try:
        async for line in _stream_bigmodel_with_retry(client, headers, payload):
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

            text = delta.get("content")
            if text:
                yield text

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
                    frag = tc_delta.get("function", {}).get("arguments", "")
                    tool_call_buffers[idx]["arguments"] += frag

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
            logger.warning("[BigModel] Output truncated due to max_tokens")
            yield "\n\n[OUTPUT_TRUNCATED]"

    except Exception as e:
        logger.error(f"[BigModel] stream error: {type(e).__name__}: {e}")
        raise


# =============================================================================
# BigModel (Zhipu AI) Non-streaming
# =============================================================================

async def complete_bigmodel(
    messages: list[dict],
    system: str = "",
    model: str = DEFAULT_BIGMODEL_MODEL,
    max_tokens: int = 4096,
    tools: list[dict] | None = None,
    temperature: float = 0.7,
) -> str:
    """Non-streaming BigModel completion. Returns text (and tool_use JSON if applicable)."""
    api_key = get_bigmodel_api_key()
    if not api_key:
        raise ValueError("No BigModel API key configured. Visit Settings to add one.")

    openai_messages = _to_openai_messages(messages, system)
    openai_tools = _to_openai_tools(tools) if tools else None

    payload: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": openai_messages,
        "temperature": temperature,
    }
    if openai_tools:
        payload["tools"] = openai_tools

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    client = _get_http_client()
    try:
        response = await client.post(
            f"{BIGMODEL_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        if response.status_code != 200:
            raise Exception(f"BigModel HTTP {response.status_code}: {response.text[:300]}")

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
        logger.error(f"[BigModel] complete error: {type(e).__name__}: {e}")
        raise
