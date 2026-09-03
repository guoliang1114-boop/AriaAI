from __future__ import annotations

from datetime import datetime
from typing import Any
import json

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import ClientMemorySnapshot, ClientMemorySummary, ClientRecord, Project
from app.services.memory_facts import (
    MODEL_SOURCE_ATTRIBUTIONS_KEY,
    bind_model_source_attributions,
    normalize_model_source_attributions,
)
from app.services.memory_rebuilds import (
    MemoryPatchValidationError,
    MemoryRebuildPlan,
    assert_memory_rebuild_baseline,
)
from app.services.memory_source_tags import strip_memory_source_tags
from app.services.memory_operation_state import set_client_memory_failure
from app.services.memory_slots import (
    CLIENT_MEMORY_SLOT_KEYS,
    build_client_slot_evidence_refs,
    project_memory_promotion_payload,
)
from app.services.project_contexts import _resolve_output_language, normalize_summary_language
from app.services.project_clients import list_projects_for_client
from app.services.stakeholder_contexts import (
    format_client_stakeholders_for_prompt,
    list_client_stakeholder_dicts,
)
from app.services.time_utils import utc_now_naive

SUPPORTED_CLIENT_MEMORY_SUMMARY_TYPES = {
    "overview",
    "stakeholder",
    "lessons",
    "client-facing",
    "risk",
    "opportunity",
    "relationship",
    "delivery",
}

# Compatibility key for the cancel epoch. The native owner column is
# authoritative; this copy remains during the aggregate-JSON cutover.
CLIENT_MEMORY_REBUILD_GENERATION_KEY = "_rebuild_generation"

CORE_CLIENT_MEMORY_SUMMARY_TYPES = [
    "overview",
    "stakeholder",
    "lessons",
]

EXTENDED_CLIENT_MEMORY_SUMMARY_TYPES = [
    "risk",
    "opportunity",
    "relationship",
    "delivery",
    "client-facing",
]


def _default_client_memory(client: ClientRecord) -> dict[str, Any]:
    return {
        "client_profile": client.notes[:400] if client.notes else client.name,
        "decision_patterns": [],
        "key_contacts": [],
        "structured_stakeholders": [],
        "lessons_learned": [],
        "relationship_signals": [],
        "project_history": [],
        "sensitive_topics": [],
        "memory_version": client.client_memory_version,
        "last_updated_at": client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else "",
        "stale": client.client_memory_stale,
        "rebuild_log": [],
        "source_project_ids": [],
        "_accepted_memory_candidates": {},
    }


def get_client_memory_payload(client: ClientRecord) -> dict[str, Any]:
    base = _default_client_memory(client)
    try:
        parsed = json.loads(client.client_memory_json or "{}")
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    parsed.pop(CLIENT_MEMORY_REBUILD_GENERATION_KEY, None)

    return {
        **base,
        **parsed,
        "memory_version": client.client_memory_version,
        "last_updated_at": client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else "",
        "stale": client.client_memory_stale,
    }


def _merge_accepted_memory_candidates(
    memory: dict[str, Any],
    existing: dict[str, Any],
) -> dict[str, Any]:
    existing_candidates = existing.get("_accepted_memory_candidates")
    existing_candidates = (
        dict(existing_candidates) if isinstance(existing_candidates, dict) else {}
    )
    incoming_candidates = memory.get("_accepted_memory_candidates")
    incoming_candidates = (
        dict(incoming_candidates) if isinstance(incoming_candidates, dict) else {}
    )
    accepted_candidates: dict[str, list[str]] = {}
    for slot_name in {*existing_candidates, *incoming_candidates}:
        combined: list[str] = []
        for source in (existing_candidates.get(slot_name), incoming_candidates.get(slot_name)):
            if isinstance(source, list):
                combined.extend(str(item).strip() for item in source if str(item).strip())
        accepted_candidates[str(slot_name)] = list(dict.fromkeys(combined))[-50:]

    for slot_name, items in accepted_candidates.items():
        if slot_name not in {"decision_patterns", "lessons_learned", "relationship_signals"}:
            continue
        current = memory.get(slot_name)
        current = (
            [str(item).strip() for item in current if str(item).strip()]
            if isinstance(current, list)
            else []
        )
        memory[slot_name] = list(dict.fromkeys([*current, *items]))[-50:]
    memory["_accepted_memory_candidates"] = accepted_candidates
    return memory


