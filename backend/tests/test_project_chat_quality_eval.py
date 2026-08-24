from app.services.agent_harness.project_chat_quality_eval import (
    run_project_chat_quality_eval,
)


def test_project_chat_quality_release_gate_passes():
    report = run_project_chat_quality_eval()

    assert report["case_count"] >= 22
    assert report["release_gate_passed"] is True, report["failures"]
    assert all(
        metric["score"] == 1.0
        for metric in report["metrics"].values()
    )
