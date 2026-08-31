"""Question-level evidence retrieval and deterministic answer readiness.

This service follows the same immutable-evidence/reconstructed-view boundary
used by Aria's native Run Evaluation and knowledge manifests.  It never asks a
model to grade another model: current project knowledge and memory are recalled
under Aria permissions, then compared with persisted Assistant evidence using
stable identities.  Only bounded previews and source metadata leave the
service; answer text, retrieved chunks, prompts, tool inputs, and hidden
reasoning do not.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Conversation, Message, Project, ProjectQuestionResolution
from app.services.agent_harness.knowledge_evidence import (
    validate_knowledge_evidence_manifest,
)
from app.services.agent_harness.project_memory_evidence import (
    build_project_memory_evidence,
    validate_project_memory_evidence_manifest,
)
from app.services.chat.interaction_feedback import parse_message_metadata
from app.services.context_builder.rag_context import build_rag_context
from app.services.memory_facts import fact_states_by_slot, get_project_memory_fact_states
from app.services.memory_slots import load_project_memory_slot_view
from app.services.project_contexts import get_project_memory_payload
from app.services.project_question_resolutions import (
    normalize_project_question,
    project_question_sha256,
)


logger = logging.getLogger(__name__)

QUESTION_EVIDENCE_SCHEMA_VERSION = 1
MAX_EVALUATED_CANDIDATES = 40
MAX_RETURNED_CANDIDATES = 12
MAX_ALIGNED_SOURCES = 8
MAX_PREVIEW_CHARS = 280
MAX_MATCHED_TERMS = 6

_WORD_PATTERN = re.compile(r"[a-z0-9]+|[\u4e00-\u9fff]+")
_STOP_WORDS = {
    "a", "an", "and", "are", "be", "did", "do", "does", "for", "how",
    "in", "is", "of", "on", "or", "the", "to", "was", "were", "what",
    "when", "where", "which", "who", "why", "with",
}
_STOP_CJK_UNITS = {
    "是否", "什么", "如何", "怎么", "为何", "哪一", "哪些", "多少", "能否",
}
_VALID_RUN_VERDICTS = {"completed", "waiting_confirmation", "failed"}
_VALID_FEEDBACK_REASONS = {
    "inaccurate", "missing_context", "wrong_skill", "wrong_action", "unclear", "incomplete",
}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_score(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return default


def _preview(value: Any) -> str:
    normalized = " ".join(str(value or "").strip().split())
    return normalized[:MAX_PREVIEW_CHARS] or "（该回答没有可显示的文本预览）"


def _text_units(value: str) -> set[str]:
    """Build deterministic English words and Chinese bigrams for recall scoring."""

    units: set[str] = set()
    for token in _WORD_PATTERN.findall(str(value or "").casefold()):
        if token.isascii():
            if len(token) >= 2 and token not in _STOP_WORDS:
                units.add(token)
            continue
        if len(token) == 1:
            units.add(token)
        else:
            units.update(
                unit
                for index in range(len(token) - 1)
                if (unit := token[index : index + 2]) not in _STOP_CJK_UNITS
            )
    return units


def _relevance(question: str, answer: str) -> tuple[int, list[str]]:
    question_units = _text_units(question)
    if not question_units or not str(answer or "").strip():
        return 0, []
    answer_units = _text_units(answer)
    matched = sorted(question_units & answer_units, key=lambda item: (-len(item), item))
    recall = len(matched) / len(question_units)
    return int(round(recall * 100)), matched[:MAX_MATCHED_TERMS]


def _run_projection(metadata: dict[str, Any]) -> tuple[dict[str, Any], int]:
    raw = metadata.get("run_evaluation")
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        return {
            "status": "not_available",
            "verdict": "",
            "score": None,
        }, 50
    verdict = str(raw.get("verdict") or "")
    if verdict not in _VALID_RUN_VERDICTS:
        return {
            "status": "invalid",
            "verdict": "",
            "score": None,
        }, 0
    score = _safe_score(raw.get("score"), 0)
    return {
        "status": "available",
        "verdict": verdict,
        "score": score,
    }, score


def _feedback_projection(metadata: dict[str, Any]) -> tuple[dict[str, Any], int]:
    raw = metadata.get("interaction_feedback")
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        return {"status": "not_available", "rating": "", "reasons": []}, 0
    rating = str(raw.get("rating") or "")
    if rating not in {"helpful", "unhelpful"}:
        return {"status": "invalid", "rating": "", "reasons": []}, 0
    reasons = [
        str(reason)
        for reason in list(raw.get("reasons") or [])[:3]
        if str(reason) in _VALID_FEEDBACK_REASONS
    ]
    return {
        "status": "available",
        "rating": rating,
        "reasons": reasons if rating == "unhelpful" else [],
    }, 5 if rating == "helpful" else -15


def _knowledge_entries(manifest: Any) -> tuple[list[dict[str, Any]], set[str], int]:
    valid, _ = validate_knowledge_evidence_manifest(manifest)
    if not valid:
        return [], set(), int(isinstance(manifest, dict) and bool(manifest))
    entries = [entry for entry in list(manifest.get("entries") or []) if isinstance(entry, dict)]
    cited = {
        str(item)
        for item in list(manifest.get("cited_evidence_ids") or [])
        if str(item)
    }
    invalid = len(list(manifest.get("invalid_citation_keys") or []))
    return entries, cited, invalid


def _memory_entries(
    manifest: Any,
    *,
    project_id: int,
) -> tuple[list[dict[str, Any]], set[str], int]:
    valid, _ = validate_project_memory_evidence_manifest(manifest)
    if not valid or manifest.get("project_id") != project_id:
        return [], set(), int(isinstance(manifest, dict) and bool(manifest))
    entries = [entry for entry in list(manifest.get("entries") or []) if isinstance(entry, dict)]
    cited = {
        str(item)
        for item in list(manifest.get("cited_evidence_ids") or [])
        if str(item)
    }
    invalid = len(list(manifest.get("invalid_citation_keys") or []))
    return entries, cited, invalid


def _candidate_evidence(
    metadata: dict[str, Any],
    *,
    project_id: int,
    question_source_map: dict[tuple[Any, ...], dict[str, Any]],
) -> dict[str, Any]:
    knowledge_entries, knowledge_cited, knowledge_invalid = _knowledge_entries(
        metadata.get("knowledge_evidence")
    )
    memory_entries, memory_cited, memory_invalid = _memory_entries(
        metadata.get("project_memory_evidence"),
        project_id=project_id,
    )
    available_count = len(knowledge_entries) + len(memory_entries)
    cited_entries: list[tuple[tuple[Any, ...], str]] = []
    for entry in knowledge_entries:
        if str(entry.get("evidence_id") or "") in knowledge_cited:
            cited_entries.append((("knowledge", str(entry.get("evidence_id") or "")), "knowledge"))
    for entry in memory_entries:
        if str(entry.get("evidence_id") or "") in memory_cited:
            cited_entries.append(
                (
                    (
                        "memory",
                        str(entry.get("slot") or ""),
                        str(entry.get("content_sha256") or ""),
                    ),
                    "project_memory",
                )
            )

    aligned_sources: list[dict[str, Any]] = []
    seen_source_keys: set[tuple[Any, ...]] = set()
    aligned_count = 0
    verified_aligned_count = 0
    aligned_support_weight = 0.0
    knowledge_cited_count = 0
    memory_cited_count = 0
    for source_key, source_type in cited_entries:
        knowledge_cited_count += int(source_type == "knowledge")
        memory_cited_count += int(source_type == "project_memory")
        current_source = question_source_map.get(source_key)
        if current_source is None:
            continue
        aligned_count += 1
        if current_source.get("source_type") == "knowledge_document":
            support_weight = 1.0
        elif current_source.get("memory_slot") == "open_questions":
            # An open question proves that the uncertainty exists; it cannot
            # prove that a proposed answer is true.
            support_weight = 0.0
        else:
            support_weight = {
                "direct": 1.0,
                "matched": 0.8,
                "scoped": 0.4,
                "legacy": 0.25,
                "unresolved": 0.0,
            }.get(str(current_source.get("provenance_status") or "unresolved"), 0.0)
        aligned_support_weight += support_weight
        verified_aligned_count += int(support_weight >= 0.8)
        if source_key not in seen_source_keys and len(aligned_sources) < MAX_ALIGNED_SOURCES:
            seen_source_keys.add(source_key)
            aligned_sources.append(dict(current_source))

    cited_count = len(cited_entries)
    invalid_count = knowledge_invalid + memory_invalid
    question_pool_count = len(question_source_map)
    alignment_rate = (
        round(aligned_count / cited_count, 4)
        if cited_count and question_pool_count
        else None
    )
    support_rate = (
        round(aligned_support_weight / cited_count, 4)
        if cited_count and question_pool_count
        else None
    )
    if invalid_count:
        status = "invalid"
    elif cited_count:
        status = "cited"
    elif available_count:
        status = "uncited"
    else:
        status = "not_available"

    if not cited_count or invalid_count:
        evidence_score = 0
    else:
        alignment = support_rate if support_rate is not None else 0.5
        # One well-aligned citation can be sufficient.  Reward the proportion
        # aligned with the question's current evidence pool, not citation
        # volume, so repeated references cannot inflate readiness.
        evidence_score = int(round((0.5 + 0.5 * alignment) * 100))
    return {
        "status": status,
        "score": evidence_score,
        "available_count": available_count,
        "cited_count": cited_count,
        "knowledge_cited_count": knowledge_cited_count,
        "memory_cited_count": memory_cited_count,
        "invalid_citation_count": invalid_count,
        "current_question_source_count": question_pool_count,
        "question_aligned_count": aligned_count,
        "verified_aligned_count": verified_aligned_count,
        "alignment_rate": alignment_rate,
        "support_rate": support_rate,
        "sources": aligned_sources,
    }


def assess_project_question_answer(
    *,
    question: str,
    answer: str,
    metadata: dict[str, Any] | str | None,
    project_id: int,
    question_source_map: dict[tuple[Any, ...], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a deterministic selection-readiness score, never a truth verdict."""

    parsed_metadata = parse_message_metadata(metadata)
    relevance_score, matched_terms = _relevance(question, answer)
    evidence = _candidate_evidence(
        parsed_metadata,
        project_id=project_id,
        question_source_map=question_source_map or {},
    )
    run, run_score = _run_projection(parsed_metadata)
    feedback, feedback_adjustment = _feedback_projection(parsed_metadata)
    readiness_score = _safe_score(
        relevance_score * 0.50
        + int(evidence["score"]) * 0.35
        + run_score * 0.15
        + feedback_adjustment
    )

    warnings: list[str] = []
    if relevance_score < 45:
        warnings.append("LOW_QUESTION_RELEVANCE")
    if evidence["status"] == "not_available":
        warnings.append("NO_PERSISTED_EVIDENCE")
    elif evidence["status"] == "uncited":
        warnings.append("AVAILABLE_EVIDENCE_NOT_CITED")
    if evidence["invalid_citation_count"]:
        warnings.append("INVALID_CITATIONS")
    if (
        evidence["cited_count"]
        and evidence["alignment_rate"] is not None
        and evidence["question_aligned_count"] == 0
    ):
        warnings.append("EVIDENCE_NOT_ALIGNED_WITH_CURRENT_QUESTION")
    elif evidence["cited_count"] and evidence["current_question_source_count"] == 0:
        warnings.append("CURRENT_QUESTION_EVIDENCE_UNAVAILABLE")
    elif (
        evidence["question_aligned_count"]
        and evidence["support_rate"] is not None
        and evidence["support_rate"] < 0.6
    ):
        warnings.append("WEAK_CURRENT_PROVENANCE")
    if run["verdict"] == "failed" or run["status"] == "invalid":
        warnings.append("RUN_EVALUATION_NOT_COMPLETED")
    if feedback["rating"] == "unhelpful":
        warnings.append("ANSWER_MARKED_UNHELPFUL")

    answer_present = bool(str(answer or "").strip())
    if not answer_present:
        band = "unrated"
    elif (
        readiness_score >= 75
        and relevance_score >= 60
        and evidence["cited_count"] > 0
        and evidence["invalid_citation_count"] == 0
        and evidence["verified_aligned_count"] > 0
        and run["verdict"] != "failed"
        and feedback["rating"] != "unhelpful"
    ):
        band = "strong"
    elif readiness_score >= 50 and relevance_score >= 40 and run["verdict"] != "failed":
        band = "review"
    else:
        band = "weak"

    return {
        "contract": "deterministic_selection_readiness",
        "readiness_score": readiness_score,
        "readiness_band": band,
        "relevance": {
            "score": relevance_score,
            "matched_question_terms": matched_terms,
        },
        "evidence": evidence,
        "run_evaluation": run,
        "feedback": feedback,
        "warnings": warnings[:8],
        "requires_human_confirmation": True,
        "is_correctness_verdict": False,
    }


