from types import SimpleNamespace

from app.services.skill_router import (
    decide_conversation_skill_activation,
    decide_skill_activation,
    is_proposal_presentation_request,
    skill_auto_match_score,
)


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


def test_conversation_skill_continues_only_for_related_follow_up():
    skill = SimpleNamespace(
        id=7,
        name="会议纪要提取",
        description="Extract decisions, minutes, and action items from meetings.",
        category="顾问基础能力",
    )

    decision = decide_conversation_skill_activation("继续按刚才的格式补充行动项", skill)

    assert decision.apply is True
    assert decision.reason.startswith("conversation_skill_")
    assert decision.clear_conversation_skill is False


def test_conversation_skill_is_released_for_unrelated_turn():
    skill = SimpleNamespace(
        id=7,
        name="会议纪要提取",
        description="Extract decisions, minutes, and action items from meetings.",
        category="顾问基础能力",
    )

    decision = decide_conversation_skill_activation("这个项目目前最大的交付风险是什么？", skill)

    assert decision.apply is False
    assert decision.reason == "conversation_skill_not_relevant"
    assert decision.clear_conversation_skill is True


def test_conversation_skill_honors_explicit_release():
    skill = SimpleNamespace(
        id=7,
        name="会议纪要提取",
        description="Extract meeting minutes.",
        category="顾问基础能力",
    )

    decision = decide_conversation_skill_activation("不用这个技能，回到普通对话", skill)

    assert decision.apply is False
    assert decision.reason == "conversation_skill_released_by_user"
    assert decision.clear_conversation_skill is True


def test_presentation_builder_matches_client_deck_language():
    skill = SimpleNamespace(
        name="presentation-builder",
        description="Base consulting PowerPoint generation skill",
        category="consulting",
    )

    score, reason = skill_auto_match_score("帮我做一个客户介绍 PPT，用于明天汇报", skill)

    assert score >= 82
    assert reason.startswith("alias:")


def test_consulting_proposal_skill_wins_for_proposal_presentation_language():
    skill = SimpleNamespace(
        name="consulting-proposal-advisor",
        description="Create client-ready consulting proposals and PPTX decks",
        category="consulting",
    )

    score, reason = skill_auto_match_score("准备一个方案沟通ppt吧", skill)

    assert is_proposal_presentation_request("准备一个方案沟通ppt吧") is True
    assert score >= 94
    assert reason == "proposal_presentation_intent"
