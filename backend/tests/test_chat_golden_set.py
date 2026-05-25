from __future__ import annotations

import asyncio
from pathlib import Path

import yaml

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.intent_contract import build_chat_intent_contract
from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy
from app.services.intent_router import classify_chat_intent, classify_chat_intent_async
from app.services.policy_guards import filter_tools_for_access, filter_tools_for_policy, policy_allows_tool
from app.services.tool_descriptions import load_tool_spec, tool_description
from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME


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
        if case.get("expected_tool_access_policy"):
            assert decision.tool_access_policy.value == case["expected_tool_access_policy"], case["id"]
            assert decision.trace["final_tool_access_policy"] == case["expected_tool_access_policy"], case["id"]
        if case.get("expected_contract_action"):
            contract = build_chat_intent_contract(
                decision,
                req,
                skill_applied=bool(case.get("skill_id") and case.get("force_skill")),
            )
            assert contract.action == case["expected_contract_action"], case["id"]
            assert contract.write_allowed is bool(case.get("expected_write_allowed", False)), case["id"]
            if "expected_delivery_required" in case:
                assert contract.delivery_required is bool(case["expected_delivery_required"]), case["id"]


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
            visible = bool(filter_tools_for_access([{"name": tool_name}], decision.action_policy, decision.tool_access_policy))
            assert not (allowed and visible), f"{case['id']} unexpectedly exposed {tool_name}"
        for tool_check in case.get("allow_tools") or []:
            tool_name = tool_check["name"] if isinstance(tool_check, dict) else tool_check
            tool_input = tool_check.get("input", {"mode": "create", "content": "# Test"}) if isinstance(tool_check, dict) else {"mode": "create", "content": "# Test"}
            allowed, _, _ = policy_allows_tool(
                decision.action_policy,
                tool_name,
                tool_input,
            )
            visible = bool(filter_tools_for_access([{"name": tool_name}], decision.action_policy, decision.tool_access_policy))
            assert allowed and visible, f"{case['id']} unexpectedly blocked {tool_name}"


def test_llm_router_can_clarify_ambiguous_portfolio_mode():
    async def fake_llm(*args, **kwargs):
        return '{"chat_mode":"cross_project_portfolio","action_policy":"read_only_tool","confidence":0.74,"reason":"same client portfolio follow-up"}'

    req = SendMessageRequest(
        content="继续看这个客户横跨几个项目的风险，帮我汇总下一步。",
        project_id=26,
    )
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert decision.chat_mode == ChatMode.CROSS_PROJECT_PORTFOLIO
    assert decision.action_policy == ActionPolicy.DIRECT_ANSWER
    assert decision.tool_access_policy == ToolAccessPolicy.INJECTED_CONTEXT_ONLY
    assert decision.method == "llm_router"
    assert decision.trace["rule_baseline"]["chat_mode"] == "project_deep_dive"
    assert decision.trace["llm_payload"]["chat_mode"] == "cross_project_portfolio"


def test_llm_router_cannot_upgrade_direct_memory_analysis_to_write_without_user_intent():
    called = False

    async def fake_llm(*args, **kwargs):
        nonlocal called
        called = True
        return '{"chat_mode":"project_deep_dive","action_policy":"write_artifact","confidence":0.91,"reason":"model guessed artifact"}'

    req = SendMessageRequest(
        content="请基于当前项目的结构化记忆，识别最重要的项目风险和阻塞点，并给出建议的缓解动作。",
        project_id=26,
    )
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert called is False
    assert decision.action_policy == ActionPolicy.DIRECT_ANSWER
    assert decision.tool_access_policy == ToolAccessPolicy.INJECTED_CONTEXT_ONLY
    assert decision.trace["final_action_policy"] == "direct_answer"
    assert decision.trace["final_tool_access_policy"] == "injected_context_only"


def test_project_memory_milestone_analysis_stays_chat_not_artifact():
    req = SendMessageRequest(
        content="请基于当前项目的结构化记忆，分析当前里程碑推进情况，指出已经完成的进展、可能延迟的事项，以及接下来最需要推进的里程碑。",
        project_id=26,
    )

    decision = classify_chat_intent(req)

    assert decision.chat_mode == ChatMode.PROJECT_DEEP_DIVE
    assert decision.action_policy == ActionPolicy.DIRECT_ANSWER
    assert decision.tool_access_policy == ToolAccessPolicy.INJECTED_CONTEXT_ONLY
    assert decision.task_route is None
    assert decision.artifact_contract.delivery_required is False


def test_project_memory_milestone_analysis_blocks_llm_artifact_guess():
    called = False

    async def fake_llm(*args, **kwargs):
        nonlocal called
        called = True
        return (
            '{"chat_mode":"task_orchestration","action_policy":"durable_task","confidence":0.92,'
            '"reason":"model guessed milestone artifact",'
            '"artifact_contract":{"delivery_required":true,"output_kind":"md","title":"里程碑推进分析",'
            '"allowed_tools":["update_project_markdown_document"]}}'
        )

    req = SendMessageRequest(
        content="请基于当前项目的结构化记忆，分析当前里程碑推进情况，指出已经完成的进展、可能延迟的事项，以及接下来最需要推进的里程碑。",
        project_id=26,
    )

    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm, model="test"))

    assert called is False
    assert decision.chat_mode == ChatMode.PROJECT_DEEP_DIVE
    assert decision.action_policy == ActionPolicy.DIRECT_ANSWER
    assert decision.tool_access_policy == ToolAccessPolicy.INJECTED_CONTEXT_ONLY
    assert decision.task_route is None
    assert decision.artifact_contract.delivery_required is False
    assert decision.method == "rule_direct_router"


