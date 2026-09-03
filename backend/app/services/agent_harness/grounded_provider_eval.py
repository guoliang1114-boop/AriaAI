"""Real-provider grounded project Q&A evaluation.

The cases use synthetic consulting-project facts, never production project
content. A configured Aria provider answers each case, then deterministic
graders measure fact inclusion, correct source citations, unsupported claims,
and abstention when evidence is missing.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import time
from typing import Any, Awaitable, Callable, Mapping


ProviderComplete = Callable[[str, str, int], Awaitable[str]]
PROVIDER_EVAL_MAX_ATTEMPTS = 3
PROVIDER_EVAL_RETRY_DELAYS_SECONDS = (2.0, 5.0)
PROVIDER_EVAL_MAX_QUALITY_REPAIRS = 2

GROUNDED_QA_SYSTEM = """You are Aria's grounded project Q&A assistant.
Use only the evidence supplied in the user message. Do not add outside facts or assumptions.
Before answering, silently build a checklist for every [R*] requested fact type. Cover every item; a response is incomplete if it substitutes a related metric or adjacent fact for the requested one.
When evidence conflicts, CURRENT and DIRECT evidence overrides STALE or indirect memory. State the current value with its matching citation and do not present the displaced stale value as current.
DIRECT and MATCHED evidence may support a factual answer. SCOPED, LEGACY, and UNRESOLVED memory is not independently verified; qualify it or explicitly say it is unconfirmed.
Write every requested supported fact as a separate bullet. End that same bullet with exactly one matching ASCII citation token such as [E1].
Use the literal ASCII square-bracket form [E1]; do not use full-width brackets, a separate source list, or citations on the next line.
Required shape: `- [R1] <one supported fact> [E1]`. Keep the matching [R*] label from the requested-fact checklist. The final non-whitespace characters of every supported bullet must be its citation token.
Invalid shape: list several uncited facts and then add `Sources: [E1] [E2]` at the end.
Never invent a citation key. Cover every fact type explicitly requested by the question. If a requested fact is absent, explicitly say that the provided evidence is insufficient and do not guess.
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
        "required_fact_types": ("核心依赖风险", "延期天数", "下一步动作与日期"),
        "claims": (
            {"variants": ("atlas供应商", "atlas 供应商"), "citation": "E1"},
            {"variants": ("延迟7天", "延迟 7 天"), "citation": "E2"},
            {"variants": ("2026-09-05", "2026年9月5日"), "citation": "E3"},
        ),
        "forbidden": ("nova供应商", "延迟14天", "2026-09-15前指定"),
    },
    {
        "id": "project_financial_status",
        "question": "请分别说明合同总额、未收款金额，以及下一笔收款的到期日期。",
        "evidence": (
            ("E1", "合同总额 120 万元，已收款 80 万元，未收款 40 万元。"),
            ("E2", "下一笔 20 万元款项计划于 2026-09-15 到期。"),
        ),
        "claims": (
            {
                "variants": (
                    "合同总额120万元",
                    "合同总额 120 万元",
                    "合同总额120万",
                    "合同金额120万",
                    "合同总金额120万",
                    "总额为120万",
                ),
                "citation": "E1",
            },
            {
                "variants": (
                    "未收款40万元",
                    "未收款 40 万元",
                    "尚有40万元未回款",
                    "尚有 40 万元未回款",
                    "剩余40万元未收",
                    "40万元未回款",
                    "未收40万",
                    "待收40万",
                    "应收40万",
                    "剩余应收40万",
                    "未回款金额40万",
                    "尚未收回40万",
                    "未收回40万",
                    "还有40万未收",
                    "剩余40万",
                    "尚有40万元待收",
                    "40万元待收",
                    "待收款40万元",
                    "未收款金额为40万元",
                ),
                "citation": "E1",
            },
            {"variants": ("2026-09-15", "2026年9月15日"), "citation": "E2"},
        ),
        "required_fact_types": ("合同总额", "未收款金额", "下一笔收款到期日期"),
        "forbidden": ("合同总额150万元", "未收款70万元", "2026-10-15"),
    },
    {
        "id": "project_stakeholder_preference",
        "question": "请分别说明关键决策人的姓名与职务，以及沟通频率和沟通形式。",
        "evidence": (
            ("E1", "李敏是客户 CFO，也是本项目的最终业务决策人。"),
            ("E2", "李敏要求每周五收到书面进度更新，不接受只做口头汇报。"),
        ),
        "claims": (
            {
                "variants": ("李敏",),
                "citation": "E1",
            },
            {
                "variants": ("cfo", "首席财务官"),
                "citation": "E1",
            },
            {"variants": ("每周五", "周五"), "citation": "E2"},
            {"variants": ("书面进度更新", "书面更新"), "citation": "E2"},
        ),
        "required_fact_types": ("决策人姓名", "决策人职务", "沟通频率", "沟通形式"),
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
        "required_fact_types": ("预算上限；证据缺失时明确拒答",),
        "forbidden": ("预算上限为500万元", "预算上限为300万元", "预算是500万元"),
    },
    {
        "id": "current_direct_evidence_overrides_stale_memory",
        "question": "当前项目治理会是星期几召开，从哪一天开始生效？",
        "evidence": (
            (
                "E1",
                "[STALE][PROVENANCE:SCOPED] 旧项目记忆记录治理会每周一召开。",
            ),
            (
                "E2",
                "[CURRENT][PROVENANCE:DIRECT] 会议纪要 #418 确认治理会从 2026-09-01 起调整为每周五召开。",
            ),
        ),
        "claims": (
            {"variants": ("每周五", "周五"), "citation": "E2"},
            {"variants": ("2026-09-01", "2026年9月1日"), "citation": "E2"},
        ),
        "required_fact_types": ("当前召开日", "生效日期"),
        "forbidden": ("当前每周一", "现在每周一", "仍为每周一"),
        "priority_case": True,
    },
    {
        "id": "unresolved_memory_requires_qualification",
        "question": "项目预算上限是否已经得到可靠来源确认？",
        "evidence": (
            (
                "E1",
                "[PROVENANCE:UNRESOLVED] 聚合记忆中出现“预算上限 300 万元”，但没有稳定 source ID 或原始证据。",
            ),
        ),
        "claims": (
            {
                "variants": (
                    "未得到可靠来源确认",
                    "没有得到可靠来源确认",
                    "没有可靠来源确认",
                    "无法确认",
                    "尚未确认",
                    "尚无可靠来源确认",
                    "未有可靠来源确认",
                    "缺乏可靠来源确认",
                    "未被可靠来源证实",
                    "不能确认",
                    "无法证实",
                ),
                "citation": "E1",
                "qualified_abstention_equivalent": True,
            },
        ),
        "must_abstain": True,
        "required_fact_types": ("预算上限的可靠来源确认状态",),
        "forbidden": ("预算上限已确认", "已经确认预算上限", "可靠来源确认预算上限"),
        "provenance_case": True,
    },
)

