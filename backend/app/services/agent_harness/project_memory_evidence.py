"""Query-aware project-memory retrieval and citation evidence.

Structured project memory remains Aria-owned domain state. This module selects
only the slots relevant to the current question, renders their values into the
ephemeral provider prompt, and retains a no-content manifest for citation and
audit. Raw memory values never enter the manifest, message metadata, or trace.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from app.models.db import Project
from app.services.project_contexts import get_project_memory_payload


PROJECT_MEMORY_EVIDENCE_SCHEMA_VERSION = 1
MAX_MEMORY_EVIDENCE_ITEMS = 12
MAX_MEMORY_ITEM_CHARS = 480
MAX_INVALID_MEMORY_CITATIONS = 12

_CITATION_PATTERN = re.compile(r"(?<![A-Za-z0-9_])\[M([1-9][0-9]{0,2})\]")
_CITATION_KEY_PATTERN = re.compile(r"M[1-9][0-9]{0,2}\Z")
_CONTENT_DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
_EMBEDDED_CITATION_PATTERN = re.compile(r"\[([KM][1-9][0-9]{0,2})\]")
_EVIDENCE_STATUSES = {
    "available",
    "cited",
    "uncited",
    "invalid",
    "partial",
    "not_available",
}

_SLOT_LABELS = {
    "project_brief": "Project brief",
    "current_stage": "Current stage",
    "current_objective": "Current objective",
    "recent_progress": "Recent progress",
    "key_risks": "Key risks",
    "open_questions": "Open questions",
    "next_actions": "Next actions",
    "important_documents": "Important documents",
    "financial_status": "Financial status",
    "delivery_signals": "Delivery signals",
    "stakeholder_notes": "Stakeholder notes",
    "client_stakeholders": "Client stakeholders",
}
_ALL_SLOTS = tuple(_SLOT_LABELS)
_CORE_SLOTS = ("project_brief", "current_stage", "current_objective")
_OVERVIEW_SLOTS = (
    "recent_progress",
    "key_risks",
    "open_questions",
    "next_actions",
    "delivery_signals",
)
_FACET_SLOTS = {
    "risk": ("key_risks", "open_questions", "delivery_signals", "next_actions"),
    "delivery": ("recent_progress", "delivery_signals", "next_actions", "important_documents"),
    "financial": ("financial_status", "key_risks", "open_questions", "next_actions"),
    "stakeholder": ("stakeholder_notes", "client_stakeholders", "open_questions", "next_actions"),
    "documents": ("important_documents", "delivery_signals", "open_questions", "next_actions"),
}
_FACET_TERMS = {
    "risk": (
        "风险", "阻塞", "障碍", "问题", "红旗", "延误", "延期", "依赖", "risk", "blocker", "issue",
    ),
    "delivery": (
        "交付", "进度", "阶段", "里程碑", "待办", "下一步", "行动", "计划", "delivery", "progress", "milestone", "next step",
    ),
    "financial": (
        "财务", "金额", "合同", "收款", "回款", "支出", "预算", "成本", "现金流", "financial", "payment", "budget", "cost",
    ),
    "stakeholder": (
        "干系人", "利益相关方", "客户联系人", "决策人", "沟通", "关系", "诉求", "stakeholder", "sponsor", "decision maker",
    ),
    "documents": (
        "文档", "文件", "材料", "报告", "ppt", "word", "excel", "知识", "document", "file", "deck",
    ),
}
_EXHAUSTIVE_TERMS = (
    "全面", "全量", "全部", "所有方面", "完整盘点", "综合评估", "整体情况",
    "comprehensive", "everything", "all aspects", "full review", "overall review",
)


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _sha256(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_query(value: str) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _prompt_safe_memory_content(value: Any) -> str:
    """Keep one memory item inside its evidence line and citation namespace."""

    normalized = " ".join(str(value or "").strip().split())
    normalized = _EMBEDDED_CITATION_PATTERN.sub(r"(\1)", normalized)
    return normalized[:MAX_MEMORY_ITEM_CHARS]


def classify_project_memory_facets(query: str) -> tuple[str, ...]:
    """Classify the question into stable, deterministic memory facets."""

    text = _normalize_query(query)
    if any(term in text for term in _EXHAUSTIVE_TERMS):
        return ("comprehensive",)
    facets = [
        facet
        for facet, terms in _FACET_TERMS.items()
        if any(term in text for term in terms)
    ]
    return tuple(facets or ("overview",))


def select_project_memory_slots(query: str) -> tuple[str, tuple[str, ...], tuple[str, ...]]:
    """Return retrieval mode, facets, and ordered memory slots."""

    facets = classify_project_memory_facets(query)
    if facets == ("comprehensive",):
        return "full", facets, _ALL_SLOTS
    selected = list(_CORE_SLOTS)
    if facets == ("overview",):
        selected.extend(_OVERVIEW_SLOTS)
        mode = "overview"
    else:
        for facet in facets:
            selected.extend(_FACET_SLOTS.get(facet, ()))
        mode = "focused"
    return mode, facets, tuple(dict.fromkeys(selected))


def _memory_items(slot: str, value: Any) -> list[str]:
    if slot == "important_documents" and isinstance(value, list):
        items = []
        for document in value:
            if isinstance(document, dict):
                name = str(document.get("name") or "").strip()
                summary = str(document.get("reason") or document.get("summary") or "").strip()
                text = f"{name}: {summary}" if name and summary else name or summary
            else:
                text = str(document or "").strip()
            if text:
                items.append(text)
        return items
    if slot == "client_stakeholders" and isinstance(value, list):
        items = []
        for stakeholder in value:
            if not isinstance(stakeholder, dict):
                continue
            parts = [
                str(stakeholder.get(key) or "").strip()
                for key in (
                    "name",
                    "role",
                    "influence_type",
                    "relationship_status",
                    "concerns",
                    "communication_preference",
                    "note",
                )
            ]
            text = " / ".join(part for part in parts if part)
            if text:
                items.append(text)
        return items
    if isinstance(value, dict):
        values: list[Any] = []
        for key in ("pinned", "ai"):
            if isinstance(value.get(key), list):
                values.extend(value[key])
        value = values
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").strip()
    return [text] if text else []


def _memory_slot_items(memory: dict[str, Any], slot: str) -> list[str]:
    """Prefer the pinned/AI detail view when the project memory exposes it."""

    detail = memory.get(f"{slot}_detail")
    value = detail if isinstance(detail, dict) else memory.get(slot)
    return _memory_items(slot, value)


def _available_slot_count(memory: dict[str, Any]) -> int:
    return sum(bool(_memory_slot_items(memory, slot)) for slot in _ALL_SLOTS)


def _manifest_digest_payload(
    entries: list[dict[str, Any]],
    *,
    project_id: int,
    memory_version: int,
    memory_stale: bool,
    retrieval_mode: str,
    query_facets: tuple[str, ...],
    selected_slots: tuple[str, ...],
) -> dict[str, Any]:
    return {
        "domain": "aria.project-memory-evidence.v1",
        "project_id": project_id,
        "memory_version": memory_version,
        "memory_stale": memory_stale,
        "retrieval_mode": retrieval_mode,
        "query_facets": list(query_facets),
        "selected_slots": list(selected_slots),
        "entries": entries,
    }


def build_project_memory_evidence(
    project: Project,
    query: str = "",
    *,
    memory_payload: dict[str, Any] | None = None,
    slot_states: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build an ephemeral prompt plus a no-content evidence manifest."""

    memory = memory_payload or get_project_memory_payload(project)
    slot_states = slot_states or {}
    memory_version = max(0, int(project.memory_version or 0))
    retrieval_mode, facets, selected_slots = select_project_memory_slots(query)
    if slot_states:
        stale_slots = tuple(
            slot
            for slot in selected_slots
            if str((slot_states.get(slot) or {}).get("status") or "") != "ready"
        )
    else:
        stale_slots = selected_slots if project.memory_stale else ()
    evidence_ref_count = sum(
        max(0, int((slot_states.get(slot) or {}).get("evidence_count") or 0))
        for slot in selected_slots
    )
    effective_stale = bool(stale_slots)
    available_slot_count = _available_slot_count(memory)
    selection = {
        "retrieval_mode": retrieval_mode,
        "query_facets": list(facets),
        "selected_slots": list(selected_slots),
        "selected_slot_count": len(selected_slots),
        "available_slot_count": available_slot_count,
        "omitted_slot_count": max(0, available_slot_count - sum(
            bool(_memory_slot_items(memory, slot)) for slot in selected_slots
        )),
        "selected_item_count": 0,
        "stale_slots": list(stale_slots),
        "stale_slot_count": len(stale_slots),
        "evidence_ref_count": evidence_ref_count,
        "truncated": False,
    }
    if not memory or memory_version <= 0:
        return {"prompt": "", "manifest": {}, "selection": selection}

    rendered_items: list[dict[str, Any]] = []
    for slot in selected_slots:
        for item_index, content in enumerate(_memory_slot_items(memory, slot)[:4]):
            normalized = _prompt_safe_memory_content(content)
            if not normalized:
                continue
            if len(rendered_items) >= MAX_MEMORY_EVIDENCE_ITEMS:
                selection["truncated"] = True
                break
            rendered_items.append(
                {
                    "slot": slot,
                    "slot_label": _SLOT_LABELS[slot],
                    "item_index": item_index,
                    "content": normalized,
                }
            )
        if len(rendered_items) >= MAX_MEMORY_EVIDENCE_ITEMS:
            break

    selection["truncated"] = sum(
        len(_memory_slot_items(memory, slot)) for slot in selected_slots
    ) > len(rendered_items)

    entries: list[dict[str, Any]] = []
    for item in rendered_items:
        content_sha256 = _text_sha256(item["content"])
        evidence_id = "memory_evidence_" + _sha256(
            {
                "project_id": int(project.id or 0),
                "memory_version": memory_version,
                "slot": item["slot"],
                "item_index": item["item_index"],
                "content_sha256": content_sha256,
            }
        )[:24]
        entries.append(
            {
                "evidence_id": evidence_id,
                "citation_key": f"M{len(entries) + 1}",
                "source_type": "project_memory",
                "project_id": int(project.id or 0),
                "memory_version": memory_version,
                "slot": item["slot"],
                "slot_label": item["slot_label"],
                "item_index": item["item_index"],
                "content_sha256": content_sha256,
            }
        )

    digest_payload = _manifest_digest_payload(
        entries,
        project_id=int(project.id or 0),
        memory_version=memory_version,
        memory_stale=effective_stale,
        retrieval_mode=retrieval_mode,
        query_facets=facets,
        selected_slots=selected_slots,
    )
    manifest = {
        "schema_version": PROJECT_MEMORY_EVIDENCE_SCHEMA_VERSION,
        "manifest_id": "pme_manifest_" + _sha256(digest_payload)[:24],
        "project_id": int(project.id or 0),
        "memory_version": memory_version,
        "memory_stale": effective_stale,
        "retrieval_mode": retrieval_mode,
        "query_facets": list(facets),
        "selected_slots": list(selected_slots),
        "status": "available" if entries else "not_available",
        "entries": entries,
        "cited_evidence_ids": [],
        "invalid_citation_keys": [],
    }
    valid, reason = validate_project_memory_evidence_manifest(manifest)
    if not valid:
        raise ValueError(f"invalid project memory evidence manifest: {reason}")

    selection["selected_item_count"] = len(entries)
    heading = (
        "**Structured Project Memory (STALE):**"
        if effective_stale
        else "**Structured Project Memory:**"
    )
    prompt_lines = [
        heading,
        "- Query-aware retrieval: "
        f"mode={retrieval_mode}; facets={', '.join(facets)}; "
        f"selected_slots={', '.join(selected_slots)}.",
        "- Citation contract: factual claims based on structured project memory "
        "must cite the matching [M*] key in the same sentence. Use the exact ASCII "
        "square-bracket form [M1], not full-width brackets or a separate source list. "
        "Never invent a memory citation key. "
        "If selected memory is insufficient, say so and rely on newer raw project evidence.",
    ]
    if effective_stale:
        prompt_lines.append(
            "- Memory freshness: only these selected slots are stale or invalid: "
            f"{', '.join(stale_slots)}. Treat values from those slots as provisional; "
            "other selected slots remain usable; prefer newer milestones, todos, progress "
            "updates, files, and current user input for stale slots."
        )
    for item, entry in zip(rendered_items, entries):
        stale_marker = " [STALE SLOT]" if item["slot"] in stale_slots else ""
        prompt_lines.append(
            f"- {item['slot_label']}{stale_marker} "
            f"[{entry['citation_key']}]: {item['content']}"
        )
    return {
        "prompt": "\n".join(prompt_lines) if entries else "",
        "manifest": manifest,
        "selection": selection,
    }


