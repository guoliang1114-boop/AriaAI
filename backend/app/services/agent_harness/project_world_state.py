"""Privacy-safe project state versions and per-turn change summaries.

The manifest stores entity identities and hashes only.  It lets Aria detect
that operational project facts changed between turns without copying file
names, todo text, stakeholder notes, or financial details into message audit
metadata.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

from sqlmodel import Session, select

from app.models.db import (
    ClientStakeholder,
    GeneratedFile,
    Message,
    Milestone,
    Project,
    ProjectFile,
    ProjectFolder,
    ProjectPayment,
    ProjectProgressUpdate,
    ProjectTodo,
)
from app.services.project_clients import find_client_for_project

WORLD_STATE_SCHEMA_VERSION = 2
WORLD_STATE_MAX_ITEMS_PER_CATEGORY = 50
WORLD_STATE_CATEGORIES = (
    "project",
    "milestones",
    "todos",
    "folders",
    "files",
    "progress",
    "financials",
    "stakeholders",
    "deliverables",
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))


def _sha256(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _item(identity: Any, state: Any) -> dict[str, str]:
    return {"id": str(identity), "state_sha256": _sha256(state)}


def _category(items: Iterable[dict[str, str]]) -> dict[str, Any]:
    all_items = sorted(list(items), key=lambda item: item["id"])
    visible = all_items[:WORLD_STATE_MAX_ITEMS_PER_CATEGORY]
    return {
        "count": len(all_items),
        "items": visible,
        "fingerprint": _sha256(all_items),
        "truncated": len(all_items) > len(visible),
    }


def build_project_world_state_manifest(session: Session, project_id: int) -> dict[str, Any]:
    """Build a bounded, content-free version of the current project state."""

    project = session.get(Project, project_id)
    if project is None:
        return {}

    milestones = session.exec(select(Milestone).where(Milestone.project_id == project_id)).all()
    todos = session.exec(select(ProjectTodo).where(ProjectTodo.project_id == project_id)).all()
    folders = session.exec(select(ProjectFolder).where(ProjectFolder.project_id == project_id)).all()
    files = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id, ProjectFile.deleted_at.is_(None))
    ).all()
    progress = session.exec(
        select(ProjectProgressUpdate).where(ProjectProgressUpdate.project_id == project_id)
    ).all()
    payments = session.exec(
        select(ProjectPayment).where(ProjectPayment.project_id == project_id)
    ).all()
    deliverables = session.exec(
        select(GeneratedFile).where(GeneratedFile.project_id == project_id)
    ).all()
    client = find_client_for_project(session, project)
    stakeholders = (
        session.exec(
            select(ClientStakeholder).where(ClientStakeholder.client_id == client.id)
        ).all()
        if client and client.id is not None
        else []
    )

    categories = {
        "project": _category([
            _item(
                project_id,
                {
                    "status": project.status,
                    "client_id": project.client_id,
                    "description": project.description,
                    "contract_amount": project.contract_amount,
                    "memory_version": project.memory_version,
                    "memory_stale": project.memory_stale,
                    "updated_at": project.updated_at,
                },
            )
        ]),
        "milestones": _category(
            _item(item.id, (item.title, item.is_done, item.priority, item.due_date))
            for item in milestones
        ),
        "todos": _category(
            _item(
                item.id,
                (item.content, item.is_done, item.due_date, item.assigned_to_user_id, item.updated_at),
            )
            for item in todos
        ),
        "folders": _category(
            _item(item.id, (item.name, item.sort_order))
            for item in folders
        ),
        "files": _category(
            _item(
                item.id,
                (
                    item.name,
                    item.file_type,
                    item.size_bytes,
                    item.summary,
                    item.origin,
                    item.folder_id,
                    item.uploaded_at,
                ),
            )
            for item in files
        ),
        "progress": _category(
            _item(item.id, (item.content, item.next_step, item.risk, item.created_at))
            for item in progress
        ),
        "financials": _category(
            _item(item.id, (item.amount, item.payment_date, item.payment_type, item.note))
            for item in payments
        ),
        "stakeholders": _category(
            _item(
                item.id,
                (
                    item.name,
                    item.role,
                    item.organization_level,
                    item.influence_type,
                    item.relationship_status,
                    item.concerns,
                    item.last_action,
                    item.updated_at,
                ),
            )
            for item in stakeholders
        ),
        "deliverables": _category(
            _item(
                item.id,
                (item.name, item.file_type, item.size_bytes, item.content_sha256, item.output_id),
            )
            for item in deliverables
        ),
    }
    core = {
        "schema_version": WORLD_STATE_SCHEMA_VERSION,
        "project_id": project_id,
        "categories": categories,
    }
    fingerprint = _sha256(core)
    return {
        **core,
        "version": fingerprint[:12],
        "fingerprint": fingerprint,
        "truncated": any(bool(category["truncated"]) for category in categories.values()),
    }


def normalize_project_world_state_manifest(value: Any, *, project_id: int | None = None) -> dict[str, Any]:
    """Accept only the bounded manifest shape emitted by this module."""

    if not isinstance(value, dict):
        return {}
    if value.get("schema_version") != WORLD_STATE_SCHEMA_VERSION:
        return {}
    try:
        manifest_project_id = int(value.get("project_id"))
    except (TypeError, ValueError):
        return {}
    if manifest_project_id <= 0 or (project_id is not None and manifest_project_id != project_id):
        return {}
    fingerprint = str(value.get("fingerprint") or "").lower()
    version = str(value.get("version") or "").lower()
    if len(fingerprint) != 64 or any(char not in "0123456789abcdef" for char in fingerprint):
        return {}
    if version != fingerprint[:12]:
        return {}
    raw_categories = value.get("categories")
    if not isinstance(raw_categories, dict):
        return {}
    categories: dict[str, Any] = {}
    for name in WORLD_STATE_CATEGORIES:
        category = raw_categories.get(name)
        if not isinstance(category, dict):
            return {}
        raw_items = category.get("items")
        if not isinstance(raw_items, list) or len(raw_items) > WORLD_STATE_MAX_ITEMS_PER_CATEGORY:
            return {}
        items: list[dict[str, str]] = []
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                return {}
            identity = str(raw_item.get("id") or "")[:80]
            state_sha = str(raw_item.get("state_sha256") or "").lower()
            if not identity or len(state_sha) != 64 or any(char not in "0123456789abcdef" for char in state_sha):
                return {}
            items.append({"id": identity, "state_sha256": state_sha})
        try:
            count = max(0, int(category.get("count") or 0))
        except (TypeError, ValueError):
            return {}
        category_fingerprint = str(category.get("fingerprint") or "").lower()
        if (
            count < len(items)
            or len(category_fingerprint) != 64
            or any(char not in "0123456789abcdef" for char in category_fingerprint)
        ):
            return {}
        categories[name] = {
            "count": count,
            "items": items,
            "fingerprint": category_fingerprint,
            "truncated": bool(category.get("truncated", False)),
        }
    return {
        "schema_version": WORLD_STATE_SCHEMA_VERSION,
        "project_id": manifest_project_id,
        "version": version,
        "fingerprint": fingerprint,
        "categories": categories,
        "truncated": bool(value.get("truncated", False)),
    }


def compare_project_world_states(previous: Any, current: Any) -> dict[str, Any]:
    """Return category-level additions, removals and updates without content."""

    normalized_current = normalize_project_world_state_manifest(current)
    if not normalized_current:
        return {}
    normalized_previous = normalize_project_world_state_manifest(
        previous,
        project_id=normalized_current["project_id"],
    )
    if not normalized_previous:
        return {
            "schema_version": WORLD_STATE_SCHEMA_VERSION,
            "baseline": True,
            "changed": False,
            "previous_version": None,
            "current_version": normalized_current["version"],
            "changed_categories": [],
            "categories": {},
        }

    changes: dict[str, dict[str, int]] = {}
    for name in WORLD_STATE_CATEGORIES:
        before = normalized_previous["categories"][name]
        after = normalized_current["categories"][name]
        if before["fingerprint"] == after["fingerprint"]:
            continue
        before_items = {item["id"]: item["state_sha256"] for item in before["items"]}
        after_items = {item["id"]: item["state_sha256"] for item in after["items"]}
        visible_added = len(after_items.keys() - before_items.keys())
        visible_removed = len(before_items.keys() - after_items.keys())
        changes[name] = {
            "added": max(visible_added, int(after["count"]) - int(before["count"])),
            "removed": max(visible_removed, int(before["count"]) - int(after["count"])),
            "updated": sum(
                1
                for identity in before_items.keys() & after_items.keys()
                if before_items[identity] != after_items[identity]
            ),
            "current_count": int(after["count"]),
            "truncated": bool(before["truncated"] or after["truncated"]),
        }
    changed_categories = list(changes)
    return {
        "schema_version": WORLD_STATE_SCHEMA_VERSION,
        "baseline": False,
        "changed": bool(changed_categories),
        "previous_version": normalized_previous["version"],
        "current_version": normalized_current["version"],
        "changed_categories": changed_categories,
        "categories": changes,
    }


def latest_project_world_state(
    session: Session,
    conversation_id: int,
    *,
    project_id: int,
) -> dict[str, Any]:
    """Load the newest valid state manifest already audited in this conversation."""

    messages = session.exec(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(60)
    ).all()
    for message in messages:
        metadata = message.get_metadata()
        reservation = metadata.get("recovery_reservation")
        if (
            isinstance(reservation, dict)
            and str(reservation.get("status") or "") in {"reserved", "expired"}
        ):
            continue
        manifest = normalize_project_world_state_manifest(
            metadata.get("project_world_state"),
            project_id=project_id,
        )
        if manifest:
            return manifest
    return {}


def format_project_world_state_change_for_prompt(change: Any) -> str:
    """Format only safe category counts for the model's current-state guard."""

    if not isinstance(change, dict) or not change.get("changed"):
        return ""
    categories = change.get("categories") if isinstance(change.get("categories"), dict) else {}
    lines = [
        "## Project State Change Guard",
        "Operational project state changed since the previous audited turn.",
        "Use the current project context as authoritative and do not repeat side effects based on stale history.",
    ]
    for name in list(change.get("changed_categories") or [])[:8]:
        counts = categories.get(name) if isinstance(categories.get(name), dict) else {}
        lines.append(
            f"- {name}: +{int(counts.get('added') or 0)} / "
            f"-{int(counts.get('removed') or 0)} / "
            f"updated {int(counts.get('updated') or 0)}"
        )
    return "\n".join(lines)
