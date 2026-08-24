import asyncio
from unittest.mock import AsyncMock, patch

from app.services.agent_harness.grounded_provider_eval import (
    grade_grounded_answer,
    run_grounded_provider_eval,
)


async def _passing_provider(_system: str, prompt: str, _max_tokens: int) -> str:
    if "Atlas" in prompt:
        return (
            "核心风险是数据迁移依赖 Atlas 供应商且接口未完成 [E1]，"
            "第二次演练延迟 7 天 [E2]。下一步应在 2026-09-05 前指定对账签字负责人 [E3]。"
        )
    if "合同总额" in prompt:
        return (
            "合同总额 120 万元，未收款 40 万元 [E1]。"
            "最近节点是 2026-09-15 到期的 20 万元款项 [E2]。"
        )
    if "李敏" in prompt:
        return "李敏是客户 CFO 和最终决策人 [E1]；应当每周五发送书面进度更新 [E2]。"
    return "提供的证据未提供预算上限，因此无法确定，不能猜测。"


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
    }
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
    assert attempts == 5


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