def _current_memory_question_evidence(
    session: Session,
    *,
    project: Project,
    question: str,
) -> tuple[dict[str, Any], dict[tuple[Any, ...], dict[str, Any]]]:
    try:
        memory, slot_states = load_project_memory_slot_view(
            session,
            project,
            get_project_memory_payload(project),
        )
        bundle = build_project_memory_evidence(
            project,
            question,
            memory_payload=memory,
            slot_states=slot_states,
            fact_states=fact_states_by_slot(
                get_project_memory_fact_states(session, int(project.id or 0))
            ),
        )
        manifest = bundle.get("manifest")
        valid, _ = validate_project_memory_evidence_manifest(manifest)
        if not valid:
            return {
                "status": "not_available",
                "memory_version": int(project.memory_version or 0),
                "memory_stale": bool(project.memory_stale),
                "retrieval_mode": "none",
                "selected_slots": [],
                "source_count": 0,
                "supporting_source_count": 0,
                "sources": [],
            }, {}
        source_map: dict[tuple[Any, ...], dict[str, Any]] = {}
        sources: list[dict[str, Any]] = []
        for entry in list(manifest.get("entries") or []):
            source = {
                "source_type": "project_memory",
                "evidence_id": str(entry.get("evidence_id") or ""),
                "citation_key": str(entry.get("citation_key") or ""),
                "title": (
                    f"项目记忆 v{int(entry.get('memory_version') or 0)} · "
                    f"{entry.get('slot_label')}"
                ),
                "memory_slot": str(entry.get("slot") or ""),
                "memory_version": int(entry.get("memory_version") or 0),
                "provenance_status": str(entry.get("provenance_status") or "unresolved"),
                "fact_evidence_count": max(0, _safe_int(entry.get("fact_evidence_count"))),
            }
            key = (
                "memory",
                str(entry.get("slot") or ""),
                str(entry.get("content_sha256") or ""),
            )
            source_map[key] = source
            sources.append(source)
        return {
            "status": "stale" if manifest.get("memory_stale") else "available",
            "memory_version": int(manifest.get("memory_version") or 0),
            "memory_stale": bool(manifest.get("memory_stale")),
            "retrieval_mode": str(manifest.get("retrieval_mode") or "none"),
            "selected_slots": list(manifest.get("selected_slots") or []),
            "source_count": len(sources),
            "supporting_source_count": sum(
                source["memory_slot"] != "open_questions"
                and source["provenance_status"] != "unresolved"
                for source in sources
            ),
            "sources": sources,
        }, source_map
    except Exception:
        logger.warning("Project question memory evidence retrieval failed", exc_info=True)
        return {
            "status": "unavailable",
            "memory_version": int(project.memory_version or 0),
            "memory_stale": bool(project.memory_stale),
            "retrieval_mode": "none",
            "selected_slots": [],
            "source_count": 0,
            "supporting_source_count": 0,
            "sources": [],
        }, {}


