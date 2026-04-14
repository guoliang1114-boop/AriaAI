from __future__ import annotations

import json
from dataclasses import dataclass

from sqlmodel import Session

from app.config import DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_store import (
    build_message_metadata,
    get_full_message_history,
    get_or_create_conversation,
    persist_assistant_message,
    persist_user_message,
)
from app.services.context_builder import build_chat_context
from app.services.provider_selector import (
    _load_provider_module,
    get_selected_model,
    resolve_provider_from_model,
)
from app.services.settings_helper import get_float_setting, get_int_setting
from app.services.title_generator import schedule_title_generation
from app.tools import registry


@dataclass
class ChatRuntime:
    conv_id: int
    selected_model: str
    llm: object
    system: str
    api_messages: list[dict]
    rag_sources: list
    tools: list | None
    max_tokens: int
    temperature: float


def prepare_chat_runtime(session: Session, req: SendMessageRequest) -> ChatRuntime:
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

    max_tokens = get_int_setting(session, "max_tokens", DEFAULT_MAX_TOKENS) or DEFAULT_MAX_TOKENS
    temperature = get_float_setting(session, "temperature", DEFAULT_TEMPERATURE) or DEFAULT_TEMPERATURE

    chat_ctx = build_chat_context(
        session=session,
        skill_id=req.skill_id,
        project_id=req.project_id,
        knowledge_scope=req.knowledge_scope,
        rag_doc_ids=req.rag_doc_ids if req.rag_doc_ids else None,
        file_ids=req.file_ids if req.file_ids else None,
        content=req.content,
        default_max_tokens=max_tokens,
    )

    selected_model = get_selected_model(session)
    provider = resolve_provider_from_model(selected_model)
    llm = _load_provider_module(provider)
    system = llm.build_system_prompt(
        chat_ctx.skill_prompt,
        chat_ctx.rag_context,
        chat_ctx.project_context,
    )

    history = get_full_message_history(session, conv.id)
    api_messages = [
        {"role": msg.role, "content": msg.content}
        for msg in history
        if msg.content.strip()
    ]

    return ChatRuntime(
        conv_id=conv.id,
        selected_model=selected_model,
        llm=llm,
        system=system,
        api_messages=api_messages,
        rag_sources=chat_ctx.rag_sources,
        tools=chat_ctx.tools,
        max_tokens=chat_ctx.max_tokens,
        temperature=temperature,
    )


def _tool_progress_payload(tool_name: str, tool_input: dict) -> dict:
    if tool_name in ("generate_ppt", "generate_ppt_from_skill"):
        slides = tool_input.get("slides", [])
        title = tool_input.get("title", "Untitled")
        return {
            "message": f"Generating \"{title}\" ({len(slides)} slides)…",
            "total": len(slides),
            "current": 0,
        }
    if tool_name == "generate_docx":
        return {"message": f"Generating document \"{tool_input.get('title', 'Untitled')}\"…"}
    if tool_name == "generate_xlsx":
        return {"message": f"Generating spreadsheet ({len(tool_input.get('sheets', []))} sheets)…"}
    if tool_name == "generate_pdf":
        return {"message": f"Generating PDF \"{tool_input.get('title', 'Untitled')}\"…"}
    return {"message": f"Executing {tool_name}…"}


def _to_user_friendly_error(error_msg: str) -> str:
    if "429" in error_msg or "engine_overloaded" in error_msg:
        return "AI 服务当前繁忙，请稍后重试。这是临时状况，几秒钟后再试即可。"
    if "Kimi 服务当前繁忙" in error_msg or "BigModel 服务当前繁忙" in error_msg:
        return error_msg
    if "No Kimi API key" in error_msg or "No Claude API key" in error_msg or "No BigModel API key" in error_msg:
        return "请先配置 API Key。前往「设置」页面添加您的 API Key。"
    if "timeout" in error_msg.lower() or "Connection refused" in error_msg:
        return "连接超时，请检查网络或稍后重试。"
    if "rate limit" in error_msg.lower():
        return "请求频率过高，请稍等片刻后重试。"
    return error_msg


