"""V1.54 - Move accepted-candidate anchors into a native lifecycle ledger.

Revision ID: 054_v1_54
Revises: 053_v1_53
Create Date: 2026-09-07
"""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "054_v1_54"
down_revision = "053_v1_53"
branch_labels = None
depends_on = None


LEGACY_ANCHOR_KEY = "_accepted_memory_candidates"
PROJECT_ANCHOR_SLOTS = frozenset(
    {
        "recent_progress",
        "key_risks",
        "open_questions",
        "next_actions",
        "delivery_signals",
        "stakeholder_notes",
    }
)
CLIENT_ANCHOR_SLOTS = frozenset(
    {"decision_patterns", "lessons_learned", "relationship_signals"}
)
DEFAULT_TARGET_SLOT = {
    "project_fact": "recent_progress",
    "project_risk": "key_risks",
    "project_next_action": "next_actions",
    "client_preference": "decision_patterns",
    "client_relationship_signal": "relationship_signals",
    "consulting_lesson": "lessons_learned",
}


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(column["name"])
        for column in inspect(op.get_bind()).get_columns(table_name)
    }


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(index["name"])
        for index in inspect(op.get_bind()).get_indexes(table_name)
    }


def _normalize_content(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _content_sha256(value: Any) -> str:
    content = _normalize_content(value)
    return hashlib.sha256(
        f"aria.memory-candidate.content.v1\0{content}".encode("utf-8")
    ).hexdigest()


def _anchor_key(scope: str, entity_id: int, slot_key: str, content: Any) -> str:
    digest = hashlib.sha256(
        (
            f"aria.memory-candidate-anchor.v1\0{scope}\0{int(entity_id)}\0"
            f"{slot_key}\0{_content_sha256(content)}"
        ).encode("utf-8")
    ).hexdigest()
    return f"{scope[:1]}mca_{digest[:24]}"


def _question_sha256(value: Any) -> str:
    normalized = _normalize_content(value)[:360]
    return hashlib.sha256(
        f"aria.project-question.v1\0{normalized}".encode("utf-8")
    ).hexdigest()


def _parse_object(raw: Any) -> dict[str, Any] | None:
    if raw is None or not str(raw).strip():
        return {}
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return None
    return dict(value) if isinstance(value, dict) else None


def _coerce_datetime(value: Any, fallback: datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return fallback


def _create_anchor_table() -> None:
    required_parents = {"project", "clientrecord", "memorycandidate", "user"}
    if not required_parents.issubset(_tables()):
        return
    if "memorycandidateanchor" not in _tables():
        op.create_table(
            "memorycandidateanchor",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("anchor_key", sa.String(), nullable=False),
            sa.Column("scope", sa.String(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("client_id", sa.Integer(), nullable=True),
            sa.Column("slot_key", sa.String(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("content_sha256", sa.String(), nullable=False),
            sa.Column("source_candidate_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="active"),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("activated_by_user_id", sa.Integer(), nullable=True),
            sa.Column("retired_by_user_id", sa.Integer(), nullable=True),
            sa.Column("retirement_reason", sa.String(), nullable=False, server_default=""),
            sa.Column("activated_at", sa.DateTime(), nullable=False),
            sa.Column("retired_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint(
                "scope IN ('project', 'client')",
                name="ck_memorycandidateanchor_scope",
            ),
            sa.CheckConstraint(
                "status IN ('active', 'retired')",
                name="ck_memorycandidateanchor_status",
            ),
            sa.CheckConstraint(
                "revision >= 1",
                name="ck_memorycandidateanchor_revision",
            ),
            sa.CheckConstraint(
                "(scope = 'project' AND project_id IS NOT NULL AND client_id IS NULL) "
                "OR (scope = 'client' AND client_id IS NOT NULL AND project_id IS NULL)",
                name="ck_memorycandidateanchor_owner",
            ),
            sa.ForeignKeyConstraint(
                ["project_id"], ["project.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["client_id"], ["clientrecord.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["source_candidate_id"], ["memorycandidate.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["activated_by_user_id"], ["user.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["retired_by_user_id"], ["user.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "anchor_key",
                name="uq_memorycandidateanchor_anchor_key",
            ),
        )
    existing_indexes = _indexes("memorycandidateanchor")
    for name, columns in (
        ("ix_memorycandidateanchor_scope", ["scope"]),
        ("ix_memorycandidateanchor_project_id", ["project_id"]),
        ("ix_memorycandidateanchor_client_id", ["client_id"]),
        ("ix_memorycandidateanchor_slot_key", ["slot_key"]),
        ("ix_memorycandidateanchor_content_sha256", ["content_sha256"]),
        ("ix_memorycandidateanchor_source_candidate_id", ["source_candidate_id"]),
        ("ix_memorycandidateanchor_status", ["status"]),
        ("ix_memorycandidateanchor_activated_by_user_id", ["activated_by_user_id"]),
        ("ix_memorycandidateanchor_retired_by_user_id", ["retired_by_user_id"]),
        ("ix_memorycandidateanchor_updated_at", ["updated_at"]),
    ):
        if name not in existing_indexes:
            op.create_index(name, "memorycandidateanchor", columns)


def _anchor_table() -> sa.Table:
    return sa.table(
        "memorycandidateanchor",
        sa.column("id", sa.Integer()),
        sa.column("anchor_key", sa.String()),
        sa.column("scope", sa.String()),
        sa.column("project_id", sa.Integer()),
        sa.column("client_id", sa.Integer()),
        sa.column("slot_key", sa.String()),
        sa.column("content", sa.Text()),
        sa.column("content_sha256", sa.String()),
        sa.column("source_candidate_id", sa.Integer()),
        sa.column("status", sa.String()),
        sa.column("revision", sa.Integer()),
        sa.column("activated_by_user_id", sa.Integer()),
        sa.column("retired_by_user_id", sa.Integer()),
        sa.column("retirement_reason", sa.String()),
        sa.column("activated_at", sa.DateTime()),
        sa.column("retired_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )


def _resolved_question_hashes() -> dict[int, set[str]]:
    required = {"project_id", "question_sha256", "status"}
    if "projectquestionresolution" not in _tables() or not required.issubset(
        _columns("projectquestionresolution")
    ):
        return {}
    resolution = sa.table(
        "projectquestionresolution",
        sa.column("project_id", sa.Integer()),
        sa.column("question_sha256", sa.String()),
        sa.column("status", sa.String()),
    )
    rows = op.get_bind().execute(
        sa.select(resolution.c.project_id, resolution.c.question_sha256).where(
            resolution.c.status == "resolved"
        )
    ).all()
    result: dict[int, set[str]] = {}
    for project_id, question_sha256 in rows:
        result.setdefault(int(project_id), set()).add(str(question_sha256 or ""))
    return result


def _upsert_anchor(
    *,
    scope: str,
    entity_id: int,
    slot_key: str,
    content: Any,
    source_candidate_id: int | None,
    activated_by_user_id: int | None,
    activated_at: Any,
    resolved_questions: dict[int, set[str]],
) -> None:
    normalized_content = _normalize_content(content)
    if not normalized_content:
        return
    allowed = PROJECT_ANCHOR_SLOTS if scope == "project" else CLIENT_ANCHOR_SLOTS
    if slot_key not in allowed:
        return
    anchor = _anchor_table()
    key = _anchor_key(scope, entity_id, slot_key, normalized_content)
    now = datetime.utcnow()
    is_retired = bool(
        scope == "project"
        and slot_key == "open_questions"
        and _question_sha256(normalized_content)
        in resolved_questions.get(entity_id, set())
    )
    status = "retired" if is_retired else "active"
    existing = op.get_bind().execute(
        sa.select(anchor).where(anchor.c.anchor_key == key).with_for_update()
    ).mappings().first()
    insert_values = {
        "content": normalized_content,
        "content_sha256": _content_sha256(normalized_content),
        "source_candidate_id": source_candidate_id,
        "status": status,
        "activated_by_user_id": activated_by_user_id,
        "retired_by_user_id": None,
        "retirement_reason": "question_resolved" if is_retired else "",
        "activated_at": _coerce_datetime(activated_at, now),
        "retired_at": now if is_retired else None,
        "updated_at": now,
    }
    if existing is None:
        op.get_bind().execute(
            anchor.insert().values(
                anchor_key=key,
                scope=scope,
                project_id=entity_id if scope == "project" else None,
                client_id=entity_id if scope == "client" else None,
                slot_key=slot_key,
                revision=1,
                created_at=now,
                **insert_values,
            )
        )
        return
    values: dict[str, Any] = {}
    for field in ("content", "content_sha256"):
        if existing.get(field) != insert_values[field]:
            values[field] = insert_values[field]
    if (
        source_candidate_id is not None
        and existing.get("source_candidate_id") != source_candidate_id
    ):
        values["source_candidate_id"] = source_candidate_id
    if (
        activated_by_user_id is not None
        and existing.get("activated_by_user_id") is None
    ):
        values["activated_by_user_id"] = activated_by_user_id
    if existing.get("status") != status:
        values.update(
            {
                "status": status,
                "revision": max(1, int(existing.get("revision") or 0) + 1),
                "retired_by_user_id": None,
                "retirement_reason": "question_resolved" if is_retired else "",
                "retired_at": now if is_retired else None,
            }
        )
        if status == "active":
            values["activated_at"] = _coerce_datetime(activated_at, now)
    if not values:
        return
    values["updated_at"] = now
    op.get_bind().execute(
        anchor.update().where(anchor.c.anchor_key == key).values(**values)
    )


def _backfill_accepted_candidates(
    resolved_questions: dict[int, set[str]],
) -> dict[tuple[str, int, str, str], int]:
    required = {
        "id",
        "scope",
        "candidate_type",
        "content",
        "status",
        "target_slot",
        "project_id",
        "client_id",
        "resolved_by_user_id",
        "resolved_at",
        "created_at",
    }
    if "memorycandidate" not in _tables() or not required.issubset(
        _columns("memorycandidate")
    ):
        return {}
    candidate = sa.table(
        "memorycandidate",
        *(sa.column(name) for name in sorted(required)),
    )
    rows = op.get_bind().execute(
        sa.select(candidate).where(candidate.c.status == "accepted").with_for_update()
    ).mappings().all()
    lookup: dict[tuple[str, int, str, str], int] = {}
    for row in rows:
        scope = str(row.get("scope") or "").strip().lower()
        if scope not in {"project", "client"}:
            continue
        entity_id = int(
            (row.get("project_id") if scope == "project" else row.get("client_id"))
            or 0
        )
        if entity_id <= 0:
            continue
        slot_key = str(row.get("target_slot") or "").strip() or DEFAULT_TARGET_SLOT.get(
            str(row.get("candidate_type") or "").strip(),
            "",
        )
        content = _normalize_content(row.get("content"))
        allowed = PROJECT_ANCHOR_SLOTS if scope == "project" else CLIENT_ANCHOR_SLOTS
        if slot_key not in allowed or not content:
            continue
        candidate_id = int(row["id"])
        lookup[(scope, entity_id, slot_key, content)] = candidate_id
        _upsert_anchor(
            scope=scope,
            entity_id=entity_id,
            slot_key=slot_key,
            content=content,
            source_candidate_id=candidate_id,
            activated_by_user_id=row.get("resolved_by_user_id"),
            activated_at=row.get("resolved_at") or row.get("created_at"),
            resolved_questions=resolved_questions,
        )
    return lookup


def _migrate_aggregate_anchors(
    *,
    scope: str,
    owner_table_name: str,
    memory_column_name: str,
    candidate_lookup: dict[tuple[str, int, str, str], int],
    resolved_questions: dict[int, set[str]],
) -> None:
    if owner_table_name not in _tables() or not {"id", memory_column_name}.issubset(
        _columns(owner_table_name)
    ):
        return
    owner = sa.table(
        owner_table_name,
        sa.column("id", sa.Integer()),
        sa.column(memory_column_name, sa.Text()),
    )
    memory_column = getattr(owner.c, memory_column_name)
    allowed_slots = PROJECT_ANCHOR_SLOTS if scope == "project" else CLIENT_ANCHOR_SLOTS
    rows = op.get_bind().execute(sa.select(owner).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get(memory_column_name))
        if memory is None or LEGACY_ANCHOR_KEY not in memory:
            continue
        raw_anchors = memory.get(LEGACY_ANCHOR_KEY)
        if not isinstance(raw_anchors, dict):
            continue
        valid_shape = all(
            str(slot_key) in allowed_slots
            and isinstance(items, list)
            and all(isinstance(item, str) for item in items)
            for slot_key, items in raw_anchors.items()
        )
        if not valid_shape:
            continue
        entity_id = int(row["id"])
        for raw_slot, items in raw_anchors.items():
            slot_key = str(raw_slot)
            for item in items:
                content = _normalize_content(item)
                if not content:
                    continue
                _upsert_anchor(
                    scope=scope,
                    entity_id=entity_id,
                    slot_key=slot_key,
                    content=content,
                    source_candidate_id=candidate_lookup.get(
                        (scope, entity_id, slot_key, content)
                    ),
                    activated_by_user_id=None,
                    activated_at=None,
                    resolved_questions=resolved_questions,
                )
        memory.pop(LEGACY_ANCHOR_KEY, None)
        op.get_bind().execute(
            owner.update()
            .where(owner.c.id == entity_id)
            .values({memory_column_name: json.dumps(memory, ensure_ascii=False)})
        )


def _restore_aggregate_anchors(
    *,
    scope: str,
    owner_table_name: str,
    memory_column_name: str,
) -> None:
    if "memorycandidateanchor" not in _tables() or owner_table_name not in _tables():
        return
    if not {"id", memory_column_name}.issubset(_columns(owner_table_name)):
        return
    anchor = _anchor_table()
    owner = sa.table(
        owner_table_name,
        sa.column("id", sa.Integer()),
        sa.column(memory_column_name, sa.Text()),
    )
    anchor_rows = op.get_bind().execute(
        sa.select(anchor).where(
            anchor.c.scope == scope,
            anchor.c.status == "active",
        )
    ).mappings().all()
    by_owner: dict[int, dict[str, list[str]]] = {}
    for row in anchor_rows:
        owner_id = int(row["project_id"] if scope == "project" else row["client_id"])
        by_owner.setdefault(owner_id, {}).setdefault(str(row["slot_key"]), []).append(
            str(row["content"])
        )
    memory_column = getattr(owner.c, memory_column_name)
    for owner_id, anchors in by_owner.items():
        raw = op.get_bind().execute(
            sa.select(memory_column).where(owner.c.id == owner_id).with_for_update()
        ).scalar_one_or_none()
        memory = _parse_object(raw)
        if memory is None or LEGACY_ANCHOR_KEY in memory:
            continue
        memory[LEGACY_ANCHOR_KEY] = anchors
        op.get_bind().execute(
            owner.update()
            .where(owner.c.id == owner_id)
            .values({memory_column_name: json.dumps(memory, ensure_ascii=False)})
        )


def upgrade() -> None:
    _create_anchor_table()
    if "memorycandidateanchor" not in _tables():
        return
    resolved_questions = _resolved_question_hashes()
    candidate_lookup = _backfill_accepted_candidates(resolved_questions)
    _migrate_aggregate_anchors(
        scope="project",
        owner_table_name="project",
        memory_column_name="context_memory_json",
        candidate_lookup=candidate_lookup,
        resolved_questions=resolved_questions,
    )
    _migrate_aggregate_anchors(
        scope="client",
        owner_table_name="clientrecord",
        memory_column_name="client_memory_json",
        candidate_lookup=candidate_lookup,
        resolved_questions=resolved_questions,
    )


def downgrade() -> None:
    _restore_aggregate_anchors(
        scope="project",
        owner_table_name="project",
        memory_column_name="context_memory_json",
    )
    _restore_aggregate_anchors(
        scope="client",
        owner_table_name="clientrecord",
        memory_column_name="client_memory_json",
    )
    if "memorycandidateanchor" in _tables():
        op.drop_table("memorycandidateanchor")
