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
    assert event["memory"] == {
        "status": "stale",
        "version": 3,
        "raw_context_available": True,
    }
    assert event["skill"]["status"] == "applied"
    assert event["skill"]["usage_mode"] == "advisory"
    assert event["evidence"]["knowledge_reference_count"] == 1
    assert event["evidence"]["history_message_count"] == 7
    assert "project_memory_stale" in event["warnings"]


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
