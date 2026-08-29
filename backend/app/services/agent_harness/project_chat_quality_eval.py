"""Deterministic release-gate evals for project chat context and Skill routing.

These cases exercise Aria's control layer without calling a model or touching
the configured application database. They complement provider/model evals by
making regressions in Skill selection, topic release, memory freshness, and
constraint retention visible in CI.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import ClientRecord, Project, ProjectPayment, Skill
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.mode_registry import ActionPolicy, ToolAccessPolicy
from app.services.chat.runtime import _resolve_effective_skill
from app.services.chat.turn_contract import build_turn_contract
from app.services.chat.turn_setup import recommend_turn_brief_template
from app.services.chat.user_memory_prompt import build_user_memory_prompt_bundle
from app.services.chat_store import build_message_metadata
from app.services.agent_harness.project_memory_evidence import (
    build_project_memory_evidence,
    select_project_memory_slots,
)
from app.services.agent_harness.skill_releases import (
    skill_release_sha256,
    skill_rollout_bucket,
)
from app.services.agent_harness.project_world_state import (
    WORLD_STATE_CATEGORIES,
    compare_project_world_states,
    format_project_world_state_change_for_prompt,
)
from app.services.chat.interaction_feedback import (
    aggregate_interaction_metrics,
    aggregate_skill_run_metrics,
)
from app.services.chat.turn_recovery import (
    build_turn_recovery_preview,
    format_turn_recovery_for_prompt,
)
from app.services.context_builder.memory_formatters import (
    build_client_memory_prompt_bundle,
    _format_project_memory_for_prompt,
)
from app.services.conversation_state import merge_user_constraints
from app.services.intent_router import classify_chat_intent
from app.services.memory_rebuilds import (
    plan_client_memory_rebuild,
    plan_project_memory_rebuild,
)
from app.services.memory_slots import CLIENT_MEMORY_SLOT_KEYS, PROJECT_MEMORY_SLOT_KEYS
from app.services.memory_facts import (
    MODEL_SOURCE_ATTRIBUTIONS_KEY,
    bind_model_source_attributions,
    capture_project_memory_source_snapshots,
    get_project_memory_fact_states,
)
from app.services.project_contexts import save_project_memory
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
            session.add(
                Skill(
                    name="供应链诊断",
                    description="供应链风险与韧性诊断",
                    category="运营",
                    package_status="deprecated",
                )
            )
            session.commit()
            selected, decision = auto_select_skill(
                session,
                SendMessageRequest(content="供应链诊断", project_id=26),
            )
            deprecated_ok = selected is None
            passed += int(deprecated_ok)
            details.append(
                {
                    "content": "供应链诊断",
                    "expected": None,
                    "actual": selected.name if selected else None,
                    "reason": decision.reason,
                    "passed": deprecated_ok,
                }
            )
    finally:
        engine.dispose()
    return passed, len(details), details


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


def _layered_memory_results() -> tuple[int, int, list[dict[str, Any]]]:
    client = ClientRecord(
        name="Eval Client",
        client_memory_version=3,
        client_memory_stale=False,
        client_memory_json=json.dumps(
            {
                "client_profile": "PRIVATE PROFILE",
                "decision_patterns": ["PRIVATE DECISION"],
                "lessons_learned": ["PRIVATE LESSON"],
                "relationship_signals": ["PRIVATE RELATIONSHIP"],
            }
        ),
    )
    unrelated = build_client_memory_prompt_bundle(client, "项目交付进度是什么？")
    relationship = build_client_memory_prompt_bundle(client, "客户关系与决策机制如何？")
    current_relationship = build_client_memory_prompt_bundle(
        client,
        "Summarize current relationship",
        force=True,
    )
    client.client_memory_stale = True
    client_slot_states = {
        "lessons_learned": {"status": "ready", "evidence_count": 2},
        "project_history": {"status": "ready", "evidence_count": 1},
        "client_profile": {"status": "ready", "evidence_count": 1},
        "decision_patterns": {"status": "stale", "evidence_count": 2},
        "relationship_signals": {"status": "stale", "evidence_count": 2},
    }
    fresh_lessons = build_client_memory_prompt_bundle(
        client,
        "What lessons did we learn from this client?",
        slot_states=client_slot_states,
    )
    stale_relationship = build_client_memory_prompt_bundle(
        client,
        "Summarize current relationship",
        slot_states=client_slot_states,
    )
    project = Project(
        id=77,
        name="Eval Project",
        client="Eval Client",
        context_memory_json=json.dumps(
            {
                "project_brief": "PROJECT BRIEF",
                "current_stage": "delivery",
                "current_objective": "Deliver",
                "key_risks": ["PAYMENT RISK"],
                "financial_status": "PAYMENT PENDING",
                "important_documents": [{"name": "pack.pdf", "reason": "Evidence"}],
                "delivery_signals": ["On track"],
            }
        ),
        memory_version=4,
        memory_stale=True,
    )
    project_slot_states = {
        "project_brief": {"status": "ready", "evidence_count": 1},
        "current_stage": {"status": "ready", "evidence_count": 1},
        "current_objective": {"status": "ready", "evidence_count": 1},
        "financial_status": {"status": "stale", "evidence_count": 2},
        "key_risks": {"status": "stale", "evidence_count": 2},
        "open_questions": {"status": "ready", "evidence_count": 1},
        "next_actions": {"status": "ready", "evidence_count": 1},
        "important_documents": {"status": "ready", "evidence_count": 1},
        "delivery_signals": {"status": "ready", "evidence_count": 1},
    }
    financial_project = build_project_memory_evidence(
        project,
        "项目回款风险是什么？",
        slot_states=project_slot_states,
    )
    document_project = build_project_memory_evidence(
        project,
        "应该查看哪些项目文件？",
        slot_states=project_slot_states,
    )
    document_fact_project = build_project_memory_evidence(
        project,
        "应该查看哪些项目文件？",
        slot_states=project_slot_states,
        fact_states={
            "important_documents": {
                0: {
                    "fact_key": "pmf_0123456789abcdef01234567",
                    "status": "ready",
                    "provenance_status": "matched",
                    "evidence_count": 1,
                }
            }
        },
    )
    relationship_fact_client = build_client_memory_prompt_bundle(
        client,
        "Summarize current relationship",
        force=True,
        fact_states={
            "relationship_signals": {
                0: {
                    "status": "ready",
                    "provenance_status": "scoped",
                    "evidence_count": 2,
                }
            }
        },
    )
    user = build_user_memory_prompt_bundle(
        {
            "response_preferences": {
                "language": "zh",
                "tone": "formal",
                "verbosity": "detailed",
            }
        },
        "请改成英文回答，并且更简短",
        version=4,
    )
    selection_json = json.dumps(
        [unrelated["selection"], relationship["selection"], user["selection"]],
        ensure_ascii=False,
    )
    details = [
        {
            "case": "unrelated_turn_skips_client_memory",
            "passed": unrelated["prompt"] == ""
            and unrelated["selection"]["retrieval_mode"] == "none",
        },
        {
            "case": "relationship_turn_routes_client_memory",
            "passed": "decision_patterns" in relationship["selection"]["selected_slots"]
            and "lessons_learned" not in relationship["selection"]["selected_slots"],
        },
        {
            "case": "natural_english_relationship_phrase_routes_focused_memory",
            "passed": current_relationship["selection"]["retrieval_mode"] == "focused"
            and "relationship" in current_relationship["selection"]["query_facets"]
            and "relationship_signals"
            in current_relationship["selection"]["selected_slots"],
        },
        {
            "case": "client_slot_freshness_is_scoped_to_selected_facets",
            "passed": fresh_lessons["selection"]["status"] == "ready"
            and fresh_lessons["selection"]["stale_slots"] == []
            and stale_relationship["selection"]["status"] == "stale"
            and "relationship_signals"
            in stale_relationship["selection"]["stale_slots"],
        },
        {
            "case": "project_slot_freshness_is_scoped_to_selected_facets",
            "passed": financial_project["manifest"]["memory_stale"] is True
            and set(financial_project["selection"]["stale_slots"])
            == {"financial_status", "key_risks"}
            and document_project["manifest"]["memory_stale"] is False
            and document_project["selection"]["stale_slots"] == [],
        },
        {
            "case": "current_turn_overrides_saved_preferences",
            "passed": user["selection"]["overridden_dimensions"] == ["language", "verbosity"]
            and "response_preferences.language: zh" not in user["prompt"]
            and "response_preferences.tone: formal" in user["prompt"],
        },
        {
            "case": "layered_memory_receipt_is_content_free",
            "passed": "PRIVATE" not in selection_json
            and "zh" not in selection_json
            and "formal" not in selection_json,
        },
        {
            "case": "project_memory_manifest_carries_fact_identity_and_provenance",
            "passed": any(
                entry.get("memory_fact_key") == "pmf_0123456789abcdef01234567"
                and entry.get("provenance_status") == "matched"
                and entry.get("fact_evidence_count") == 1
                for entry in document_fact_project["manifest"]["entries"]
            )
            and document_fact_project["selection"]["matched_fact_count"] == 1,
        },
        {
            "case": "client_memory_scoped_provenance_is_not_overclaimed",
            "passed": "[PROVENANCE:SCOPED]" in relationship_fact_client["prompt"]
            and relationship_fact_client["selection"]["scoped_fact_count"] == 1,
        },
    ]
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


def _turn_setup_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Preflight advice stays deterministic and abstains on weak signals."""

    cases = (
        ("请先做执行计划，不要执行", "plan_only"),
        ("请核验访谈证据并标明来源", "evidence_first"),
        ("整理成董事会汇报，结论先行", "executive_answer"),
        ("Please update the database schema", None),
    )
    details: list[dict[str, Any]] = []
    for content, expected in cases:
        advice = recommend_turn_brief_template(content)
        actual = advice.template_id if advice else None
        details.append({
            "content": content,
            "expected": expected,
            "actual": actual,
            "passed": actual == expected,
        })
    return sum(int(item["passed"]) for item in details), len(details), details


