"""Versioned, tamper-evident approval snapshots for Aria HITAS actions.

The separation between technical permission boundaries and approval policy, and
the binding of an approval to one canonical action payload, are Python
adaptations of OpenAI Codex:

* ``codex-rs/core/src/tools/sandboxing.rs``
* ``codex-rs/core/src/tools/approvals.rs``
* ``codex-rs/core/src/tools/runtimes/apply_patch.rs``
* ``codex-rs/execpolicy/src/decision.rs``

Upstream baseline: commit ``343074d4207d572809bd8cea15f4be1d09d98e0b``
(Apache License 2.0).

Modified for AriaAI on 2026-08-23: approvals bind an Aria business tool name,
frozen JSON input, project scope, action type, risk, creation policy, and batch
ordering into one domain-separated SHA-256 envelope. Confirmation revalidates
that envelope and the Aria ``allow / prompt / forbidden`` policy before an
action is claimed. Legacy input-only hashes remain verifiable during their
short pending lifetime. No Codex process, sandbox, SDK, or protocol is used.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import json
import re
from typing import Any

from app.services.agent_harness.tool_policy import (
    PolicyDecision,
    ToolPolicyEvaluation,
    evaluate_tool_policy,
)
from app.services.chat.mode_registry import ActionPolicy


APPROVAL_ENVELOPE_PREFIX = "aria-approval-v2:"
APPROVAL_ENVELOPE_SCHEMA_VERSION = 2
_LEGACY_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_RISK_RANK = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "destructive": 3,
}
_MINIMUM_RISK_BY_POLICY = {
    ActionPolicy.DIRECT_ANSWER: "low",
    ActionPolicy.READ_ONLY_TOOL: "low",
    ActionPolicy.WRITE_ARTIFACT: "medium",
    ActionPolicy.MODIFY_EXISTING_FILE: "high",
    ActionPolicy.DURABLE_TASK: "high",
    ActionPolicy.DESTRUCTIVE_ACTION: "destructive",
}


class ApprovalEnvelopeError(ValueError):
    """A pending action is not the exact action represented by its approval."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(f"{code}: {message}")


@dataclass(frozen=True)
class ApprovalEnvelopeVerification:
    fingerprint: str
    schema_version: int
    legacy: bool
    policy_evaluation: ToolPolicyEvaluation | None


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def legacy_tool_input_hash(tool_input: dict[str, Any]) -> str:
    """Reproduce Aria's pre-v2 input-only hash for pending-action compatibility."""

    normalized = json.dumps(
        tool_input or {},
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def approval_envelope_hash(
    *,
    tool_name: str,
    tool_input: dict[str, Any],
    project_id: int | None,
    action_type: str,
    risk_level: str,
    policy_at_creation: str,
    approval_batch_id: str,
    sequence_index: int,
) -> str:
    """Return a domain-separated hash for one exact approval action snapshot."""

    payload = {
        "schema_version": APPROVAL_ENVELOPE_SCHEMA_VERSION,
        "tool_name": str(tool_name or ""),
        "tool_input": tool_input or {},
        "project_id": project_id,
        "action_type": str(action_type or ""),
        "risk_level": str(risk_level or ""),
        "policy_at_creation": str(policy_at_creation or ""),
        "approval_batch_id": str(approval_batch_id or ""),
        "sequence_index": int(sequence_index or 0),
    }
    digest = hashlib.sha256(
        f"aria-hitas-approval\0{_canonical_json(payload)}".encode("utf-8")
    ).hexdigest()
    return f"{APPROVAL_ENVELOPE_PREFIX}{digest}"


def _validate_v2_policy(
    *,
    policy_at_creation: str,
    tool_name: str,
    tool_input: dict[str, Any],
    risk_level: str,
) -> ToolPolicyEvaluation:
    if not policy_at_creation:
        raise ApprovalEnvelopeError(
            "approval_policy_missing",
            "versioned approval is missing its creation policy",
        )
    try:
        evaluation = evaluate_tool_policy(policy_at_creation, tool_name, tool_input)
    except (TypeError, ValueError) as exc:
        raise ApprovalEnvelopeError(
            "approval_policy_invalid",
            "versioned approval has an invalid creation policy",
        ) from exc
    if evaluation.decision is not PolicyDecision.PROMPT:
        raise ApprovalEnvelopeError(
            "approval_policy_drift",
            (
                "stored action no longer resolves to the confirmation-required "
                f"policy path ({evaluation.decision.value})"
            ),
        )

    normalized_risk = str(risk_level or "").lower()
    minimum_risk = _MINIMUM_RISK_BY_POLICY[evaluation.required_policy]
    if normalized_risk not in _RISK_RANK:
        raise ApprovalEnvelopeError(
            "approval_risk_invalid",
            "versioned approval has an unknown risk level",
        )
    if _RISK_RANK[normalized_risk] < _RISK_RANK[minimum_risk]:
        raise ApprovalEnvelopeError(
            "approval_risk_downgrade",
            f"risk '{normalized_risk}' is lower than required '{minimum_risk}'",
        )
    return evaluation


def verify_approval_envelope(
    *,
    stored_fingerprint: str,
    tool_name: str,
    tool_input: dict[str, Any],
    project_id: int | None,
    action_type: str,
    risk_level: str,
    policy_at_creation: str,
    approval_batch_id: str,
    sequence_index: int,
) -> ApprovalEnvelopeVerification:
    """Fail closed when a versioned approval snapshot or policy no longer matches."""

    fingerprint = str(stored_fingerprint or "")
    if fingerprint.startswith(APPROVAL_ENVELOPE_PREFIX):
        expected = approval_envelope_hash(
            tool_name=tool_name,
            tool_input=tool_input,
            project_id=project_id,
            action_type=action_type,
            risk_level=risk_level,
            policy_at_creation=policy_at_creation,
            approval_batch_id=approval_batch_id,
            sequence_index=sequence_index,
        )
        if not hmac.compare_digest(fingerprint, expected):
            raise ApprovalEnvelopeError(
                "approval_snapshot_mismatch",
                "stored approval metadata or tool input changed after preview",
            )
        evaluation = _validate_v2_policy(
            policy_at_creation=policy_at_creation,
            tool_name=tool_name,
            tool_input=tool_input,
            risk_level=risk_level,
        )
        return ApprovalEnvelopeVerification(
            fingerprint=fingerprint,
            schema_version=APPROVAL_ENVELOPE_SCHEMA_VERSION,
            legacy=False,
            policy_evaluation=evaluation,
        )

    # Pending actions created before Phase 2E expire after 24 hours. Preserve
    # their existing behavior while still checking any input-only fingerprint
    # that was recorded. Empty fingerprints are explicitly marked unbound.
    if fingerprint:
        if not _LEGACY_SHA256.fullmatch(fingerprint):
            raise ApprovalEnvelopeError(
                "approval_fingerprint_unknown",
                "stored approval fingerprint uses an unsupported format",
            )
        expected_legacy = legacy_tool_input_hash(tool_input)
        if not hmac.compare_digest(fingerprint, expected_legacy):
            raise ApprovalEnvelopeError(
                "approval_legacy_input_mismatch",
                "legacy approval input changed after preview",
            )
    return ApprovalEnvelopeVerification(
        fingerprint=fingerprint,
        schema_version=1 if fingerprint else 0,
        legacy=True,
        policy_evaluation=None,
    )
