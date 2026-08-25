"""Deterministic release-gate evals for project chat context and Skill routing.

These cases exercise Aria's control layer without calling a model or touching
the configured application database. They complement provider/model evals by
making regressions in Skill selection, topic release, memory freshness, and
constraint retention visible in CI.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Project, Skill
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.mode_registry import ActionPolicy, ToolAccessPolicy
from app.services.chat.runtime import _resolve_effective_skill
from app.services.chat.turn_contract import build_turn_contract
from app.services.chat_store import build_message_metadata
from app.services.agent_harness.project_memory_evidence import (
    select_project_memory_slots,
)
from app.services.context_builder.memory_formatters import (
    _format_project_memory_for_prompt,
)
from app.services.conversation_state import merge_user_constraints
from app.services.intent_router import classify_chat_intent
from app.services.skill_router import (
    auto_select_skill,
    decide_conversation_skill_activation,
)


_CATALOG = (
    ("舞弊风险评估", "舞弊三角、舞弊红旗和反舞弊控制", "风险与合规"),
    ("审计计划与风险评估", "ISA 315 与重大错报风险识别", "审计"),
    ("实质性程序设计", "细节测试、函证程序和审计抽样", "审计"),
    ("增值税合规与优化", "进项税、销项税和留抵退税", "税务"),
    ("商业尽职调查", "市场吸引力、客户质量和增长可持续性", "交易"),
    ("会议纪要提取", "会议纪要、决策和会议行动项", "顾问基础能力"),
    ("presentation-builder", "PowerPoint generation skill", "consulting"),
)

_SKILL_CASES = (
    ("如何识别这个项目的舞弊红旗？", "舞弊风险评估"),
    ("审计计划阶段如何识别重大错报风险？", "审计计划与风险评估"),
    ("留抵退税和进项税抵扣风险应该怎么分析？", "增值税合规与优化"),
    ("商业尽调中如何判断客户质量？", "商业尽职调查"),
    ("如何从会议记录中提炼会议行动项？", "会议纪要提取"),
    ("这个项目目前最大的交付风险是什么？", None),
    ("为什么这个项目需要做 PPT？", None),
)

_LIFECYCLE_CASES = (
    ("继续按刚才的格式补充行动项", True, False),
    ("不用这个技能，回到普通对话", False, True),
    ("换个话题，另一个问题", False, True),
    ("这个项目目前最大的交付风险是什么？", False, True),
)

_MEMORY_EVAL_ALL_SLOTS = (
    "project_brief",
    "current_stage",
    "current_objective",
    "recent_progress",
    "key_risks",
    "open_questions",
    "next_actions",
    "important_documents",
    "financial_status",
    "delivery_signals",
    "stakeholder_notes",
    "client_stakeholders",
)


def _ratio(passed: int, total: int) -> float:
    return round(passed / total, 4) if total else 1.0


def _skill_selection_results() -> tuple[int, int, list[dict[str, Any]]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    details: list[dict[str, Any]] = []
    passed = 0
    try:
        with Session(engine) as session:
            for name, description, category in _CATALOG:
                session.add(
                    Skill(
                        name=name,
                        description=description,
                        category=category,
                    )
                )
            session.commit()
            for content, expected in _SKILL_CASES:
                selected, decision = auto_select_skill(
                    session,
                    SendMessageRequest(content=content, project_id=26),
                )
                actual = selected.name if selected is not None else None
                ok = actual == expected
                passed += int(ok)
                details.append(
                    {
                        "content": content,
                        "expected": expected,
                        "actual": actual,
                        "reason": decision.reason,
                        "passed": ok,
                    }
                )
    finally:
        engine.dispose()
    return passed, len(_SKILL_CASES), details


def _lifecycle_results() -> tuple[int, int, list[dict[str, Any]]]:
    skill = SimpleNamespace(
        id=7,
        name="会议纪要提取",
        description="会议纪要、会议决策和会议行动项",
        category="顾问基础能力",
    )
    details: list[dict[str, Any]] = []
    passed = 0
    for content, expected_apply, expected_clear in _LIFECYCLE_CASES:
        decision = decide_conversation_skill_activation(content, skill)
        ok = (
            decision.apply is expected_apply
            and decision.clear_conversation_skill is expected_clear
        )
        passed += int(ok)
        details.append(
            {
                "content": content,
                "expected_apply": expected_apply,
                "actual_apply": decision.apply,
                "expected_clear": expected_clear,
                "actual_clear": decision.clear_conversation_skill,
                "reason": decision.reason,
                "passed": ok,
            }
        )
    return passed, len(_LIFECYCLE_CASES), details


def _advisory_safety_results() -> tuple[int, int, list[dict[str, Any]]]:
    """A matched advisory Skill must not grant side-effect capability."""

    details: list[dict[str, Any]] = []
    for content in (
        "如何识别这个项目的舞弊红旗？",
        "审计计划阶段如何识别重大错报风险？",
    ):
        decision = classify_chat_intent(
            SendMessageRequest(content=content, project_id=26),
            effective_skill_id=7,
        )
        safe_action = decision.action_policy in {
            ActionPolicy.DIRECT_ANSWER,
            ActionPolicy.READ_ONLY_TOOL,
        }
        no_write_access = decision.tool_access_policy != ToolAccessPolicy.WRITE_ALLOWED
        details.append(
            {
                "content": content,
                "action_policy": decision.action_policy.value,
                "tool_access_policy": decision.tool_access_policy.value,
                "passed": safe_action and no_write_access,
            }
        )
    return sum(int(item["passed"]) for item in details), len(details), details


def _skill_control_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Explicit on/off controls must be deterministic and mutually exclusive."""

    class LookupMustNotRun:
        def get(self, *_args, **_kwargs):
            raise AssertionError("disabled Skill control performed a database lookup")

    _, disabled, effective_skill_id, effective_skill = _resolve_effective_skill(
        LookupMustNotRun(),
        SendMessageRequest(content="本轮普通回答", project_id=26, disable_skill=True),
    )
    disabled_ok = (
        disabled.apply is False
        and disabled.reason == "skill_disabled_by_user"
        and disabled.clear_conversation_skill is True
        and effective_skill_id is None
        and effective_skill is None
    )
    _, conflict, conflict_skill_id, conflict_skill = _resolve_effective_skill(
        LookupMustNotRun(),
        SendMessageRequest(
            content="冲突控制",
            skill_id=7,
            force_skill=True,
            disable_skill=True,
        ),
    )
    disable_precedes_enable = (
        conflict.reason == "skill_disabled_by_user"
        and conflict_skill_id is None
        and conflict_skill is None
    )
    details = [
        {"case": "structured_skill_disable", "passed": disabled_ok},
        {"case": "disable_precedes_conflicting_enable", "passed": disable_precedes_enable},
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _structured_reference_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Project object choices remain exact IDs and empty choices stay absent."""

    mention_context = {
        "file_ids": [11],
        "stakeholder_ids": [12],
        "milestone_ids": [13],
    }
    metadata = build_message_metadata(project_id=26, mention_context=mention_context)
    empty_metadata = build_message_metadata(
        project_id=26,
        mention_context={"file_ids": [], "stakeholder_ids": [], "milestone_ids": []},
    )
    details = [
        {
            "case": "structured_project_references_preserve_exact_ids",
            "passed": metadata.get("mention_context") == mention_context,
        },
        {
            "case": "empty_project_references_are_omitted",
            "passed": "mention_context" not in empty_metadata,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _memory_results() -> tuple[int, int, list[dict[str, Any]]]:
    stale = Project(
        name="Stale",
        client="Client",
        memory_version=3,
        memory_stale=True,
        context_memory_json='{"project_brief":"Earlier synthesis"}',
    )
    fresh = Project(
        name="Fresh",
        client="Client",
        memory_version=4,
        memory_stale=False,
        context_memory_json='{"project_brief":"Current synthesis"}',
    )
    stale_prompt = _format_project_memory_for_prompt(stale)
    fresh_prompt = _format_project_memory_for_prompt(fresh)
    details = [
        {
            "case": "stale_memory_guard",
            "passed": "Structured Project Memory (STALE)" in stale_prompt
            and "prefer newer milestones" in stale_prompt,
        },
        {
            "case": "fresh_memory_no_false_warning",
            "passed": "Structured Project Memory:**" in fresh_prompt
            and "STALE" not in fresh_prompt,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _memory_retrieval_results() -> tuple[int, int, list[dict[str, Any]]]:
    cases = (
        ("项目风险、阻塞和下一步是什么？", {"key_risks", "open_questions", "next_actions"}, {"financial_status", "client_stakeholders"}),
        ("合同回款、预算和现金流怎么样？", {"financial_status"}, {"client_stakeholders", "important_documents"}),
        ("关键干系人的诉求和沟通偏好是什么？", {"client_stakeholders", "stakeholder_notes"}, {"financial_status", "important_documents"}),
        ("应该优先阅读哪些项目文档？", {"important_documents"}, {"financial_status", "client_stakeholders"}),
        ("全面盘点项目所有方面", set(_MEMORY_EVAL_ALL_SLOTS), set()),
    )
    details: list[dict[str, Any]] = []
    for content, required, forbidden in cases:
        mode, facets, slots = select_project_memory_slots(content)
        slot_set = set(slots)
        passed = required.issubset(slot_set) and not (forbidden & slot_set)
        details.append(
            {
                "content": content,
                "mode": mode,
                "facets": list(facets),
                "selected_slots": list(slots),
                "passed": passed,
            }
        )
    return sum(int(item["passed"]) for item in details), len(details), details


def _constraint_results() -> tuple[int, int, list[dict[str, Any]]]:
    cases = (
        (
            ["必须使用正式语气", "输出为 Markdown"],
            "不用正式语气，改成简洁口语",
            ["不用正式语气", "改成简洁口语", "输出为 Markdown"],
        ),
        (
            ["必须使用正式语气", "输出为 Markdown"],
            "继续补充竞争分析",
            ["必须使用正式语气", "输出为 Markdown"],
        ),
    )
    details: list[dict[str, Any]] = []
    for existing, content, expected in cases:
        actual = merge_user_constraints(existing, content)
        details.append(
            {
                "content": content,
                "expected": expected,
                "actual": actual,
                "passed": actual == expected,
            }
        )
    return sum(int(item["passed"]) for item in details), len(details), details


def _turn_brief_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Explicit goal/constraints are bounded, auditable, and permission-shrinking."""

    req = SendMessageRequest(
        content="请更新项目 Markdown 报告并保存。",
        project_id=26,
        turn_brief={
            "goal": "先评估报告结构是否完整",
            "constraints": ["只分析，不修改项目内容", "使用正式专业语气"],
        },
    )
    decision = classify_chat_intent(req)
    contract = build_turn_contract(
        decision,
        req,
        tools=[{"name": "update_project_markdown_document"}],
    )
    metadata = build_message_metadata(
        project_id=26,
        turn_brief=req.turn_brief.model_dump() if req.turn_brief else None,
    )
    constraints = merge_user_constraints(
        ["使用口语", "输出为 Markdown"],
        "继续分析",
        structured_constraints=["使用正式专业语气", "沿用董事会风险分级"],
    )
    details = [
        {
            "case": "turn_brief_goal_and_constraints_enter_contract",
            "passed": (
                contract.user_goal == "先评估报告结构是否完整"
                and list(contract.user_constraints)
                == ["只分析，不修改项目内容", "使用正式专业语气"]
            ),
        },
        {
            "case": "turn_brief_can_only_shrink_execution",
            "passed": contract.mode == "plan_only" and contract.write_allowed is False,
        },
        {
            "case": "turn_brief_is_audited_and_persisted_without_keyword_guessing",
            "passed": (
                metadata.get("turn_brief", {}).get("goal") == "先评估报告结构是否完整"
                and constraints
                == ["使用正式专业语气", "沿用董事会风险分级", "输出为 Markdown"]
            ),
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def run_project_chat_quality_eval() -> dict[str, Any]:
    """Run all deterministic cases and return a JSON-safe release report."""

    groups = {
        "skill_selection_accuracy": _skill_selection_results(),
        "skill_lifecycle_accuracy": _lifecycle_results(),
        "advisory_skill_safety_rate": _advisory_safety_results(),
        "skill_control_accuracy": _skill_control_results(),
        "structured_reference_accuracy": _structured_reference_results(),
        "memory_freshness_guard_rate": _memory_results(),
        "memory_retrieval_precision_rate": _memory_retrieval_results(),
        "constraint_retention_rate": _constraint_results(),
        "turn_brief_accuracy": _turn_brief_results(),
    }
    metrics = {
        name: {
            "passed": result[0],
            "total": result[1],
            "score": _ratio(result[0], result[1]),
        }
        for name, result in groups.items()
    }
    return {
        "schema_version": 1,
        "case_count": sum(item["total"] for item in metrics.values()),
        "metrics": metrics,
        "release_gate_passed": all(item["score"] == 1.0 for item in metrics.values()),
        "failures": [
            {"metric": name, **detail}
            for name, result in groups.items()
            for detail in result[2]
            if not detail["passed"]
        ],
    }