def mark_client_memory_stale(
    session: Session,
    client_id: int,
    trigger: str = "data_changed",
    *,
    commit: bool = True,
) -> None:
    client = session.exec(
        select(ClientRecord)
        .where(ClientRecord.id == client_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if not client:
        return
    from app.services.memory_slots import mark_client_memory_slots_stale
    from app.services.memory_facts import mark_client_memory_facts_stale

    mark_client_memory_slots_stale(session, client_id, trigger)
    mark_client_memory_facts_stale(session, client_id, trigger)
    client.client_memory_stale = True
    session.add(client)
    if commit:
        session.commit()


def build_client_memory_data(
    session: Session,
    client_id: int,
    slot_keys: tuple[str, ...] | None = None,
) -> tuple[ClientRecord, str, list[int], dict[str, str]]:
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    selected = set(slot_keys or CLIENT_MEMORY_SLOT_KEYS)
    needs_stakeholders = bool(
        selected
        & {
            "key_contacts",
            "structured_stakeholders",
            "decision_patterns",
            "relationship_signals",
            "sensitive_topics",
        }
    )
    needs_projects = bool(
        selected
        & {
            "client_profile",
            "decision_patterns",
            "lessons_learned",
            "relationship_signals",
            "project_history",
            "sensitive_topics",
        }
    )
    structured_stakeholders = (
        list_client_stakeholder_dicts(
            session,
            client_id,
            include_source_id=True,
        )
        if needs_stakeholders
        else []
    )
    projects = (
        sorted(
            list_projects_for_client(session, client),
            key=lambda project: project.updated_at,
            reverse=True,
        )
        if needs_projects
        else []
    )

    client_source = f"[client:{client.id}]"
    lines = [
        f"{client_source} Client: {client.name}",
        f"{client_source} Industry: {client.industry}",
        f"{client_source} Contact: {client.contact}",
    ]
    if client.notes:
        lines.append(f"{client_source} Client notes:\n{client.notes[:1200]}")
    stakeholder_context = format_client_stakeholders_for_prompt(structured_stakeholders)
    if stakeholder_context:
        lines.append(stakeholder_context)

    if projects:
        lines.append(f"Related projects ({len(projects)} total):")
        for project in projects[:12]:
            project_source = f"[project:{project.id}]"
            lines.append(
                f"- {project_source} {project.name} | status={project.status} | "
                f"contract_amount={project.contract_amount}"
            )
            if project.context_summary:
                lines.append(
                    f"  {project_source} Summary: {project.context_summary[:320]}"
                )
            if project.context_memory_json:
                try:
                    memory = json.loads(project.context_memory_json)
                    if isinstance(memory, dict):
                        brief = str(memory.get("project_brief", "")).strip()
                        risks = memory.get("key_risks", [])
                        next_actions = memory.get("next_actions", [])
                        if brief:
                            lines.append(
                                f"  {project_source} Project brief: {brief[:240]}"
                            )
                        if isinstance(risks, list) and risks:
                            lines.append(
                                f"  {project_source} Risks: "
                                f"{'; '.join(str(item) for item in risks[:3])}"
                            )
                        if isinstance(next_actions, list) and next_actions:
                            lines.append(
                                f"  {project_source} Next actions: "
                                f"{'; '.join(str(item) for item in next_actions[:3])}"
                            )
                except json.JSONDecodeError:
                    pass

    source_handles = list(
        dict.fromkeys(
            [
                f"client:{client.id}",
                *[
                    f"client_stakeholder:{stakeholder.get('_source_id')}"
                    for stakeholder in structured_stakeholders
                    if stakeholder.get("_source_id")
                ],
                *[
                    f"project:{project.id}"
                    for project in projects[:12]
                    if project.id is not None
                ],
            ]
        )
    )
    source_project_ids = [
        int(project.id)
        for project in projects[:12]
        if project.id is not None
    ]
    evidence_by_slot = build_client_slot_evidence_refs(
        session,
        client,
        {"source_project_ids": source_project_ids},
    )
    visible_source_handles = set(source_handles)
    source_snapshots = {
        handle: source_sha256
        for slot_key in selected
        for ref in evidence_by_slot.get(slot_key, [])
        if (
            handle := f"{ref.get('source_type', '')}:{ref.get('source_id', '')}"
        ) in visible_source_handles
        if (source_sha256 := str(ref.get("source_sha256") or ""))
    }
    return (
        client,
        "\n".join(lines),
        source_project_ids,
        source_snapshots,
    )


def build_client_memory_prompt(
    client_data: str,
    slot_keys: tuple[str, ...] | None = None,
) -> str:
    selected = tuple(slot_keys or CLIENT_MEMORY_SLOT_KEYS)
    exact_keys = ", ".join(selected)
    partial_instruction = (
        "This is a partial rebuild. Return every requested business key and no unrequested business keys. "
        if slot_keys is not None
        else ""
    )
    rules: list[str] = []
    if set(selected) & {
        "decision_patterns",
        "lessons_learned",
        "relationship_signals",
        "sensitive_topics",
    }:
        rules.append("Requested narrative collection slots must be arrays of strings.")
    if "key_contacts" in selected:
        rules.append("key_contacts must be an array of objects with keys name, role, note.")
    if "structured_stakeholders" in selected:
        rules.append(
            "structured_stakeholders must be an array of objects with keys name, role, influence_type, relationship_status, concerns, communication_preference, note."
        )
    if "project_history" in selected:
        rules.append(
            "project_history must be an array of objects with keys project_name, status, outcome, key_factor."
        )
    return (
        "You are building long-term client memory for a consulting team. "
        "Use only the client and project evidence below. Do not invent missing facts. "
        f"{partial_instruction}Return valid JSON only with these business keys: {exact_keys}, "
        f"plus the private {MODEL_SOURCE_ATTRIBUTIONS_KEY} key described below. "
        f"Rules: {' '.join(rules)} "
        f"Also return {MODEL_SOURCE_ATTRIBUTIONS_KEY} as an array of objects with keys "
        "slot_key, fact_index, source_ids. fact_index is zero-based within the returned "
        "slot (a scalar uses 0). source_ids must contain only exact [source_type:id] "
        "IDs visible below, without the brackets. Return at most 48 attribution objects. "
        "Never copy a [source_type:id] marker into any business value; markers belong "
        "only in this private envelope. Attribute every supported non-empty "
        "fact; omit an attribution instead of guessing or citing a merely related source. "
        "Prefer concise, reusable guidance for future projects.\n\n"
        f"Client data:\n{client_data}"
    )


def build_client_memory_promote_prompt(
    current_memory: dict[str, Any],
    project_name: str,
    project_memory: dict[str, Any],
    project_id: int | None = None,
) -> str:
    project_source = (
        f"[project_memory:{project_id}] " if project_id is not None else ""
    )
    promotion_payload = project_memory_promotion_payload(project_memory)
    return (
        "You are updating client-level consulting memory using one project's structured memory. "
        "Preserve useful long-term client knowledge. Do not copy temporary delivery noise. "
        "Return valid JSON only with these business keys: "
        "client_profile, decision_patterns, key_contacts, structured_stakeholders, lessons_learned, relationship_signals, project_history, sensitive_topics, "
        f"plus private {MODEL_SOURCE_ATTRIBUTIONS_KEY}. Return that private key as an "
        "array of slot_key, zero-based fact_index, and source_ids objects. Cite only "
        "exact [source_type:id] IDs visible below and omit unsupported attributions. "
        "Return at most 48 attribution objects. Never copy a source marker into a "
        "business value.\n\n"
        f"Current client memory JSON:\n{json.dumps(current_memory, ensure_ascii=False)}\n\n"
        f"Project to absorb: {project_source}{project_name}\n"
        f"Project memory JSON:\n{json.dumps(promotion_payload, ensure_ascii=False)}"
    )


def _extract_first_json_object(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return raw[start : end + 1]
    return "{}"


def _client_model_fact_bindings(
    parsed: dict[str, Any],
    slot_keys: tuple[str, ...],
) -> dict[str, dict[int, tuple[str, Any]]]:
    """Bind provider indexes to the canonical values Aria will persist."""

    bindings: dict[str, dict[int, tuple[str, Any]]] = {}
    list_string_slots = {
        "decision_patterns",
        "lessons_learned",
        "relationship_signals",
        "sensitive_topics",
    }
    list_object_slots = {
        "key_contacts",
        "structured_stakeholders",
        "project_history",
    }
    for slot_key in slot_keys:
        if slot_key not in parsed:
            continue
        value = strip_memory_source_tags(parsed[slot_key])
        slot_bindings: dict[int, tuple[str, Any]] = {}
        if slot_key == "client_profile" and isinstance(value, str):
            canonical = value.strip()
            if canonical:
                slot_bindings[0] = ("value", canonical)
        elif slot_key in list_string_slots and isinstance(value, list):
            for raw_index, item in enumerate(value):
                if isinstance(item, str) and (canonical := item.strip()):
                    slot_bindings[raw_index] = ("item", canonical)
        elif slot_key in list_object_slots and isinstance(value, list):
            for raw_index, item in enumerate(value):
                if isinstance(item, dict):
                    slot_bindings[raw_index] = ("item", item)
        if slot_bindings:
            bindings[slot_key] = slot_bindings
    return bindings


def parse_client_memory(raw: str, client: ClientRecord) -> dict[str, Any]:
    existing = get_client_memory_payload(client)
    try:
        parsed = json.loads(_extract_first_json_object(raw))
    except json.JSONDecodeError:
        parsed = {}

    if not isinstance(parsed, dict):
        parsed = {}

    parsed_business = {
        key: strip_memory_source_tags(value)
        for key, value in parsed.items()
        if key != MODEL_SOURCE_ATTRIBUTIONS_KEY
    }
    memory = {
        **_default_client_memory(client),
        **parsed_business,
    }
    for key in (
        "decision_patterns",
        "lessons_learned",
        "relationship_signals",
        "project_history",
        "sensitive_topics",
        "key_contacts",
    ):
        value = memory.get(key)
        memory[key] = value if isinstance(value, list) else []
    memory["rebuild_log"] = existing.get("rebuild_log", []) if isinstance(existing.get("rebuild_log"), list) else []
    memory["source_project_ids"] = (
        existing.get("source_project_ids", []) if isinstance(existing.get("source_project_ids"), list) else []
    )
    _merge_accepted_memory_candidates(memory, existing)
    structured_stakeholders = existing.get("structured_stakeholders", [])
    parsed_stakeholders = memory.get("structured_stakeholders", [])
    memory["structured_stakeholders"] = (
        parsed_stakeholders
        if isinstance(parsed_stakeholders, list) and parsed_stakeholders
        else structured_stakeholders
        if isinstance(structured_stakeholders, list)
        else []
    )
    memory[MODEL_SOURCE_ATTRIBUTIONS_KEY] = bind_model_source_attributions(
        parsed.get(MODEL_SOURCE_ATTRIBUTIONS_KEY),
        CLIENT_MEMORY_SLOT_KEYS,
        _client_model_fact_bindings(parsed, CLIENT_MEMORY_SLOT_KEYS),
    )
    return memory


def parse_client_memory_patch(
    raw: str,
    client: ClientRecord,
    slot_keys: tuple[str, ...],
) -> dict[str, Any]:
    """Strictly validate and merge an LLM response for selected client slots."""

    try:
        parsed = json.loads(_extract_first_json_object(raw))
    except json.JSONDecodeError as exc:
        raise MemoryPatchValidationError("partial client memory is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise MemoryPatchValidationError("partial client memory must be an object")

    selected = tuple(slot_keys)
    missing = [key for key in selected if key not in parsed]
    if missing:
        raise MemoryPatchValidationError(
            f"partial client memory is missing slots: {', '.join(missing)}"
        )

    existing = get_client_memory_payload(client)
    memory = {**_default_client_memory(client), **existing}
    string_slots = {"client_profile"}
    list_string_slots = {
        "decision_patterns",
        "lessons_learned",
        "relationship_signals",
        "sensitive_topics",
    }
    list_object_slots = {
        "key_contacts",
        "structured_stakeholders",
        "project_history",
    }
    for key in selected:
        value = strip_memory_source_tags(parsed[key])
        if key in string_slots:
            if not isinstance(value, str):
                raise MemoryPatchValidationError(f"slot {key} must be a string")
            memory[key] = value.strip()
        elif key in list_string_slots:
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise MemoryPatchValidationError(f"slot {key} must be an array of strings")
            memory[key] = [item.strip() for item in value if item.strip()]
        elif key in list_object_slots:
            if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
                raise MemoryPatchValidationError(f"slot {key} must be an array of objects")
            memory[key] = value
        else:
            raise MemoryPatchValidationError(f"unknown client memory slot: {key}")

    memory["rebuild_log"] = existing.get("rebuild_log", []) if isinstance(existing.get("rebuild_log"), list) else []
    memory["source_project_ids"] = existing.get("source_project_ids", []) if isinstance(existing.get("source_project_ids"), list) else []
    _merge_accepted_memory_candidates(memory, existing)
    memory[MODEL_SOURCE_ATTRIBUTIONS_KEY] = bind_model_source_attributions(
        parsed.get(MODEL_SOURCE_ATTRIBUTIONS_KEY),
        selected,
        _client_model_fact_bindings(parsed, selected),
    )
    return memory


def save_client_memory(
    session: Session,
    client_id: int,
    memory: dict[str, Any],
    *,
    trigger: str = "manual",
    source_project_ids: list[int] | None = None,
    source_snapshots: dict[str, str] | None = None,
    rebuilt_slots: tuple[str, ...] | None = None,
    rebuild_mode: str | None = None,
    fallback_reason: str = "",
    rebuild_plan: MemoryRebuildPlan | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    # A FOR UPDATE query does not refresh an already-cached SQLAlchemy identity.
    # Provider-backed rebuilds carry a baseline plan, so expire before locking;
    # immediate transactional edits must retain their pending in-session work.
    if rebuild_plan is not None:
        session.expire_all()
    client = session.exec(
        select(ClientRecord).where(ClientRecord.id == client_id).with_for_update()
    ).first()
    if not client:
        raise HTTPException(404, "Client not found")

    selected_slots = tuple(rebuilt_slots or CLIENT_MEMORY_SLOT_KEYS)
    if not selected_slots or any(key not in CLIENT_MEMORY_SLOT_KEYS for key in selected_slots):
        raise ValueError("rebuilt_slots contains an unknown client memory slot")
    if rebuild_plan is not None:
        from app.services.memory_slots import get_client_memory_slot_states

        assert_memory_rebuild_baseline(
            rebuild_plan,
            current_memory_version=int(client.client_memory_version or 0),
            current_slot_states=get_client_memory_slot_states(
                session,
                client_id,
                for_update=True,
            ),
            rebuilt_slots=selected_slots,
        )

    memory = _merge_accepted_memory_candidates(
        dict(memory),
        get_client_memory_payload(client),
    )
    source_attributions = normalize_model_source_attributions(
        memory.pop(MODEL_SOURCE_ATTRIBUTIONS_KEY, []),
        selected_slots,
    )

    client.client_memory_version = int(client.client_memory_version or 0) + 1
    client.client_memory_updated_at = utc_now_naive()
    memory["memory_version"] = client.client_memory_version
    memory["last_updated_at"] = client.client_memory_updated_at.isoformat()
    rebuild_log = memory.get("rebuild_log", [])
    if not isinstance(rebuild_log, list):
        rebuild_log = []
    log_entry: dict[str, Any] = {
        "at": client.client_memory_updated_at.isoformat(),
        "trigger": trigger,
        "version": client.client_memory_version,
    }
    if rebuild_mode:
        log_entry.update({"mode": rebuild_mode, "rebuilt_slots": list(selected_slots)})
    if fallback_reason:
        log_entry["fallback_reason"] = fallback_reason
    rebuild_log.append(log_entry)
    memory["rebuild_log"] = rebuild_log[-10:]

    existing_source_ids = memory.get("source_project_ids", [])
    if not isinstance(existing_source_ids, list):
        existing_source_ids = []
    merged_source_ids = [
        *[int(item) for item in existing_source_ids if str(item).isdigit()],
        *[int(item) for item in (source_project_ids or [])],
    ]
    memory["source_project_ids"] = list(dict.fromkeys(merged_source_ids))
    structured_stakeholders = (
        list_client_stakeholder_dicts(
            session,
            client_id,
            include_source_id=True,
        )
        if "structured_stakeholders" in selected_slots
        else []
    )
    if "structured_stakeholders" in selected_slots:
        source_attributions = [
            attribution
            for attribution in source_attributions
            if attribution.get("slot_key") != "structured_stakeholders"
        ]
        persisted_stakeholders = [
            {
                key: value
                for key, value in stakeholder.items()
                if key != "_source_id"
            }
            for stakeholder in structured_stakeholders
        ]
        source_attributions.extend(
            bind_model_source_attributions(
                [
                    {
                        "slot_key": "structured_stakeholders",
                        "fact_index": index,
                        "source_ids": [f"client_stakeholder:{source_id}"],
                    }
                    for index, stakeholder in enumerate(structured_stakeholders)
                    if (source_id := str(stakeholder.get("_source_id") or "").strip())
                ],
                ("structured_stakeholders",),
                {
                    "structured_stakeholders": {
                        index: ("item", stakeholder)
                        for index, stakeholder in enumerate(persisted_stakeholders)
                    }
                },
            )
        )
        memory["structured_stakeholders"] = persisted_stakeholders
        if source_snapshots is None:
            current_evidence = build_client_slot_evidence_refs(session, client, memory)
            source_snapshots = {
                f"{ref.get('source_type', '')}:{ref.get('source_id', '')}": str(
                    ref.get("source_sha256") or ""
                )
                for refs in current_evidence.values()
                for ref in refs
                if str(ref.get("source_sha256") or "")
            }
        else:
            # A non-null map is the provider's prompt-time trust boundary.
            # Do not widen it with stakeholders created or changed while the
            # provider was running: doing so could attach those unseen sources
            # as MATCHED/SCOPED evidence to other rebuilt client slots.
            source_snapshots = dict(source_snapshots)

    client.client_memory_rebuild_status = "idle"
    client.client_memory_rebuild_failed_at = None
    set_client_memory_failure(client, None)
    session.add(client)
    from app.services.memory_slots import sync_client_memory_slots
    from app.services.memory_facts import sync_client_memory_facts

    sync_client_memory_slots(
        session,
        client,
        memory,
        slot_keys=selected_slots,
        source_snapshots=source_snapshots,
    )
    sync_client_memory_facts(
        session,
        client,
        memory,
        slot_keys=selected_slots,
        source_attributions=source_attributions,
        source_snapshots=source_snapshots,
        protect_existing_fact_provenance=trigger in {
            "project_promoted",
            "project_archived_auto_promoted",
        },
    )
    session.flush()
    from app.services.memory_slots import get_client_memory_slot_states

    current_states = get_client_memory_slot_states(session, client_id)
    client.client_memory_stale = (
        {state["slot_key"] for state in current_states}
        != set(CLIENT_MEMORY_SLOT_KEYS)
        or any(state["status"] != "ready" for state in current_states)
    )
    memory["stale"] = client.client_memory_stale
    client.client_memory_json = json.dumps(memory, ensure_ascii=False)
    session.add(client)
    session.add(
        ClientMemorySnapshot(
            client_id=client_id,
            memory_version=client.client_memory_version,
            trigger=trigger,
            memory_json=client.client_memory_json,
            created_at=client.client_memory_updated_at,
        )
    )
    if commit:
        session.commit()
        session.refresh(client)
    else:
        session.flush()
    return get_client_memory_payload(client)


def build_client_memory_summary_prompt(
    memory: dict[str, Any],
    client_name: str,
    summary_type: str = "overview",
    language: str | None = None,
) -> str:
    output_language = _resolve_output_language(language)
    normalized_type = summary_type if summary_type in SUPPORTED_CLIENT_MEMORY_SUMMARY_TYPES else "overview"
    compact_memory = build_client_memory_summary_payload(memory, normalized_type)
    instructions = {
        "overview": (
            "Write exactly 3 concise bullet points. Focus on who this client is, how they decide, "
            "the most reusable lessons learned, and what future teams should remember."
        ),
        "stakeholder": (
            "Write exactly 3 concise bullet points focused on stakeholders. Highlight key contacts, "
            "decision style, alignment expectations, and relationship signals future teams should remember."
        ),
        "lessons": (
            "Write exactly 3 concise bullet points focused on reusable lessons learned. Highlight what worked, "
            "what caused friction, and what future teams should repeat or avoid."
        ),
        "client-facing": (
            "Write exactly 3 concise bullet points that are safe to share with a client-facing team. "
            "Focus on current relationship context, collaboration style, and helpful next-step guidance."
        ),
        "risk": (
            "Write exactly 3 concise bullet points focused on client relationship risk. Highlight sensitive topics, "
            "decision friction, stakeholder gaps, and what future teams should handle carefully."
        ),
        "opportunity": (
            "Write exactly 3 concise bullet points focused on growth opportunity. Highlight reusable trust signals, "
            "potential next projects, expansion whitespace, and the strongest momentum hints."
        ),
        "relationship": (
            "Write exactly 3 concise bullet points focused on the client relationship. Highlight trust level, "
            "communication rhythm, sponsor alignment, and what will strengthen the relationship next."
        ),
        "delivery": (
            "Write exactly 3 concise bullet points focused on delivery readiness. Highlight execution preferences, "
            "ways of working, delivery friction, and what future teams should prepare before kickoff."
        ),
    }
    return (
        "You are an AI consultant assistant. "
        f"{instructions[normalized_type]} "
        f"Return ONLY bullet points, one per line, starting with '- '. Write the answer in {output_language}.\n\n"
        f"Client: {client_name}\n"
        f"Summary type: {normalized_type}\n"
        f"Structured client memory JSON:\n{json.dumps(compact_memory, ensure_ascii=False)}"
    )


def _trim_text(value: Any, limit: int = 240) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _trim_list(values: Any, limit: int = 5, text_limit: int = 120) -> list[str]:
    if not isinstance(values, list):
        return []
    trimmed: list[str] = []
    for item in values:
        text = _trim_text(item, text_limit)
        if text:
            trimmed.append(text)
        if len(trimmed) >= limit:
            break
    return trimmed


def _trim_contacts(values: Any, limit: int = 4) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    contacts: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        contact = {
            "name": _trim_text(item.get("name", ""), 40),
            "role": _trim_text(item.get("role", ""), 40),
            "note": _trim_text(item.get("note", ""), 100),
        }
        if contact["name"] or contact["role"] or contact["note"]:
            contacts.append(contact)
        if len(contacts) >= limit:
            break
    return contacts


def _trim_stakeholders(values: Any, limit: int = 6) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    stakeholders: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        row = {
            "name": _trim_text(item.get("name", ""), 60),
            "role": _trim_text(item.get("role", ""), 60),
            "influence_type": _trim_text(item.get("influence_type", ""), 60),
            "relationship_status": _trim_text(item.get("relationship_status", ""), 60),
            "concerns": _trim_text(item.get("concerns", ""), 120),
            "communication_preference": _trim_text(item.get("communication_preference", ""), 100),
            "note": _trim_text(item.get("note", ""), 120),
        }
        if any(row.values()):
            stakeholders.append(row)
        if len(stakeholders) >= limit:
            break
    return stakeholders


def _trim_project_history(values: Any, limit: int = 4) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    history: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        row = {
            "project_name": _trim_text(item.get("project_name", ""), 80),
            "status": _trim_text(item.get("status", ""), 40),
            "outcome": _trim_text(item.get("outcome", ""), 100),
            "key_factor": _trim_text(item.get("key_factor", ""), 100),
        }
        if any(row.values()):
            history.append(row)
        if len(history) >= limit:
            break
    return history


def build_client_memory_summary_payload(memory: dict[str, Any], summary_type: str) -> dict[str, Any]:
    base = {
        "client_profile": _trim_text(memory.get("client_profile", ""), 320),
        "decision_patterns": _trim_list(memory.get("decision_patterns", [])),
        "key_contacts": _trim_contacts(memory.get("key_contacts", [])),
        "structured_stakeholders": _trim_stakeholders(memory.get("structured_stakeholders", [])),
        "lessons_learned": _trim_list(memory.get("lessons_learned", [])),
        "relationship_signals": _trim_list(memory.get("relationship_signals", [])),
        "project_history": _trim_project_history(memory.get("project_history", [])),
        "sensitive_topics": _trim_list(memory.get("sensitive_topics", [])),
    }
    if summary_type == "stakeholder":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "structured_stakeholders": base["structured_stakeholders"],
            "sensitive_topics": base["sensitive_topics"],
        }
    if summary_type == "lessons":
        return {
            "client_profile": base["client_profile"],
            "lessons_learned": base["lessons_learned"],
            "project_history": base["project_history"],
            "relationship_signals": base["relationship_signals"],
            "sensitive_topics": base["sensitive_topics"],
        }
    if summary_type == "client-facing":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "structured_stakeholders": base["structured_stakeholders"],
        }
    if summary_type == "risk":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "structured_stakeholders": base["structured_stakeholders"],
            "sensitive_topics": base["sensitive_topics"],
            "lessons_learned": base["lessons_learned"],
        }
    if summary_type == "opportunity":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "structured_stakeholders": base["structured_stakeholders"],
            "lessons_learned": base["lessons_learned"],
            "project_history": base["project_history"],
        }
    if summary_type == "relationship":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "structured_stakeholders": base["structured_stakeholders"],
            "project_history": base["project_history"],
            "relationship_signals": base["relationship_signals"],
            "sensitive_topics": base["sensitive_topics"],
        }
    if summary_type == "delivery":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "lessons_learned": base["lessons_learned"],
            "project_history": base["project_history"],
            "sensitive_topics": base["sensitive_topics"],
        }
    return base