_CITATION_PATTERN = re.compile(r"\[E([1-9][0-9]{0,2})\]")
_LOOSE_CITATION_PATTERN = re.compile(
    r"(?:\[|【|（|\()\s*E([1-9][0-9]{0,2})\s*(?:\]|】|）|\))"
)
_ABSTENTION_MARKERS = (
    "证据不足",
    "信息不足",
    "未提供",
    "没有提供",
    "无法确定",
    "无法判断",
    "无法确认",
    "尚未确认",
    "未得到可靠来源确认",
    "没有得到可靠来源确认",
    "insufficient evidence",
    "not provided",
    "cannot determine",
)
_PROVENANCE_QUALIFICATION_MARKERS = (
    "可靠",
    "来源",
    "证据",
    "确认",
    "证实",
    "核验",
    "sourceid",
    "source id",
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
    # A citation at the end of a bullet clause supports facts separated by a
    # semicolon inside that clause. Preserve full-stop boundaries so citations
    # from a different sentence cannot be borrowed by an unrelated claim.
    for clause in re.split(r"[。\n]", answer):
        normalized_clause = _normalize(clause)
        if f"[{citation}]" not in clause:
            continue
        if any(_normalize(variant) in normalized_clause for variant in variants):
            return True
    return False


def _is_qualified_abstention(answer: str) -> bool:
    normalized_answer = _normalize(answer)
    has_abstention = any(marker in answer.lower() for marker in _ABSTENTION_MARKERS)
    has_provenance_context = any(
        _normalize(marker) in normalized_answer
        for marker in _PROVENANCE_QUALIFICATION_MARKERS
    )
    return has_abstention and has_provenance_context


def _contains_forbidden_fact(normalized_answer: str, term: str) -> bool:
    normalized_term = _normalize(term)
    if normalized_term == "每周一":
        # Chinese "每周一次" (once per week) contains the weekday string
        # "每周一" but does not claim that communication happens on Monday.
        return re.search(r"每周一(?!次)", normalized_answer) is not None
    return bool(normalized_term and normalized_term in normalized_answer)


def _render_case_prompt(case: dict[str, Any]) -> str:
    required_facts = [
        f"[R{index}] {fact_type}"
        for index, fact_type in enumerate(
            case.get("required_fact_types") or (),
            start=1,
        )
    ]
    blocks = [
        "以下证据是本轮唯一事实来源：",
        *[f"[{key}] {content}" for key, content in case["evidence"]],
        "",
        f"用户问题：{case['question']}",
        "必须逐项覆盖的事实类型：",
        *required_facts,
        "完整性规则：最终回答必须逐项覆盖每个 [R*]，不得用相邻指标替代；缺失项也必须单独说明证据不足。",
        "输出格式：严格按 [R*] 顺序逐项输出并保留对应的 [R*] 标签；每个事实类型单独一条项目符号，并在同一行句末写唯一对应的 ASCII [E*]；证据缺失的事实明确拒答。",
    ]
    return "\n".join(blocks)


def grade_grounded_answer(case: dict[str, Any], answer: str) -> dict[str, Any]:
    normalized_answer = _normalize(answer)
    valid_keys = {key for key, _ in case["evidence"]}
    observed_keys = list(
        dict.fromkeys(f"E{item}" for item in _CITATION_PATTERN.findall(answer))
    )
    loosely_observed_keys = list(
        dict.fromkeys(f"E{item}" for item in _LOOSE_CITATION_PATTERN.findall(answer))
    )
    abstained = any(marker in answer.lower() for marker in _ABSTENTION_MARKERS)
    claims = []
    for claim in case.get("claims") or ():
        present, _, matched = _claim_match(answer, claim["variants"])
        qualified_abstention = bool(
            not present
            and claim.get("qualified_abstention_equivalent")
            and _is_qualified_abstention(answer)
        )
        if qualified_abstention:
            present = True
            matched = "qualified_abstention"
        cited = present and (
            _claim_has_citation(answer, claim["variants"], claim["citation"])
            or (qualified_abstention and claim["citation"] in observed_keys)
        )
        claims.append(
            {
                "present": present,
                "correctly_cited": cited,
                "expected_citation": claim["citation"],
                "matched_variant": matched,
            }
        )
    forbidden_hits = [
        term for term in case.get("forbidden") or ()
        if _contains_forbidden_fact(normalized_answer, term)
    ]
    invalid_citations = [key for key in observed_keys if key not in valid_keys]
    must_abstain = bool(case.get("must_abstain", False))
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
        "observed_citation_count": len(observed_keys),
        "citation_format_mismatch_count": len(
            [key for key in loosely_observed_keys if key not in observed_keys]
        ),
        "must_abstain": must_abstain,
        "abstained": abstained,
        "passed_abstention": (not must_abstain) or (abstained and not forbidden_hits),
    }


