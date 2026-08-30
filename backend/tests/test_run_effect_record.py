from __future__ import annotations

import json

from app.services.agent_harness.run_effect_record import (
    build_rollout_effect_ledger,
    build_step_effect_records,
    canonical_tool_input_sha256,
    decide_recovery_effect,
    normalize_run_effect_record,
    normalize_run_effect_ledger,
    result_ref_is_verifiable,
)


def _persisted_output(*, tool_use_id: str, tool_name: str) -> dict:
    return {
        "schema_version": 1,
        "output_id": "out_artifact_verified",
        "run_id": "run_source",
        "kind": "artifact",
        "status": "persisted",
        "source": {"tool_use_id": tool_use_id, "tool_name": tool_name},
        "artifact": {
            "name": "report.pdf",
            "file_type": "pdf",
            "path_sha256": "a" * 64,
            "generated_file_id": 9,
            "size_bytes": 12,
            "content_sha256": "b" * 64,
        },
    }


def test_effect_ledger_is_content_free_and_binds_persisted_result() -> None:
    calls = [{"id": "tool_1", "name": "generate_pdf", "input": {"title": "PRIVATE REPORT"}}]
    effects = build_step_effect_records(
        0,
        calls,
        [{"tool_use_id": "tool_1", "tool_name": "generate_pdf", "status": "completed"}],
    )
    ledger = build_rollout_effect_ledger(
        [{"step_index": 0, "tool_calls": [], "effect_records": effects}],
        [_persisted_output(tool_use_id="tool_1", tool_name="generate_pdf")],
    )

    serialized = json.dumps(ledger, ensure_ascii=False)
    record = ledger["records"][0]
    assert "PRIVATE REPORT" not in serialized
    assert record["input_sha256"] == canonical_tool_input_sha256({"title": "PRIVATE REPORT"})
    assert record["outcome"] == "persisted"
    assert record["result_ref"]["generated_file_id"] == 9
    assert ledger["integrity"]["verified_persisted_count"] == 1


def test_legacy_mutation_and_changed_world_state_fail_closed() -> None:
    ledger = build_rollout_effect_ledger(
        [
            {
                "step_index": 0,
                "tool_calls": [
                    {
                        "tool_use_id": "legacy",
                        "tool_name": "generate_pdf",
                        "input_sha256": "c" * 64,
                    }
                ],
                "tool_events": [],
            }
        ],
        [],
    )
    assert ledger["integrity"]["legacy_or_unknown_mutating_count"] == 1

    decision = decide_recovery_effect(
        {
            "schema_version": 2,
            "strategy": "replan_from_checkpoint",
            "effect_ledger": {"schema_version": 1, "records": [], "integrity": {}},
            "world_state_change": {"changed": True},
        },
        tool_name="generate_pdf",
        tool_input={"title": "new"},
    )
    assert decision.action == "manual_review"
    assert decision.reason == "project_world_state_changed_since_source_run"


def test_public_effect_counts_include_only_mutating_persistence() -> None:
    from app.services.chat.turn_recovery import build_turn_recovery_preview

    def record(index: int, effect: str, outcome: str) -> dict:
        value = {
            "schema_version": 1,
            "step_index": index,
            "tool_use_id": f"tool_{index}",
            "tool_name": "read_project_file" if effect == "read" else "generate_pdf",
            "input_sha256": str(index + 1) * 64,
            "effect": effect,
            "outcome": outcome,
            "target_ref": {"kind": "new_artifact"},
        }
        if outcome == "persisted":
            value["result_ref"] = {
                "kind": "persisted_artifact",
                "output_id": "out_counted",
                "generated_file_id": 9,
                "content_sha256": "f" * 64,
            }
        return value

    preview = build_turn_recovery_preview(
        {
            "run_id": "run_counts",
            "status": "failed",
            "steps": [],
            "effect_ledger": {
                "schema_version": 1,
                "records": [
                    record(0, "read", "completed"),
                    record(1, "create", "persisted"),
                    record(2, "modify", "not_executed"),
                    record(3, "external", "failed"),
                ],
                "integrity": {"mutating_effect_count": 3, "unresolved_mutating_count": 1},
            },
        },
        source_message_id=4,
    )
    assert preview["completed_effect_count"] == 1
    assert preview["pending_effect_count"] == 1


