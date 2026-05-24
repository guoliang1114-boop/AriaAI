"""Plan Mode router — AI generates an execution plan before running tools."""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from app.database import get_session
from app.models.db import User
from app.routers.auth import get_current_user
from app.routers.chat_security import require_chat_request_access
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_streaming import prepare_chat_runtime_async

router = APIRouter()


class PlannedTool(BaseModel):
    name: str
    description: str
    input_summary: str


class ChatPlanResponse(BaseModel):
    plan_text: str
    planned_tools: list[PlannedTool]


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


def _format_tools_for_plan_prompt(tools: list[dict] | None) -> str:
    """Format available tools as a markdown list for the plan prompt."""
    if not tools:
        return "无可用工具。"
    lines = ["可用工具列表："]
    for t in tools:
        name = t.get("name", "unknown")
        desc = t.get("description", "")
        lines.append(f'- `{name}`: {desc}')
    return "\n".join(lines)


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


@router.post("/plan", response_model=ChatPlanResponse)
async def generate_chat_plan(
    req: SendMessageRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Generate an execution plan for the user's request without executing tools.

    Uses a single LLM call with tool definitions embedded in the prompt.
    The model describes the plan in natural language and may include tool_use
    JSON blocks indicating which tools it would call.
    """
    conversation = require_chat_request_access(
        session,
        conversation_id=req.conversation_id,
        project_id=req.project_id,
        current_user=current_user,
    )
    if conversation and req.project_id is None and conversation.project_id is not None:
        req.project_id = conversation.project_id
    runtime = await prepare_chat_runtime_async(
        session,
        req,
        owner_user_id=current_user.id,
        persist_user=False,
        create_conversation=False,
    )

    # Embed tool definitions in the system prompt so the model knows what's available
    # without being triggered to actually call them.
    tools_description = _format_tools_for_plan_prompt(runtime.tools)

    plan_system = (
        runtime.system
        + "\n\n【计划模式】当前处于计划模式。请分析用户需求并制定详细的执行计划。"
        + "\n\n"
        + tools_description
        + "\n\n要求：\n"
        "1. 先进行需求分析\n"
        "2. 列出执行步骤（按顺序）\n"
        "3. 如果会调用工具，请说明工具名称和用途\n"
        "4. 说明预期输出\n"
        "5. 不要实际执行任何工具调用，只返回计划文本\n"
        "6. 如果需要调用工具，可以在回复中嵌入 tool_use JSON 块来表明意图"
    )

    plan_messages = [
        *runtime.api_messages,
        {"role": "user", "content": req.content},
        {
            "role": "user",
            "content": (
                "请为以上请求制定执行计划。"
                "如果涉及工具调用，请描述你会使用哪些工具以及参数。"
                "不要实际执行任何操作。"
            ),
        },
    ]

    # Single LLM call — no tools parameter, tools are described in system prompt
    plan_text = await runtime.llm.complete(
        plan_messages,
        system=plan_system,
        model=runtime.selected_model,
        max_tokens=min(runtime.max_tokens, 8000),
        temperature=runtime.temperature,
    )

    # Parse any tool_use blocks that the model included in its plan
    planned_tools: list[PlannedTool] = []
    tool_blocks = _extract_tool_uses_from_text(plan_text)
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

    return ChatPlanResponse(plan_text=plan_text.strip(), planned_tools=planned_tools)
