"""Deterministic completion evidence and verdicts for Aria chat runs.

The bounded evidence snapshots, structured findings, and explicit overall
verdict are adapted from OpenAI Codex's
``codex-rs/core/src/context/guardian_review_evidence.rs``,
``codex-rs/prompts/templates/review/rubric.md``, and
``codex-rs/protocol/src/review_format.rs`` at upstream commit
``99660ab3c7b861c916e467581fa9b8723504d66b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: replaced code-review/model judgment with a
provider-neutral deterministic grader over Aria Agent Steps, tool audit events,
Artifact delivery, policy traces, confirmation state, and execution budgets.
Only bounded evidence summaries are persisted; no Codex runtime, reviewer,
protocol, account, or model API is used.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from app.services.context_builder.assembly import (
    context_manifest_reference,
    validate_context_assembly_manifest,
)
from app.services.agent_harness.tool_execution_record import (
    tool_event_is_completed,
    tool_event_is_failure,
    tool_event_is_omission_marker,
)
from app.services.agent_harness.run_output_record import (
    RunOutputKind,
    RunOutputStatus,
    normalize_run_output_records,
)
from app.services.agent_harness.knowledge_evidence import (
    knowledge_evidence_reference,
    validate_knowledge_evidence_manifest,
)
from app.services.agent_harness.project_memory_evidence import (
    project_memory_evidence_reference,
    validate_project_memory_evidence_manifest,
)
from app.services.agent_harness.conversation_capsule import (
    conversation_capsule_reference,
    validate_conversation_capsule,
)
from app.services.agent_harness.instruction_manifest import (
    instruction_manifest_reference,
    validate_instruction_manifest,
)


RUN_EVALUATION_SCHEMA_VERSION = 1
MAX_EVALUATION_FINDINGS = 8
MAX_EVIDENCE_TOOL_NAMES = 5

class CompletionVerdict(str, Enum):
    COMPLETED = "completed"
    WAITING_CONFIRMATION = "waiting_confirmation"
    FAILED = "failed"


class FindingSeverity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass(frozen=True)
class EvaluationFinding:
    code: str
    severity: FindingSeverity
    message: str
    evidence: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity.value,
            "message": self.message[:300],
            "evidence": dict(self.evidence),
        }


@dataclass(frozen=True)
class RunCompletionEvaluation:
    verdict: CompletionVerdict
    score: int
    summary: str
    checks: dict[str, str]
    evidence: dict[str, Any]
    findings: tuple[EvaluationFinding, ...]

    @property
    def failed(self) -> bool:
        return self.verdict is CompletionVerdict.FAILED

    @property
    def primary_finding_code(self) -> str:
        for finding in self.findings:
            if finding.severity is FindingSeverity.ERROR:
                return finding.code
        return ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": RUN_EVALUATION_SCHEMA_VERSION,
            "verdict": self.verdict.value,
            "score": self.score,
            "summary": self.summary,
            "primary_finding_code": self.primary_finding_code or None,
            "checks": dict(self.checks),
            "evidence": dict(self.evidence),
            "findings": [finding.to_dict() for finding in self.findings],
        }


def _event_status(event: dict[str, Any]) -> str:
    return str(event.get("status") or "").strip().lower()


def _event_tool_name(event: dict[str, Any]) -> str:
    return str(event.get("tool_name") or "unknown").strip()[:120] or "unknown"


def _event_tool_use_id(event: dict[str, Any]) -> str:
    return str(event.get("tool_use_id") or "").strip()[:200]


def _trace_types(state: Any) -> set[str]:
    return {
        str(event.get("type") or "")
        for event in list(getattr(state, "trace_events", None) or [])
        if isinstance(event, dict)
    }


def _unresolved_tool_failures(
    tool_events: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split failures into unresolved and explicitly linked recoveries.

    A later successful call with the same tool name is not enough evidence: it
    may target a different file or record. Recovery therefore requires the
    success event to identify the failed call through ``retry_of_tool_use_id``
    or ``recovery_of_tool_use_id``.
    """

    unresolved: list[dict[str, Any]] = []
    recovered: list[dict[str, Any]] = []
    for index, event in enumerate(tool_events):
        if not tool_event_is_failure(event):
            continue
        tool_name = _event_tool_name(event)
        tool_use_id = _event_tool_use_id(event)
        later_success = any(
            completed_index > index
            and tool_event_is_completed(completed_event)
            and _event_tool_name(completed_event) == tool_name
            and tool_use_id
            and tool_use_id
            in {
                str(completed_event.get("retry_of_tool_use_id") or "").strip(),
                str(completed_event.get("recovery_of_tool_use_id") or "").strip(),
            }
            for completed_index, completed_event in enumerate(tool_events)
        )
        (recovered if later_success else unresolved).append(event)
    return unresolved, recovered