def get_client_memory_summary_cache(
    session: Session,
    client_id: int,
    summary_type: str,
    language: str | None,
    memory_version: int,
) -> ClientMemorySummary | None:
    normalized_language = normalize_summary_language(language)
    return session.exec(
        select(ClientMemorySummary)
        .where(ClientMemorySummary.client_id == client_id)
        .where(ClientMemorySummary.summary_type == summary_type)
        .where(ClientMemorySummary.language == normalized_language)
        .where(ClientMemorySummary.memory_version == memory_version)
        .order_by(ClientMemorySummary.updated_at.desc())
    ).first()


def save_client_memory_summary_cache(
    session: Session,
    client_id: int,
    summary_type: str,
    language: str | None,
    memory_version: int,
    content: str,
) -> ClientMemorySummary:
    normalized_language = normalize_summary_language(language)
    cached = get_client_memory_summary_cache(
        session,
        client_id=client_id,
        summary_type=summary_type,
        language=normalized_language,
        memory_version=memory_version,
    )
    now = utc_now_naive()
    if cached:
        cached.content = content
        cached.updated_at = now
        session.add(cached)
        session.commit()
        session.refresh(cached)
        return cached

    cached = ClientMemorySummary(
        client_id=client_id,
        summary_type=summary_type,
        language=normalized_language,
        memory_version=memory_version,
        content=content,
        created_at=now,
        updated_at=now,
    )
    session.add(cached)
    session.commit()
    session.refresh(cached)
    return cached
