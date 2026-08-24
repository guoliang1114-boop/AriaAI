"""Real-provider grounded project Q&A evaluation.

The cases use synthetic consulting-project facts, never production project
content. A configured Aria provider answers each case, then deterministic
graders measure fact inclusion, correct source citations, unsupported claims,
and abstention when evidence is missing.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Awaitable, Callable


ProviderComplete = Callable[[str, str, int], Awaitable[str]]

GROUNDED_QA_SYSTEM = """You are Aria's grounded project Q&A assistant.
Use only the evidence supplied in the user message. Do not add outside facts or assumptions.
For every concrete factual claim, copy the critical fact accurately and place its supporting [E*] citation immediately after the claim.
Never invent a citation key. If the requested fact is absent, explicitly say that the provided evidence is insufficient and do not guess.
Answer concisely in Chinese."""

_CASES: tuple[dict[str, Any], ...] = (
    {
        "id": "project_risk_and_action",
        "question": "这个项目当前最重要的风险是什么，下一步应该做什么？",
        "evidence": (
            ("E1", "数据迁移依赖 Atlas 供应商，接口交付尚未完成。"),
            ("E2", "第二次迁移演练已延迟 7 天。"),
            ("E3", "下一步是在 2026-09-05 前指定对账签字负责人。"),
        ),
        "claims": (
            {"variants": ("atlas供应商", "atlas 供应商"), "citation": "E1"},
            {"variants": ("延迟7天", "延迟 7 天"), "citation": "E2"},
            {"variants": ("2026-09-05", "2026年9月5日"), "citation": "E3"},
        ),
        "forbidden": ("nova供应商", "延迟14天", "2026-09-15前指定"),
    },
    {
        "id": "project_financial_status",
        "question": "概括项目合同与回款状态，并指出最近的收款节点。",
        "evidence": (
            ("E1", "合同总额 120 万元，已收款 80 万元，未收款 40 万元。"),
            ("E2", "下一笔 20 万元款项计划于 2026-09-15 到期。"),
        ),
        "claims": (
            {"variants": ("合同总额120万元", "合同总额 120 万元"), "citation": "E1"},
            {"variants": ("未收款40万元", "未收款 40 万元"), "citation": "E1"},
            {"variants": ("2026-09-15", "2026年9月15日"), "citation": "E2"},
        ),
        "forbidden": ("合同总额150万元", "未收款70万元", "2026-10-15"),
    },
    {
        "id": "project_stakeholder_preference",
        "question": "谁是关键决策人，应当如何与她沟通？",
        "evidence": (
            ("E1", "李敏是客户 CFO，也是本项目的最终业务决策人。"),
            ("E2", "李敏要求每周五收到书面进度更新，不接受只做口头汇报。"),
        ),
        "claims": (
            {"variants": ("李敏是客户cfo", "李敏是客户 CFO", "李敏是cfo"), "citation": "E1"},
            {"variants": ("每周五", "周五"), "citation": "E2"},
            {"variants": ("书面进度更新", "书面更新"), "citation": "E2"},
        ),
        "forbidden": ("王敏", "每周一", "只需口头汇报"),
    },
    {
        "id": "missing_budget_abstention",
        "question": "这个项目的预算上限是多少？",
        "evidence": (
            ("E1", "项目当前处于用户验收测试阶段。"),
            ("E2", "下一里程碑是完成数据迁移演练。"),
        ),
        "claims": (),
        "must_abstain": True,
        "forbidden": ("预算上限为500万元", "预算上限为300万元", "预算是500万元"),
    },
)

_CITATION_PATTERN = re.compile(r"\[E([1-9][0-9]{0,2})\]")
_ABSTENTION_MARKERS = (
    "证据不足",
    "信息不足",
    "未提供",
    "没有提供",
    "无法确定",
    "无法判断",
    "insufficient evidence",
    "not provided",
    "cannot determine",
)


def _normalize(value: str) -> str:
    return re.sub(r"[\s，。；：、,.!?！？;:（）()]", "", str(value or "").lower())


def _claim_match(answer: str, variants: tuple[str, ...]) -> tuple[bool, int, str]:
    normalized_answer = _normalize(answer)
    for variant in variants:
        normalized_variant = _normalize(variant)
        offset = normalized_answer.find(normalized_variant)
        if offset >= 0:
            return True, offset, normalized_variant
    return False, -1, ""


def _claim_has_citation(answer: str, variants: tuple[str, ...], citation: str) -> bool:
    segments = re.split(r"[。；;\n]", answer)
    for segment in segments:
        normalized_segment = _normalize(segment)
        if f"[{citation}]" not in segment:
            continue
        if any(_normalize(variant) in normalized_segment for variant in variants):
            return True
    return False


def _render_case_prompt(case: dict[str, Any]) -> str:
    blocks = [
        "以下证据是本轮唯一事实来源：",
        *[f"[{key}] {content}" for key, content in case["evidence"]],
        "",
        f"用户问题：{case['question']}",
    ]
    return "\n".join(blocks)


def grade_grounded_answer(case: dict[str, Any], answer: str) -> dict[str, Any]:
    claims = []
    for claim in case.get("claims") or ():
        present, _, matched = _claim_match(answer, claim["variants"])
        cited = present and _claim_has_citation(
            answer,
            claim["variants"],
            claim["citation"],
        )
        claims.append(
            {
                "present": present,
                "correctly_cited": cited,
                "expected_citation": claim["citation"],
                "matched_variant": matched,
            }
        )
    normalized_answer = _normalize(answer)
    forbidden_hits = [
        term for term in case.get("forbidden") or ()
        if _normalize(term) in normalized_answer
    ]
    valid_keys = {key for key, _ in case["evidence"]}
    observed_keys = list(dict.fromkeys(f"E{item}" for item in _CITATION_PATTERN.findall(answer)))
    invalid_citations = [key for key in observed_keys if key not in valid_keys]
    must_abstain = bool(case.get("must_abstain", False))
    abstained = any(marker in answer.lower() for marker in _ABSTENTION_MARKERS)
    return {
        "case_id": case["id"],
        "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
        "answer_chars": len(answer),
        "claims": claims,
        "required_claim_count": len(claims),
        "present_claim_count": sum(int(item["present"]) for item in claims),
        "correctly_cited_claim_count": sum(int(item["correctly_cited"]) for item in claims),
        "forbidden_hits": forbidden_hits,
        "invalid_citations": invalid_citations,
        "must_abstain": must_abstain,
        "abstained": abstained,
        "passed_abstention": (not must_abstain) or (abstained and not forbidden_hits),
    }


def _ratio(passed: int, total: int) -> float:
    return round(passed / total, 4) if total else 1.0


async def run_grounded_provider_eval(
    complete: ProviderComplete,
    *,
    provider: str,
    model: str,
) -> dict[str, Any]:
    """Call one real provider and return a privacy-safe release report."""

    results: list[dict[str, Any]] = []
    started = time.perf_counter()
    for case in _CASES:
        case_started = time.perf_counter()
        answer = await complete(
            GROUNDED_QA_SYSTEM,
            _render_case_prompt(case),
            700,
        )
        result = grade_grounded_answer(case, str(answer or ""))
        result["duration_ms"] = round((time.perf_counter() - case_started) * 1000)
        results.append(result)

    total_claims = sum(item["required_claim_count"] for item in results)
    present_claims = sum(item["present_claim_count"] for item in results)
    cited_claims = sum(item["correctly_cited_claim_count"] for item in results)
    unsupported_count = sum(
        len(item["forbidden_hits"]) + len(item["invalid_citations"])
        for item in results
    )
    abstention_cases = [item for item in results if item["must_abstain"]]
    passed_abstentions = sum(int(item["passed_abstention"]) for item in abstention_cases)
    metrics = {
        "factual_accuracy": _ratio(present_claims, total_claims),
        "citation_coverage": _ratio(cited_claims, total_claims),
        "unsupported_claim_rate": _ratio(unsupported_count, max(1, total_claims)),
        "abstention_accuracy": _ratio(passed_abstentions, len(abstention_cases)),
    }
    thresholds = {
        "factual_accuracy": 0.8,
        "citation_coverage": 0.8,
        "unsupported_claim_rate_max": 0.0,
        "abstention_accuracy": 1.0,
    }
    release_gate_passed = (
        metrics["factual_accuracy"] >= thresholds["factual_accuracy"]
        and metrics["citation_coverage"] >= thresholds["citation_coverage"]
        and metrics["unsupported_claim_rate"] <= thresholds["unsupported_claim_rate_max"]
        and metrics["abstention_accuracy"] >= thresholds["abstention_accuracy"]
    )
    return {
        "schema_version": 1,
        "provider": str(provider),
        "model": str(model),
        "case_count": len(results),
        "total_duration_ms": round((time.perf_counter() - started) * 1000),
        "metrics": metrics,
        "thresholds": thresholds,
        "release_gate_passed": release_gate_passed,
        "failures": [
            {
                "case_id": item["case_id"],
                "missing_claims": item["required_claim_count"] - item["present_claim_count"],
                "uncited_claims": item["required_claim_count"] - item["correctly_cited_claim_count"],
                "forbidden_hits": item["forbidden_hits"],
                "invalid_citations": item["invalid_citations"],
                "abstention_failed": item["must_abstain"] and not item["passed_abstention"],
            }
            for item in results
            if (
                item["present_claim_count"] < item["required_claim_count"]
                or item["correctly_cited_claim_count"] < item["required_claim_count"]
                or item["forbidden_hits"]
                or item["invalid_citations"]
                or (item["must_abstain"] and not item["passed_abstention"])
            )
        ],
        "cases": results,
    }


def compact_provider_eval_report(report: dict[str, Any]) -> str:
    """Stable JSON for logs without raw provider answers or prompts."""

    return json.dumps(report, ensure_ascii=False, sort_keys=True)