def test_retry_read_strategy_never_claims_an_exact_mutation_completed() -> None:
    tool_input = {"title": "Read-only retry must stay read-only"}
    records = build_step_effect_records(
        0,
        [{"id": "tool_retry", "name": "generate_pdf", "input": tool_input}],
        [{"tool_use_id": "tool_retry", "tool_name": "generate_pdf", "status": "completed"}],
    )
    ledger = build_rollout_effect_ledger(
        [{"step_index": 0, "tool_calls": [], "effect_records": records}],
        [_persisted_output(tool_use_id="tool_retry", tool_name="generate_pdf")],
    )

    decision = decide_recovery_effect(
        {
            "schema_version": 2,
            "strategy": "retry_read_step",
            "effect_ledger": ledger,
            "world_state_change": {"changed": False},
        },
        tool_name="generate_pdf",
        tool_input=tool_input,
    )

    assert decision.action == "manual_review"
    assert decision.reason == "retry_read_step_forbids_mutating_tools"


def test_pending_confirmation_effect_forces_manual_review() -> None:
    """A still-confirmable old action must not coexist with automatic replanning."""

    records = build_step_effect_records(
        0,
        [{"id": "tool_pending", "name": "generate_pdf", "input": {"title": "pending"}}],
        [
            {
                "tool_use_id": "tool_pending",
                "tool_name": "generate_pdf",
                "status": "pending_confirmation",
            }
        ],
    )
    ledger = build_rollout_effect_ledger(
        [{"step_index": 0, "tool_calls": [], "effect_records": records}],
        [],
    )

    assert ledger["integrity"]["unresolved_mutating_count"] == 1
    decision = decide_recovery_effect(
        {
            "schema_version": 2,
            "strategy": "replan_from_checkpoint",
            "effect_ledger": ledger,
            "world_state_change": {"changed": False},
        },
        tool_name="generate_pdf",
        tool_input={"title": "new output"},
    )
    assert decision.action == "manual_review"
    assert decision.reason == "source_side_effects_cannot_be_verified"


def test_effect_ledger_normalizer_drops_unknown_content_and_bounds_counts() -> None:
    record = build_step_effect_records(
        0,
        [{"id": "tool_safe", "name": "generate_pdf", "input": {"title": "private"}}],
        [{"tool_use_id": "tool_safe", "tool_name": "generate_pdf", "status": "failed"}],
    )[0]
    normalized = normalize_run_effect_ledger(
        {
            "schema_version": 1,
            "records": [{**record, "raw_input": "must-not-survive"}],
            "integrity": {
                "mutating_effect_count": "999999",
                "unresolved_mutating_count": "not-an-int",
                "private_note": "must-not-survive",
            },
            "raw_result": "must-not-survive",
        }
    )
    serialized = json.dumps(normalized, ensure_ascii=False)
    assert "must-not-survive" not in serialized
    assert normalized["integrity"]["mutating_effect_count"] == 64
    assert normalized["integrity"]["unresolved_mutating_count"] == 1


def test_boolean_database_ids_are_not_verifiable_artifact_references() -> None:
    base = {
        "kind": "persisted_artifact",
        "output_id": "out_bool",
        "generated_file_id": 9,
        "content_sha256": "a" * 64,
    }
    assert result_ref_is_verifiable(base) is True
    assert result_ref_is_verifiable({**base, "generated_file_id": True}) is False
    assert result_ref_is_verifiable({**base, "project_file_id": True}) is False


def test_effect_record_normalizer_rejects_boolean_indices_and_entity_ids() -> None:
    base = {
        "schema_version": 1,
        "step_index": 0,
        "tool_use_id": "tool_bool",
        "tool_name": "generate_pdf",
        "input_sha256": "a" * 64,
        "effect": "create",
        "outcome": "failed",
        "target_ref": {
            "kind": "aria_entity",
            "ids": {"project_id": True, "generated_file_id": 9},
        },
    }

    assert normalize_run_effect_record({**base, "step_index": True}) == {}
    normalized = normalize_run_effect_record(base)
    assert normalized["target_ref"]["ids"] == {"generated_file_id": 9}