def validate_project_memory_evidence_manifest(value: Any) -> tuple[bool, str]:
    if not isinstance(value, dict):
        return False, "project memory evidence manifest must be an object"
    if value.get("schema_version") != PROJECT_MEMORY_EVIDENCE_SCHEMA_VERSION:
        return False, "unsupported project memory evidence schema version"
    entries = value.get("entries")
    if not isinstance(entries, list) or len(entries) > MAX_MEMORY_EVIDENCE_ITEMS:
        return False, "project memory evidence entries are invalid or unbounded"
    project_id = value.get("project_id")
    memory_version = value.get("memory_version")
    if not isinstance(project_id, int) or project_id < 0:
        return False, "invalid project id"
    if not isinstance(memory_version, int) or memory_version <= 0:
        return False, "invalid memory version"
    if not isinstance(value.get("memory_stale"), bool):
        return False, "invalid memory freshness state"
    if value.get("retrieval_mode") not in {"overview", "focused", "full"}:
        return False, "invalid memory retrieval mode"
    facets = value.get("query_facets")
    selected_slots = value.get("selected_slots")
    if not isinstance(facets, list) or not facets:
        return False, "memory query facets are invalid"
    if (
        not isinstance(selected_slots, list)
        or len(selected_slots) != len(set(selected_slots))
        or any(slot not in _ALL_SLOTS for slot in selected_slots)
    ):
        return False, "selected memory slots are invalid"
    evidence_ids: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            return False, "memory evidence entry must be an object"
        if entry.get("citation_key") != f"M{index + 1}":
            return False, "memory citation keys must be ordered and contiguous"
        evidence_id = str(entry.get("evidence_id") or "")
        if not evidence_id.startswith("memory_evidence_") or evidence_id in evidence_ids:
            return False, "invalid or duplicate memory evidence id"
        evidence_ids.add(evidence_id)
        if entry.get("source_type") != "project_memory":
            return False, "unsupported memory evidence source type"
        if entry.get("project_id") != project_id or entry.get("memory_version") != memory_version:
            return False, "memory evidence scope mismatch"
        slot = entry.get("slot")
        if slot not in selected_slots:
            return False, "memory evidence slot was not selected"
        if entry.get("slot_label") != _SLOT_LABELS[slot]:
            return False, "memory evidence slot label mismatch"
        item_index = entry.get("item_index")
        if not isinstance(item_index, int) or not 0 <= item_index < 4:
            return False, "invalid memory evidence item index"
        content_sha256 = str(entry.get("content_sha256") or "")
        if not _CONTENT_DIGEST_PATTERN.fullmatch(content_sha256):
            return False, "invalid memory evidence content digest"
        expected_evidence_id = "memory_evidence_" + _sha256(
            {
                "project_id": project_id,
                "memory_version": memory_version,
                "slot": slot,
                "item_index": item_index,
                "content_sha256": content_sha256,
            }
        )[:24]
        if evidence_id != expected_evidence_id:
            return False, "memory evidence identity mismatch"
    if str(value.get("status") or "") not in _EVIDENCE_STATUSES:
        return False, "invalid memory evidence status"
    expected_manifest_id = "pme_manifest_" + _sha256(
        _manifest_digest_payload(
            entries,
            project_id=project_id,
            memory_version=memory_version,
            memory_stale=bool(value.get("memory_stale")),
            retrieval_mode=str(value["retrieval_mode"]),
            query_facets=tuple(str(item) for item in facets),
            selected_slots=tuple(str(item) for item in selected_slots),
        )
    )[:24]
    if value.get("manifest_id") != expected_manifest_id:
        return False, "project memory evidence manifest digest mismatch"
    cited_ids = value.get("cited_evidence_ids", [])
    if (
        not isinstance(cited_ids, list)
        or len(cited_ids) != len(set(cited_ids))
        or any(item not in evidence_ids for item in cited_ids)
    ):
        return False, "cited memory evidence ids are invalid"
    invalid_keys = value.get("invalid_citation_keys", [])
    if (
        not isinstance(invalid_keys, list)
        or len(invalid_keys) > MAX_INVALID_MEMORY_CITATIONS
        or len(invalid_keys) != len(set(invalid_keys))
        or any(not _CITATION_KEY_PATTERN.fullmatch(str(key)) for key in invalid_keys)
    ):
        return False, "invalid memory citation keys are unbounded"

    status = str(value.get("status") or "")
    cited_count = len(cited_ids)
    invalid_count = len(invalid_keys)
    lifecycle_valid = {
        "available": bool(entries) and cited_count == 0 and invalid_count == 0,
        "cited": bool(entries) and cited_count > 0 and invalid_count == 0,
        "uncited": bool(entries) and cited_count == 0 and invalid_count == 0,
        "invalid": bool(entries) and cited_count == 0 and invalid_count > 0,
        "partial": bool(entries) and cited_count > 0 and invalid_count > 0,
        "not_available": not entries and cited_count == 0 and invalid_count == 0,
    }
    if not lifecycle_valid.get(status, False):
        return False, "memory evidence lifecycle state is inconsistent"
    return True, ""