def _case_passed(item: Mapping[str, Any]) -> bool:
    return bool(
        item["present_claim_count"] == item["required_claim_count"]
        and item["correctly_cited_claim_count"] == item["required_claim_count"]
        and not item["forbidden_hits"]
        and not item["invalid_citations"]
        and item["passed_abstention"]
    )


def _render_quality_repair_prompt(
    case: Mapping[str, Any],
    original_prompt: str,
    draft: str,
    grade: Mapping[str, Any],
) -> str:
    required_fact_types = tuple(case.get("required_fact_types") or ())
    findings: list[str] = []
    for index, claim in enumerate(grade.get("claims") or (), start=1):
        label = (
            str(required_fact_types[index - 1])
            if index <= len(required_fact_types)
            else f"requested fact {index}"
        )
        if not claim.get("present"):
            findings.append(f"- [R{index}] `{label}` 尚未明确回答。")
        elif not claim.get("correctly_cited"):
            findings.append(
                f"- [R{index}] `{label}` 必须在同一条末尾使用 "
                f"[{claim.get('expected_citation')}]。"
            )
    if grade.get("invalid_citations"):
        findings.append("- 删除证据列表中不存在的引用键。")
    if grade.get("forbidden_hits"):
        findings.append("- 删除证据不支持或已被更新证据取代的断言。")
    if case.get("must_abstain") and not grade.get("passed_abstention"):
        findings.append("- 对缺失或未核验事实明确说明无法确认，不得猜测。")
    if not findings:
        findings.append("- 严格按逐项清单重写，并确保每项引用与本行事实匹配。")
    return "\n".join(
        (
            original_prompt,
            "",
            "以下是未通过完整性与引用校验的初稿：",
            draft,
            "",
            "质量复核发现：",
            *findings,
            "请只输出修正后的最终回答，不解释修订过程。",
        )
    )


def _ratio(passed: int, total: int) -> float:
    return round(passed / total, 4) if total else 1.0


