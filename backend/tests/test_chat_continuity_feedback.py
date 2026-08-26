from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Message, Milestone, Project
from app.services.agent_harness.project_world_state import (
    build_project_world_state_manifest,
    compare_project_world_states,
    format_project_world_state_change_for_prompt,
)
from app.services.chat.interaction_feedback import aggregate_interaction_metrics
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
    assert preview["strategy"] == "continue_as_new_turn"
    assert preview["completed_steps"] == [1]
    assert preview["side_effects_possible"] is True
    assert "inspect_before_side_effects" in preview["warning_codes"]
    prompt = format_turn_recovery_for_prompt(preview)
    assert "Never replay a previous write" in prompt
    assert "write_project_file" not in prompt


def test_runtime_rebuilds_recovery_from_server_rollout(monkeypatch) -> None:
    source_message = SimpleNamespace(
        id=91,
        role="assistant",
        conversation_id=4,
        get_metadata=lambda: {"run_rollout": {"run_id": "run_server"}},
    )
    session = SimpleNamespace(get=lambda model, identity: source_message)
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

    assert recovery["strategy"] == "resume_from_checkpoint"
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
