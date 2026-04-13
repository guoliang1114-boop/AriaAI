"""Chat router — SSE streaming, conversation history, RAG injection."""
from __future__ import annotations

from datetime import datetime

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.database import get_session
from app.models.db import Conversation, Message
from app.routers.chat_conversations import router as conversations_router
from app.routers.chat_export import router as export_router
from app.routers.chat_schemas import SendMessageRequest, TestConnectionRequest, TestModelRequest
from app.services.context_builder import build_chat_context
from app.services.provider_selector import (
    get_selected_model,
    resolve_provider_from_model, _load_provider_module
)
from app.services.chat_store import (
    build_message_metadata,
    get_full_message_history,
    get_or_create_conversation,
    persist_user_message,
)
from app.services.settings_helper import get_int_setting, get_float_setting
from app.services.title_generator import schedule_title_generation
from app.config import (
    DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE
)
from app.tools import registry

router = APIRouter(prefix="/chat", tags=["chat"])
router.include_router(conversations_router)
router.include_router(export_router)


@router.post("/send")
async def send_message(req: SendMessageRequest, session: Session = Depends(get_session)):
    """Stream Claude response via SSE. Creates conversation if needed."""

    conv = get_or_create_conversation(
        session,
        req.conversation_id,
        project_id=req.project_id,
        skill_id=req.skill_id,
    )

    metadata = build_message_metadata(
        project_id=req.project_id,
        skill_id=req.skill_id,
        rag_doc_ids=req.rag_doc_ids,
        file_ids=req.file_ids,
    )
    persist_user_message(session, conv.id, req.content, metadata)

    # Build chat context using context_builder
    max_tokens = get_int_setting(session, "max_tokens", DEFAULT_MAX_TOKENS) or DEFAULT_MAX_TOKENS
    temperature = get_float_setting(session, "temperature", DEFAULT_TEMPERATURE) or DEFAULT_TEMPERATURE
    
    chat_ctx = build_chat_context(
        session=session,
        skill_id=req.skill_id,
        project_id=req.project_id,
        rag_doc_ids=req.rag_doc_ids if req.rag_doc_ids else None,
        file_ids=req.file_ids if req.file_ids else None,
        content=req.content,
        default_max_tokens=max_tokens,
    )
    
    skill_prompt = chat_ctx.skill_prompt
    project_context = chat_ctx.project_context
    rag_context = chat_ctx.rag_context
    rag_sources = chat_ctx.rag_sources
    tools = chat_ctx.tools
    max_tokens = chat_ctx.max_tokens

    # Use model-based provider resolution instead of llm_provider setting
    # This ensures correct provider is used even if settings are inconsistent
    selected_model = get_selected_model(session)
    provider = resolve_provider_from_model(selected_model)
    llm = _load_provider_module(provider)
    system = llm.build_system_prompt(skill_prompt, rag_context, project_context)

    # Build message history — skip empty assistant messages (from prior failures)
    history = get_full_message_history(session, conv.id)
    api_messages = [
        {"role": m.role, "content": m.content}
        for m in history
        if m.content.strip()
    ]

    async def event_stream():
        conv_id = conv.id
        yield f"data: {json.dumps({'type': 'conversation_id', 'id': conv_id})}\n\n"
        
        # Send RAG sources if available (for citation display)
        if rag_sources:
            yield f"data: {json.dumps({'type': 'references', 'references': rag_sources})}\n\n"

        try:
            # ── Phase 1: stream first Claude turn ────────────────────────────
            # claude.stream_response yields either:
            #   • plain text chunks  (stream to user immediately)
            #   • complete tool_use JSON strings  (intercept, do NOT stream)
            text_buffer = ""          # user-visible text from this turn
            tool_use_blocks = []      # collected tool_use dicts
            reasoning_content = ""   # kimi-k2.5 reasoning (needed for multi-turn tool calls)

            print(f"[P1] starting stream, tools={[t.get('name') for t in (tools or [])]}", flush=True)

            async for chunk in llm.stream_response(
                api_messages, system=system, model=selected_model, tools=tools, max_tokens=max_tokens, temperature=temperature
            ):
                stripped = chunk.strip()
                # 检查是否是提前通知前端工具正在生成的 marker
                if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
                    tool_name = stripped[12:-1]
                    progress_msg = f"Generating 15 slides... (this may take 1-2 minutes)"
                    yield f"data: {json.dumps({'type': 'tool_executing', 'tool_name': tool_name, 'message': progress_msg})}\n\n"
                    continue

                # Detect complete tool_use JSON emitted by claude.py / openai_compat.py
                if (
                    stripped.startswith("{")
                    and stripped.endswith("}")
                    and '"type"' in stripped
                ):
                    try:
                        block = json.loads(stripped)
                        if block.get("type") == "tool_use":
                            print(f"[P1] tool_use detected: {block.get('name')}, id={block.get('id')}, input_keys={list(block.get('input', {}).keys())}", flush=True)
                            tool_use_blocks.append(block)
                            continue  # do NOT yield to frontend
                        if block.get("type") == "reasoning_content":
                            reasoning_content = block.get("content", "")
                            continue  # internal only, not sent to frontend
                    except json.JSONDecodeError:
                        pass  # not valid JSON, treat as text

                # Regular text chunk
                text_buffer += chunk
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"

            print(f"[P1] done. text_len={len(text_buffer)}, tool_use_count={len(tool_use_blocks)}", flush=True)

            # ── Phase 2: execute tools if any ────────────────────────────────
            executed_results = []   # raw registry.execute() outputs
            tool_result_blocks = [] # Anthropic-format tool_result blocks

            for tool_data in tool_use_blocks:
                tool_name  = tool_data.get("name", "")
                tool_input = tool_data.get("input", {})
                tool_id    = tool_data.get("id", "")

                if not tool_name or not isinstance(tool_input, dict):
                    continue

                # Progress notification to frontend
                if tool_name in ("generate_ppt", "generate_ppt_from_skill"):
                    slides     = tool_input.get("slides", [])
                    slide_count = len(slides)
                    title      = tool_input.get("title", "Untitled")
                    progress   = {
                        "message": f"Generating \"{title}\" ({slide_count} slides)…",
                        "total": slide_count, "current": 0,
                    }
                elif tool_name == "generate_docx":
                    progress = {"message": f"Generating document \"{tool_input.get('title', 'Untitled')}\"…"}
                elif tool_name == "generate_xlsx":
                    progress = {"message": f"Generating spreadsheet ({len(tool_input.get('sheets', []))} sheets)…"}
                elif tool_name == "generate_pdf":
                    progress = {"message": f"Generating PDF \"{tool_input.get('title', 'Untitled')}\"…"}
                else:
                    progress = {"message": f"Executing {tool_name}…"}

                yield f"data: {json.dumps({'type': 'tool_executing', 'tool_name': tool_name, **progress})}\n\n"

                print(f"[P2] executing tool: {tool_name}, input_keys={list(tool_input.keys())}", flush=True)
                try:
                    result = await registry.execute(tool_name, tool_input)
                except Exception as exc:
                    result = {"type": "tool_result", "tool_name": tool_name,
                              "status": "error", "error": str(exc)}

                print(f"[P2] tool result: status={result.get('status')}, keys={list(result.keys())}", flush=True)
                executed_results.append(result)
                yield f"data: {json.dumps({'type': 'tool_result', 'result': result})}\n\n"

                # Build Anthropic-format tool_result block
                output = result.get("output", result)
                tool_result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(output, ensure_ascii=False),
                })

            print(f"[P2] done. tool_result_blocks={len(tool_result_blocks)}", flush=True)

            # ── Phase 3: optional follow-up turn after tool execution ─────────
            follow_up_text = ""
            if tool_use_blocks and tool_result_blocks:
                # Build proper Anthropic multi-turn messages
                # Assistant turn: text (if any) + tool_use blocks
                assistant_content: list = []
                if text_buffer.strip():
                    assistant_content.append({"type": "text", "text": text_buffer.strip()})
                for tb in tool_use_blocks:
                    assistant_content.append({
                        "type": "tool_use",
                        "id":    tb["id"],
                        "name":  tb["name"],
                        "input": tb.get("input", {}),
                    })

                continuation_messages = api_messages + [
                    {"role": "assistant", "content": assistant_content,
                     **({"reasoning_content": reasoning_content} if reasoning_content else {})},
                    {"role": "user",      "content": tool_result_blocks},
                ]

                print(f"[P3] starting follow-up. continuation_messages={len(continuation_messages)}", flush=True)
                # Stream follow-up response (no tools needed)
                async for chunk in llm.stream_response(
                    continuation_messages, system=system, model=selected_model,
                    tools=None, max_tokens=max_tokens, temperature=temperature
                ):
                    follow_up_text += chunk
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"

                print(f"[P3] done. follow_up_text_len={len(follow_up_text)}", flush=True)

            # ── Phase 4: persist ─────────────────────────────────────────────
            # Save user-visible text only (no tool_use JSON blobs)
            full_text = text_buffer.strip()
            if follow_up_text.strip():
                full_text = (full_text + "\n\n" + follow_up_text.strip()).strip()

            print(f"[P4] persisting. full_text_len={len(full_text)}", flush=True)
            need_title = False
            if full_text:
                with Session(session.get_bind()) as new_session:
                    asst_msg = Message(
                        conversation_id=conv_id,
                        role="assistant",
                        content=full_text,
                    )
                    new_session.add(asst_msg)
                    c = new_session.get(Conversation, conv_id)
                    if c:
                        c.updated_at = datetime.utcnow()
                        if c.title == "New Workstream":
                            # Placeholder — real title generated in background
                            c.title = req.content[:40] + ("…" if len(req.content) > 40 else "")
                            need_title = True
                        new_session.add(c)
                    new_session.commit()

        except Exception as e:
            import traceback
            print(f"[event_stream error] {e}\n{traceback.format_exc()}", flush=True)
            
            # Provide user-friendly error messages
            error_msg = str(e)
            user_friendly_msg = error_msg
            
            # Check for specific error patterns
            if "429" in error_msg or "engine_overloaded" in error_msg:
                user_friendly_msg = "AI 服务当前繁忙，请稍后重试。这是临时状况，几秒钟后再试即可。"
            elif "Kimi 服务当前繁忙" in error_msg or "BigModel 服务当前繁忙" in error_msg:
                user_friendly_msg = error_msg  # Already user-friendly
            elif "No Kimi API key" in error_msg or "No Claude API key" in error_msg or "No BigModel API key" in error_msg:
                user_friendly_msg = "请先配置 API Key。前往「设置」页面添加您的 API Key。"
            elif "timeout" in error_msg.lower() or "Connection refused" in error_msg:
                user_friendly_msg = "连接超时，请检查网络或稍后重试。"
            elif "rate limit" in error_msg.lower():
                user_friendly_msg = "请求频率过高，请稍等片刻后重试。"
            
            yield f"data: {json.dumps({'type': 'error', 'message': user_friendly_msg})}\n\n"
            return

        # Send done immediately — don't wait for title generation
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

        # Generate title in background (after done is already sent to client)
        if need_title and full_text:
            schedule_title_generation(
                conv_id=conv_id,
                user_content=req.content,
                bind=session.get_bind(),
                complete_fn=llm.complete,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ---------------------------------------------------------------------------
# Test Connection Endpoints
# ---------------------------------------------------------------------------


@router.post("/test-connection")
async def test_connection(req: TestConnectionRequest):
    """Test API key connectivity for a provider."""
    from app.core.security import get_api_key, get_kimi_api_key, get_bigmodel_api_key
    
    provider = req.provider
    
    # Support anthropic, moonshot, and bigmodel
    if provider not in ["anthropic", "moonshot", "bigmodel"]:
        return {"success": False, "message": f"Provider not supported: {provider}"}
    
    try:
        if provider == "anthropic":
            api_key = get_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            # Test with a simple request
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": req.model or "claude-3-5-haiku-20241022",
                        "max_tokens": 10,
                        "messages": [{"role": "user", "content": "Hi"}],
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "Connection successful"}
                else:
                    return {"success": False, "message": f"API error: {resp.status_code}"}
                    
        elif provider == "moonshot":
            api_key = get_kimi_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.moonshot.cn/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": req.model or "kimi-k2-0711-preview",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "Connection successful"}
                else:
                    return {"success": False, "message": f"API error: {resp.status_code}"}
                    
        elif provider == "bigmodel":
            api_key = get_bigmodel_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": req.model or "glm-4-plus",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "Connection successful"}
                else:
                    return {"success": False, "message": f"API error: {resp.status_code}"}
        else:
            return {"success": False, "message": f"Unknown provider: {provider}"}
            
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@router.post("/test-model")
async def test_model(req: TestModelRequest):
    """Test a model with a simple message."""
    try:
        # Determine provider from model
        provider = "anthropic"
        if req.model.startswith("moonshot-") or req.model.startswith("kimi-"):
            provider = "moonshot"
        elif req.model.startswith("claude-"):
            provider = "anthropic"
        elif req.model.startswith("glm-") or req.model.startswith("GLM-"):
            provider = "bigmodel"
        else:
            return {"success": False, "message": f"Model not supported: {req.model}"}
        
        # Support anthropic, moonshot, and bigmodel
        if provider not in ["anthropic", "moonshot", "bigmodel"]:
            return {"success": False, "message": f"Provider not supported: {provider}"}
        
        # Get the appropriate LLM client
        if provider == "anthropic":
            from app.services import claude as llm
        elif provider == "moonshot":
            from app.services import openai_compat as llm
        elif provider == "bigmodel":
            from app.services import openai_compat as llm
        else:
            return {"success": False, "message": f"Unsupported provider: {provider}"}
        
        # Moonshot models have fixed parameters - let the service handle it
        # The openai_compat.complete() will override temperature for Moonshot models
        messages = [{"role": "user", "content": req.message}]
        response = await llm.complete(
            messages=messages,
            model=req.model,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
        
        return {
            "success": True,
            "message": "Model test successful",
            "response": response[:200] + "..." if len(response) > 200 else response,
        }
    except Exception as e:
        return {"success": False, "message": f"Model test failed: {str(e)}"}