async def stream_chat_events(runtime: ChatRuntime, req: SendMessageRequest, bind):
    yield f"data: {json.dumps({'type': 'conversation_id', 'id': runtime.conv_id})}\n\n"
    if runtime.rag_sources:
        yield f"data: {json.dumps({'type': 'references', 'references': runtime.rag_sources})}\n\n"

    full_text = ""
    need_title = False

    try:
        text_buffer = ""
        tool_use_blocks = []
        reasoning_content = ""

        print(f"[P1] starting stream, tools={[t.get('name') for t in (runtime.tools or [])]}", flush=True)
        async for chunk in runtime.llm.stream_response(
            runtime.api_messages,
            system=runtime.system,
            model=runtime.selected_model,
            tools=runtime.tools,
            max_tokens=runtime.max_tokens,
            temperature=runtime.temperature,
        ):
            stripped = chunk.strip()
            if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
                tool_name = stripped[12:-1]
                yield f"data: {json.dumps({'type': 'tool_executing', 'tool_name': tool_name, 'message': 'Generating 15 slides... (this may take 1-2 minutes)'})}\n\n"
                continue

            if stripped.startswith("{") and stripped.endswith("}") and '"type"' in stripped:
                try:
                    block = json.loads(stripped)
                    if block.get("type") == "tool_use":
                        print(
                            f"[P1] tool_use detected: {block.get('name')}, id={block.get('id')}, input_keys={list(block.get('input', {}).keys())}",
                            flush=True,
                        )
                        tool_use_blocks.append(block)
                        continue
                    if block.get("type") == "reasoning_content":
                        reasoning_content = block.get("content", "")
                        continue
                except json.JSONDecodeError:
                    pass

            text_buffer += chunk
            yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"

        print(f"[P1] done. text_len={len(text_buffer)}, tool_use_count={len(tool_use_blocks)}", flush=True)

        tool_result_blocks = []
        for tool_data in tool_use_blocks:
            tool_name = tool_data.get("name", "")
            tool_input = tool_data.get("input", {})
            tool_id = tool_data.get("id", "")

            if not tool_name or not isinstance(tool_input, dict):
                continue

            yield f"data: {json.dumps({'type': 'tool_executing', 'tool_name': tool_name, **_tool_progress_payload(tool_name, tool_input)})}\n\n"

            print(f"[P2] executing tool: {tool_name}, input_keys={list(tool_input.keys())}", flush=True)
            try:
                result = await registry.execute(tool_name, tool_input)
            except Exception as exc:
                result = {"type": "tool_result", "tool_name": tool_name, "status": "error", "error": str(exc)}

            print(f"[P2] tool result: status={result.get('status')}, keys={list(result.keys())}", flush=True)
            yield f"data: {json.dumps({'type': 'tool_result', 'result': result})}\n\n"

            output = result.get("output", result)
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(output, ensure_ascii=False),
                }
            )

        print(f"[P2] done. tool_result_blocks={len(tool_result_blocks)}", flush=True)

        follow_up_text = ""
        if tool_use_blocks and tool_result_blocks:
            assistant_content: list = []
            if text_buffer.strip():
                assistant_content.append({"type": "text", "text": text_buffer.strip()})
            for tool_block in tool_use_blocks:
                assistant_content.append(
                    {
                        "type": "tool_use",
                        "id": tool_block["id"],
                        "name": tool_block["name"],
                        "input": tool_block.get("input", {}),
                    }
                )

            continuation_messages = runtime.api_messages + [
                {
                    "role": "assistant",
                    "content": assistant_content,
                    **({"reasoning_content": reasoning_content} if reasoning_content else {}),
                },
                {"role": "user", "content": tool_result_blocks},
            ]

            print(f"[P3] starting follow-up. continuation_messages={len(continuation_messages)}", flush=True)
            async for chunk in runtime.llm.stream_response(
                continuation_messages,
                system=runtime.system,
                model=runtime.selected_model,
                tools=None,
                max_tokens=runtime.max_tokens,
                temperature=runtime.temperature,
            ):
                follow_up_text += chunk
                yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
            print(f"[P3] done. follow_up_text_len={len(follow_up_text)}", flush=True)

        full_text = text_buffer.strip()
        if follow_up_text.strip():
            full_text = (full_text + "\n\n" + follow_up_text.strip()).strip()

        print(f"[P4] persisting. full_text_len={len(full_text)}", flush=True)
        if full_text:
            need_title = persist_assistant_message(bind, runtime.conv_id, full_text, req.content)

    except Exception as exc:
        import traceback

        print(f"[event_stream error] {exc}\n{traceback.format_exc()}", flush=True)
        yield f"data: {json.dumps({'type': 'error', 'message': _to_user_friendly_error(str(exc))})}\n\n"
        return

    yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    if need_title and full_text:
        schedule_title_generation(
            conv_id=runtime.conv_id,
            user_content=req.content,
            bind=bind,
            complete_fn=runtime.llm.complete,
        )
