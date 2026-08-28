from types import SimpleNamespace

from app.services.agent_harness.context_receipt import build_context_receipt


def _runtime(**overrides):
    values = {
        "context_receipt": {
            "scope": "project",
            "project": {"id": 26, "name": "Project"},
            "memory": {
                "status": "stale",
                "version": 3,
                "raw_context_available": True,
                "retrieval_mode": "focused",
                "query_facets": ["risk"],
                "selected_slots": ["key_risks", "open_questions", "next_actions"],
                "selected_slot_count": 3,
                "available_slot_count": 8,
                "omitted_slot_count": 5,
                "selected_item_count": 6,
                "truncated": False,
                "layers": [
                    {
                        "scope": "user",
                        "status": "ready",
                        "version": 2,
                        "retrieval_mode": "focused",
                        "selected_slots": ["response_preferences.tone"],
                        "selected_slot_count": 1,
                        "available_slot_count": 2,
                        "omitted_slot_count": 1,
                        "selected_item_count": 1,
                        "truncated": False,
                        "overridden_dimensions": ["language"],
                    },
                    {
                        "scope": "client",
                        "status": "stale",
                        "version": 4,
                        "retrieval_mode": "focused",
                        "selected_slots": ["decision_patterns"],
                        "selected_slot_count": 1,
                        "available_slot_count": 3,
                        "omitted_slot_count": 2,
                        "selected_item_count": 1,
                        "truncated": False,
                        "overridden_dimensions": [],
                    },
                ],
            },
            "evidence": {
                "workspace_context": True,
                "attached_file_count": 2,
                "knowledge_reference_count": 0,
            },
        },
        "prepare_metrics": {
            "skill_decision": "auto_skill_advisory_match:舞弊风险评估",
            "skill_decision_confidence": 0.9,
            "history_message_count_loaded": 7,
            "user_memory_injected": True,
        },
        "skill_id": 9,
        "skill_name": "舞弊风险评估",
        "skill_activation_source": "auto",
        "skill_activation_reason": "auto_skill_advisory_match:舞弊风险评估",
        "rag_sources": [{"title": "Evidence"}],
        "context_manifest": None,
        "conversation_capsule": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_build_context_receipt_reports_advisory_skill_and_stale_memory():
    event = build_context_receipt("run_quality", _runtime())

    assert event["schema_version"] == 1
    assert event["scope"] == "project"
    assert event["memory"]["status"] == "stale"
    assert event["memory"]["version"] == 3
    assert event["memory"]["raw_context_available"] is True
    assert event["memory"]["retrieval_mode"] == "focused"
    assert event["memory"]["selected_item_count"] == 6
    assert event["skill"]["status"] == "applied"
    assert event["skill"]["usage_mode"] == "advisory"
    assert event["evidence"]["knowledge_reference_count"] == 1
    assert event["evidence"]["history_message_count"] == 7
    assert "project_memory_stale" in event["warnings"]
    assert "client_memory_stale" in event["warnings"]
    assert "user_preference_overridden" in event["warnings"]
    assert [layer["scope"] for layer in event["memory"]["layers"]] == ["user", "client"]


def test_build_context_receipt_reports_ambiguous_skill_candidates_without_prompt():
    runtime = _runtime(
        skill_id=None,
        skill_name="",
        skill_activation_reason="auto_skill_ambiguous_advisory_match",
        prepare_metrics={
            "skill_decision": "auto_skill_ambiguous_advisory_match",
            "skill_decision_confidence": 0.9,
            "skill_top_candidates": [
                {"skill_id": 1, "skill_name": "Skill A", "score": 90},
                {"skill_id": 2, "skill_name": "Skill B", "score": 90},
            ],
        },
    )

    event = build_context_receipt("run_ambiguous", runtime)

    assert event["skill"]["status"] == "ambiguous"
    assert [item["name"] for item in event["skill"]["candidates"]] == [
        "Skill A",
        "Skill B",
    ]
    assert "skill_match_ambiguous" in event["warnings"]
    assert "system_prompt" not in str(event)


def test_build_context_receipt_reports_project_state_version_and_change():
    runtime = _runtime()
    runtime.prepare_metrics.update(
        {
            "project_world_state": {
                "version": "abcdef123456",
                "truncated": False,
            },
            "project_world_state_change": {
                "schema_version": 1,
                "baseline": False,
                "changed": True,
                "previous_version": "123456abcdef",
                "current_version": "abcdef123456",
                "changed_categories": ["todos"],
                "categories": {
                    "todos": {"added": 1, "removed": 0, "updated": 0, "current_count": 4}
                },
            },
        }
    )

    event = build_context_receipt("run_world_state", runtime)

    assert event["world_state"]["changed"] is True
    assert event["world_state"]["changed_categories"] == ["todos"]
    assert "project_world_state_changed" in event["warnings"]