def _current_knowledge_question_evidence(
    session: Session,
    *,
    project_id: int,
    question: str,
) -> tuple[dict[str, Any], dict[tuple[Any, ...], dict[str, Any]]]:
    try:
        rag = build_rag_context(
            session,
            question,
            project_id=project_id,
            knowledge_scope="project",
            auto_trigger=True,
            accessible_project_ids=[project_id],
            accessible_client_ids=[],
        )
        manifest = rag.get("evidence_manifest")
        valid, _ = validate_knowledge_evidence_manifest(manifest)
        if not valid:
            return {
                "status": "not_available",
                "source_count": 0,
                "supporting_source_count": 0,
                "sources": [],
            }, {}
        source_map: dict[tuple[Any, ...], dict[str, Any]] = {}
        sources: list[dict[str, Any]] = []
        for entry in list(manifest.get("entries") or []):
            source = {
                "source_type": "knowledge_document",
                "evidence_id": str(entry.get("evidence_id") or ""),
                "citation_key": str(entry.get("citation_key") or ""),
                "title": str(entry.get("title") or "")[:240],
                "document_id": int(entry.get("document_id") or 0),
                "chunk_index": max(0, int(entry.get("chunk_index") or 0)),
                "retrieval_score": round(float(entry.get("score") or 0.0), 4),
            }
            source_map[("knowledge", source["evidence_id"])] = source
            sources.append(source)
        return {
            "status": "available" if sources else "not_available",
            "source_count": len(sources),
            "supporting_source_count": len(sources),
            "sources": sources,
        }, source_map
    except Exception:
        logger.warning("Project question knowledge evidence retrieval failed", exc_info=True)
        return {
            "status": "unavailable",
            "source_count": 0,
            "supporting_source_count": 0,
            "sources": [],
        }, {}


