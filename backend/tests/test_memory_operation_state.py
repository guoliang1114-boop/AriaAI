from __future__ import annotations

import json

from app.models.db import ClientRecord, Project
from app.services.memory_operation_state import (
    build_memory_operation_authority_report,
    get_client_memory_failure,
    get_client_memory_rebuild_generation,
    get_project_client_promotion,
    get_project_memory_failure,
    set_client_memory_failure,
    set_client_memory_rebuild_generation,
    set_project_client_promotion,
    set_project_memory_failure,
)


def test_native_project_operation_state_precedes_legacy_aggregate() -> None:
    project = Project(
        name="Native",
        client="Client",
        context_memory_json=json.dumps(
            {
                "_last_failure": {"stage": "legacy"},
                "_client_promotion": {"status": "failed"},
            }
        ),
        memory_last_failure_json=json.dumps({"stage": "native"}),
        client_memory_promotion_json=json.dumps({"status": "completed"}),
    )

    assert get_project_memory_failure(project) == {"stage": "native"}
    assert get_project_client_promotion(project) == {"status": "completed"}
    assert "memory_last_failure_json" not in project.model_dump()
    assert "client_memory_promotion_json" not in project.model_dump()


def test_project_operation_state_falls_back_and_setters_can_clear() -> None:
    project = Project(
        name="Legacy",
        client="Client",
        context_memory_json=json.dumps(
            {
                "_last_failure": {"stage": "legacy"},
                "_client_promotion": {"status": "failed"},
            }
        ),
    )

    assert get_project_memory_failure(project) == {"stage": "legacy"}
    assert get_project_client_promotion(project) == {"status": "failed"}

    set_project_memory_failure(project, {"stage": "native"})
    set_project_client_promotion(project, {"status": "completed"})
    assert get_project_memory_failure(project) == {"stage": "native"}
    assert get_project_client_promotion(project) == {"status": "completed"}

    set_project_memory_failure(project, None)
    set_project_client_promotion(project, None)
    assert project.memory_last_failure_json == ""
    assert project.client_memory_promotion_json == ""


def test_native_client_operation_state_precedes_legacy_aggregate() -> None:
    client = ClientRecord(
        name="Native",
        client_memory_json=json.dumps(
            {
                "_last_failure": {"stage": "legacy"},
                "_rebuild_generation": "legacy-generation",
            }
        ),
        client_memory_last_failure_json=json.dumps({"stage": "native"}),
        client_memory_rebuild_generation="native-generation",
    )

    assert get_client_memory_failure(client) == {"stage": "native"}
    assert get_client_memory_rebuild_generation(client) == "native-generation"
    assert "client_memory_last_failure_json" not in client.model_dump()
    assert "client_memory_rebuild_generation" not in client.model_dump()


def test_client_operation_state_falls_back_and_setters_can_clear() -> None:
    client = ClientRecord(
        name="Legacy",
        client_memory_json=json.dumps(
            {
                "_last_failure": {"stage": "legacy"},
                "_rebuild_generation": "legacy-generation",
            }
        ),
    )

    assert get_client_memory_failure(client) == {"stage": "legacy"}
    assert get_client_memory_rebuild_generation(client) == "legacy-generation"

    set_client_memory_failure(client, {"stage": "native"})
    set_client_memory_rebuild_generation(client, "native-generation")
    assert get_client_memory_failure(client) == {"stage": "native"}
    assert get_client_memory_rebuild_generation(client) == "native-generation"

    set_client_memory_failure(client, None)
    set_client_memory_rebuild_generation(client, "")
    assert client.client_memory_last_failure_json == ""
    assert client.client_memory_rebuild_generation == ""


def test_operation_authority_report_is_content_free_and_detects_cutover_gaps() -> None:
    projects = [
        Project(
            name="Ready",
            client="Client",
            context_memory_json=json.dumps(
                {"_client_promotion": {"status": "completed", "private": "legacy"}}
            ),
            client_memory_promotion_json=json.dumps(
                {"status": "completed", "private": "legacy"}
            ),
        ),
        Project(
            name="Missing",
            client="Client",
            context_memory_json=json.dumps(
                {"_last_failure": {"message": "private failure"}}
            ),
        ),
    ]
    clients = [
        ClientRecord(
            name="Divergent",
            client_memory_json=json.dumps({"_rebuild_generation": "legacy-secret"}),
            client_memory_rebuild_generation="native-secret",
        )
    ]

    report = build_memory_operation_authority_report(projects, clients)
    serialized = json.dumps(report, ensure_ascii=False)

    assert report["native_cutover_ready"] is False
    assert report["missing_native_state_count"] == 1
    assert report["divergent_native_state_count"] == 1
    assert report["project"]["native_state_by_kind"]["client_promotion"] == 1
    assert report["client"]["native_state_by_kind"]["rebuild_generation"] == 1
    assert "private failure" not in serialized
    assert "legacy-secret" not in serialized
    assert "native-secret" not in serialized
