from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Message, Milestone, Project, ProjectFile, ProjectFolder
from app.services.agent_harness.project_world_state import (
    build_project_world_state_manifest,
    compare_project_world_states,
    format_project_world_state_change_for_prompt,
)
from app.services.chat.interaction_feedback import (
    aggregate_interaction_metrics,
    aggregate_skill_run_metrics,
)
from app.services.chat.turn_recovery import (
    build_turn_recovery_preview,
    format_turn_recovery_for_prompt,
)
from app.services.chat.runtime import _validated_turn_recovery
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_store import build_message_metadata


def test_project_world_state_is_content_free_and_reports_category_changes() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project = Project(
                name="Secret project",
                client="Confidential client",
                description="PRIVATE-WORLD-STATE-CONTENT",
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            before = build_project_world_state_manifest(session, int(project.id or 0))
            session.add(
                Milestone(
                    project_id=int(project.id or 0),
                    title="PRIVATE-MILESTONE-CONTENT",
                )
            )
            session.commit()
            after = build_project_world_state_manifest(session, int(project.id or 0))

        serialized = json.dumps(after, ensure_ascii=False)
        change = compare_project_world_states(before, after)
        prompt = format_project_world_state_change_for_prompt(change)

        assert "PRIVATE-WORLD-STATE-CONTENT" not in serialized
        assert "PRIVATE-MILESTONE-CONTENT" not in serialized
        assert change["changed"] is True
        assert change["changed_categories"] == ["milestones"]
        assert change["categories"]["milestones"]["added"] == 1
        assert "milestones: +1" in prompt
        assert "PRIVATE" not in prompt
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_project_world_state_tracks_folder_lifecycle_and_file_moves() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project = Project(name="Folder state project", client="Folder state client")
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id or 0)

            project_file = ProjectFile(
                project_id=project_id,
                name="PRIVATE-FILE-NAME",
                file_type="pdf",
                path="private/file.pdf",
            )
            session.add(project_file)
            session.commit()
            session.refresh(project_file)

            before_create = build_project_world_state_manifest(session, project_id)
            folder = ProjectFolder(
                project_id=project_id,
                name="PRIVATE-FOLDER-NAME",
                sort_order=10,
            )
            session.add(folder)
            session.commit()
            session.refresh(folder)
            folder_id = int(folder.id or 0)
            after_create = build_project_world_state_manifest(session, project_id)

            create_change = compare_project_world_states(before_create, after_create)
            assert create_change["changed_categories"] == ["folders"]
            assert create_change["categories"]["folders"]["added"] == 1

            folder.name = "PRIVATE-RENAMED-FOLDER"
            session.add(folder)
            session.commit()
            after_rename = build_project_world_state_manifest(session, project_id)
            rename_change = compare_project_world_states(after_create, after_rename)
            assert rename_change["changed_categories"] == ["folders"]
            assert rename_change["categories"]["folders"]["updated"] == 1

            folder.sort_order = 20
            session.add(folder)
            session.commit()
            after_reorder = build_project_world_state_manifest(session, project_id)
            reorder_change = compare_project_world_states(after_rename, after_reorder)
            assert reorder_change["changed_categories"] == ["folders"]
            assert reorder_change["categories"]["folders"]["updated"] == 1

            project_file.folder_id = folder_id
            session.add(project_file)
            session.commit()
            after_move_in = build_project_world_state_manifest(session, project_id)
            move_in_change = compare_project_world_states(after_reorder, after_move_in)
            assert move_in_change["changed_categories"] == ["files"]
            assert move_in_change["categories"]["files"]["updated"] == 1

            project_file.folder_id = None
            session.add(project_file)
            session.commit()
            after_move_out = build_project_world_state_manifest(session, project_id)
            move_out_change = compare_project_world_states(after_move_in, after_move_out)
            assert move_out_change["changed_categories"] == ["files"]
            assert move_out_change["categories"]["files"]["updated"] == 1

            session.delete(folder)
            session.commit()
            after_delete = build_project_world_state_manifest(session, project_id)
            delete_change = compare_project_world_states(after_move_out, after_delete)
            assert delete_change["changed_categories"] == ["folders"]
            assert delete_change["categories"]["folders"]["removed"] == 1

        serialized = json.dumps(after_reorder, ensure_ascii=False)
        assert "PRIVATE-FOLDER-NAME" not in serialized
        assert "PRIVATE-RENAMED-FOLDER" not in serialized
        assert "PRIVATE-FILE-NAME" not in serialized
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_turn_recovery_preserves_checkpoints_and_warns_before_side_effects() -> None:
    preview = build_turn_recovery_preview(
        {
            "run_id": "run_interrupted",
            "status": "cancelled",
            "steps": [
                {
                    "step_index": 1,
                    "status": "completed",
                    "tool_calls": [{"tool_name": "write_project_file"}],
                },
                {"step_index": 2, "status": "failed", "tool_calls": []},
            ],
            "run_outputs": [],
            "recovery": {"can_resume": False, "can_retry": False},
        },
        source_message_id=91,
    )

    assert preview["can_continue"] is True
    assert preview["schema_version"] == 2
    assert preview["strategy"] == "manual_review"
    assert preview["completed_steps"] == [1]
    assert preview["side_effects_possible"] is True
    assert "manual_review_required" in preview["warning_codes"]
    prompt = format_turn_recovery_for_prompt(preview)
    assert "fail-closed" in prompt
    assert "write_project_file" not in prompt


