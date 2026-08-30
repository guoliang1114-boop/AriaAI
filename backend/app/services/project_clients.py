"""Stable Project -> ClientRecord relationship helpers.

``Project.client`` remains a display snapshot only. Relationship reads use
``Project.client_id`` so mutable, duplicate, or recreated names cannot change
a project's business scope.

The stable-entity boundary adapts the world-state identity principle from
OpenAI Codex ``codex-rs/core/src/context/world_state/mod.rs`` at upstream
commit ``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).
This implementation is rewritten for Aria's SQLModel business entities and
does not import, start, or communicate with Codex.
"""
from __future__ import annotations

from sqlmodel import Session, select

from app.models.db import ClientRecord, Project
from app.services.client_identity import (
    client_identity_expression,
    resolve_client_identity,
)


def clients_matching_name(
    session: Session,
    client_name: str | None,
    *,
    for_update: bool = False,
) -> list[ClientRecord]:
    """Return at most two normalized-name matches in stable ID order.

    Two rows are enough to distinguish an explicit, unique compatibility write
    from an ambiguous one. Runtime relationship reads never call this helper.
    """

    identity = resolve_client_identity(session, client_name)
    if not identity:
        return []
    statement = (
        select(ClientRecord)
        .where(client_identity_expression(ClientRecord.name) == identity)
        .order_by(ClientRecord.id)
        .limit(2)
    )
    if for_update:
        statement = statement.with_for_update()
    return list(session.exec(statement).all())


def find_client_for_project(session: Session, project: Project) -> ClientRecord | None:
    """Resolve a project's client exclusively through its stable identity.

    Name matching is intentionally limited to explicit project write flows.
    Treating every NULL-ID row as historical would let a client created later
    claim an unrelated free-text project with the same name.
    """

    if project.client_id is None:
        return None
    return session.get(ClientRecord, int(project.client_id))


def project_belongs_to_client(
    session: Session,
    project: Project,
    client: ClientRecord,
) -> bool:
    """Return whether ``project`` belongs to ``client`` by stable identity."""

    return (
        project.client_id is not None
        and int(project.client_id) == int(client.id or 0)
    )


def list_projects_for_client(
    session: Session,
    client: ClientRecord,
    *,
    for_update: bool = False,
) -> list[Project]:
    """List projects linked to exactly one stable client identity.

    Migration 035 performs the only automatic legacy-name backfill. Runtime
    reads never infer ownership from mutable display text.
    """

    client_id = int(client.id or 0)
    statement = (
        select(Project)
        .where(Project.client_id == client_id)
        .order_by(Project.id)
    )
    if for_update:
        statement = statement.with_for_update()
    return list(session.exec(statement).all())