def _is_transient_provider_error(exc: BaseException) -> bool:
    message = str(exc or "").lower()
    return any(
        marker in message
        for marker in (
            "http 429",
            "rate limit",
            "overloaded",
            "temporarily unavailable",
            "timeout",
            "timed out",
            "http 502",
            "http 503",
            "http 504",
        )
    )


async def _complete_with_bounded_retry(
    complete: ProviderComplete,
    system: str,
    prompt: str,
    max_tokens: int,
) -> tuple[str, int]:
    retries = 0
    for attempt in range(PROVIDER_EVAL_MAX_ATTEMPTS):
        try:
            return await complete(system, prompt, max_tokens), retries
        except Exception as exc:
            is_last_attempt = attempt + 1 >= PROVIDER_EVAL_MAX_ATTEMPTS
            if is_last_attempt or not _is_transient_provider_error(exc):
                raise
            retries += 1
            await asyncio.sleep(PROVIDER_EVAL_RETRY_DELAYS_SECONDS[attempt])
    raise RuntimeError("provider evaluation retry loop exhausted")  # pragma: no cover


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
        prompt = _render_case_prompt(case)
        answer, provider_retry_count = await _complete_with_bounded_retry(
            complete,
            GROUNDED_QA_SYSTEM,
            prompt,
            700,
        )
        answer = str(answer or "")
        result = grade_grounded_answer(case, answer)
        first_pass = result
        quality_repair_count = 0
        while (
            not _case_passed(result)
            and quality_repair_count < PROVIDER_EVAL_MAX_QUALITY_REPAIRS
        ):
            answer, retry_count = await _complete_with_bounded_retry(
                complete,
                GROUNDED_QA_SYSTEM,
                _render_quality_repair_prompt(case, prompt, answer, result),
                700,
            )
            provider_retry_count += retry_count
            quality_repair_count += 1
            answer = str(answer or "")
            result = grade_grounded_answer(case, answer)
        result["provider_retry_count"] = provider_retry_count
        result["quality_repair_count"] = quality_repair_count
        result["first_pass_passed"] = _case_passed(first_pass)
        result["quality_repair_succeeded"] = bool(
            quality_repair_count and _case_passed(result)
        )
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

    priority_results = [
        item
        for case, item in zip(_CASES, results)
        if case.get("priority_case")
    ]
    provenance_results = [
        item
        for case, item in zip(_CASES, results)
        if case.get("provenance_case")
    ]
    metrics = {
        "factual_accuracy": _ratio(present_claims, total_claims),
        "citation_coverage": _ratio(cited_claims, total_claims),
        "unsupported_claim_rate": _ratio(unsupported_count, max(1, total_claims)),
        "abstention_accuracy": _ratio(passed_abstentions, len(abstention_cases)),
        "source_priority_accuracy": _ratio(
            sum(int(_case_passed(item)) for item in priority_results),
            len(priority_results),
        ),
        "provenance_calibration_accuracy": _ratio(
            sum(int(_case_passed(item)) for item in provenance_results),
            len(provenance_results),
        ),
        "first_pass_case_accuracy": _ratio(
            sum(int(item["first_pass_passed"]) for item in results),
            len(results),
        ),
        "quality_repair_success_rate": _ratio(
            sum(int(item["quality_repair_succeeded"]) for item in results),
            sum(int(item["quality_repair_count"] > 0) for item in results),
        ),
    }
    thresholds = {
        "factual_accuracy": 1.0,
        "citation_coverage": 1.0,
        "unsupported_claim_rate_max": 0.0,
        "abstention_accuracy": 1.0,
        "source_priority_accuracy": 1.0,
        "provenance_calibration_accuracy": 1.0,
        "quality_repair_success_rate": 1.0,
    }
    release_gate_passed = (
        metrics["factual_accuracy"] >= thresholds["factual_accuracy"]
        and metrics["citation_coverage"] >= thresholds["citation_coverage"]
        and metrics["unsupported_claim_rate"] <= thresholds["unsupported_claim_rate_max"]
        and metrics["abstention_accuracy"] >= thresholds["abstention_accuracy"]
        and metrics["source_priority_accuracy"] >= thresholds["source_priority_accuracy"]
        and metrics["provenance_calibration_accuracy"]
        >= thresholds["provenance_calibration_accuracy"]
        and metrics["quality_repair_success_rate"]
        >= thresholds["quality_repair_success_rate"]
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
                "observed_citation_count": item["observed_citation_count"],
                "citation_format_mismatch_count": item[
                    "citation_format_mismatch_count"
                ],
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
