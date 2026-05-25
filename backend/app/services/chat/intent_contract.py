"""Auditable contract for a single chat turn.

The intent router may use several signals internally, but the rest of the chat
pipeline should see one stable product-level action: answer, read, save, create,
modify, delete, or skill execution.  This contract is intentionally small so it
can be stored in traces, asserted in golden tests, and shown in diagnostics.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy
from app.services.chat.markdown_followup import is_save_previous_answer_as_markdown_request


@dataclass(frozen=True)
class ChatIntentContract:
    action: str
    chat_mode: str
    action_policy: str
    tool_access_policy: str
    write_allowed: bool = False
    requires_confirmation: bool = False
    delivery_required: bool = False
    output_kind: str = "chat"
    allowed_tools: tuple[str, ...] = ()
    deterministic: bool = False
    reason: str = ""
    source: str = ""
    checks: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "chat_mode": self.chat_mode,
            "action_policy": self.action_policy,
            "tool_access_policy": self.tool_access_policy,
            "write_allowed": self.write_allowed,
            "requires_confirmation": self.requires_confirmation,
            "delivery_required": self.delivery_required,
            "output_kind": self.output_kind,
            "allowed_tools": list(self.allowed_tools),
            "deterministic": self.deterministic,
            "reason": self.reason,
            "source": self.source,
            "checks": list(self.checks),
        }


def _value(item: Any) -> str:
    return str(getattr(item, "value", item) or "")


def build_chat_intent_contract(intent_decision, req, *, skill_applied: bool = False) -> ChatIntentContract:
    policy = intent_decision.action_policy
    mode = intent_decision.chat_mode
    access = intent_decision.tool_access_policy
    artifact_contract = getattr(intent_decision, "artifact_contract", None)

    if req.project_id and is_save_previous_answer_as_markdown_request(req.content):
        return ChatIntentContract(
            action="save_previous_answer",
            chat_mode=_value(mode),
            action_policy=_value(policy),
            tool_access_policy=_value(access),
            write_allowed=True,
            delivery_required=True,
            output_kind="md",
            allowed_tools=("save_previous_answer_as_markdown",),
            deterministic=True,
            reason="save_previous_answer_markdown_followup",
            source="deterministic_followup",
            checks=("latest_assistant_message_exists", "created_markdown_file_contains_previous_answer"),
        )

    if skill_applied or mode == ChatMode.SKILL_EXECUTION:
        return ChatIntentContract(
            action="run_skill",
            chat_mode=_value(mode),
            action_policy=_value(policy),
            tool_access_policy=_value(access),
            write_allowed=access == ToolAccessPolicy.WRITE_ALLOWED,
            delivery_required=bool(getattr(artifact_contract, "delivery_required", False)),
            output_kind=str(getattr(artifact_contract, "output_kind", "") or "chat"),
            allowed_tools=tuple(getattr(artifact_contract, "allowed_tools", ()) or ()),
            reason=getattr(intent_decision, "reason", "") or "skill_execution",
            source=getattr(intent_decision, "method", ""),
            checks=("tool_policy_enforced", "skill_progress_recorded"),
        )

    if policy == ActionPolicy.DESTRUCTIVE_ACTION:
        return ChatIntentContract(
            action="destructive_action",
            chat_mode=_value(mode),
            action_policy=_value(policy),
            tool_access_policy=_value(access),
            write_allowed=True,
            requires_confirmation=True,
            reason=getattr(intent_decision, "reason", "") or "destructive_action",
            source=getattr(intent_decision, "method", ""),
            checks=("confirmation_required", "pending_action_persisted", "post_action_state_verified"),
        )

    if policy == ActionPolicy.MODIFY_EXISTING_FILE:
        return ChatIntentContract(
            action="modify_project_space",
            chat_mode=_value(mode),
            action_policy=_value(policy),
            tool_access_policy=_value(access),
            write_allowed=True,
            requires_confirmation=True,
            reason=getattr(intent_decision, "reason", "") or "modify_existing_file",
            source=getattr(intent_decision, "method", ""),
            checks=("confirmation_required", "post_action_state_verified"),
        )

    if mode == ChatMode.TASK_ORCHESTRATION or policy == ActionPolicy.DURABLE_TASK:
        return ChatIntentContract(
            action="create_artifact",
            chat_mode=_value(mode),
            action_policy=_value(policy),
            tool_access_policy=_value(access),
            write_allowed=True,
            delivery_required=True,
            output_kind=str(getattr(artifact_contract, "output_kind", "") or getattr(intent_decision.task_route, "output_kind", "") or ""),
            allowed_tools=tuple(getattr(artifact_contract, "allowed_tools", ()) or ()),
            reason=getattr(intent_decision, "reason", "") or "task_orchestration",
            source=getattr(intent_decision, "method", ""),
            checks=("artifact_contract_satisfied", "file_exists", "file_size_positive"),
        )

    if policy == ActionPolicy.WRITE_ARTIFACT:
        return ChatIntentContract(
            action="create_artifact",
            chat_mode=_value(mode),
            action_policy=_value(policy),
            tool_access_policy=_value(access),
            write_allowed=True,
            delivery_required=bool(getattr(artifact_contract, "delivery_required", False)),
            output_kind=str(getattr(artifact_contract, "output_kind", "") or "artifact"),
            allowed_tools=tuple(getattr(artifact_contract, "allowed_tools", ()) or ()),
            reason=getattr(intent_decision, "reason", "") or "write_artifact",
            source=getattr(intent_decision, "method", ""),
            checks=("write_tool_allowed_by_policy", "file_exists"),
        )

    if access in {ToolAccessPolicy.READ_ON_DEMAND, ToolAccessPolicy.EXPLICIT_FILE_READ} or policy == ActionPolicy.READ_ONLY_TOOL:
        return ChatIntentContract(
            action="read_then_answer",
            chat_mode=_value(mode),
            action_policy=_value(policy),
            tool_access_policy=_value(access),
            reason=getattr(intent_decision, "reason", "") or "read_then_answer",
            source=getattr(intent_decision, "method", ""),
            checks=("write_tools_hidden", "answer_grounded_in_project_context"),
        )

    return ChatIntentContract(
        action="answer_only",
        chat_mode=_value(mode),
        action_policy=_value(policy),
        tool_access_policy=_value(access),
        reason=getattr(intent_decision, "reason", "") or "answer_only",
        source=getattr(intent_decision, "method", ""),
        checks=("write_tools_hidden",),
    )