def _turn_revision_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Revision attribution is bounded metadata and never an execution input."""

    valid = build_message_metadata(
        project_id=26,
        turn_revision={
            "source_message_id": 91,
            "source_fingerprint": "turn-1a2b3c4d",
            "source_role": "assistant",
            "changed_fields": ["goal", "goal", "skill", "unknown"],
        },
    )
    invalid = build_message_metadata(
        project_id=26,
        turn_revision={
            "source_message_id": -1,
            "source_fingerprint": "invalid",
            "source_role": "assistant",
        },
    )
    details = [
        {
            "case": "turn_revision_is_deduplicated_and_bounded",
            "passed": valid.get("turn_revision", {}).get("changed_fields") == ["goal", "skill"],
        },
        {
            "case": "invalid_turn_revision_is_not_persisted",
            "passed": "turn_revision" not in invalid,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _world_state_manifest(version_char: str, *, todo_state_char: str) -> dict[str, Any]:
    categories = {
        name: {
            "count": 0,
            "items": [],
            "fingerprint": "1" * 64,
            "truncated": False,
        }
        for name in WORLD_STATE_CATEGORIES
    }
    categories["todos"] = {
        "count": 1,
        "items": [{"id": "7", "state_sha256": todo_state_char * 64}],
        "fingerprint": todo_state_char * 64,
        "truncated": False,
    }
    return {
        "schema_version": 1,
        "project_id": 26,
        "version": version_char * 12,
        "fingerprint": version_char * 64,
        "categories": categories,
        "truncated": False,
    }


def _project_world_state_results() -> tuple[int, int, list[dict[str, Any]]]:
    before = _world_state_manifest("a", todo_state_char="2")
    after = _world_state_manifest("b", todo_state_char="3")
    change = compare_project_world_states(before, after)
    prompt = format_project_world_state_change_for_prompt(change)
    details = [
        {
            "case": "world_state_change_is_category_exact",
            "passed": (
                change.get("changed_categories") == ["todos"]
                and change.get("categories", {}).get("todos", {}).get("updated") == 1
            ),
        },
        {
            "case": "world_state_prompt_contains_counts_not_business_content",
            "passed": "todos: +0 / -0 / updated 1" in prompt and "PRIVATE" not in prompt,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _turn_recovery_results() -> tuple[int, int, list[dict[str, Any]]]:
    preview = build_turn_recovery_preview(
        {
            "run_id": "run_quality_recovery",
            "status": "interrupted",
            "steps": [
                {
                    "step_index": 1,
                    "status": "completed",
                    "tool_calls": [{"tool_name": "write_project_file"}],
                }
            ],
            "run_outputs": [],
            "recovery": {"can_resume": True, "can_retry": False},
        },
        source_message_id=91,
    )
    prompt = format_turn_recovery_for_prompt(preview)
    details = [
        {
            "case": "interrupted_turn_uses_durable_checkpoint",
            "passed": preview.get("strategy") == "resume_from_checkpoint"
            and preview.get("completed_steps") == [1],
        },
        {
            "case": "recovery_blocks_blind_side_effect_replay",
            "passed": preview.get("side_effects_possible") is True
            and "Never replay a previous write" in prompt
            and "write_project_file" not in prompt,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _interaction_feedback_results() -> tuple[int, int, list[dict[str, Any]]]:
    messages = [
        SimpleNamespace(
            role="assistant",
            content="PRIVATE-ANSWER",
            metadata_json=json.dumps(
                {
                    "interaction_feedback": {
                        "schema_version": 1,
                        "rating": "unhelpful",
                        "reasons": ["missing_context"],
                    }
                }
            ),
        ),
        SimpleNamespace(
            role="user",
            content="PRIVATE-QUESTION",
            metadata_json=json.dumps(
                {"turn_setup_trace": {"schema_version": 1, "outcome": "applied"}}
            ),
        ),
    ]
    metrics = aggregate_interaction_metrics(messages)
    details = [
        {
            "case": "interaction_metrics_are_content_free",
            "passed": metrics.get("privacy") == {
                "stores_message_content": False,
                "stores_free_text_feedback": False,
                "stores_user_identity": False,
            }
            and "PRIVATE" not in json.dumps(metrics),
        },
        {
            "case": "feedback_and_setup_adoption_are_attributed",
            "passed": metrics.get("negative_reasons", {}).get("missing_context") == 1
            and metrics.get("turn_setup", {}).get("adoption_rate") == 1.0,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _skill_run_quality_results() -> tuple[int, int, list[dict[str, Any]]]:
    messages = [
        SimpleNamespace(
            id=81,
            role="assistant",
            content="PRIVATE-SKILL-ANSWER",
            metadata_json=json.dumps(
                {
                    "interaction_feedback": {
                        "schema_version": 1,
                        "rating": "helpful",
                        "reasons": [],
                    }
                }
            ),
        )
    ]
    runs = [
        SimpleNamespace(
            skill_id=7,
            skill_name="舞弊风险评估",
            skill_version="1.0.0",
            skill_release_status="stable",
            skill_release_sha256="a" * 64,
            skill_activation_source="auto",
            status="completed",
            duration_ms=120,
            assistant_message_id=81,
        ),
        SimpleNamespace(
            skill_id=7,
            skill_name="舞弊风险评估",
            skill_version="1.1.0",
            skill_release_status="stable",
            skill_release_sha256="b" * 64,
            skill_activation_source="explicit",
            status="failed",
            duration_ms=80,
            assistant_message_id=None,
        ),
    ]
    metrics = aggregate_skill_run_metrics(runs, messages)
    details = [
        {
            "case": "skill_quality_separates_exact_release_versions",
            "passed": metrics.get("run_count") == 2
            and len(metrics.get("items") or []) == 2
            and {item.get("version") for item in metrics.get("items") or []}
            == {"1.0.0", "1.1.0"},
        },
        {
            "case": "skill_quality_is_content_and_identity_free",
            "passed": metrics.get("privacy") == {
                "reads_message_content": False,
                "stores_free_text_feedback": False,
                "stores_user_identity": False,
            }
            and "PRIVATE" not in json.dumps(metrics),
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _skill_release_governance_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Exact snapshots and project-sticky buckets stay deterministic."""

    baseline = SimpleNamespace(
        name="Project Risk Review",
        category="risk",
        description="Review project risks",
        system_prompt="Use the approved baseline.",
        user_template="Review {{project}}",
        estimated_time="~2 min",
        max_tokens=4096,
        tools_definition_json="[]",
        tools_json="[]",
        package_version="1.0.0",
        package_status="stable",
    )
    candidate = SimpleNamespace(
        **{
            **vars(baseline),
            "system_prompt": "Use the candidate risk method.",
            "package_version": "1.1.0",
            "package_status": "preview",
        }
    )
    baseline_sha = skill_release_sha256(baseline)
    candidate_sha = skill_release_sha256(candidate)
    project_bucket = skill_rollout_bucket(
        17,
        skill_id=7,
        project_id=26,
        conversation_id=81,
        owner_user_id=3,
    )
    same_project_bucket = skill_rollout_bucket(
        17,
        skill_id=7,
        project_id=26,
        conversation_id=999,
        owner_user_id=99,
    )
    conversation_bucket = skill_rollout_bucket(
        17,
        skill_id=7,
        project_id=None,
        conversation_id=81,
        owner_user_id=3,
    )
    same_conversation_bucket = skill_rollout_bucket(
        17,
        skill_id=7,
        project_id=None,
        conversation_id=81,
        owner_user_id=99,
    )
    owner_bucket = skill_rollout_bucket(
        17,
        skill_id=7,
        project_id=None,
        conversation_id=None,
        owner_user_id=3,
    )
    same_owner_bucket = skill_rollout_bucket(
        17,
        skill_id=7,
        project_id=None,
        conversation_id=None,
        owner_user_id=3,
    )
    details = [
        {
            "case": "skill_release_hash_identifies_exact_runtime_contract",
            "passed": len(baseline_sha) == 64
            and len(candidate_sha) == 64
            and baseline_sha != candidate_sha,
        },
        {
            "case": "skill_rollout_is_sticky_to_project_before_turn_identity",
            "passed": 0 <= project_bucket < 100
            and project_bucket == same_project_bucket,
        },
        {
            "case": "skill_rollout_fallback_scopes_are_deterministic",
            "passed": conversation_bucket == same_conversation_bucket
            and owner_bucket == same_owner_bucket,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _memory_rebuild_planning_results() -> tuple[int, int, list[dict[str, Any]]]:
    def states(keys: tuple[str, ...], stale: set[str]) -> list[dict[str, Any]]:
        return [
            {
                "slot_key": key,
                "slot_version": 2,
                "status": "stale" if key in stale else "ready",
                "value_sha256": f"sha:{key}",
                "stale_at": "2026-08-28" if key in stale else None,
                "updated_at": "2026-08-27",
            }
            for key in keys
        ]

    payment_slots = {"key_risks", "financial_status"}
    project_partial = plan_project_memory_rebuild(
        memory_version=5,
        parent_stale=True,
        trigger="payment_updated",
        slot_states=states(PROJECT_MEMORY_SLOT_KEYS, payment_slots),
    )
    project_manual = plan_project_memory_rebuild(
        memory_version=5,
        parent_stale=True,
        trigger="manual",
        slot_states=states(PROJECT_MEMORY_SLOT_KEYS, payment_slots),
    )
    incomplete = plan_project_memory_rebuild(
        memory_version=5,
        parent_stale=True,
        trigger="payment_updated",
        slot_states=states(PROJECT_MEMORY_SLOT_KEYS[:-1], payment_slots),
    )
    stakeholder_slots = {
        "decision_patterns",
        "key_contacts",
        "structured_stakeholders",
        "relationship_signals",
        "sensitive_topics",
    }
    client_partial = plan_client_memory_rebuild(
        memory_version=4,
        parent_stale=True,
        trigger="stakeholder_updated",
        slot_states=states(CLIENT_MEMORY_SLOT_KEYS, stakeholder_slots),
    )
    details = [
        {
            "case": "payment_change_rebuilds_only_financial_project_slots",
            "passed": project_partial.mode == "partial"
            and set(project_partial.slot_keys) == payment_slots,
        },
        {
            "case": "manual_project_rebuild_remains_explicitly_full",
            "passed": project_manual.mode == "full"
            and project_manual.slot_keys == PROJECT_MEMORY_SLOT_KEYS,
        },
        {
            "case": "incomplete_slot_ledger_falls_back_to_full_rebuild",
            "passed": incomplete.mode == "full"
            and incomplete.reason == "slot_ledger_incomplete",
        },
        {
            "case": "stakeholder_change_rebuilds_only_affected_client_slots",
            "passed": client_partial.mode == "partial"
            and set(client_partial.slot_keys) == stakeholder_slots,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _memory_direct_source_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Model-declared source IDs remain private and fail closed to the prompt pool."""

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project = Project(name="Direct source eval", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            payment = ProjectPayment(
                project_id=int(project.id or 0),
                amount=1000,
                payment_date="2026-08-28",
                payment_type="received",
                note="Deposit received",
            )
            session.add(payment)
            session.commit()
            session.refresh(payment)
            source_handles = [f"project_payment:{payment.id}"]
            source_snapshots = capture_project_memory_source_snapshots(
                session,
                project,
                source_handles,
            )
            memory = {
                "financial_status": "Deposit received",
                MODEL_SOURCE_ATTRIBUTIONS_KEY: bind_model_source_attributions(
                    [
                        {
                            "slot_key": "financial_status",
                            "fact_index": 0,
                            "source_ids": source_handles,
                        }
                    ],
                    ("financial_status",),
                    {"financial_status": {0: ("value", "Deposit received")}},
                ),
            }
            save_project_memory(
                session,
                int(project.id or 0),
                memory,
                trigger="quality_eval_direct_source",
                coverage={
                    "_source_snapshots": source_snapshots,
                },
                rebuilt_slots=("financial_status",),
                rebuild_mode="partial",
            )
            fact = get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]
            persisted = session.get(Project, project.id).context_memory_json

            changed = {"financial_status": "Unverified collection forecast"}
            changed[MODEL_SOURCE_ATTRIBUTIONS_KEY] = bind_model_source_attributions(
                [
                    {
                        "slot_key": "financial_status",
                        "fact_index": 0,
                        "source_ids": source_handles,
                    }
                ],
                ("financial_status",),
                {
                    "financial_status": {
                        0: ("value", "Unverified collection forecast")
                    }
                },
            )
            save_project_memory(
                session,
                int(project.id or 0),
                changed,
                trigger="quality_eval_missing_prompt_source",
                rebuilt_slots=("financial_status",),
                rebuild_mode="partial",
            )
            rejected = get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]
            details = [
                {
                    "case": "prompt_visible_source_id_becomes_direct_fact_link",
                    "passed": fact["provenance_status"] == "direct"
                    and fact["evidence_refs"][0]["relation"] == "direct_source_id",
                },
                {
                    "case": "private_source_attribution_is_not_persisted",
                    "passed": MODEL_SOURCE_ATTRIBUTIONS_KEY not in persisted,
                },
                {
                    "case": "source_id_outside_captured_prompt_pool_is_rejected",
                    "passed": rejected["provenance_status"] != "direct"
                    and all(
                        ref["relation"] != "direct_source_id"
                        for ref in rejected["evidence_refs"]
                    ),
                },
            ]
    finally:
        engine.dispose()
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
        "layered_memory_routing_accuracy": _layered_memory_results(),
        "constraint_retention_rate": _constraint_results(),
        "turn_brief_accuracy": _turn_brief_results(),
        "turn_setup_recommendation_accuracy": _turn_setup_results(),
        "turn_revision_attribution_accuracy": _turn_revision_results(),
        "project_world_state_accuracy": _project_world_state_results(),
        "turn_recovery_safety_rate": _turn_recovery_results(),
        "interaction_feedback_privacy_rate": _interaction_feedback_results(),
        "skill_quality_attribution_accuracy": _skill_run_quality_results(),
        "skill_release_governance_accuracy": _skill_release_governance_results(),
        "memory_rebuild_planning_accuracy": _memory_rebuild_planning_results(),
        "memory_direct_source_accuracy": _memory_direct_source_results(),
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
