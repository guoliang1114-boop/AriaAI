from __future__ import annotations

import json

from app.models.db import ClientRecord, Project
from app.services.memory_projection_state import (
    build_memory_projection_authority_report,
    get_client_memory_source_project_ids,
    get_project_memory_coverage,
    set_client_memory_source_project_ids,
    set_project_memory_coverage,
)


def test_projection_state_prefers_native_and_falls_back_to_valid_legacy() -> None:
    native_project = Project(
        name="Native",
        client="Client",
        context_memory_json=json.dumps({"_coverage": {"source": "legacy"}}),
        memory_coverage_json=json.dumps({"source": "native"}),
    )
    legacy_project = Project(
        name="Legacy",
        client="Client",
        context_memory_json=json.dumps({"_coverage": {"source": "legacy"}}),
    )
    native_client = ClientRecord(
        name="Native",
        client_memory_json=json.dumps({"source_project_ids": [1]}),
        client_memory_source_project_ids_json=json.dumps([2, 3]),
    )
    legacy_client = ClientRecord(
        name="Legacy",
        client_memory_json=json.dumps({"source_project_ids": ["4", 4, 5]}),
    )

    assert get_project_memory_coverage(native_project) == {"source": "native"}
    assert get_project_memory_coverage(legacy_project) == {"source": "legacy"}
    assert get_client_memory_source_project_ids(native_client) == [2, 3]
    assert get_client_memory_source_project_ids(legacy_client) == [4, 5]


def test_projection_state_setters_normalize_and_stay_private() -> None:
    project = Project(name="Project", client="Client")
    client = ClientRecord(name="Client")

    set_project_memory_coverage(project, {"milestones_total": 2})
    set_client_memory_source_project_ids(client, [3, 3, 7])

    assert get_project_memory_coverage(project) == {"milestones_total": 2}
    assert get_client_memory_source_project_ids(client) == [3, 7]
    assert "memory_coverage_json" not in project.model_dump()
    assert "client_memory_source_project_ids_json" not in client.model_dump()


def test_projection_authority_report_is_content_free_and_detects_gaps() -> None:
    projects = [
        Project(
            name="Missing",
            client="Client",
            context_memory_json=json.dumps(
                {"_coverage": {"private_source": "legacy-secret"}}
            ),
        ),
        Project(
            name="Divergent",
            client="Client",
            context_memory_json=json.dumps({"_coverage": {"count": 1}}),
            memory_coverage_json=json.dumps({"count": 2}),
        ),
        Project(
            name="Invalid aggregate",
            client="Client",
            context_memory_json="not-json",
        ),
    ]
    clients = [
        ClientRecord(
            name="Invalid",
            client_memory_json=json.dumps({"source_project_ids": ["secret-id"]}),
            client_memory_source_project_ids_json="not-json",
        )
    ]

    report = build_memory_projection_authority_report(projects, clients)
    serialized = json.dumps(report, ensure_ascii=False)

    assert report["schema_version"] == 1
    assert report["content_included"] is False
    assert report["native_cutover_ready"] is False
    assert report["legacy_aggregate_retirement_ready"] is False
    assert report["missing_native_projection_count"] == 1
    assert report["divergent_native_projection_count"] == 1
    assert report["invalid_native_projection_count"] == 1
    assert report["invalid_legacy_projection_count"] == 1
    assert report["invalid_aggregate_storage_count"] == 1
    assert report["legacy_aggregate_projection_count"] == 3
    assert "legacy-secret" not in serialized
    assert "private_source" not in serialized
    assert "secret-id" not in serialized


def test_projection_authority_report_confirms_native_clean_storage() -> None:
    report = build_memory_projection_authority_report(
        [
            Project(
                name="Project",
                client="Client",
                memory_coverage_json=json.dumps({"milestones_total": 2}),
            )
        ],
        [
            ClientRecord(
                name="Client",
                client_memory_source_project_ids_json=json.dumps([3]),
            )
        ],
    )

    assert report["native_cutover_ready"] is True
    assert report["legacy_aggregate_retirement_ready"] is True
    assert report["legacy_aggregate_projection_count"] == 0
    assert report["project"]["native"] == 1
    assert report["client"]["native"] == 1
