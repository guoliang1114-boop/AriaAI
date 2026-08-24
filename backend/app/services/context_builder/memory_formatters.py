"""Memory formatters for context builder."""
from __future__ import annotations

import json

from app.models.db import ClientRecord, Project
from app.services.agent_harness.project_memory_evidence import (
    build_project_memory_evidence,
)
from app.services.stakeholder_contexts import format_client_stakeholders_for_prompt


def _format_project_memory_for_prompt(
    project: Project,
    query: str = "",
    *,
    evidence_bundle: dict | None = None,
) -> str:
    """Render only the structured-memory slots relevant to this question."""

    bundle = evidence_bundle or build_project_memory_evidence(project, query)
    return str(bundle.get("prompt") or "")


def _format_client_memory_for_prompt(client: ClientRecord) -> str:
    try:
        memory = json.loads(client.client_memory_json or "{}")
        if not isinstance(memory, dict):
            memory = {}
    except Exception:
        memory = {}

    if not memory or (client.client_memory_version or 0) <= 0:
        return ""

    lines: list[str] = []
    if client.client_memory_stale:
        lines.append(
            "- Memory freshness: STALE. Prefer newer project facts and current user input, "
            "and disclose when a conclusion materially depends on this stale synthesis."
        )
    if memory.get("client_profile"):
        lines.append(f"- Client profile: {memory['client_profile']}")
    for key, label in (
        ("decision_patterns", "Decision patterns"),
        ("lessons_learned", "Lessons learned"),
        ("sensitive_topics", "Sensitive topics"),
    ):
        items = [str(item).strip() for item in (memory.get(key) or []) if str(item).strip()]
        if items:
            lines.append(f"- {label}: " + "; ".join(items[:4]))

    contacts = memory.get("key_contacts") or []
    contact_bits: list[str] = []
    for item in contacts[:4]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        role = str(item.get("role") or "").strip()
        note = str(item.get("note") or "").strip()
        bit = " / ".join(part for part in (name, role, note) if part)
        if bit:
            contact_bits.append(bit)
    if contact_bits:
        lines.append("- Key contacts: " + "; ".join(contact_bits))

    structured = memory.get("structured_stakeholders") or []
    if isinstance(structured, list):
        structured_context = format_client_stakeholders_for_prompt(
            [item for item in structured if isinstance(item, dict)],
            title="Structured stakeholders",
        )
        if structured_context:
            lines.append(structured_context)

    if not lines:
        return ""
    heading = (
        "**Structured Client Memory (STALE):**"
        if client.client_memory_stale
        else "**Structured Client Memory:**"
    )
    return heading + "\n" + "\n".join(lines)


def _memory_items_for_portfolio(memory: dict, key: str, limit: int = 4) -> list[str]:
    raw = memory.get(key)
    if isinstance(raw, dict):
        values = []
        for slot in ("pinned", "ai"):
            slot_value = raw.get(slot)
            if isinstance(slot_value, list):
                values.extend(slot_value)
        raw = values
    if not isinstance(raw, list):
        return []
    items = []
    for item in raw:
        text = str(item or "").strip()
        if text:
            items.append(text[:180])
        if len(items) >= limit:
            break
    return items
