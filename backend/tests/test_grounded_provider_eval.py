import asyncio
from unittest.mock import AsyncMock, patch

from app.services.agent_harness.grounded_provider_eval import (
    grade_grounded_answer,
    run_grounded_provider_eval,
)


async def _passing_provider(_system: str, prompt: str, _max_tokens: int) -> str:
    if "Atlas" in prompt:
        return (
            "- 核心风险是数据迁移依赖 Atlas 供应商且接口未完成 [E1]\n"
            "- 第二次演练延迟 7 天 [E2]\n"
            "- 下一步应在 2026-09-05 前指定对账签字负责人 [E3]"
        )
    if "合同总额" in prompt:
        return (
            "- 合同总额 120 万元 [E1]\n"
            "- 未收款 40 万元 [E1]\n"
            "- 最近节点是 2026-09-15 到期的 20 万元款项 [E2]"
        )
    if "李敏" in prompt:
        return (
            "- 李敏是最终决策人 [E1]\n"
            "- 李敏担任客户 CFO [E1]\n"
            "- 沟通频率为每周五 [E2]\n"
            "- 沟通形式为书面进度更新 [E2]"
        )
    if "会议纪要 #418" in prompt:
        return "- 当前治理会每周五召开 [E2]\n- 该调整从 2026-09-01 起生效 [E2]"
    if "PROVENANCE:UNRESOLVED" in prompt:
        return "- 预算上限尚未得到可靠来源确认，当前只能视为未核验记忆 [E1]"
    return "- 提供的证据未提供预算上限，因此无法确定，不能猜测。"


def test_grounded_provider_release_gate_passes_with_supported_answers():
    report = asyncio.run(
        run_grounded_provider_eval(
            _passing_provider,
            provider="test",
            model="test-model",
        )
    )

    assert report["release_gate_passed"] is True, report["failures"]
    assert report["metrics"] == {
        "factual_accuracy": 1.0,
        "citation_coverage": 1.0,
        "unsupported_claim_rate": 0.0,
        "abstention_accuracy": 1.0,
        "source_priority_accuracy": 1.0,
        "provenance_calibration_accuracy": 1.0,
        "first_pass_case_accuracy": 1.0,
        "quality_repair_success_rate": 1.0,
    }
    assert report["case_count"] == 6
    assert report["thresholds"]["factual_accuracy"] == 1.0
    assert report["thresholds"]["citation_coverage"] == 1.0
    assert "Atlas" not in str(report)


def test_grounded_grader_detects_invalid_citation_and_hallucination():
    case = {
        "id": "bad",
        "evidence": (("E1", "真实事实"),),
        "claims": ({"variants": ("真实事实",), "citation": "E1"},),
        "forbidden": ("虚构事实",),
    }
    result = grade_grounded_answer(case, "真实事实 [E9]，同时声称虚构事实。")

    assert result["present_claim_count"] == 1
    assert result["correctly_cited_claim_count"] == 0
    assert result["invalid_citations"] == ["E9"]
    assert result["forbidden_hits"] == ["虚构事实"]


def test_grounded_grader_accepts_equivalent_fact_order_but_rejects_full_width_citation():
    case = {
        "id": "paraphrase",
        "evidence": (("E1", "李敏是客户 CFO。"),),
        "claims": ({"variants": ("客户cfo李敏",), "citation": "E1"},),
        "forbidden": (),
    }

    result = grade_grounded_answer(case, "- 客户 CFO 李敏是决策人【E1】")

    assert result["present_claim_count"] == 1
    assert result["correctly_cited_claim_count"] == 0
    assert result["observed_citation_count"] == 0
    assert result["citation_format_mismatch_count"] == 1


def test_grounded_grader_applies_line_citation_to_semicolon_separated_facts():
    case = {
        "id": "same_bullet",
        "evidence": (("E1", "每周五书面更新。"),),
        "claims": (
            {"variants": ("每周五",), "citation": "E1"},
            {"variants": ("书面进度更新",), "citation": "E1"},
        ),
        "forbidden": (),
    }

    result = grade_grounded_answer(
        case,
        "- 沟通频率为每周五；沟通形式为书面进度更新 [E1]",
    )

    assert result["present_claim_count"] == 2
    assert result["correctly_cited_claim_count"] == 2


def test_grounded_grader_does_not_borrow_citation_across_sentences():
    case = {
        "id": "wrong_sentence_citations",
        "evidence": (("E1", "甲事实。"), ("E2", "乙事实。")),
        "claims": (
            {"variants": ("甲事实",), "citation": "E1"},
            {"variants": ("乙事实",), "citation": "E2"},
        ),
        "forbidden": (),
    }

    result = grade_grounded_answer(case, "甲事实 [E2]。乙事实 [E1]")

    assert result["present_claim_count"] == 2
    assert result["correctly_cited_claim_count"] == 0