def test_runtime_rebuilds_recovery_from_server_rollout(monkeypatch) -> None:
    source_message = SimpleNamespace(
        id=91,
        role="assistant",
        conversation_id=4,
        get_metadata=lambda: {"run_rollout": {"run_id": "run_server"}},
    )
    session = SimpleNamespace(
        get=lambda model, identity: source_message,
        exec=lambda *_args, **_kwargs: SimpleNamespace(first=lambda: None),
    )
    monkeypatch.setattr(
        "app.services.chat.runtime.get_chat_rollout",
        lambda *_args, **_kwargs: {
            "run_id": "run_server",
            "status": "interrupted",
            "steps": [{"step_index": 1, "status": "completed", "tool_calls": []}],
            "run_outputs": [],
            "recovery": {"can_resume": True, "can_retry": False},
        },
    )
    monkeypatch.setattr(
        "app.services.chat.runtime.resolve_recovery_world_state",
        lambda *_args, **_kwargs: {
            "chat_run": SimpleNamespace(
                assistant_message_id=91,
                status="interrupted",
            ),
            "current_world_state": {},
            "world_state_change": {},
            "source_world_state_available": True,
        },
    )
    req = SendMessageRequest(
        conversation_id=4,
        content="继续",
        turn_recovery={
            "source_run_id": "run_server",
            "source_message_id": 91,
            "strategy": "continue_as_new_turn",
            "completed_steps": [999],
            "side_effects_possible": True,
        },
    )

    recovery = _validated_turn_recovery(session, req, conversation_id=4)

    assert recovery["strategy"] == "manual_review"
    assert recovery["completed_steps"] == [1]
    assert recovery["side_effects_possible"] is False


def test_runtime_rejects_cross_conversation_recovery() -> None:
    source_message = SimpleNamespace(
        id=91,
        role="assistant",
        conversation_id=5,
        get_metadata=lambda: {"run_rollout": {"run_id": "run_server"}},
    )
    session = SimpleNamespace(get=lambda model, identity: source_message)
    req = SendMessageRequest(
        conversation_id=4,
        content="继续",
        turn_recovery={
            "source_run_id": "run_server",
            "source_message_id": 91,
            "strategy": "continue_as_new_turn",
        },
    )

    with pytest.raises(ValueError, match="does not belong"):
        _validated_turn_recovery(session, req, conversation_id=4)


def test_feedback_metrics_use_only_categorical_message_metadata() -> None:
    messages = [
        SimpleNamespace(
            role="assistant",
            content="PRIVATE-ANSWER",
            metadata_json=json.dumps(
                {
                    "interaction_feedback": {
                        "schema_version": 1,
                        "rating": "unhelpful",
                        "reasons": ["missing_context", "wrong_skill"],
                    },
                    "turn_revision": {"source_message_id": 1},
                }
            ),
        ),
        SimpleNamespace(
            role="assistant",
            content="SECOND-PRIVATE-ANSWER",
            metadata_json=json.dumps(
                {
                    "interaction_feedback": {
                        "schema_version": 1,
                        "rating": "helpful",
                        "reasons": [],
                    }
                }
            ),
        ),
        SimpleNamespace(
            role="user",
            content="PRIVATE-QUESTION",
            metadata_json=json.dumps(
                {"turn_setup_trace": {"schema_version": 1, "outcome": "applied"}}
            ),
        ),
    ]

    metrics = aggregate_interaction_metrics(messages)

    assert metrics["assistant_turn_count"] == 2
    assert metrics["feedback_coverage"] == 1.0
    assert metrics["helpful_rate"] == 0.5
    assert metrics["revision_success_rate"] == 0.0
    assert metrics["turn_setup"]["adoption_rate"] == 1.0
    assert metrics["negative_reasons"]["missing_context"] == 1
    assert metrics["privacy"] == {
        "stores_message_content": False,
        "stores_free_text_feedback": False,
        "stores_user_identity": False,
    }
    assert "PRIVATE" not in json.dumps(metrics)


