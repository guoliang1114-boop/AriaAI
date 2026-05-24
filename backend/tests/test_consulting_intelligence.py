from app.services.consulting_intelligence import build_consulting_turn_frame


def test_pre_meeting_frame_prioritizes_30_second_client_brief():
    frame = build_consulting_turn_frame("我 30 秒后要见客户，帮我准备开场、避雷点和推进建议。", project_id=1)

    assert frame.job_type == "pre_meeting_brief"
    assert frame.client_moment == "before_client_meeting"
    assert "stakeholders" in frame.memory_focus
    assert "opening_line" in frame.response_shape


def test_proposal_frame_builds_persuasion_chain():
    frame = build_consulting_turn_frame("帮我准备一个客户数字化转型建议书和报价方案。", project_id=1)

    assert frame.job_type == "proposal_or_business_case"
    assert frame.client_moment == "pursuit_or_scope_alignment"
    assert frame.response_shape[:3] == ("why_now", "diagnosis", "recommended_solution")


def test_project_risk_frame_uses_delivery_control_shape():
    frame = build_consulting_turn_frame("识别项目风险和阻塞点，给出缓解动作。", project_id=1)

    assert frame.job_type == "project_risk_diagnosis"
    assert "milestones" in frame.memory_focus
    assert "decision_needed" in frame.response_shape