def test_grounded_grader_accepts_cited_qualified_provenance_abstention():
    case = {
        "id": "qualified_provenance",
        "evidence": (("E1", "记忆没有稳定来源。"),),
        "claims": (
            {
                "variants": ("未得到可靠来源确认",),
                "citation": "E1",
                "qualified_abstention_equivalent": True,
            },
        ),
        "must_abstain": True,
        "forbidden": ("预算上限已确认",),
    }

    result = grade_grounded_answer(
        case,
        "- 现有记忆缺少稳定 source ID，因此无法确认其可靠性 [E1]",
    )

    assert result["present_claim_count"] == 1
    assert result["correctly_cited_claim_count"] == 1
    assert result["claims"][0]["matched_variant"] == "qualified_abstention"


def test_forbidden_weekday_does_not_false_match_once_per_week():
    case = {
        "id": "weekday_boundary",
        "evidence": (("E1", "每周五更新。"),),
        "claims": ({"variants": ("每周五",), "citation": "E1"},),
        "forbidden": ("每周一",),
    }

    once = grade_grounded_answer(case, "每周一次，固定每周五 [E1]。")
    monday = grade_grounded_answer(case, "每周一更新，另在每周五更新 [E1]。")

    assert once["forbidden_hits"] == []
    assert monday["forbidden_hits"] == ["每周一"]


def test_grounded_provider_eval_retries_transient_overload_only():
    attempts = 0

    async def flaky_provider(system: str, prompt: str, max_tokens: int) -> str:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("Kimi HTTP 429: engine_overloaded_error")
        return await _passing_provider(system, prompt, max_tokens)

    with patch("app.services.agent_harness.grounded_provider_eval.asyncio.sleep", new=AsyncMock()):
        report = asyncio.run(
            run_grounded_provider_eval(
                flaky_provider,
                provider="test",
                model="test-model",
            )
        )

    assert report["release_gate_passed"] is True
    assert report["cases"][0]["provider_retry_count"] == 1
    assert attempts == 7


def test_grounded_provider_eval_does_not_retry_non_transient_errors():
    attempts = 0

    async def broken_provider(_system: str, _prompt: str, _max_tokens: int) -> str:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("No API key configured")

    with patch("app.services.agent_harness.grounded_provider_eval.asyncio.sleep", new=AsyncMock()):
        try:
            asyncio.run(
                run_grounded_provider_eval(
                    broken_provider,
                    provider="test",
                    model="test-model",
                )
            )
        except RuntimeError as exc:
            assert "No API key" in str(exc)
        else:  # pragma: no cover
            raise AssertionError("expected provider configuration error")

    assert attempts == 1


def test_grounded_provider_gate_rejects_one_missing_requested_dimension():
    async def incomplete_provider(system: str, prompt: str, max_tokens: int) -> str:
        if "合同总额" in prompt:
            return (
                "- 合同总额 120 万元 [E1]\n"
                "- 最近节点是 2026-09-15 到期的 20 万元款项 [E2]"
            )
        return await _passing_provider(system, prompt, max_tokens)

    report = asyncio.run(
        run_grounded_provider_eval(
            incomplete_provider,
            provider="test",
            model="test-model",
        )
    )

    assert report["release_gate_passed"] is False
    assert report["metrics"]["factual_accuracy"] < 1.0
    assert report["failures"] == [
        {
            "case_id": "project_financial_status",
            "missing_claims": 1,
            "uncited_claims": 1,
            "forbidden_hits": [],
            "invalid_citations": [],
            "observed_citation_count": 2,
            "citation_format_mismatch_count": 0,
            "abstention_failed": False,
        }
    ]


def test_grounded_provider_repairs_a_missing_dimension_with_bounded_feedback():
    financial_attempts = 0

    async def repairable_provider(system: str, prompt: str, max_tokens: int) -> str:
        nonlocal financial_attempts
        if "合同总额" in prompt:
            financial_attempts += 1
            if "质量复核发现" not in prompt:
                return (
                    "- [R1] 合同总额 120 万元 [E1]\n"
                    "- [R3] 下一笔于 2026-09-15 到期 [E2]"
                )
            return (
                "- [R1] 合同总额 120 万元 [E1]\n"
                "- [R2] 未收款 40 万元 [E1]\n"
                "- [R3] 下一笔于 2026-09-15 到期 [E2]"
            )
        return await _passing_provider(system, prompt, max_tokens)

    report = asyncio.run(
        run_grounded_provider_eval(
            repairable_provider,
            provider="test",
            model="test-model",
        )
    )

    financial = next(
        item
        for item in report["cases"]
        if item["case_id"] == "project_financial_status"
    )
    assert report["release_gate_passed"] is True
    assert report["metrics"]["first_pass_case_accuracy"] == 0.8333
    assert report["metrics"]["quality_repair_success_rate"] == 1.0
    assert financial["quality_repair_count"] == 1
    assert financial["quality_repair_succeeded"] is True
    assert financial_attempts == 2
