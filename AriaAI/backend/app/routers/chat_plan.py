"""Plan Mode router — AI generates an execution plan before running tools."""
from __future__ import annotations

import json
import re
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from app.database import get_session
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_streaming import prepare_chat_runtime

router = APIRouter()


class PlannedTool(BaseModel):
    name: str
    description: str
    input_summary: str


class ChatPlanResponse(BaseModel):
    plan_text: str
    planned_tools: list[PlannedTool]


_PLAN_SYSTEM_SUFFIX = (
    "\n\n【计划模式】当前处于计划模式。请分析用户需求并制定详细的执行计划，"
    "列出将要采取的步骤。如果会调用工具，请说明工具名称和用途。"
    "不要实际执行任何工具调用，只返回计划文本。用中文回复。"
)


def _extract_tool_uses_from_text(text: str) -> list[dict]:
    """Extract tool_use JSON blocks from plan text."""
    blocks = []
    idx = text.find('{"type"')
    while idx != -1:
        depth = 0
        for i, ch in enumerate(text[idx:], start=idx):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        block = json.loads(text[idx:i + 1])
                        if block.get("type") == "tool_use":
                            blocks.append(block)
                    except json.JSONDecodeError:
                        break
        idx = text.find('{"type"', idx + 1)
    return blocks


def _summarize_tool_input(tool_name: str, tool_input: dict) -> str:
    """Create a human-readable summary of tool input."""
    if tool_name in ("update_project_markdown_document", "read_project_markdown_document"):
        file_name = tool_input.get("file_name") or tool_input.get("file_id") or "unknown"
        mode = tool_input.get("mode", "")
        return f"文件: {file_name}, 模式: {mode}"
    if tool_name in ("write_project_office_document",):
        return f"类型: {tool_input.get('document_type', 'unknown')}, 标题: {tool_input.get('title', 'unknown')}"
    if tool_name in ("generate_ppt", "generate_ppt_from_skill"):
        return f"标题: {tool_input.get('title', 'unknown')}, 页数: {len(tool_input.get('slides', []))}"
    return ", ".join(f"{k}={v}" for k, v in list(tool_input.items())[:3])


@router.post("/plan", response_model=ChatPlanResponse)
async def generate_chat_plan(req: SendMessageRequest, session: Session = Depends(get_session)):
    """Generate an execution plan for the user's request without executing tools.

    Returns a plan text and a list of tools that would be called.
    """
    runtime = prepare_chat_runtime(session, req)

    # Build plan request messages
    plan_system = runtime.system + _PLAN_SYSTEM_SUFFIX
    plan_messages = runtime.api_messages + [
        {
            "role": "user",
            "content": (
                "请为以上请求制定执行计划。计划应包括：\n"
                "1. 需求分析\n"
                "2. 执行步骤（按顺序）\n"
                "3. 需要调用的工具（如有）\n"
                "4. 预期输出\n\n"
                "不要实际执行任何操作，只返回计划文本。"
            ),
        },
    ]

    # Call LLM without tools to get the plan description
    plan_text = await runtime.llm.complete(
        plan_messages,
        system=plan_system,
        model=runtime.selected_model,
        max_tokens=min(runtime.max_tokens, 8000),
        temperature=runtime.temperature,
    )

    # Also call with tools to see what tools the model would use
    planned_tools: list[PlannedTool] = []
    if runtime.tools:
        try:
            tool_response = await runtime.llm.complete(
                runtime.api_messages,
                system=runtime.system,  # No plan suffix — let model act naturally
                model=runtime.selected_model,
                max_tokens=min(runtime.max_tokens, 4000),
                tools=runtime.tools,
                temperature=runtime.temperature,
            )
            tool_blocks = _extract_tool_uses_from_text(tool_response)
            seen = set()
            for block in tool_blocks:
                name = block.get("name", "")
                if not name or name in seen:
                    continue
                seen.add(name)
                tool_input = block.get("input", {})
                planned_tools.append(
                    PlannedTool(
                        name=name,
                        description=block.get("description") or name,
                        input_summary=_summarize_tool_input(name, tool_input),
                    )
                )
        except Exception as exc:
            # Tool prediction is best-effort
            print(f"[plan mode] tool prediction failed: {exc}", flush=True)

    return ChatPlanResponse(plan_text=plan_text.strip(), planned_tools=planned_tools)
