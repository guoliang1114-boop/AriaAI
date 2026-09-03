"""Native operational state for project and client memory workflows.

The aggregate memory JSON remains a compatibility projection during the
cutover.  Operational receipts are read from dedicated owner columns first;
legacy aggregate keys are used only when a row has not been backfilled yet.
"""
from __future__ import annotations

import json
from typing import Any, Iterable

from app.models.db import ClientRecord, Project


def _parse_object(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    return dict(value) if isinstance(value, dict) else {}


def _legacy_object(raw_memory: str | None, key: str) -> dict[str, Any]:
    memory = _parse_object(raw_memory)
    value = memory.get(key)
    return dict(value) if isinstance(value, dict) else {}


def get_project_memory_failure(project: Project | None) -> dict[str, Any]:
    if project is None:
        return {}
    native = _parse_object(project.memory_last_failure_json)
    return native or _legacy_object(project.context_memory_json, "_last_failure")


def set_project_memory_failure(project: Project, failure: dict[str, Any] | None) -> None:
    project.memory_last_failure_json = (
        json.dumps(failure, ensure_ascii=False) if failure else ""
    )


def get_project_client_promotion(project: Project | None) -> dict[str, Any]:
    if project is None:
        return {}
    native = _parse_object(project.client_memory_promotion_json)
    return native or _legacy_object(project.context_memory_json, "_client_promotion")


def set_project_client_promotion(
    project: Project,
    promotion: dict[str, Any] | None,
) -> None:
    project.client_memory_promotion_json = (
        json.dumps(promotion, ensure_ascii=False) if promotion else ""
    )


def get_client_memory_failure(client: ClientRecord | None) -> dict[str, Any]:
    if client is None:
        return {}
    native = _parse_object(client.client_memory_last_failure_json)
    return native or _legacy_object(client.client_memory_json, "_last_failure")


def set_client_memory_failure(
    client: ClientRecord,
    failure: dict[str, Any] | None,
) -> None:
    client.client_memory_last_failure_json = (
        json.dumps(failure, ensure_ascii=False) if failure else ""
    )


def get_client_memory_rebuild_generation(client: ClientRecord | None) -> str:
    if client is None:
        return ""
    native = str(client.client_memory_rebuild_generation or "").strip()
    if native:
        return native
    # The legacy value is a string rather than an object, so inspect the
    # aggregate directly while keeping malformed payloads fail-closed.
    memory = _parse_object(client.client_memory_json)
    return str(memory.get("_rebuild_generation") or "").strip()


def set_client_memory_rebuild_generation(
    client: ClientRecord,
    generation: str,
) -> None:
    client.client_memory_rebuild_generation = str(generation or "").strip()


def build_memory_operation_authority_report(
    projects: Iterable[Project],
    clients: Iterable[ClientRecord],
) -> dict[str, Any]:
    """Summarize native-vs-legacy operation state without returning values."""

    project_rows = list(projects)
    client_rows = list(clients)
    project_missing = {"last_failure": 0, "client_promotion": 0}
    project_divergent = {"last_failure": 0, "client_promotion": 0}
    project_native = {"last_failure": 0, "client_promotion": 0}
    client_missing = {"last_failure": 0, "rebuild_generation": 0}
    client_divergent = {"last_failure": 0, "rebuild_generation": 0}
    client_native = {"last_failure": 0, "rebuild_generation": 0}

    for project in project_rows:
        pairs = {
            "last_failure": (
                _parse_object(project.memory_last_failure_json),
                _legacy_object(project.context_memory_json, "_last_failure"),
            ),
            "client_promotion": (
                _parse_object(project.client_memory_promotion_json),
                _legacy_object(project.context_memory_json, "_client_promotion"),
            ),
        }
        for key, (native, legacy) in pairs.items():
            project_native[key] += int(bool(native))
            project_missing[key] += int(bool(legacy) and not native)
            project_divergent[key] += int(bool(native) and bool(legacy) and native != legacy)

    for client in client_rows:
        native_failure = _parse_object(client.client_memory_last_failure_json)
        legacy_failure = _legacy_object(client.client_memory_json, "_last_failure")
        native_generation = str(client.client_memory_rebuild_generation or "").strip()
        legacy_memory = _parse_object(client.client_memory_json)
        legacy_generation = str(legacy_memory.get("_rebuild_generation") or "").strip()
        pairs = {
            "last_failure": (native_failure, legacy_failure),
            "rebuild_generation": (native_generation, legacy_generation),
        }
        for key, (native, legacy) in pairs.items():
            client_native[key] += int(bool(native))
            client_missing[key] += int(bool(legacy) and not native)
            client_divergent[key] += int(bool(native) and bool(legacy) and native != legacy)

    missing_count = sum(project_missing.values()) + sum(client_missing.values())
    divergent_count = sum(project_divergent.values()) + sum(client_divergent.values())
    return {
        "schema_version": 1,
        "content_included": False,
        "native_cutover_ready": missing_count == 0 and divergent_count == 0,
        "missing_native_state_count": missing_count,
        "divergent_native_state_count": divergent_count,
        "project": {
            "entity_count": len(project_rows),
            "native_state_by_kind": project_native,
            "missing_native_state_by_kind": project_missing,
            "divergent_native_state_by_kind": project_divergent,
        },
        "client": {
            "entity_count": len(client_rows),
            "native_state_by_kind": client_native,
            "missing_native_state_by_kind": client_missing,
            "divergent_native_state_by_kind": client_divergent,
        },
    }
