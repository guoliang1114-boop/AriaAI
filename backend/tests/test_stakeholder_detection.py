from app.services.stakeholder_detection import detect_stakeholders_from_text


def test_stakeholder_detection_rejects_topic_as_person():
    text = "本次重点关注数据安全、系统交付和品牌负责人意见，不要把数据安全误认为客户干系人。"

    assert detect_stakeholders_from_text(text) == []


def test_stakeholder_detection_rejects_department_role_without_name():
    text = "需要进一步确认采购负责人、法务负责人和高管层对方案的态度。"

    assert detect_stakeholders_from_text(text) == []


def test_stakeholder_detection_accepts_named_chinese_stakeholders():
    text = "张经理关注预算，李总监更在意实施风险，王总希望下周看到方案。"

    candidates = detect_stakeholders_from_text(text)

    assert [candidate["name"] for candidate in candidates] == ["张经理", "李总监", "王总"]
    assert [candidate["role"] for candidate in candidates] == ["经理", "总监", "总"]


def test_stakeholder_detection_accepts_english_person_with_title():
    text = "Please align with Alice Wang, CFO before sending the commercial proposal."

    candidates = detect_stakeholders_from_text(text)

    assert candidates[0]["name"] == "Alice Wang"
    assert candidates[0]["role"].upper() == "CFO"
