import pytest

import json
from types import SimpleNamespace

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.agent_loop import _markdown_inline_delta, run_agent_loop
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import ToolOutcome


def test_exact_whole_document_is_not_streamed_or_persisted_twice():
    content = "# 交付报告\n\n预算为 100 万元。\n\n| 风险 | 状态 |\n| --- | --- |\n| 进度 | 待确认 |"
    assert _markdown_inline_delta(content, content + "\n") == ""


def test_long_exact_suffix_can_have_an_intro():
    content = "# 报告\n\n" + "保留所有原始证据，不做模糊去重。" * 12
    assert _markdown_inline_delta("报告如下：\n\n" + content, content) == ""


@pytest.mark.parametrize("prior,body", [
    ("预算为100万元", "预算为200万元"),
    ("第一份\n\n完成", "完成"),
    ("## 背景\n\n说明", "## 背景\n\n说明\n\n## 风险\n\n新内容"),
    ("A B", "AB"),
    ("报价 10 万。", "报价 10 万。\n需要审批。"),
])
def test_changed_or_partially_overlapping_content_is_preserved(prior, body):
    assert _markdown_inline_delta(prior, body) == body


@pytest.mark.asyncio
async def test_agent_loop_keeps_artifact_receipt_and_tool_result_while_showing_body_once(monkeypatch):
    body = "# 交付报告\n\n预算为 100 万元，需财务负责人确认。"
    requests = []
    executed = []
    call = {"type": "tool_use", "id": "markdown_1", "name": "save_text", "input": {"content": body}}

    async def stream(messages, **kwargs):
        requests.append(messages)
        if len(requests) == 1:
            yield body
            yield json.dumps(call)
        else:
            yield "交付物已就绪。"

    async def execute(_runtime, _state, tool_call, **kwargs):
        executed.append(tool_call["id"])
        return ToolOutcome(
            result_block={"type": "tool_result", "tool_use_id": "markdown_1", "content": '{"ok":true}'},
            events=['data: {"type":"artifact","artifact":{"file_id":7}}\n\n'],
            markdown_inline_text=body,
        )

    monkeypatch.setattr("app.services.chat.agent_loop.execute_tool_with_policy", execute)
    runtime = SimpleNamespace(
        llm=SimpleNamespace(stream_response=stream), system="system", selected_model="test-model",
        tools=None, max_tokens=256, temperature=0.0,
        api_messages=[{"role": "user", "content": "生成报告并保存"}], action_policy=ActionPolicy.WRITE_ARTIFACT,
    )
    state = ChatSessionState()
    events = [json.loads(event.removeprefix("data: ")) async for event in run_agent_loop(
        runtime, SendMessageRequest(content="生成报告并保存"), state,
    )]
    assert executed == ["markdown_1"]
    assert state.full_text.count(body) == 1
    assert "".join(event.get("content", "") for event in events if event["type"] == "text").count(body) == 1
    assert any(event.get("artifact", {}).get("file_id") == 7 for event in events)
    assert any(block.get("tool_use_id") == "markdown_1" for message in requests[-1]
               if isinstance(message.get("content"), list) for block in message["content"])