def test_turn_setup_and_recovery_metadata_are_bounded() -> None:
    metadata = build_message_metadata(
        turn_setup_trace={
            "outcome": "applied",
            "template_id": "Risk Review!",
            "skill_id": 7,
        },
        turn_recovery={
            "source_run_id": "run_abc123",
            "source_message_id": 91,
            "strategy": "resume_from_checkpoint",
            "completed_steps": [1, 1, -2, 3],
            "side_effects_possible": True,
        },
    )

    assert metadata["turn_setup_trace"] == {
        "schema_version": 1,
        "outcome": "applied",
        "template_id": "riskreview",
        "skill_id": 7,
    }
    assert metadata["turn_recovery"] == {
        "schema_version": 1,
        "source_run_id": "run_abc123",
        "source_message_id": 91,
        "strategy": "resume_from_checkpoint",
        "completed_steps": [1, 3],
        "side_effects_possible": True,
    }


def test_feedback_aggregation_ignores_malformed_metadata() -> None:
    metrics = aggregate_interaction_metrics(
        [Message(conversation_id=1, role="assistant", content="private", metadata_json="not-json")]
    )

    assert metrics["assistant_turn_count"] == 1
    assert metrics["feedback_count"] == 0
    assert metrics["helpful_rate"] is None


def test_skill_run_metrics_group_exact_versions_without_reading_content() -> None:
    messages = [
        SimpleNamespace(
            id=21,
            role="assistant",
            content="PRIVATE-ANSWER-V1",
            metadata_json=json.dumps(
                {
                    "interaction_feedback": {
                        "schema_version": 1,
                        "rating": "unhelpful",
                        "reasons": ["wrong_skill"],
                    }
                }
            ),
        ),
        SimpleNamespace(
            id=22,
            role="assistant",
            content="PRIVATE-ANSWER-V2",
            metadata_json=json.dumps(
                {
                    "interaction_feedback": {
                        "schema_version": 1,
                        "rating": "helpful",
                        "reasons": [],
                    },
                    "turn_revision": {"source_message_id": 21},
                }
            ),
        ),
    ]
    runs = [
        SimpleNamespace(
            skill_id=7,
            skill_name="风险评估",
            skill_version="1.0.0",
            skill_release_status="stable",
            skill_release_sha256="a" * 64,
            skill_activation_source="auto",
            status="completed",
            duration_ms=100,
            assistant_message_id=21,
        ),
        SimpleNamespace(
            skill_id=7,
            skill_name="风险评估",
            skill_version="1.1.0",
            skill_release_status="stable",
            skill_release_sha256="b" * 64,
            skill_activation_source="explicit",
            status="completed",
            duration_ms=300,
            assistant_message_id=22,
        ),
        SimpleNamespace(
            skill_id=7,
            skill_name="风险评估",
            skill_version="1.1.0",
            skill_release_status="stable",
            skill_release_sha256="b" * 64,
            skill_activation_source="conversation",
            status="failed",
            duration_ms=200,
            assistant_message_id=None,
        ),
        SimpleNamespace(skill_id=None, skill_name="", status="completed"),
    ]

    metrics = aggregate_skill_run_metrics(runs, messages)

    assert metrics["run_count"] == 3
    assert metrics["versioned_run_count"] == 3
    assert [item["version"] for item in metrics["items"]] == ["1.1.0", "1.0.0"]
    current = metrics["items"][0]
    assert current["run_count"] == 2
    assert current["completion_rate"] == 0.5
    assert current["helpful_rate"] == 1.0
    assert current["revision_success_rate"] == 1.0
    assert current["average_duration_ms"] == 250
    assert current["activation_sources"] == {
        "explicit": 1,
        "auto": 0,
        "conversation": 1,
        "other": 0,
    }
    previous = metrics["items"][1]
    assert previous["wrong_skill_count"] == 1
    serialized = json.dumps(metrics, ensure_ascii=False)
    assert "PRIVATE" not in serialized
    assert metrics["privacy"]["reads_message_content"] is False
