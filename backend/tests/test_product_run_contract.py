import json
import pytest

from app.services.chat import product_run_events as events

from scripts.product_run_contract_fixture import FIXTURE_PATH, build_contract_fixture


def test_wire_fixture_matches_current_backend_builders_and_covers_every_event():
    generated = build_contract_fixture()
    assert json.loads(FIXTURE_PATH.read_text()) == generated, (
        "Review the contract change, then regenerate with scripts/product_run_contract_fixture.py --write"
    )
    scenario_events = [event for scenario in generated["scenarios"] for event in scenario["events"]]
    assert {event["type"] for event in scenario_events} == set(generated["event_types"])
    # Every checked-in wire example must be valid JSON, including finite numbers.
    json.dumps(generated, allow_nan=False)


@pytest.mark.parametrize("progress", [float("nan"), float("inf"), float("-inf"), True, "0.5", {}])
def test_progress_never_emits_non_json_numbers_or_wrong_field_types(progress):
    with pytest.raises(ValueError):
        events.status("run_contract", "合成状态", progress=progress)
    with pytest.raises(ValueError):
        events.tool_progress("run_contract", 1, "合成工具", "running", progress=progress)


@pytest.mark.parametrize("identity", [None, True, False, 0, -1, 1.5, "", " ", {}, []])
def test_event_identifiers_do_not_turn_invalid_values_into_apparent_success(identity):
    builders = [
        lambda: events.task_update("run_contract", identity, "running"),
        lambda: events.artifact_ready("run_contract", identity, "pdf"),
        lambda: events.memory_candidate_ready("run_contract", identity, "project", "risk"),
        lambda: events.message_persisted("run_contract", identity),
        lambda: events.run_done("run_contract", "completed", artifact_ids=[identity]),
    ]
    if identity is not None:
        builders.append(lambda: events.run_done("run_contract", "completed", message_id=identity))
    for build in builders:
        with pytest.raises(ValueError):
            build()


@pytest.mark.parametrize("progress", [True, 10.5, "10", float("nan"), -1, 101])
def test_task_progress_is_an_integer_percentage(progress):
    with pytest.raises(ValueError):
        events.task_update("run_contract", 1, "running", progress_pct=progress)


def test_boolean_duration_is_not_a_numeric_duration():
    with pytest.raises(ValueError):
        events.step_completed("run_contract", 1, "completed", True)