def project_memory_reference(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": PROJECT_MEMORY_EVIDENCE_SCHEMA_VERSION,
        "type": "memory",
        "id": int(entry["project_id"]),
        "title": f"项目记忆 v{int(entry['memory_version'])} · {entry['slot_label']}",
        "evidence_id": str(entry["evidence_id"]),
        "citation_key": str(entry["citation_key"]),
        "memory_version": int(entry["memory_version"]),
        "memory_slot": str(entry["slot"]),
        "content_sha256": str(entry["content_sha256"]),
    }


def resolve_project_memory_citations(
    manifest: Any,
    output_text: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    valid, _ = validate_project_memory_evidence_manifest(manifest)
    if not valid:
        return {}, []
    payload = json.loads(_stable_json(manifest))
    entries = list(payload.get("entries") or [])
    if not entries:
        payload["status"] = "not_available"
        return payload, []
    by_key = {str(entry["citation_key"]): entry for entry in entries}
    observed_keys = list(
        dict.fromkeys(f"M{match}" for match in _CITATION_PATTERN.findall(output_text or ""))
    )
    cited_entries = [by_key[key] for key in observed_keys if key in by_key]
    invalid_keys = [key for key in observed_keys if key not in by_key][
        :MAX_INVALID_MEMORY_CITATIONS
    ]
    payload["cited_evidence_ids"] = [entry["evidence_id"] for entry in cited_entries]
    payload["invalid_citation_keys"] = invalid_keys
    if cited_entries and invalid_keys:
        payload["status"] = "partial"
    elif cited_entries:
        payload["status"] = "cited"
    elif invalid_keys:
        payload["status"] = "invalid"
    else:
        payload["status"] = "uncited"
    return payload, [project_memory_reference(entry) for entry in cited_entries]


def project_memory_evidence_reference(manifest: Any) -> dict[str, Any]:
    valid, _ = validate_project_memory_evidence_manifest(manifest)
    if not valid:
        return {
            "valid": False,
            "manifest_id": None,
            "status": "not_available",
            "evidence_count": 0,
            "cited_count": 0,
            "invalid_citation_count": 0,
            "selected_slots": [],
            "retrieval_mode": "none",
        }
    return {
        "valid": True,
        "manifest_id": manifest["manifest_id"],
        "status": manifest["status"],
        "project_id": manifest["project_id"],
        "memory_version": manifest["memory_version"],
        "memory_stale": manifest["memory_stale"],
        "retrieval_mode": manifest["retrieval_mode"],
        "query_facets": list(manifest["query_facets"]),
        "selected_slots": list(manifest["selected_slots"]),
        "evidence_count": len(manifest["entries"]),
        "cited_count": len(manifest.get("cited_evidence_ids") or []),
        "invalid_citation_count": len(manifest.get("invalid_citation_keys") or []),
    }


def resolve_runtime_project_memory_evidence(
    runtime: Any,
    output_text: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return resolve_project_memory_citations(
        getattr(runtime, "project_memory_evidence_manifest", None),
        output_text,
    )
