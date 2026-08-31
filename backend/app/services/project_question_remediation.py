"""Deterministic, side-effect-free remediation plans for question evidence gaps.

The plan is a draft projection over the current question evidence review.  It
does not persist project state, send a message, invoke a tool, or claim that a
gap has been closed.  A project member must edit and explicitly carry out any
suggested action through Aria's normal authorization and HITAS boundaries.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from sqlmodel import Session

from app.models.db import Project
from app.services.project_question_evidence import (
    build_project_question_evidence_review,
)


QUESTION_REMEDIATION_SCHEMA_VERSION = 1
MAX_REMEDIATION_GAPS = 8
MAX_REMEDIATION_ACTIONS = 6
MAX_DRAFT_CHARS = 600

_CONFIRMATION_PATTERN = re.compile(
    r"(?:是否|确认|批准|同意|签署|验收|confirm|approve|agree|sign)",
    re.IGNORECASE,
)
_TIMING_PATTERN = re.compile(
    r"(?:何时|时间|日期|截止|完成|交付|when|date|deadline|timing)",
    re.IGNORECASE,
)
_AMOUNT_PATTERN = re.compile(
    r"(?:多少|金额|预算|比例|数量|回款|付款|how much|amount|budget|ratio|payment)",
    re.IGNORECASE,
)
_OWNERSHIP_PATTERN = re.compile(
    r"(?:谁|负责人|主责|归属|职责|who|owner|responsib)",
    re.IGNORECASE,
)

_WARNING_GAPS = {
    "LOW_QUESTION_RELEVANCE": (
        "warning",
        "历史回答与问题相关性不足",
        "当前候选回答可能在回答其他议题，不应直接用于关单。",
    ),
    "NO_PERSISTED_EVIDENCE": (
        "blocking",
        "历史回答缺少持久化证据",
        "无法对历史回答的依据进行稳定复核。",
    ),
    "AVAILABLE_EVIDENCE_NOT_CITED": (
        "warning",
        "可用证据未被回答引用",
        "回答生成时有证据上下文，但没有形成可核对的引用关系。",
    ),
    "INVALID_CITATIONS": (
        "blocking",
        "历史引用契约无效",
        "引用 manifest 无法通过完整性校验，必须重新核对原始来源。",
    ),
    "EVIDENCE_NOT_ALIGNED_WITH_CURRENT_QUESTION": (
        "blocking",
        "历史引用未对齐当前问题证据",
        "历史引用与当前重新召回的项目证据没有稳定交集。",
    ),
    "CURRENT_QUESTION_EVIDENCE_UNAVAILABLE": (
        "blocking",
        "当前问题证据池不可用",
        "暂时无法确认历史引用是否仍适用于当前项目状态。",
    ),
    "WEAK_CURRENT_PROVENANCE": (
        "blocking",
        "当前证据溯源强度不足",
        "当前对齐来源主要是范围性或未解析记忆，不足以单独支持结论。",
    ),
    "RUN_EVALUATION_NOT_COMPLETED": (
        "warning",
        "历史回答运行质量未通过",
        "候选回答的运行评估失败或无效，需要人工复查生成过程。",
    ),
    "ANSWER_MARKED_UNHELPFUL": (
        "warning",
        "历史回答曾被标记为无帮助",
        "负向反馈不能单独证伪结论，但应触发额外人工复核。",
    ),
}


def _bounded(value: Any, limit: int = MAX_DRAFT_CHARS) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def _question_archetype(question: str) -> dict[str, str]:
    if _CONFIRMATION_PATTERN.search(question):
        return {
            "name": "confirmation",
            "evidence_target": "written_confirmation",
            "clarification": (
                f"请确认“{question}”。请明确确认人、确认时间、适用范围，"
                "以及是否存在保留条件。"
            ),
            "request": (
                "请提供可核验的书面确认记录，例如签字文件、邮件或会议决议，"
                "并保留确认主体、时间和范围。"
            ),
            "acceptance": "包含确认主体、时间、适用范围和原始记录定位信息。",
        }
    if _TIMING_PATTERN.search(question):
        return {
            "name": "timing",
            "evidence_target": "dated_record",
            "clarification": (
                f"请就“{question}”确认目标日期、时区、前置条件，"
                "以及该日期是承诺、计划还是预测。"
            ),
            "request": "请提供最新排期、里程碑或带日期的负责人确认记录。",
            "acceptance": "包含日期、时区、负责人、前置条件和状态口径。",
        }
    if _AMOUNT_PATTERN.search(question):
        return {
            "name": "quantitative",
            "evidence_target": "source_system_record",
            "clarification": (
                f"请就“{question}”确认数据口径、币种或单位、截止日期，"
                "以及是已发生数还是预测数。"
            ),
            "request": "请提供来源系统导出、对账表或审批后的数值记录。",
            "acceptance": "包含数值、口径、单位、截止日期和来源系统定位信息。",
        }
    if _OWNERSHIP_PATTERN.search(question):
        return {
            "name": "ownership",
            "evidence_target": "ownership_record",
            "clarification": (
                f"请就“{question}”确认主责人、审批人、交付边界，"
                "以及代理或升级机制。"
            ),
            "request": "请提供最新 RACI、任务分配或负责人书面确认记录。",
            "acceptance": "包含主责人、审批人、责任范围和生效时间。",
        }
    return {
        "name": "general",
        "evidence_target": "primary_source",
        "clarification": (
            f"请就“{question}”确认所需结论的判定标准、时间范围，"
            "以及可以作为最终依据的权威来源。"
        ),
        "request": "请提供能够直接支持该结论的原始文件、系统记录或负责人确认。",
        "acceptance": "包含结论口径、适用时间、负责主体和原始来源定位信息。",
    }


def _evidence_identity_fingerprint(question_evidence: dict[str, Any]) -> str:
    identities: set[str] = set()
    for collection_name in ("memory", "knowledge"):
        collection = question_evidence.get(collection_name)
        collection = collection if isinstance(collection, dict) else {}
        for source in list(collection.get("sources") or []):
            if not isinstance(source, dict):
                continue
            evidence_id = _bounded(source.get("evidence_id"), 160)
            if not evidence_id:
                continue
            source_type = _bounded(source.get("source_type"), 40)
            identities.add(f"{source_type}:{evidence_id}")
    return hashlib.sha256(
        json.dumps(sorted(identities), ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()


def _add_gap(
    gaps: list[dict[str, Any]],
    seen: set[str],
    *,
    code: str,
    severity: str,
    title: str,
    detail: str,
) -> None:
    if code in seen or len(gaps) >= MAX_REMEDIATION_GAPS:
        return
    seen.add(code)
    gaps.append(
        {
            "code": code,
            "severity": severity,
            "title": title,
            "detail": detail,
        }
    )


def _action(
    *,
    kind: str,
    title: str,
    draft: str,
    rationale: str,
    suggested_owner_role: str,
    blocking: bool,
    acceptance_criteria: str,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "title": _bounded(title, 120),
        "draft": _bounded(draft),
        "rationale": _bounded(rationale, 280),
        "suggested_owner_role": suggested_owner_role,
        "suggested_channel": "manual",
        "blocking": blocking,
        "acceptance_criteria": _bounded(acceptance_criteria, 280),
        "editable_fields": ["title", "draft", "owner_user_id"],
        "execution_mode": "manual_only",
    }


def build_question_evidence_remediation_plan(
    review: dict[str, Any],
) -> dict[str, Any]:
    """Project a bounded remediation draft from a current evidence review."""

    question = _bounded(review.get("question"), 360)
    identity = str(review.get("question_sha256") or "")
    project_id = int(review.get("project_id") or 0)
    question_evidence = review.get("question_evidence")
    question_evidence = question_evidence if isinstance(question_evidence, dict) else {}
    summary = review.get("summary")
    summary = summary if isinstance(summary, dict) else {}
    candidates = [
        item for item in list(review.get("candidates") or []) if isinstance(item, dict)
    ]
    memory = question_evidence.get("memory")
    memory = memory if isinstance(memory, dict) else {}
    bands = summary.get("bands")
    bands = bands if isinstance(bands, dict) else {}

    evidence_status = str(question_evidence.get("status") or "not_available")
    source_count = max(0, int(question_evidence.get("source_count") or 0))
    supporting_source_count = max(
        0, int(question_evidence.get("supporting_source_count") or 0)
    )
    evaluated_count = max(0, int(summary.get("evaluated_candidate_count") or 0))
    strong_count = max(0, int(bands.get("strong") or 0))

    gaps: list[dict[str, Any]] = []
    seen_gaps: set[str] = set()
    if bool(memory.get("memory_stale")):
        _add_gap(
            gaps,
            seen_gaps,
            code="STALE_PROJECT_MEMORY",
            severity="blocking",
            title="项目记忆已陈旧",
            detail="当前问题的记忆依据可能落后于最新项目状态。",
        )
    if evidence_status == "unavailable":
        _add_gap(
            gaps,
            seen_gaps,
            code="CURRENT_EVIDENCE_RETRIEVAL_UNAVAILABLE",
            severity="blocking",
            title="当前证据召回不可用",
            detail="知识或记忆召回失败，不能把空结果解读为项目中没有证据。",
        )
    elif evidence_status == "not_available" or source_count == 0:
        _add_gap(
            gaps,
            seen_gaps,
            code="NO_CURRENT_QUESTION_EVIDENCE",
            severity="blocking",
            title="当前没有问题级证据",
            detail="当前项目知识与记忆未召回到与该问题相关的来源。",
        )
    elif evidence_status == "context_only" or supporting_source_count == 0:
        _add_gap(
            gaps,
            seen_gaps,
            code="CONTEXT_ONLY_EVIDENCE",
            severity="blocking",
            title="当前只有问题上下文",
            detail="开放问题记忆能证明不确定性存在，但不能证明任何候选答案为真。",
        )

    if evaluated_count == 0:
        _add_gap(
            gaps,
            seen_gaps,
            code="NO_PROJECT_ANSWER_CANDIDATE",
            severity="warning",
            title="项目中没有可复核的回答",
            detail="需要先补齐证据，再形成带来源的候选答案。",
        )
    elif strong_count == 0:
        _add_gap(
            gaps,
            seen_gaps,
            code="NO_STRONG_ANSWER_CANDIDATE",
            severity="warning",
            title="尚无证据较强的候选回答",
            detail="现有回答需要补引用、提高相关性或重新核对当前来源。",
        )

    for candidate in candidates[:5]:
        assessment = candidate.get("assessment")
        assessment = assessment if isinstance(assessment, dict) else {}
        for warning in list(assessment.get("warnings") or [])[:8]:
            definition = _WARNING_GAPS.get(str(warning))
            if definition is None:
                continue
            severity, title, detail = definition
            _add_gap(
                gaps,
                seen_gaps,
                code=str(warning),
                severity=severity,
                title=title,
                detail=detail,
            )

    archetype = _question_archetype(question)
    actions: list[dict[str, Any]] = []
    gap_codes = {gap["code"] for gap in gaps}
    blocking_gap = any(gap["severity"] == "blocking" for gap in gaps)
    if "STALE_PROJECT_MEMORY" in gap_codes:
        actions.append(
            _action(
                kind="internal_check",
                title="刷新问题相关的项目记忆",
                draft="先刷新项目记忆与开放问题槽位，然后重新运行问题证据分析。",
                rationale="防止陈旧记忆与最新项目状态冲突。",
                suggested_owner_role="project_owner",
                blocking=True,
                acceptance_criteria="项目记忆状态为 ready，且重新分析后的证据基准指纹已更新。",
            )
        )
    if evidence_status in {"unavailable", "not_available", "context_only"} or supporting_source_count == 0:
        actions.append(
            _action(
                kind="evidence_request",
                title="请求能直接支持结论的原始证据",
                draft=archetype["request"],
                rationale="当前项目证据池不足以支持关单结论。",
                suggested_owner_role="evidence_owner",
                blocking=True,
                acceptance_criteria=archetype["acceptance"],
            )
        )
        actions.append(
            _action(
                kind="clarification_question",
                title="向责任干系人补充关键口径",
                draft=archetype["clarification"],
                rationale="在收集文件前先固定结论口径，避免收集不适用的证据。",
                suggested_owner_role="stakeholder_owner",
                blocking=True,
                acceptance_criteria="问题口径、时间范围、适用边界和确认主体已明确。",
            )
        )
    if gap_codes & {
        "INVALID_CITATIONS",
        "EVIDENCE_NOT_ALIGNED_WITH_CURRENT_QUESTION",
        "CURRENT_QUESTION_EVIDENCE_UNAVAILABLE",
        "WEAK_CURRENT_PROVENANCE",
        "AVAILABLE_EVIDENCE_NOT_CITED",
        "NO_PERSISTED_EVIDENCE",
    }:
        actions.append(
            _action(
                kind="internal_check",
                title="重建候选回答与当前证据的引用链",
                draft="对照当前可访问的项目来源，逐条核对候选回答的关键主张，删除无法定位的引用。",
                rationale="历史引用不能自动继承为当前真值证据。",
                suggested_owner_role="project_analyst",
                blocking=True,
                acceptance_criteria="每个关键主张均能定位到当前可访问来源，且无无效引用。",
            )
        )
    if evaluated_count == 0 or strong_count == 0:
        actions.append(
            _action(
                kind="candidate_review",
                title="在补证后重新形成候选答案",
                draft="使用已核验证据重新回答当前问题，明确区分已证实事实、推断和剩余不确定性。",
                rationale="现有候选回答尚未达到强证据复核条件。",
                suggested_owner_role="project_analyst",
                blocking=False,
                acceptance_criteria="新候选答案与问题直接相关，引用当前来源，并标明剩余不确定性。",
            )
        )
    actions.append(
        _action(
            kind="human_verification",
            title="由项目负责人完成最终人工确认",
            draft="核对补充证据、候选回答和适用范围后，再决定是否采用回答并标记问题已解决。",
            rationale="证据准备度不是正确性裁决，关单仍必须由人承担责任。",
            suggested_owner_role="project_owner",
            blocking=blocking_gap,
            acceptance_criteria="人工确认结论、来源、适用范围和解决摘要，然后通过现有关单流程提交。",
        )
    )
    actions = actions[:MAX_REMEDIATION_ACTIONS]
    for index, item in enumerate(actions, start=1):
        item["action_id"] = f"remediation_{index:02d}"

    status = (
        "evidence_collection_required"
        if blocking_gap
        else "targeted_review_required"
        if gaps
        else "verification_ready"
    )
    basis = {
        "question_sha256": identity,
        "evidence_status": evidence_status,
        "source_count": source_count,
        "supporting_source_count": supporting_source_count,
        "memory_version": max(0, int(memory.get("memory_version") or 0)),
        "memory_stale": bool(memory.get("memory_stale")),
        "evaluated_candidate_count": evaluated_count,
        "strong_candidate_count": strong_count,
        "recommended_message_id": summary.get("recommended_message_id"),
        "gap_codes": [gap["code"] for gap in gaps],
        "evidence_identity_fingerprint": _evidence_identity_fingerprint(
            question_evidence
        ),
    }
    basis_fingerprint = hashlib.sha256(
        json.dumps(basis, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    return {
        "schema_version": QUESTION_REMEDIATION_SCHEMA_VERSION,
        "project_id": project_id,
        "question": question,
        "question_sha256": identity,
        "status": status,
        "question_archetype": archetype["name"],
        "evidence_target": archetype["evidence_target"],
        "basis": {**basis, "fingerprint": basis_fingerprint},
        "gaps": gaps,
        "actions": actions,
        "plan_contract": {
            "name": "deterministic_evidence_gap_remediation",
            "generation_method": "rules_only",
            "persists_changes": False,
            "sends_messages": False,
            "executes_tools": False,
            "requires_human_confirmation": True,
        },
        "privacy": {
            "includes_question_text": True,
            "includes_answer_previews": False,
            "includes_source_titles": False,
            "includes_retrieved_chunk_content": False,
            "includes_prompt_content": False,
            "includes_tool_inputs": False,
            "includes_tool_outputs": False,
            "includes_hidden_reasoning": False,
        },
    }


def build_project_question_remediation_plan(
    session: Session,
    *,
    project: Project,
    question: str,
    question_sha256: str,
) -> dict[str, Any]:
    """Re-retrieve current evidence, then return a non-persisted plan draft."""

    review = build_project_question_evidence_review(
        session,
        project=project,
        question=question,
        question_sha256=question_sha256,
    )
    return build_question_evidence_remediation_plan(review)