def _question_exists(
    session: Session,
    *,
    project: Project,
    normalized_question: str,
    identity: str,
) -> ProjectQuestionResolution | None:
    memory, _ = load_project_memory_slot_view(
        session,
        project,
        get_project_memory_payload(project),
    )
    raw_open = memory.get("open_questions")
    open_hashes = {
        project_question_sha256(normalize_project_question(str(item or "")))
        for item in (raw_open if isinstance(raw_open, list) else [])
        if normalize_project_question(str(item or ""))
    }
    resolution = session.exec(
        select(ProjectQuestionResolution).where(
            ProjectQuestionResolution.project_id == int(project.id or 0),
            ProjectQuestionResolution.question_sha256 == identity,
        )
    ).first()
    if identity not in open_hashes and resolution is None:
        raise HTTPException(status_code=404, detail="Project question not found")
    if (
        resolution is not None
        and normalize_project_question(resolution.question_text) != normalized_question
    ):
        raise HTTPException(status_code=409, detail="Project question identity is inconsistent")
    return resolution


def build_project_question_evidence_review(
    session: Session,
    *,
    project: Project,
    question: str,
    question_sha256: str,
) -> dict[str, Any]:
    """Recall current evidence and rank persisted project answers for review."""

    normalized_question = normalize_project_question(question)
    identity = project_question_sha256(normalized_question)
    if not normalized_question or identity != str(question_sha256 or "").lower():
        raise HTTPException(status_code=400, detail="Question identity does not match")
    project_id = int(project.id or 0)
    resolution = _question_exists(
        session,
        project=project,
        normalized_question=normalized_question,
        identity=identity,
    )

    memory_evidence, memory_source_map = _current_memory_question_evidence(
        session,
        project=project,
        question=normalized_question,
    )
    knowledge_evidence, knowledge_source_map = _current_knowledge_question_evidence(
        session,
        project_id=project_id,
        question=normalized_question,
    )
    question_source_map = {**memory_source_map, **knowledge_source_map}

    rows = session.exec(
        select(Message, Conversation)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.project_id == project_id,
            Message.role == "assistant",
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(MAX_EVALUATED_CANDIDATES + 1)
    ).all()
    truncated = len(rows) > MAX_EVALUATED_CANDIDATES
    candidates_by_id = {
        int(message.id or 0): (message, conversation)
        for message, conversation in rows[:MAX_EVALUATED_CANDIDATES]
    }
    selected_answer_id = int(resolution.answer_message_id or 0) if resolution is not None else 0
    if selected_answer_id and selected_answer_id not in candidates_by_id:
        selected = session.exec(
            select(Message, Conversation)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Message.id == selected_answer_id,
                Message.role == "assistant",
                Conversation.project_id == project_id,
            )
        ).first()
        if selected is not None:
            candidates_by_id[selected_answer_id] = selected

    candidates: list[dict[str, Any]] = []
    for message, conversation in candidates_by_id.values():
        assessment = assess_project_question_answer(
            question=normalized_question,
            answer=str(message.content or ""),
            metadata=message.metadata_json,
            project_id=project_id,
            question_source_map=question_source_map,
        )
        candidates.append(
            {
                "message_id": int(message.id or 0),
                "conversation_id": int(conversation.id or 0),
                "conversation_title": str(conversation.title or "未命名对话")[:160],
                "preview": _preview(message.content),
                "created_at": message.created_at.isoformat() if message.created_at else "",
                "is_selected_resolution": int(message.id or 0) == selected_answer_id,
                "assessment": assessment,
            }
        )
    candidates.sort(
        key=lambda item: (
            int(item["assessment"]["readiness_score"]),
            int(item["assessment"]["relevance"]["score"]),
            str(item["created_at"]),
            int(item["message_id"]),
        ),
        reverse=True,
    )
    returned = candidates[:MAX_RETURNED_CANDIDATES]
    band_counts = {
        band: sum(item["assessment"]["readiness_band"] == band for item in candidates)
        for band in ("strong", "review", "weak", "unrated")
    }
    recommended = next(
        (
            item["message_id"]
            for item in returned
            if item["assessment"]["readiness_band"] in {"strong", "review"}
        ),
        None,
    )
    question_source_count = len(question_source_map)
    supporting_source_count = int(memory_evidence["supporting_source_count"]) + int(
        knowledge_evidence["supporting_source_count"]
    )
    return {
        "schema_version": QUESTION_EVIDENCE_SCHEMA_VERSION,
        "project_id": project_id,
        "question": normalized_question,
        "question_sha256": identity,
        "question_evidence": {
            "status": (
                "available"
                if supporting_source_count
                else "context_only"
                if question_source_count
                else "unavailable"
                if "unavailable" in {memory_evidence["status"], knowledge_evidence["status"]}
                else "not_available"
            ),
            "source_count": question_source_count,
            "supporting_source_count": supporting_source_count,
            "memory": memory_evidence,
            "knowledge": knowledge_evidence,
        },
        "summary": {
            "evaluated_candidate_count": len(candidates),
            "returned_candidate_count": len(returned),
            "recommended_message_id": recommended,
            "bands": band_counts,
            "truncated": truncated or len(candidates) > MAX_RETURNED_CANDIDATES,
        },
        "candidates": returned,
        "assessment_contract": {
            "name": "deterministic_selection_readiness",
            "dimensions": [
                "question_relevance",
                "evidence_alignment",
                "run_evaluation",
                "human_feedback",
            ],
            "requires_human_confirmation": True,
            "is_correctness_verdict": False,
        },
        "privacy": {
            "includes_bounded_answer_previews": bool(returned),
            "includes_full_answer_content": False,
            "includes_retrieved_chunk_content": False,
            "includes_prompt_content": False,
            "includes_tool_inputs": False,
            "includes_tool_outputs": False,
            "includes_hidden_reasoning": False,
        },
    }