def test_project_memory_analysis_with_quoted_ai_advice_blocks_artifact_guess():
    called = False

    async def fake_llm(*args, **kwargs):
        nonlocal called
        called = True
        return (
            '{"chat_mode":"task_orchestration","action_policy":"durable_task","confidence":0.92,'
            '"reason":"model guessed markdown artifact from quoted advice",'
            '"artifact_contract":{"delivery_required":true,"output_kind":"md","title":"里程碑推进计划",'
            '"allowed_tools":["update_project_markdown_document"]}}'
        )

    req = SendMessageRequest(
        content=(
            "请基于当前项目的结构化记忆，分析当前里程碑推进情况，指出已经完成的进展、可能延迟的事项，"
            "以及接下来最需要推进的里程碑。以下是别的 AI 给出的建议，当然你要辩证地看："
            "模型还在调 MD 工具，可能是 prompt 里有生成文档的暗示；建议生成一份推进计划。"
        ),
        project_id=26,
    )

    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm, model="test"))

    assert called is False
    assert decision.chat_mode == ChatMode.PROJECT_DEEP_DIVE
    assert decision.action_policy == ActionPolicy.DIRECT_ANSWER
    assert decision.tool_access_policy == ToolAccessPolicy.INJECTED_CONTEXT_ONLY
    assert decision.task_route is None
    assert decision.artifact_contract.delivery_required is False
    assert decision.method == "rule_direct_router"


def test_llm_router_can_controlled_upgrade_ambiguous_artifact_contract():
    async def fake_llm(*args, **kwargs):
        return (
            '{"chat_mode":"task_orchestration","action_policy":"durable_task","confidence":0.91,'
            '"reason":"user wants a deliverable spreadsheet",'
            '"artifact_contract":{'
            '"delivery_required":true,'
            '"output_kind":"xlsx",'
            '"title":"部门访谈问卷",'
            f'"allowed_tools":["{WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME}"]'
            "}}"
        )

    req = SendMessageRequest(
        content="帮我弄个部门访谈表，明天要发客户各部门填写。",
        project_id=26,
    )
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert decision.chat_mode == ChatMode.TASK_ORCHESTRATION
    assert decision.action_policy == ActionPolicy.DURABLE_TASK
    assert decision.tool_access_policy == ToolAccessPolicy.WRITE_ALLOWED
    assert decision.task_route is not None
    assert decision.task_route.task_type == "generate_project_excel"
    assert decision.artifact_contract.delivery_required is True
    assert decision.artifact_contract.output_kind == "xlsx"
    assert decision.trace["artifact_contract"]["output_kind"] == "xlsx"


def test_llm_router_rejects_artifact_upgrade_without_contract():
    async def fake_llm(*args, **kwargs):
        return '{"chat_mode":"task_orchestration","action_policy":"durable_task","confidence":0.9,"reason":"guessed workflow"}'

    req = SendMessageRequest(
        content="帮我分析一下明天客户访谈应该重点问什么。",
        project_id=26,
    )
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert decision.chat_mode != ChatMode.TASK_ORCHESTRATION
    assert decision.action_policy == ActionPolicy.READ_ONLY_TOOL
    assert decision.tool_access_policy == ToolAccessPolicy.READ_ON_DEMAND
    assert decision.task_route is None


def test_llm_router_rejects_low_confidence_artifact_upgrade():
    async def fake_llm(*args, **kwargs):
        return (
            '{"chat_mode":"task_orchestration","action_policy":"durable_task","confidence":0.86,'
            '"reason":"low confidence artifact guess",'
            '"artifact_contract":{"delivery_required":true,"output_kind":"md","title":"风险评估",'
            '"allowed_tools":["update_project_markdown_document"]}}'
        )

    req = SendMessageRequest(content="评估项目风险并给我建议", project_id=26)
    decision = asyncio.run(classify_chat_intent_async(req, llm_complete=fake_llm))
    assert decision.chat_mode != ChatMode.TASK_ORCHESTRATION
    assert decision.action_policy == ActionPolicy.READ_ONLY_TOOL
    assert decision.task_route is None
    assert decision.artifact_contract.delivery_required is False


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
    assert decision.tool_access_policy == ToolAccessPolicy.WRITE_ALLOWED
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


def test_tool_access_policy_hides_read_tools_for_injected_context_answers():
    tools = [
        {"name": "read_project_markdown_document"},
        {"name": "read_project_file"},
        {"name": "update_project_markdown_document"},
    ]

    filtered = filter_tools_for_access(tools, ActionPolicy.READ_ONLY_TOOL, ToolAccessPolicy.INJECTED_CONTEXT_ONLY)

    assert filtered == []


def test_tool_access_policy_allows_read_tools_for_explicit_file_read():
    tools = [
        {"name": "read_project_markdown_document"},
        {"name": "read_project_file"},
        {"name": "update_project_markdown_document"},
    ]

    filtered = filter_tools_for_access(tools, ActionPolicy.READ_ONLY_TOOL, ToolAccessPolicy.EXPLICIT_FILE_READ)

    assert [tool["name"] for tool in filtered or []] == ["read_project_markdown_document", "read_project_file"]
