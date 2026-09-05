"""Owner-native metadata projected through the public memory contract.

Project coverage and the client source-project set affect rebuild provenance,
but they are not business memory slots. Dedicated owner columns are the native
state; aggregate keys remain a temporary read fallback for records that have
not completed the V1.52 migration.
"""
from __future__ import annotations

import json
from typing import Any, Iterable

from app.models.db import ClientRecord, Project


def _parse_object(raw: str | None) -> dict[str, Any] | None:
    if raw is None or not str(raw).strip():
        return {}
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return dict(value) if isinstance(value, dict) else None


def _parse_aggregate(raw: str | None) -> dict[str, Any] | None:
    return _parse_object(raw)


def _normalize_source_project_ids(value: Any) -> list[int] | None:
    if not isinstance(value, list):
        return None
    normalized: list[int] = []
    for item in value:
        if isinstance(item, bool) or not str(item).isdigit():
            return None
        project_id = int(item)
        if project_id <= 0:
            return None
        if project_id not in normalized:
            normalized.append(project_id)
    return normalized


def _parse_source_project_ids(raw: str | None) -> list[int] | None:
    if raw is None or not str(raw).strip():
        return []
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return _normalize_source_project_ids(value)


def _legacy_project_coverage(project: Project) -> dict[str, Any] | None:
    aggregate = _parse_aggregate(project.context_memory_json)
    if aggregate is None or "_coverage" not in aggregate:
        return {}
    value = aggregate.get("_coverage")
    return dict(value) if isinstance(value, dict) else None


def _legacy_client_source_project_ids(client: ClientRecord) -> list[int] | None:
    aggregate = _parse_aggregate(client.client_memory_json)
    if aggregate is None or "source_project_ids" not in aggregate:
        return []
    return _normalize_source_project_ids(aggregate.get("source_project_ids"))


def get_project_memory_coverage(project: Project | None) -> dict[str, Any]:
    if project is None:
        return {}
    native = _parse_object(project.memory_coverage_json)
    if native:
        return native
    legacy = _legacy_project_coverage(project)
    return legacy if legacy is not None else {}


def set_project_memory_coverage(
    project: Project,
    coverage: dict[str, Any] | None,
) -> None:
    project.memory_coverage_json = json.dumps(
        dict(coverage or {}),
        ensure_ascii=False,
        separators=(",", ":"),
    )


def get_client_memory_source_project_ids(
    client: ClientRecord | None,
) -> list[int]:
    if client is None:
        return []
    native = _parse_source_project_ids(client.client_memory_source_project_ids_json)
    if native:
        return native
    legacy = _legacy_client_source_project_ids(client)
    return legacy if legacy is not None else []


def set_client_memory_source_project_ids(
    client: ClientRecord,
    source_project_ids: list[int] | None,
) -> None:
    normalized = _normalize_source_project_ids(list(source_project_ids or []))
    if normalized is None:
        raise ValueError("source_project_ids must contain positive integer IDs")
    client.client_memory_source_project_ids_json = json.dumps(
        normalized,
        separators=(",", ":"),
    )


def build_memory_projection_authority_report(
    projects: Iterable[Project],
    clients: Iterable[ClientRecord],
) -> dict[str, Any]:
    """Summarize native projection coverage without returning any values."""

    project_rows = list(projects)
    client_rows = list(clients)
    project_counts = {
        "native": 0,
        "legacy": 0,
        "missing": 0,
        "divergent": 0,
        "invalid_native": 0,
        "invalid_legacy": 0,
        "invalid_aggregate": 0,
    }
    client_counts = dict.fromkeys(project_counts, 0)

    for project in project_rows:
        aggregate = _parse_aggregate(project.context_memory_json)
        legacy_present = aggregate is not None and "_coverage" in aggregate
        legacy = _legacy_project_coverage(project)
        native = _parse_object(project.memory_coverage_json)
        project_counts["legacy"] += int(legacy_present)
        project_counts["invalid_aggregate"] += int(aggregate is None)
        project_counts["invalid_native"] += int(native is None)
        project_counts["invalid_legacy"] += int(legacy_present and legacy is None)
        project_counts["native"] += int(bool(native))
        project_counts["missing"] += int(bool(legacy) and not native)
        project_counts["divergent"] += int(
            bool(native) and legacy_present and legacy is not None and native != legacy
        )

    for client in client_rows:
        aggregate = _parse_aggregate(client.client_memory_json)
        legacy_present = aggregate is not None and "source_project_ids" in aggregate
        legacy = _legacy_client_source_project_ids(client)
        native = _parse_source_project_ids(
            client.client_memory_source_project_ids_json
        )
        client_counts["legacy"] += int(legacy_present)
        client_counts["invalid_aggregate"] += int(aggregate is None)
        client_counts["invalid_native"] += int(native is None)
        client_counts["invalid_legacy"] += int(legacy_present and legacy is None)
        client_counts["native"] += int(bool(native))
        client_counts["missing"] += int(bool(legacy) and not native)
        client_counts["divergent"] += int(
            bool(native) and legacy_present and legacy is not None and native != legacy
        )

    missing = project_counts["missing"] + client_counts["missing"]
    divergent = project_counts["divergent"] + client_counts["divergent"]
    invalid_native = (
        project_counts["invalid_native"] + client_counts["invalid_native"]
    )
    invalid_legacy = (
        project_counts["invalid_legacy"] + client_counts["invalid_legacy"]
    )
    invalid_aggregate = (
        project_counts["invalid_aggregate"]
        + client_counts["invalid_aggregate"]
    )
    legacy = project_counts["legacy"] + client_counts["legacy"]
    native_cutover_ready = not any(
        (missing, divergent, invalid_native, invalid_legacy, invalid_aggregate)
    )
    return {
        "schema_version": 1,
        "content_included": False,
        "native_cutover_ready": native_cutover_ready,
        "legacy_aggregate_retirement_ready": native_cutover_ready and legacy == 0,
        "missing_native_projection_count": missing,
        "divergent_native_projection_count": divergent,
        "invalid_native_projection_count": invalid_native,
        "invalid_legacy_projection_count": invalid_legacy,
        "invalid_aggregate_storage_count": invalid_aggregate,
        "legacy_aggregate_projection_count": legacy,
        "project": {
            "entity_count": len(project_rows),
            "kind": "coverage",
            **project_counts,
        },
        "client": {
            "entity_count": len(client_rows),
            "kind": "source_project_ids",
            **client_counts,
        },
    }
