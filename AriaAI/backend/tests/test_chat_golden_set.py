from __future__ import annotations

import asyncio
from pathlib import Path

import yaml

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.mode_registry import ActionPolicy, ChatMode
from app.services.intent_router import classify_chat_intent, classify_chat_intent_async
from app.services.policy_guards import filter_tools_for_policy, policy_allows_tool
from app.services.tool_descriptions import load_tool_spec, tool_description


def _load_cases() -> list[dict]:
    path = Path(__file__).parent / "golden_chat_set" / "router_cases.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))["cases"]


def test_router_golden_set_cases_are_stable():
    for case in _load_cases():
        req = SendMessageRequest(
            content=case["content"],
            project_id=case.get("project_id"),
            skill_id=case.get("skill_id"),
            force_skill=case.get("force_skill", False),
        )
        decision = classify_chat_intent(req, effective_skill_id=case.get("skill_id") if case.get("force_skill") else None)
        assert decision.chat_mode.value == case["expected_chat_mode"], case["id"]
        assert decision.action_policy.value == case["expected_action_policy"], case["id"]
        assert decision.trace["final_chat_mode"] == case["expected_chat_mode"], case["id"]
        assert decision.trace["final_action_policy"] == case["expected_action_policy"], case["id"]


def test_router_golden_set_tool_permissions_are_stable():
    for case in _load_cases():
        req = SendMessageRequest(
            content=case["content"],
            project_id=case.get("project_id"),
            skill_id=case.get("skill_id"),
            force_skill=case.get("force_skill", False),
        )
        decision = classify_chat_intent(req, effective_skill_id=case.get("skill_id") if case.get("force_skill") else None)
        for tool_check in case.get("forbid_tools") or []:
            tool_name = tool_check["name"] if isinstance(tool_check, dict) else tool_check
            tool_input = tool_check.get("input", {"mode": "create", "content": "# Test"}) if isinstance(tool_check, dict) else {"mode": "create", "content": "# Test"}
            allowed, _, _ = policy_allows_tool(
                decision.action_policy,
                tool_name,
                tool_input,
            )
            assert not allowed, f"{case['id']} unexpectedly allowed {tool_name}"
        for tool_check in case.get("allow_tools") or []:
            tool_name = tool_check["name"] if isinstance(tool_check, dict) else tool_check
            tool_input = tool_check.get("input", {"mode": "create", "content": "# Test"}) if isinstance(tool_check, dict) else {"mode": "create", "content": "# Test"}
            allowed, _, _ = policy_allows_tool(
                decision.action_policy,
                tool_name,
                tool_input,
            )
            assert allowed, f"{case['id']} unexpectedly blocked {tool_name}"


def test_llm_router_can_clarify_ambiguous_portfolio_mode():
    async def fake_llm(*args, **kwargs):
        return '{"chat_mode":"cross_project_portfolio","action_policy":"read_only_tool","confidence":0.74,"reason":"same client portfolio follow-up"}'

    req = SendMessageRequest(
        content="继续看这个客户横跨几个项目的风险，帮我汇总下一步。",
        project_id=26,
    )
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert decision.chat_mode == ChatMode.CROSS_PROJECT_PORTFOLIO
    assert decision.action_policy == ActionPolicy.READ_ONLY_TOOL
    assert decision.method == "llm_router"
    assert decision.trace["rule_baseline"]["chat_mode"] == "project_deep_dive"
    assert decision.trace["llm_payload"]["chat_mode"] == "cross_project_portfolio"


def test_llm_router_cannot_upgrade_read_only_to_write_without_user_intent():
    async def fake_llm(*args, **kwargs):
        return '{"chat_mode":"project_deep_dive","action_policy":"write_artifact","confidence":0.91,"reason":"model guessed artifact"}'

    req = SendMessageRequest(
        content="请基于当前项目的结构化记忆，识别最重要的项目风险和阻塞点，并给出建议的缓解动作。",
        project_id=26,
    )
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert decision.action_policy == ActionPolicy.READ_ONLY_TOOL
    assert decision.trace["final_action_policy"] == "read_only_tool"
    assert decision.trace["llm_payload"]["action_policy"] == "write_artifact"


def test_unified_router_short_circuits_explicit_office_generation():
    called = False

    async def fake_llm(*args, **kwargs):
        nonlocal called
        called = True
        return "{}"

    req = SendMessageRequest(content="给我准备一个客户介绍 PPT，保存到项目空间。", project_id=27)
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert decision.chat_mode == ChatMode.TASK_ORCHESTRATION
    assert decision.action_policy == ActionPolicy.DURABLE_TASK
    assert decision.task_route is not None
    assert decision.task_route.task_type == "generate_client_ppt"
    assert called is False


def test_tool_specs_are_loaded_from_yaml_and_drive_policy():
    spec = load_tool_spec("update_project_markdown_document")
    assert spec["required_policy"]["append"] == "modify_existing_file"
    assert "analysis-only" in tool_description("update_project_markdown_document", "")

    allowed, _, required = policy_allows_tool(
        ActionPolicy.WRITE_ARTIFACT,
        "update_project_markdown_document",
        {"mode": "append", "content": "追加内容"},
    )
    assert required == ActionPolicy.MODIFY_EXISTING_FILE
    assert allowed is False

    allowed, _, required = policy_allows_tool(
        ActionPolicy.READ_ONLY_TOOL,
        "read_project_markdown_document",
        {"action": "list"},
    )
    assert required == ActionPolicy.READ_ONLY_TOOL
    assert allowed is True


def test_filter_tools_for_policy_uses_tool_default_policy_for_all_policies():
    tools = [
        {"name": "read_project_markdown_document"},
        {"name": "update_project_markdown_document"},
        {"name": "manage_project_folders"},
    ]

    filtered = filter_tools_for_policy(tools, ActionPolicy.WRITE_ARTIFACT)

    assert [tool["name"] for tool in filtered or []] == ["read_project_markdown_document", "update_project_markdown_document"]