def _tool_names(events: list[dict[str, Any]]) -> list[str]:
    return list(
        dict.fromkeys(_event_tool_name(event) for event in events)
    )[:MAX_EVIDENCE_TOOL_NAMES]


def _finding(
    code: str,
    severity: FindingSeverity,
    message: str,
    **evidence: Any,
) -> EvaluationFinding:
    return EvaluationFinding(
        code=code,
        severity=severity,
        message=message,
        evidence=evidence,
    )


def evaluate_run_completion(
    runtime: Any,
    state: Any,
    *,
    full_text: str,
    delivery_failed: bool = False,
    output_was_empty: bool = False,
) -> RunCompletionEvaluation:
    """Grade whether the persisted run has evidence for a completed verdict.

    This grader never inspects raw tool arguments or full tool outputs. It also
    never calls a model, so the verdict is stable across providers and retries.
    """

    context_manifest = getattr(runtime, "context_manifest", None)
    context_manifest_ref = context_manifest_reference(context_manifest)
    conversation_capsule = getattr(runtime, "conversation_capsule", None)
    conversation_capsule_ref = conversation_capsule_reference(conversation_capsule)
    instruction_manifest = getattr(runtime, "instruction_manifest", None)
    instruction_manifest_ref = instruction_manifest_reference(instruction_manifest)
    tool_events = [
        event
        for event in list(getattr(state, "tool_call_events", None) or [])
        if isinstance(event, dict) and not tool_event_is_omission_marker(event)
    ]
    steps = list(getattr(state, "steps", None) or [])
    trace_types = _trace_types(state)
    unresolved_failures, recovered_failures = _unresolved_tool_failures(tool_events)
    completed_tool_count = sum(
        tool_event_is_completed(event) for event in tool_events
    )
    run_outputs = normalize_run_output_records(
        list(getattr(state, "run_outputs", None) or [])
    )
    artifact_outputs = [
        output
        for output in run_outputs
        if output.get("kind") == RunOutputKind.ARTIFACT.value
    ]
    failed_artifact_outputs = [
        output
        for output in artifact_outputs
        if output.get("status") == RunOutputStatus.FAILED.value
    ]
    unpersisted_artifact_outputs = [
        output
        for output in artifact_outputs
        if output.get("status") == RunOutputStatus.PRODUCED.value
    ]
    delivered_artifacts = getattr(state, "delivered_artifacts", None)
    delivered_artifact_count = len(
        delivered_artifacts()
        if callable(delivered_artifacts)
        else list(getattr(state, "artifacts", None) or [])
    )
    artifact_count = max(
        sum(
            output.get("status") == RunOutputStatus.PERSISTED.value
            for output in artifact_outputs
        ),
        delivered_artifact_count,
    )
    confirmation_requested = bool(getattr(state, "confirmation_requested", False))
    knowledge_evidence = getattr(state, "knowledge_evidence", None)
    knowledge_evidence_ref = knowledge_evidence_reference(knowledge_evidence)
    project_memory_evidence = getattr(state, "project_memory_evidence", None)
    project_memory_evidence_ref = project_memory_evidence_reference(
        project_memory_evidence
    )
    # Dedicated checks below provide more actionable findings for these
    # synthetic harness events, so exclude them from the generic tool finding.
    generic_unresolved = [
        event
        for event in unresolved_failures
        if _event_tool_name(event) not in {"execution_truth_gate", "hitas"}
        and _event_status(event) != "blocked"
    ]

    findings: list[EvaluationFinding] = []
    checks: dict[str, str] = {}

    if context_manifest:
        manifest_valid, manifest_reason = validate_context_assembly_manifest(
            context_manifest
        )
        if manifest_valid:
            checks["context_assembly"] = (
                "passed_compacted"
                if context_manifest_ref["compacted"]
                else "passed"
            )
        else:
            checks["context_assembly"] = "failed"
            findings.append(
                _finding(
                    "CONTEXT_ASSEMBLY_INVALID",
                    FindingSeverity.ERROR,
                    "模型上下文清单未通过完整性或预算校验。",
                    validation_reason=manifest_reason,
                )
            )
    else:
        # Direct unit/recovery constructors predate the production manifest.
        # They remain usable, but production runtimes always populate it.
        checks["context_assembly"] = "not_available"

    if conversation_capsule:
        capsule_valid, capsule_reason = validate_conversation_capsule(
            conversation_capsule
        )
        if capsule_valid:
            checks["conversation_capsule"] = "passed"
        else:
            checks["conversation_capsule"] = "failed"
            findings.append(
                _finding(
                    "CONVERSATION_CAPSULE_INVALID",
                    FindingSeverity.ERROR,
                    "多轮对话状态胶囊未通过完整性校验。",
                    validation_reason=capsule_reason,
                )
            )
    else:
        checks["conversation_capsule"] = "not_available"

    if instruction_manifest:
        instruction_valid, instruction_reason = validate_instruction_manifest(
            instruction_manifest
        )
        if instruction_valid:
            checks["instruction_manifest"] = "passed"
        else:
            checks["instruction_manifest"] = "failed"
            findings.append(
                _finding(
                    "INSTRUCTION_MANIFEST_INVALID",
                    FindingSeverity.ERROR,
                    "指令优先级清单未通过完整性校验。",
                    validation_reason=instruction_reason,
                )
            )
    else:
        checks["instruction_manifest"] = "not_available"

    if knowledge_evidence:
        evidence_valid, evidence_reason = validate_knowledge_evidence_manifest(
            knowledge_evidence
        )
        evidence_status = str(knowledge_evidence_ref.get("status") or "")
        if not evidence_valid:
            checks["knowledge_evidence"] = "failed"
            findings.append(
                _finding(
                    "KNOWLEDGE_EVIDENCE_INVALID",
                    FindingSeverity.ERROR,
                    "知识证据清单未通过完整性校验。",
                    validation_reason=evidence_reason,
                )
            )
        elif not knowledge_evidence_ref["evidence_count"]:
            checks["knowledge_evidence"] = "not_used"
        elif evidence_status == "cited":
            checks["knowledge_evidence"] = "passed"
        elif evidence_status == "partial":
            checks["knowledge_evidence"] = "warning"
            findings.append(
                _finding(
                    "KNOWLEDGE_CITATION_PARTIAL",
                    FindingSeverity.WARNING,
                    "回答引用了有效知识证据，但同时包含未知引用标记。",
                    cited_count=knowledge_evidence_ref["cited_count"],
                    invalid_citation_count=knowledge_evidence_ref[
                        "invalid_citation_count"
                    ],
                )
            )
        elif evidence_status == "invalid":
            checks["knowledge_evidence"] = "warning"
            findings.append(
                _finding(
                    "KNOWLEDGE_CITATION_INVALID",
                    FindingSeverity.WARNING,
                    "回答包含无法回指到本轮检索证据的引用标记。",
                    invalid_citation_count=knowledge_evidence_ref[
                        "invalid_citation_count"
                    ],
                )
            )
        else:
            checks["knowledge_evidence"] = "warning"
            findings.append(
                _finding(
                    "KNOWLEDGE_EVIDENCE_UNCITED",
                    FindingSeverity.WARNING,
                    "本轮使用了知识检索上下文，但回答没有回指有效证据。",
                    evidence_count=knowledge_evidence_ref["evidence_count"],
                )
            )
    else:
        checks["knowledge_evidence"] = "not_used"

    if project_memory_evidence:
        memory_valid, memory_reason = validate_project_memory_evidence_manifest(
            project_memory_evidence
        )
        memory_status = str(project_memory_evidence_ref.get("status") or "")
        if not memory_valid:
            checks["project_memory_evidence"] = "failed"
            findings.append(
                _finding(
                    "PROJECT_MEMORY_EVIDENCE_INVALID",
                    FindingSeverity.ERROR,
                    "项目记忆证据清单未通过完整性校验。",
                    validation_reason=memory_reason,
                )
            )
        elif not project_memory_evidence_ref["evidence_count"]:
            checks["project_memory_evidence"] = "not_used"
        elif memory_status == "cited":
            checks["project_memory_evidence"] = "passed"
        elif memory_status == "partial":
            checks["project_memory_evidence"] = "warning"
            findings.append(
                _finding(
                    "PROJECT_MEMORY_CITATION_PARTIAL",
                    FindingSeverity.WARNING,
                    "回答包含有效项目记忆引用，但同时出现未知记忆引用标记。",
                    cited_count=project_memory_evidence_ref["cited_count"],
                    invalid_citation_count=project_memory_evidence_ref[
                        "invalid_citation_count"
                    ],
                )
            )
        elif memory_status == "invalid":
            checks["project_memory_evidence"] = "warning"
            findings.append(
                _finding(
                    "PROJECT_MEMORY_CITATION_INVALID",
                    FindingSeverity.WARNING,
                    "回答包含无法回指到本轮项目记忆的引用标记。",
                    invalid_citation_count=project_memory_evidence_ref[
                        "invalid_citation_count"
                    ],
                )
            )
        else:
            checks["project_memory_evidence"] = "warning"
            findings.append(
                _finding(
                    "PROJECT_MEMORY_EVIDENCE_UNCITED",
                    FindingSeverity.WARNING,
                    "本轮使用了结构化项目记忆，但回答没有回指有效记忆证据。",
                    evidence_count=project_memory_evidence_ref["evidence_count"],
                )
            )
    else:
        checks["project_memory_evidence"] = "not_used"

    if bool(getattr(state, "budget_exhausted", False)):
        checks["turn_budget"] = "failed"
        exhaustion = getattr(state, "budget_exhaustion", None) or {}
        findings.append(
            _finding(
                "TURN_BUDGET_EXCEEDED",
                FindingSeverity.ERROR,
                "单轮执行预算已耗尽。",
                kind=str(exhaustion.get("kind") or "unknown"),
            )
        )
    else:
        checks["turn_budget"] = "passed"

    if delivery_failed:
        checks["artifact_delivery"] = "failed"
        findings.append(
            _finding(
                "ARTIFACT_DELIVERY_MISSING",
                FindingSeverity.ERROR,
                "请求的交付物缺少可验证的持久化结果。",
                artifact_count=len(list(getattr(state, "artifacts", None) or [])),
            )
        )
    else:
        checks["artifact_delivery"] = "passed"

    if failed_artifact_outputs or unpersisted_artifact_outputs:
        checks["output_persistence"] = "failed"
        failure_codes = list(
            dict.fromkeys(
                str((output.get("failure") or {}).get("code") or "OUTPUT_NOT_PERSISTED")
                for output in [*failed_artifact_outputs, *unpersisted_artifact_outputs]
            )
        )[:5]
        findings.append(
            _finding(
                "OUTPUT_PERSISTENCE_FAILED",
                FindingSeverity.ERROR,
                "一个或多个产物没有形成可验证的持久化记录。",
                failure_count=len(failed_artifact_outputs),
                unpersisted_count=len(unpersisted_artifact_outputs),
                failure_codes=failure_codes,
            )
        )
    else:
        checks["output_persistence"] = "passed"

    if "execution_truth_gate_blocked_completion_claim" in trace_types:
        checks["execution_grounding"] = "failed"
        findings.append(
            _finding(
                "EXECUTION_CLAIM_UNGROUNDED",
                FindingSeverity.ERROR,
                "完成表述缺少成功工具或交付物证据。",
                gate="execution_truth_gate",
            )
        )
    else:
        checks["execution_grounding"] = "passed"

    if "tool_blocked" in trace_types:
        checks["policy"] = "failed"
        findings.append(
            _finding(
                "POLICY_REJECTED",
                FindingSeverity.ERROR,
                "计划中的工具调用被 Aria 权限策略拒绝。",
                blocked=True,
            )
        )
    else:
        checks["policy"] = "passed"

    if "pending_action_persist_failed" in trace_types:
        checks["approval_persistence"] = "failed"
        findings.append(
            _finding(
                "APPROVAL_PERSISTENCE_FAILED",
                FindingSeverity.ERROR,
                "待确认动作未能可靠保存。",
                pending_action_count=len(
                    list(getattr(state, "pending_tool_actions", None) or [])
                ),
            )
        )
    else:
        checks["approval_persistence"] = "passed"

    if generic_unresolved:
        checks["tool_execution"] = "failed"
        findings.append(
            _finding(
                "TOOL_EXECUTION_UNRESOLVED",
                FindingSeverity.ERROR,
                "一个或多个工具调用失败，且没有同工具的后续成功证据。",
                failure_count=len(generic_unresolved),
                tool_names=_tool_names(generic_unresolved),
            )
        )
    elif recovered_failures:
        checks["tool_execution"] = "warning"
        findings.append(
            _finding(
                "TOOL_FAILURE_RECOVERED",
                FindingSeverity.WARNING,
                "工具失败后由同工具的后续成功调用恢复。",
                recovered_count=len(recovered_failures),
                tool_names=_tool_names(recovered_failures),
            )
        )
    else:
        checks["tool_execution"] = "passed"

    failed_steps_without_tool_event = [
        step
        for step in steps
        if str(getattr(step, "status", "") or "") in {"failed", "running", "cancelled"}
        and not list(getattr(step, "tool_calls", None) or [])
    ]
    if failed_steps_without_tool_event:
        checks["step_terminal_state"] = "failed"
        findings.append(
            _finding(
                "STEP_INCOMPLETE",
                FindingSeverity.ERROR,
                "存在没有工具审计证据的未完成 Agent Step。",
                step_indexes=[
                    int(getattr(step, "index", 0) or 0)
                    for step in failed_steps_without_tool_event[:5]
                ],
            )
        )
    else:
        checks["step_terminal_state"] = "passed"

    truncated_steps = [
        int(getattr(step, "index", 0) or 0)
        for step in steps
        if bool(getattr(step, "truncated", False))
    ]
    if truncated_steps:
        checks["output_completeness"] = "failed"
        findings.append(
            _finding(
                "OUTPUT_TRUNCATED",
                FindingSeverity.ERROR,
                "模型输出在自动续写后仍被截断。",
                step_indexes=truncated_steps[:5],
            )
        )
    elif not full_text.strip() or (
        output_was_empty
        and completed_tool_count == 0
        and artifact_count == 0
        and not confirmation_requested
    ):
        checks["output_completeness"] = "failed"
        findings.append(
            _finding(
                "EMPTY_MODEL_OUTPUT",
                FindingSeverity.ERROR,
                "模型没有产生可用的正文输出。",
                output_chars=len(full_text),
            )
        )
    else:
        checks["output_completeness"] = "passed"

    checks["confirmation"] = "pending" if confirmation_requested else "not_required"

    findings = findings[:MAX_EVALUATION_FINDINGS]
    error_count = sum(
        finding.severity is FindingSeverity.ERROR for finding in findings
    )
    warning_count = sum(
        finding.severity is FindingSeverity.WARNING for finding in findings
    )
    score = max(0, 100 - error_count * 30 - warning_count * 8)
    if error_count:
        verdict = CompletionVerdict.FAILED
    elif confirmation_requested:
        verdict = CompletionVerdict.WAITING_CONFIRMATION
    else:
        verdict = CompletionVerdict.COMPLETED

    if verdict is CompletionVerdict.FAILED:
        primary_code = next(
            finding.code
            for finding in findings
            if finding.severity is FindingSeverity.ERROR
        )
        summary_by_code = {
            "TURN_BUDGET_EXCEEDED": "本轮达到执行预算上限，已保存现有结果。",
            "ARTIFACT_DELIVERY_MISSING": "请求的交付物未成功生成，本轮已按失败状态保存。",
            "EXECUTION_CLAIM_UNGROUNDED": "本轮缺少可验证的执行结果，已按失败状态保存。",
            "POLICY_REJECTED": "计划动作被权限策略拒绝，本轮未完成。",
            "APPROVAL_PERSISTENCE_FAILED": "待确认动作保存失败，本轮未完成。",
            "TOOL_EXECUTION_UNRESOLVED": "部分工具执行失败，本轮未达到可验证完成状态。",
            "STEP_INCOMPLETE": "Agent Step 未正常结束，本轮已按失败状态保存。",
            "OUTPUT_TRUNCATED": "模型输出仍不完整，本轮已按失败状态保存。",
            "EMPTY_MODEL_OUTPUT": "模型未生成可用正文，本轮已按失败状态保存。",
            "CONTEXT_ASSEMBLY_INVALID": "模型上下文清单校验失败，本轮未达到可验证完成状态。",
            "OUTPUT_PERSISTENCE_FAILED": "产物持久化证据未通过校验，本轮不会声称文件已经保存。",
            "KNOWLEDGE_EVIDENCE_INVALID": "知识证据清单校验失败，本轮未达到可验证完成状态。",
            "PROJECT_MEMORY_EVIDENCE_INVALID": "项目记忆证据清单校验失败，本轮未达到可验证完成状态。",
            "CONVERSATION_CAPSULE_INVALID": "多轮对话状态胶囊校验失败，本轮未达到可验证完成状态。",
            "INSTRUCTION_MANIFEST_INVALID": "指令优先级清单校验失败，本轮未达到可验证完成状态。",
        }
        summary = summary_by_code.get(
            primary_code,
            "完成证据检查未通过，本轮已按失败状态保存。",
        )
    elif verdict is CompletionVerdict.WAITING_CONFIRMATION:
        summary = "完成证据已记录，本轮正在等待用户确认。"
    elif warning_count:
        summary = "完成证据检查通过，但包含需要关注的非阻断警告。"
    else:
        summary = "完成证据检查通过。"

    evidence = {
        "output_chars": len(full_text),
        "step_count": len(steps),
        "tool_call_count": len(tool_events),
        "completed_tool_count": completed_tool_count,
        "unresolved_tool_failure_count": len(unresolved_failures),
        "recovered_tool_failure_count": len(recovered_failures),
        "artifact_count": artifact_count,
        "run_output_count": len(run_outputs),
        "failed_run_output_count": len(failed_artifact_outputs),
        "pending_confirmation_count": len(
            list(getattr(state, "pending_tool_confirmations", None) or [])
        ),
        "context_manifest": context_manifest_ref,
        "conversation_capsule": conversation_capsule_ref,
        "instruction_manifest": instruction_manifest_ref,
        "knowledge_evidence": knowledge_evidence_ref,
        "project_memory_evidence": project_memory_evidence_ref,
    }
    return RunCompletionEvaluation(
        verdict=verdict,
        score=score,
        summary=summary,
        checks=checks,
        evidence=evidence,
        findings=tuple(findings),
    )
