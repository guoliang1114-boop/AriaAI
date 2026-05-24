from types import SimpleNamespace

from app.services.skill_router import decide_skill_activation, skill_auto_match_score


def test_selected_skill_runs_for_clear_workflow_deliverable_request():
    skill = SimpleNamespace(id=7, name="Strategy Skill")

    decision = decide_skill_activation("生成一份战略报告", skill)

    assert decision.apply is True
    assert decision.reason == "selected_skill_workflow_request"
    assert decision.candidate_skill_id == 7


def test_selected_skill_does_not_run_for_question_only_turn():
    skill = SimpleNamespace(id=7, name="Strategy Skill")

    decision = decide_skill_activation("这个方法怎么用？", skill)

    assert decision.apply is False
    assert decision.reason == "selected_skill_not_armed"


def test_presentation_builder_matches_client_deck_language():
    skill = SimpleNamespace(
        name="presentation-builder",
        description="Base consulting PowerPoint generation skill",
        category="consulting",
    )

    score, reason = skill_auto_match_score("帮我做一个客户介绍 PPT，用于明天汇报", skill)

    assert score >= 82
    assert reason.startswith("alias:")
