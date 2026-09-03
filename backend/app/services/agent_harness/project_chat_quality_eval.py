"""Deterministic release-gate evals for project chat context and Skill routing.

These cases exercise Aria's control layer without calling a model or touching
the configured application database. They complement provider/model evals by
making regressions in Skill selection, topic release, memory freshness, and
constraint retention visible in CI.
"""
from __future__ import annotations

import json
import hashlib
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import ChatTrace, ClientRecord, Project, ProjectPayment, Skill
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.config_validation import assert_chat_runtime_configuration
from app.services.chat.mode_registry import (
    ActionPolicy,
    ChatMode,
    ToolAccessPolicy,
    filter_tools_for_mode,
)
from app.services.chat.prompt_assembler import build_prompt_layer_manifest
from app.services.chat.runtime import (
    _history_for_model,
    _resolve_effective_skill,
    _resolve_runtime_model_and_tokens,
)
from app.services.chat.trace import build_chat_trace_diagnostic
from app.services.chat.turn_contract import build_turn_contract
from app.services.chat.turn_setup import recommend_turn_brief_template
from app.services.chat.user_memory_prompt import build_user_memory_prompt_bundle
from app.services.chat_store import build_message_metadata
from app.services.agent_harness.project_memory_evidence import (
    build_project_memory_evidence,
    select_project_memory_slots,
)
from app.services.agent_harness.grounded_provider_eval import grade_grounded_answer
from app.services.agent_harness.knowledge_evidence import (
    build_knowledge_evidence_manifest,
    resolve_knowledge_citations,
)
from app.services.agent_harness.skill_releases import (
    skill_release_sha256,
    skill_rollout_bucket,
)
from app.services.agent_harness.skill_runtime_contract import (
    build_skill_runtime_contract,
    finalize_skill_runtime_contract,
    format_skill_runtime_contract_for_prompt,
    skill_runtime_contract_warnings,
)
from app.services.agent_harness.skill_deliverables import (
    build_skill_deliverable_catalog,
    format_skill_deliverable_for_prompt,
    resolve_selected_skill_deliverable,
    skill_deliverable_reference,
)
from app.services.agent_harness.artifact_verification import (
    build_artifact_verification_evidence,
)
from app.services.agent_harness.artifact_acceptance import (
    build_artifact_acceptance_contract,
    default_deliverable_business_verifiers,
    registered_artifact_business_verifiers,
    run_registered_artifact_business_verifiers,
)
from app.services.agent_harness.project_world_state import (
    WORLD_STATE_CATEGORIES,
    WORLD_STATE_SCHEMA_VERSION,
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
from app.services.context_builder.assembly import assemble_context
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
from app.services.project_question_evidence import assess_project_question_answer
from app.services.project_question_remediation import (
    build_question_evidence_remediation_plan,
)
from app.services.project_question_remediation_promotions import (
    build_remediation_promotion_contract,
)
from app.services.project_question_remediation_executions import (
    build_remediation_execution_contract,
)
from app.services.project_question_remediation_evidence_reviews import (
    build_remediation_evidence_review_contract,
)
from app.services.project_question_reanswer import (
    build_project_question_reanswer_contract,
    build_project_question_reanswer_manifest,
    resolve_project_question_reanswer_citations,
    validate_project_question_reanswer_manifest,
)
from app.services.project_question_answer_adoption import (
    build_project_question_answer_adoption_contract,
    encode_project_question_resolution_event_note,
    parse_project_question_resolution_event_note,
)
from app.services.project_question_resolutions import project_question_sha256
from app.services.skill_router import (
    auto_select_skill,
    decide_conversation_skill_activation,
)
from app.tools import file_generators as _file_generators  # noqa: F401
from app.tools import office_documents as _office_documents  # noqa: F401
from app.tools import pdf_tools as _pdf_tools  # noqa: F401
from app.tools import pdf_translation as _pdf_translation  # noqa: F401
from app.tools import project_markdown as _project_markdown  # noqa: F401
from app.tools import registry as tool_registry


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
        "schema_version": WORLD_STATE_SCHEMA_VERSION,
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
            "case": "interrupted_legacy_write_requires_manual_review",
            "passed": preview.get("strategy") == "manual_review"
            and preview.get("completed_steps") == [1],
        },
        {
            "case": "recovery_blocks_blind_side_effect_replay",
            "passed": preview.get("side_effects_possible") is True
            and "Never claim a write was completed" in prompt
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


def _question_answer_readiness_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Answer ranking must reward current evidence without claiming truth."""

    question = "客户是否确认了最终验收范围？"
    manifest = build_knowledge_evidence_manifest(
        [
            SimpleNamespace(
                content="客户已经书面确认最终验收范围。",
                document_name="验收确认函.pdf",
                document_id=31,
                chunk_index=2,
                score=0.91,
            )
        ],
        knowledge_scope="project",
        project_id=26,
    )
    cited, _ = resolve_knowledge_citations(manifest, "已确认。[K1]")
    evidence_id = manifest["entries"][0]["evidence_id"]
    source_map = {
        ("knowledge", evidence_id): {
            "source_type": "knowledge_document",
            "evidence_id": evidence_id,
            "citation_key": "K1",
            "title": "验收确认函.pdf",
        }
    }
    metadata = {
        "knowledge_evidence": cited,
        "run_evaluation": {
            "schema_version": 1,
            "verdict": "completed",
            "score": 100,
        },
    }
    supported = assess_project_question_answer(
        question=question,
        answer="客户已经书面确认最终验收范围。[K1]",
        metadata=metadata,
        project_id=26,
        question_source_map=source_map,
    )
    unrelated = assess_project_question_answer(
        question=question,
        answer="今天讨论了团队团建安排。[K1]",
        metadata=metadata,
        project_id=26,
        question_source_map=source_map,
    )
    details = [
        {
            "case": "relevant_current_evidence_can_rank_as_strong",
            "passed": supported["readiness_band"] == "strong"
            and supported["evidence"]["question_aligned_count"] == 1,
        },
        {
            "case": "citations_cannot_rescue_an_unrelated_answer",
            "passed": unrelated["readiness_band"] == "weak"
            and "LOW_QUESTION_RELEVANCE" in unrelated["warnings"],
        },
        {
            "case": "readiness_never_becomes_an_automatic_truth_verdict",
            "passed": supported["requires_human_confirmation"] is True
            and supported["is_correctness_verdict"] is False,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _question_remediation_safety_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Evidence gaps become drafts, never automatic side effects or truth claims."""

    base = {
        "schema_version": 1,
        "project_id": 26,
        "question": "客户是否确认了最终验收范围？",
        "question_sha256": "a" * 64,
        "question_evidence": {
            "status": "context_only",
            "source_count": 1,
            "supporting_source_count": 0,
            "memory": {"memory_version": 5, "memory_stale": False},
        },
        "summary": {
            "evaluated_candidate_count": 0,
            "recommended_message_id": None,
            "bands": {"strong": 0, "review": 0, "weak": 0, "unrated": 0},
        },
        "candidates": [],
    }
    collection = build_question_evidence_remediation_plan(base)
    strong_review = {
        **base,
        "question_evidence": {
            **base["question_evidence"],
            "status": "available",
            "source_count": 2,
            "supporting_source_count": 2,
        },
        "summary": {
            "evaluated_candidate_count": 1,
            "recommended_message_id": 42,
            "bands": {"strong": 1, "review": 0, "weak": 0, "unrated": 0},
        },
        "candidates": [
            {
                "message_id": 42,
                "preview": "PRIVATE-ANSWER",
                "assessment": {"warnings": [], "readiness_band": "strong"},
            }
        ],
    }
    ready = build_question_evidence_remediation_plan(strong_review)
    serialized = json.dumps([collection, ready], ensure_ascii=False)
    details = [
        {
            "case": "context_only_evidence_creates_collection_and_clarification_drafts",
            "passed": collection["status"] == "evidence_collection_required"
            and {action["kind"] for action in collection["actions"]}
            >= {"evidence_request", "clarification_question"},
        },
        {
            "case": "remediation_contract_cannot_send_persist_or_execute",
            "passed": collection["plan_contract"]["sends_messages"] is False
            and collection["plan_contract"]["persists_changes"] is False
            and collection["plan_contract"]["executes_tools"] is False
            and all(
                action["execution_mode"] == "manual_only"
                for action in collection["actions"]
            ),
        },
        {
            "case": "strong_evidence_still_requires_human_confirmation_without_answer_leakage",
            "passed": ready["status"] == "verification_ready"
            and ready["gaps"] == []
            and [action["kind"] for action in ready["actions"]]
            == ["human_verification"]
            and ready["plan_contract"]["requires_human_confirmation"] is True
            and "PRIVATE-ANSWER" not in serialized,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _question_remediation_promotion_safety_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Consequential remediation targets require a durable two-step boundary."""

    todo = build_remediation_promotion_contract("project_todo")
    communication = build_remediation_promotion_contract("communication_request")
    details = [
        {
            "case": "promotion_persists_preview_before_creating_any_target",
            "passed": todo["persists_frozen_preview"] is True
            and todo["creates_target_before_confirmation"] is False
            and todo["requires_explicit_confirmation"] is True,
        },
        {
            "case": "confirmation_reauthorizes_and_rechecks_current_evidence",
            "passed": todo["reauthorizes_on_confirmation"] is True
            and todo["rechecks_current_evidence_basis"] is True,
        },
        {
            "case": "communication_promotion_has_no_delivery_or_tool_capability",
            "passed": communication["delivery_mode"] == "manual_only"
            and communication["outbound_delivery"] is False
            and communication["sends_messages"] is False
            and communication["executes_tools"] is False,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _question_remediation_execution_safety_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Execution tracking stays manual, evidence-gated, and non-resolving."""

    contract = build_remediation_execution_contract()
    details = [
        {
            "case": "manual_send_is_attestation_without_aria_delivery",
            "passed": contract["manual_send_is_user_attestation"] is True
            and contract["delivered_by_aria"] is False
            and contract["outbound_delivery"] is False,
        },
        {
            "case": "execution_completion_requires_project_scoped_evidence",
            "passed": contract["completion_requires_evidence"] is True
            and contract["evidence_is_project_scoped"] is True
            and contract["evidence_events_are_append_only"] is True,
        },
        {
            "case": "execution_cannot_send_execute_or_resolve_question",
            "passed": contract["sends_messages"] is False
            and contract["executes_tools"] is False
            and contract["automatically_resolves_question"] is False,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _question_remediation_evidence_review_safety_results() -> tuple[
    int, int, list[dict[str, Any]]
]:
    """Human evidence acceptance stays bounded, reversible, and non-agentic."""

    contract = build_remediation_evidence_review_contract()
    details = [
        {
            "case": "evidence_acceptance_is_human_judgment_not_truth_or_memory",
            "passed": contract["human_judgment_only"] is True
            and contract["acceptance_is_truth_verdict"] is False
            and contract["writes_long_term_memory"] is False,
        },
        {
            "case": "evidence_review_cannot_fetch_send_execute_or_resolve",
            "passed": contract["fetches_external_references"] is False
            and contract["sends_messages"] is False
            and contract["executes_tools"] is False
            and contract["automatically_resolves_question"] is False,
        },
        {
            "case": "evidence_review_reauthorizes_uses_cas_and_appends_audit",
            "passed": contract["reauthorizes_on_decision"] is True
            and contract["uses_optimistic_revision"] is True
            and contract["events_are_append_only"] is True,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _question_reanswer_grounding_safety_results() -> tuple[
    int, int, list[dict[str, Any]]
]:
    """A re-answer stays source-bound, answer-only, and citation-exact."""

    question = "客户是否确认了最终验收范围？"
    question_identity = project_question_sha256(question)
    contract = build_project_question_reanswer_contract()
    manifest = build_project_question_reanswer_manifest(
        project_id=26,
        question_sha256=question_identity,
        entries=[
            {
                "attachment_id": 51,
                "evidence_id": f"remediation_attachment_{'a' * 64}",
                "evidence_sha256": "a" * 64,
                "evidence_kind": "manual_note",
                "title": "客户回复人工核对记录",
                "support_level": "review_required",
                "review_status": "accepted",
                "review_revision": 2,
                "source_content_sha256": "b" * 64,
            }
        ],
    )
    cited, references = resolve_project_question_reanswer_citations(
        manifest,
        "人工记录支持这一有限表述。[A1] 无效键不会成为证据。[A9]",
    )
    uncited, uncited_references = resolve_project_question_reanswer_citations(
        manifest,
        "这段回答没有证据引用。",
    )
    valid, reason = validate_project_question_reanswer_manifest(cited)
    current_source = {
        (
            "remediation_attachment",
            "a" * 64,
            51,
            2,
        ): {
            "source_type": "remediation_attachment",
            "support_level": "review_required",
            "review_status": "accepted",
        }
    }
    aligned = assess_project_question_answer(
        question=question,
        answer="客户对验收范围提供了回复，但仍须人工确认。[A1]",
        metadata={"project_question_reanswer_evidence": cited},
        project_id=26,
        question_source_map=current_source,
    )
    cross_question = assess_project_question_answer(
        question="项目预算是否获批？",
        answer="项目预算获批。[A1]",
        metadata={"project_question_reanswer_evidence": cited},
        project_id=26,
        question_source_map=current_source,
    )
    details = [
        {
            "case": "reanswer_contract_is_answer_only_and_non_agentic",
            "passed": contract["answer_only"] is True
            and contract["mutates_historical_messages"] is False
            and contract["writes_long_term_memory"] is False
            and contract["fetches_external_references"] is False
            and contract["executes_tools"] is False
            and contract["automatically_resolves_question"] is False,
        },
        {
            "case": "only_emitted_exact_attachment_citations_are_persisted",
            "passed": valid
            and reason == ""
            and cited["status"] == "partial"
            and cited["invalid_citation_keys"] == ["A9"]
            and [item["citation_key"] for item in references] == ["A1"],
        },
        {
            "case": "uncited_available_evidence_never_becomes_a_reference",
            "passed": uncited["status"] == "uncited"
            and uncited["cited_evidence_ids"] == []
            and uncited_references == [],
        },
        {
            "case": "answer_alignment_is_bound_to_the_exact_project_question",
            "passed": aligned["evidence"]["remediation_aligned_count"] == 1
            and aligned["is_correctness_verdict"] is False
            and cross_question["evidence"]["remediation_aligned_count"] == 0
            and cross_question["evidence"]["invalid_citation_count"] == 1,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _question_answer_adoption_safety_results() -> tuple[
    int, int, list[dict[str, Any]]
]:
    """Answer adoption stays explicit, snapshot-bound, and audit-readable."""

    contract = build_project_question_answer_adoption_contract()
    audit = {
        "schema_version": 1,
        "snapshot_sha256": "a" * 64,
        "domain": "aria.project-question-answer-adoption.v1",
        "project_id": 26,
        "question_sha256": "b" * 64,
        "memory_version": 4,
        "slot_version": 2,
        "answer_message_id": 91,
        "answer_conversation_id": 13,
        "answer_content_sha256": "c" * 64,
        "resolution_summary_sha256": "d" * 64,
        "evidence_identity_fingerprint": "e" * 64,
        "attachment_evidence_identity_fingerprint": "f" * 64,
        "assessment": {
            "readiness_score": 86,
            "readiness_band": "strong",
            "warnings": [],
            "requires_human_confirmation": True,
            "is_correctness_verdict": False,
        },
    }
    note = encode_project_question_resolution_event_note("人工核对后采用。", audit)
    parsed = parse_project_question_resolution_event_note(note)
    tampered = json.loads(note)
    tampered["answer_adoption"]["answer_content_sha256"] = "invalid"
    rejected = parse_project_question_resolution_event_note(
        json.dumps(tampered, ensure_ascii=False)
    )
    details = [
        {
            "case": "answer_adoption_preview_never_resolves_without_confirmation",
            "passed": contract["preview_resolves_question"] is False
            and contract["requires_explicit_confirmation"] is True
            and contract["confirmation_resolves_question"] is True,
        },
        {
            "case": "answer_adoption_reauthorizes_and_rechecks_item_and_evidence",
            "passed": contract["reauthorizes_on_confirmation"] is True
            and contract["rechecks_current_question"] is True
            and contract["rechecks_answer_content"] is True
            and contract["rechecks_current_evidence_basis"] is True
            and contract["mutates_historical_messages"] is False,
        },
        {
            "case": "answer_adoption_audit_rejects_invalid_content_bindings",
            "passed": parsed["resolution_summary"] == "人工核对后采用。"
            and parsed["answer_adoption"]["answer_message_id"] == 91
            and rejected["answer_adoption"] is None,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _skill_runtime_contract_results() -> tuple[int, int, list[dict[str, Any]]]:
    skill = SimpleNamespace(
        builtin_key="proposal",
        package_version="2.0.0",
        package_status="stable",
        package_sha256="e" * 64,
        tools_definition_json='[{"name":"read"},{"name":"write"}]',
        system_prompt=(
            "# Proposal\n\n---\n\n"
            "## Bundled Reference: references/quality-checklist.md\n\n"
            "# Quality Checklist\n- [ ] Evidence\n- [ ] Review"
        ),
    )
    contract = build_skill_runtime_contract(
        skill,
        release_id=7,
        granted_tools=[{"name": "read"}],
    )
    rendered = format_skill_runtime_contract_for_prompt(contract)
    compacted = finalize_skill_runtime_contract(
        contract,
        instruction_complete=False,
    )
    degraded = build_skill_runtime_contract(
        SimpleNamespace(
            builtin_key="",
            package_version="",
            package_status="preview",
            package_sha256="",
            tools_definition_json="invalid",
            system_prompt="",
        )
    )
    details = [
        {
            "case": "skill_runtime_binds_exact_release_and_loaded_resources",
            "passed": contract["release_id"] == "7"
            and contract["release_sha256"] == "e" * 64
            and contract["resource_names"]
            == ["references/quality-checklist.md"],
        },
        {
            "case": "skill_runtime_intersects_tools_with_aria_policy",
            "passed": contract["declared_tool_count"] == 2
            and contract["granted_tool_count"] == 1
            and contract["policy_filtered_tool_count"] == 1,
        },
        {
            "case": "skill_runtime_never_authorizes_package_scripts",
            "passed": contract["scripts_executable"] is False
            and "Package scripts are never executable" in rendered,
        },
        {
            "case": "skill_runtime_surfaces_verification_and_degraded_loads",
            "passed": contract["verification_status"] == "available"
            and contract["verification_step_count"] == 2
            and len(contract["verification_plan_sha256"]) == 64
            and skill_runtime_contract_warnings(degraded)
            == [
                "skill_instructions_missing",
                "skill_tool_contract_invalid",
                "skill_verification_not_declared",
            ],
        },
        {
            "case": "skill_runtime_prompt_boundary_excludes_release_fingerprint",
            "passed": "e" * 64 not in rendered
            and "quality-checklist.md" not in rendered
            and "tool_input" not in rendered
            and compacted["load_status"] == "compacted"
            and compacted["verification_context_complete"] is False
            and "skill_instructions_compacted"
            in skill_runtime_contract_warnings(compacted),
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _artifact_verification_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Artifact claims must stay byte-bound, bounded, and automation-honest."""

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        text_path = root / "delivery.txt"
        text_path.write_text("deterministic delivery", encoding="utf-8")
        text_digest = hashlib.sha256(text_path.read_bytes()).hexdigest()
        passed = build_artifact_verification_evidence(
            text_path,
            file_type="txt",
            expected_content_sha256=text_digest,
        )
        manual = build_artifact_verification_evidence(
            text_path,
            file_type="txt",
            expected_content_sha256=text_digest,
            skill_runtime_contract={
                "verification_status": "available",
                "verification_context_complete": True,
                "verification_step_count": 3,
                "verification_plan_sha256": "a" * 64,
                "release_sha256": "b" * 64,
            },
        )
        partial = build_artifact_verification_evidence(
            text_path,
            file_type="txt",
            expected_content_sha256=text_digest,
            skill_runtime_contract={
                "verification_status": "available",
                "verification_context_complete": False,
                "verification_step_count": 3,
            },
        )
        json_path = root / "delivery.json"
        json_path.write_text('{"incomplete":', encoding="utf-8")
        failed = build_artifact_verification_evidence(
            json_path,
            file_type="json",
            expected_content_sha256=hashlib.sha256(json_path.read_bytes()).hexdigest(),
        )
        serialized = json.dumps([passed, manual, partial, failed], ensure_ascii=False)
    details = [
        {
            "case": "artifact_verification_binds_exact_file_bytes",
            "passed": passed["status"] == "passed"
            and passed["content_sha256"] == text_digest,
        },
        {
            "case": "artifact_verification_fails_invalid_known_formats",
            "passed": failed["status"] == "failed"
            and failed["technical_status"] == "failed",
        },
        {
            "case": "artifact_verification_keeps_skill_checks_manual",
            "passed": manual["status"] == "manual_required"
            and manual["skill_status"] == "manual_required"
            and manual["skill_check_count"] == 3
            and manual["skill_release_sha256"] == "b" * 64,
        },
        {
            "case": "artifact_verification_discloses_compacted_skill_context",
            "passed": partial["status"] == "partial"
            and partial["skill_status"] == "context_incomplete",
        },
        {
            "case": "artifact_verification_evidence_excludes_paths_and_content",
            "passed": str(root) not in serialized
            and "deterministic delivery" not in serialized,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _artifact_acceptance_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Delivery sign-off must be bounded, fail-closed, and auditable."""

    contract = build_artifact_acceptance_contract()
    registry = registered_artifact_business_verifiers()
    deterministic = run_registered_artifact_business_verifiers(
        {"metrics": {"slide_count": 12}},
        [{"verifier_id": "min_slide_count", "expected_min": 10}],
    )
    blocked = run_registered_artifact_business_verifiers(
        {"metrics": {"slide_count": 12}},
        [{"verifier_id": "run_skill_script", "expected_min": 1}],
    )
    details = [
        {
            "case": "artifact_acceptance_cannot_override_failed_or_partial_evidence",
            "passed": contract["failed_or_partial_evidence_can_be_accepted"] is False,
        },
        {
            "case": "artifact_acceptance_uses_revisioned_append_only_human_audit",
            "passed": contract["uses_optimistic_revision"] is True
            and contract["events_are_append_only"] is True
            and contract["human_judgment_only"] is True
            and contract["acceptance_is_truth_verdict"] is False,
        },
        {
            "case": "artifact_business_registry_runs_bounded_declarative_rules",
            "passed": registry["execution_boundary"]
            == "aria_owned_declarative_rules_only"
            and deterministic["status"] == "passed"
            and deterministic["passed_count"] == 1,
        },
        {
            "case": "artifact_business_registry_rejects_package_execution",
            "passed": registry["skill_package_code_executable"] is False
            and contract["executes_skill_package_code"] is False
            and blocked["status"] == "partial"
            and blocked["checks"][0]["code"] == "verifier_not_registered",
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _skill_deliverable_contract_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Selected outputs must remain release-bound and action-safe."""

    skill = SimpleNamespace(
        id=17,
        name="Digital Strategy",
        package_version="2.1.0",
        package_sha256="d" * 64,
        system_prompt=(
            "# Digital Strategy\n\n"
            "### Deliverable Catalog\n"
            "| Deliverable | When to use | Minimum content | Format |\n"
            "|---|---|---|---|\n"
            "| Executive deck | Board decision | Options and recommendation | PPTX / PDF |\n"
            "| Action tracker | During execution | Owner, date, status | Excel workbook |"
        ),
    )
    catalog = build_skill_deliverable_catalog(skill)
    item = catalog["items"][0]
    selection = {
        "deliverable_id": item["deliverable_id"],
        "catalog_sha256": catalog["catalog_sha256"],
        "contract_sha256": item["contract_sha256"],
    }
    resolved = resolve_selected_skill_deliverable(skill, selection)
    reference = skill_deliverable_reference(resolved)
    rendered = format_skill_deliverable_for_prompt(resolved)
    stale_rejected = False
    try:
        resolve_selected_skill_deliverable(
            skill,
            {**selection, "catalog_sha256": "e" * 64},
        )
    except Exception as error:
        stale_rejected = int(getattr(error, "status_code", 0)) == 409
    details = [
        {
            "case": "skill_deliverable_catalog_has_stable_item_and_catalog_hashes",
            "passed": catalog["item_count"] == 2
            and len(catalog["catalog_sha256"]) == 64
            and all(len(candidate["contract_sha256"]) == 64 for candidate in catalog["items"]),
        },
        {
            "case": "skill_deliverable_selection_binds_exact_release",
            "passed": reference["deliverable_id"] == item["deliverable_id"]
            and reference["skill_release_sha256"] == "d" * 64,
        },
        {
            "case": "skill_deliverable_rejects_stale_catalog",
            "passed": stale_rejected,
        },
        {
            "case": "skill_deliverable_prompt_forbids_silent_switch",
            "passed": "Do not silently switch" in rendered,
        },
        {
            "case": "skill_deliverable_does_not_imply_archive_or_delivery_authority",
            "passed": "remain separate Aria-authorized actions" in rendered
            and resolved["memory_policy"] == "explicit_user_confirmation",
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _skill_deliverable_business_verifier_results() -> tuple[
    int, int, list[dict[str, Any]]
]:
    """Format-derived structural checks stay bounded and fail closed."""

    requirements = default_deliverable_business_verifiers(["pptx", "pdf"])
    passed = run_registered_artifact_business_verifiers(
        {"metrics": {"slide_count": 4}},
        requirements,
        file_type="pptx",
    )
    failed = run_registered_artifact_business_verifiers(
        {"metrics": {"slide_count": 2}},
        requirements,
        file_type="pptx",
    )
    unsupported = run_registered_artifact_business_verifiers(
        {"metrics": {}},
        requirements,
        file_type="docx",
    )
    details = [
        {
            "case": "deliverable_formats_map_to_aria_owned_structural_rules",
            "passed": requirements
            == [
                {"verifier_id": "min_slide_count", "expected_min": 3},
                {"verifier_id": "min_page_count", "expected_min": 1},
            ],
        },
        {
            "case": "multi_format_contract_runs_only_the_actual_file_type_rule",
            "passed": passed["status"] == "passed"
            and passed["passed_count"] == 1
            and passed["not_applicable_count"] == 1,
        },
        {
            "case": "structural_threshold_failure_blocks_delivery",
            "passed": failed["status"] == "failed"
            and failed["failed_count"] == 1,
        },
        {
            "case": "unmatched_artifact_type_fails_closed_without_code_execution",
            "passed": unsupported["status"] == "partial"
            and unsupported["checks"][0]["code"]
            == "artifact_file_type_not_configured",
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _conversation_trace_diagnostic_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Long-history budgeting and user-facing diagnostics stay safe and exact."""

    candidates = [SimpleNamespace(id=index + 1) for index in range(48)]
    full_history = _history_for_model(candidates, ChatMode.PROJECT_DEEP_DIVE)
    recent_history = _history_for_model(candidates, ChatMode.WORKSPACE_INVENTORY)
    task_history = _history_for_model(candidates, ChatMode.TASK_ORCHESTRATION)
    private_messages = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"PRIVATE-HISTORY-{index} " + ("detail " * 600),
        }
        for index in range(20)
    ]
    assembly = assemble_context(
        system="PRIVATE-SYSTEM " + ("policy " * 600),
        messages=private_messages,
        tools=None,
        sources=[],
        context_window_tokens=4_096,
        max_output_tokens=512,
        history_summary_tokens=256,
    )
    trace = ChatTrace(
        trace_id="trace_quality_safe",
        conversation_id=1,
        message_id=2,
        chat_mode="project_deep_dive",
        action_policy="read_only_tool",
        intent_method="llm_guarded",
        intent_reason="PRIVATE user content was repeated here",
        model_used="quality-model",
        metadata_json=json.dumps(
            {
                "context_manifest": assembly.manifest,
                "prepare_metrics": {"user_goal": "PRIVATE-GOAL"},
            }
        ),
        tool_decisions_json=json.dumps(
            [{"status": "blocked", "input": {"secret": "PRIVATE-TOOL"}}]
        ),
        fallback_events_json=json.dumps(
            [{"type": "tool_blocked", "reason": "PRIVATE-FALLBACK"}]
        ),
    )
    diagnostic = build_chat_trace_diagnostic(trace)
    diagnostic_json = json.dumps(diagnostic, ensure_ascii=False, default=str)
    budget = assembly.budget_report
    details = [
        {
            "case": "full_history_mode_exposes_more_than_legacy_24_candidates_to_budgeting",
            "passed": len(full_history) == 48,
        },
        {
            "case": "mode_registry_enforces_recent_and_none_history_strategies",
            "passed": len(recent_history) == 6 and task_history == [],
        },
        {
            "case": "overflow_history_has_auditable_bounded_compaction_decision",
            "passed": budget.compacted
            and budget.compaction_strategy == "recent_turns_with_bounded_excerpts"
            and budget.summary_injected
            and budget.summarized_messages > 0
            and budget.estimated_total_after
            <= budget.context_window_tokens - budget.safety_margin_tokens,
        },
        {
            "case": "trace_diagnostic_explains_counts_without_private_runtime_content",
            "passed": diagnostic["context"]["manifest_valid"]
            and diagnostic["context"]["history_compacted"]
            and diagnostic["routing"]["intent_reason"]
            == "router_explanation_withheld"
            and diagnostic["execution"]["tool_status_counts"].get("blocked") == 1
            and "PRIVATE" not in diagnostic_json,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _runtime_configuration_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Mode, prompt, and tool permission configuration stays one safe contract."""

    report = assert_chat_runtime_configuration(tool_registry.list_tools())
    standalone_model, standalone_tokens = _resolve_runtime_model_and_tokens(
        SimpleNamespace(
            content="hello",
            project_id=None,
            rag_doc_ids=[],
            file_ids=[],
        ),
        "kimi-k2.6",
        8192,
        None,
        chat_mode=ChatMode.STANDALONE_QA,
    )
    portfolio_model, portfolio_tokens = _resolve_runtime_model_and_tokens(
        SimpleNamespace(
            content="portfolio",
            project_id=1,
            rag_doc_ids=[],
            file_ids=[],
        ),
        "deepseek-v4-pro",
        8192,
        None,
        has_deepseek_api_key=True,
        chat_mode=ChatMode.CROSS_PROJECT_PORTFOLIO,
    )
    candidate_tools = [
        {"name": "read_project_file"},
        {"name": "generate_ppt"},
        {"name": "unknown_dynamic_tool"},
    ]
    standalone_tools = filter_tools_for_mode(candidate_tools, ChatMode.STANDALONE_QA)
    skill_tools = filter_tools_for_mode(candidate_tools, ChatMode.SKILL_EXECUTION)
    prompt_manifest = build_prompt_layer_manifest(
        skill_prompt="PRIVATE-SKILL",
        rag_context="PRIVATE-KNOWLEDGE",
        project_context="PRIVATE-PROJECT",
        chat_mode=ChatMode.SKILL_EXECUTION,
        runtime_fragment_paths=("frames/turn_contract.md",),
    )
    prompt_manifest_json = json.dumps(prompt_manifest, ensure_ascii=False)
    details = [
        {
            "case": "all_chat_modes_and_registered_tools_have_valid_central_config",
            "passed": report["valid"]
            and report["mode_count"] == 6
            and report["tool_count"] == 17,
        },
        {
            "case": "mode_registry_drives_fast_model_and_token_caps",
            "passed": standalone_model == "moonshot-v1-8k"
            and standalone_tokens == 1536
            and portfolio_model == "deepseek-v4-flash"
            and portfolio_tokens == 4096,
        },
        {
            "case": "mode_tool_boundary_blocks_undeclared_and_unknown_tools",
            "passed": standalone_tools == []
            and [tool["name"] for tool in skill_tools or []]
            == ["read_project_file", "generate_ppt"],
        },
        {
            "case": "file_backed_prompt_manifest_is_hash_only",
            "passed": prompt_manifest["layer_count"] == 7
            and len(prompt_manifest["manifest_sha256"]) == 64
            and "PRIVATE" not in prompt_manifest_json,
        },
    ]
    return sum(int(item["passed"]) for item in details), len(details), details


def _grounded_answer_contract_results() -> tuple[int, int, list[dict[str, Any]]]:
    """Grounded answers preserve coverage, citations, and source authority."""

    financial_case = {
        "id": "financial_dimensions",
        "evidence": (
            ("E1", "合同总额 120 万元，未收款 40 万元。"),
            ("E2", "下一笔款项于 2026-09-15 到期。"),
        ),
        "claims": (
            {"variants": ("合同总额120万元",), "citation": "E1"},
            {"variants": ("未收款40万元",), "citation": "E1"},
            {"variants": ("2026-09-15",), "citation": "E2"},
        ),
        "forbidden": (),
    }
    complete_financial = grade_grounded_answer(
        financial_case,
        "- 合同总额 120 万元 [E1]\n"
        "- 未收款 40 万元 [E1]\n"
        "- 下一笔款项于 2026-09-15 到期 [E2]",
    )
    incomplete_financial = grade_grounded_answer(
        financial_case,
        "- 合同总额 120 万元 [E1]\n"
        "- 下一笔款项于 2026-09-15 到期 [E2]",
    )

    priority_case = {
        "id": "current_direct_priority",
        "evidence": (
            ("E1", "[STALE][PROVENANCE:SCOPED] 旧记忆记录每周一召开。"),
            ("E2", "[CURRENT][PROVENANCE:DIRECT] 从 2026-09-01 起改为每周五。"),
        ),
        "claims": (
            {"variants": ("每周五",), "citation": "E2"},
            {"variants": ("2026-09-01",), "citation": "E2"},
        ),
        "forbidden": ("当前每周一",),
    }
    current_direct = grade_grounded_answer(
        priority_case,
        "- 当前每周五召开 [E2]\n- 从 2026-09-01 起生效 [E2]",
    )

    unresolved_case = {
        "id": "unresolved_provenance",
        "evidence": (("E1", "[PROVENANCE:UNRESOLVED] 预算上限 300 万元。"),),
        "claims": (
            {
                "variants": ("未得到可靠来源确认",),
                "citation": "E1",
            },
        ),
        "must_abstain": True,
        "forbidden": ("预算上限已确认",),
    }
    unresolved = grade_grounded_answer(
        unresolved_case,
        "- 预算上限未得到可靠来源确认，无法作为已核验事实 [E1]",
    )

    details = [
        {
            "case": "multi_dimension_answer_requires_every_requested_fact_and_citation",
            "passed": complete_financial["present_claim_count"] == 3
            and complete_financial["correctly_cited_claim_count"] == 3,
        },
        {
            "case": "one_omitted_dimension_is_detected_even_when_adjacent_facts_are_correct",
            "passed": incomplete_financial["present_claim_count"] == 2
            and incomplete_financial["correctly_cited_claim_count"] == 2
            and incomplete_financial["required_claim_count"] == 3,
        },
        {
            "case": "current_direct_evidence_displaces_stale_scoped_memory",
            "passed": current_direct["present_claim_count"] == 2
            and current_direct["correctly_cited_claim_count"] == 2
            and not current_direct["forbidden_hits"],
        },
        {
            "case": "unresolved_memory_requires_qualification_and_abstention",
            "passed": unresolved["correctly_cited_claim_count"] == 1
            and unresolved["passed_abstention"]
            and not unresolved["forbidden_hits"],
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
        "skill_runtime_contract_accuracy": _skill_runtime_contract_results(),
        "artifact_verification_accuracy": _artifact_verification_results(),
        "artifact_acceptance_safety_rate": _artifact_acceptance_results(),
        "skill_deliverable_contract_accuracy": _skill_deliverable_contract_results(),
        "skill_deliverable_business_verifier_accuracy": (
            _skill_deliverable_business_verifier_results()
        ),
        "conversation_trace_diagnostic_safety_rate": (
            _conversation_trace_diagnostic_results()
        ),
        "chat_runtime_configuration_integrity_rate": (
            _runtime_configuration_results()
        ),
        "grounded_answer_contract_accuracy": _grounded_answer_contract_results(),
        "memory_rebuild_planning_accuracy": _memory_rebuild_planning_results(),
        "memory_direct_source_accuracy": _memory_direct_source_results(),
        "question_answer_readiness_accuracy": _question_answer_readiness_results(),
        "question_remediation_safety_rate": _question_remediation_safety_results(),
        "question_remediation_promotion_safety_rate": (
            _question_remediation_promotion_safety_results()
        ),
        "question_remediation_execution_safety_rate": (
            _question_remediation_execution_safety_results()
        ),
        "question_remediation_evidence_review_safety_rate": (
            _question_remediation_evidence_review_safety_results()
        ),
        "question_reanswer_grounding_safety_rate": (
            _question_reanswer_grounding_safety_results()
        ),
        "question_answer_adoption_safety_rate": (
            _question_answer_adoption_safety_results()
        ),
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
