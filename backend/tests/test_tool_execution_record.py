import json

from app.services.agent_harness.tool_execution_record import (
    MAX_TOOL_EXECUTION_LEDGER_BYTES,
    MAX_TOOL_EXECUTION_RECORDS,
    TOOL_EXECUTION_SCHEMA_VERSION,
    ToolExecutionOutcome,
    append_tool_execution_record,
    build_tool_execution_record,
    tool_event_is_completed,
    tool_event_is_failure,
    tool_event_is_omission_marker,
    tool_event_outcome,
    tool_event_waits_confirmation,
)
from app.services.chat.state import ChatSessionState


def _wire_bytes(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def test_record_normalizes_aliases_and_excludes_raw_payloads() -> None:
    record = build_tool_execution_record(
        {
            "call_id": "call-1",
            "name": "read_project_file",
            "status": "success",
            "message": "m" * 900,
            "details": [f"detail-{index}" for index in range(20)],
            "input": {"secret": "never persist"},
            "tool_input": {"secret": "never persist"},
            "output": {"content": "never persist"},
            "_aria_tool_execution_truncated": {"omitted_calls": 999},
        }
    )

    assert record["schema_version"] == TOOL_EXECUTION_SCHEMA_VERSION
    assert record["tool_use_id"] == "call-1"
    assert record["status"] == "completed"
    assert record["outcome"] == "succeeded"
    assert record["terminal"] is True
    assert len(record["message"]) == 500
    assert len(record["details"]) == 12
    assert "input" not in record
    assert "tool_input" not in record
    assert "output" not in record
    assert "_aria_tool_execution_truncated" not in record


def test_missing_call_ids_are_stable_and_distinct_by_ordinal() -> None:
    event = {"tool_name": "synthetic", "status": "completed", "step_index": 1}
    first = build_tool_execution_record(event, ordinal=2)
    replay = build_tool_execution_record(event, ordinal=2)
    next_record = build_tool_execution_record(event, ordinal=3)

    assert first["tool_use_id"] == replay["tool_use_id"]
    assert first["tool_use_id"] != next_record["tool_use_id"]


def test_status_classification_supports_v1_and_legacy_events() -> None:
    assert tool_event_is_completed({"status": "done"})
    assert tool_event_is_failure({"status": "conflict"})
    assert tool_event_waits_confirmation({"status": "pending_confirmation"})
    assert tool_event_outcome({"outcome": "skipped"}) is ToolExecutionOutcome.SKIPPED


def test_ledger_prioritizes_recent_records_and_reports_omissions() -> None:
    records: list[dict] = []
    for index in range(MAX_TOOL_EXECUTION_RECORDS + 44):
        append_tool_execution_record(
            records,
            {
                "tool_use_id": f"call-{index}",
                "tool_name": f"tool-{index}",
                "status": "completed",
                "summary": "x" * 300,
            },
        )

    assert len(records) <= MAX_TOOL_EXECUTION_RECORDS
    assert _wire_bytes(records) <= MAX_TOOL_EXECUTION_LEDGER_BYTES
    assert tool_event_is_omission_marker(records[0])
    marker = records[0]["_aria_tool_execution_truncated"]
    assert marker["omitted_calls"] > 0
    assert records[-1]["tool_use_id"] == f"call-{MAX_TOOL_EXECUTION_RECORDS + 43}"
    assert not any(record.get("tool_use_id") == "call-0" for record in records)

    prior_omissions = records[0]["_aria_tool_execution_truncated"]["omitted_calls"]
    append_tool_execution_record(
        records,
        {"tool_use_id": "latest", "tool_name": "latest", "status": "completed"},
    )
    assert records[0]["_aria_tool_execution_truncated"]["omitted_calls"] >= prior_omissions
    assert records[-1]["tool_use_id"] == "latest"


def test_chat_state_shared_boundary_normalizes_replacement_and_append() -> None:
    state = ChatSessionState()
    state.replace_tool_execution_records(
        [{"tool_name": "legacy", "status": "failed", "output": {"large": "x" * 10_000}}]
    )
    state.record_tool_execution({"tool_name": "new", "status": "confirmation_required"})

    assert [record["status"] for record in state.tool_call_events] == ["error", "confirmation_required"]
    assert all(record["schema_version"] == 1 for record in state.tool_call_events)
    assert "output" not in state.tool_call_events[0]


def test_call_id_links_planned_and_terminal_lifecycle_without_duplicates() -> None:
    state = ChatSessionState()
    state.record_tool_execution(
        {"tool_use_id": "call-1", "tool_name": "read_project_file", "status": "planned", "source": "text"}
    )
    state.record_tool_execution(
        {"tool_use_id": "call-1", "tool_name": "read_project_file", "status": "completed", "duration_ms": 10}
    )

    assert len(state.tool_call_events) == 1
    assert state.tool_call_events[0]["status"] == "completed"
    assert state.tool_call_events[0]["source"] == "text"
    assert state.tool_call_events[0]["event_ordinal"] == 1
