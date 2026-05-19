"""Memory formatters for context builder."""
import json

from app.models.db import ClientRecord, Project
from app.services.project_contexts import get_project_memory_payload
from app.services.stakeholder_contexts import format_client_stakeholders_for_prompt


def _format_project_memory_for_prompt(project: Project) -> str:
    memory = get_project_memory_payload(project)
    if not memory or (project.memory_version or 0) <= 0:
        return ""

    lines: list[str] = []
    if memory.get("project_brief"):
        lines.append(f"- Project brief: {memory['project_brief']}")
    if memory.get("current_stage"):
        lines.append(f"- Current stage: {memory['current_stage']}")
    if memory.get("current_objective"):
        lines.append(f"- Current objective: {memory['current_objective']}")

    for key, label in (
        ("recent_progress", "Recent progress"),
        ("key_risks", "Key risks"),
        ("open_questions", "Open questions"),
        ("next_actions", "Next actions"),
    ):
        items = [str(item).strip() for item in (memory.get(key) or []) if str(item).strip()]
        if items:
            lines.append(f"- {label}: " + "; ".join(items[:4]))

    important_documents = memory.get("important_documents") or []
    document_bits: list[str] = []
    for document in important_documents[:4]:
        if isinstance(document, dict):
            name = str(document.get("name") or "").strip()
            summary = str(document.get("summary") or "").strip()
            if name and summary:
                document_bits.append(f"{name}: {summary}")
            elif name:
                document_bits.append(name)
        elif document:
            document_bits.append(str(document).strip())
    if document_bits:
        lines.append("- Important documents: " + "; ".join(document_bits))

    if memory.get("financial_status"):
        lines.append(f"- Financial status: {memory['financial_status']}")

    structured = memory.get("client_stakeholders") or []
    if isinstance(structured, list):
        structured_context = format_client_stakeholders_for_prompt(
            [item for item in structured if isinstance(item, dict)],
            title="Client stakeholders",
        )
        if structured_context:
            lines.append(structured_context)

    if not lines:
        return ""
    return "**Structured Project Memory:**\n" + "\n".join(lines)


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
    return "**Structured Client Memory:**\n" + "\n".join(lines)


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
