from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class MentionContext(BaseModel):
    file_ids: List[int] = Field(default_factory=list)
    stakeholder_ids: List[int] = Field(default_factory=list)
    milestone_ids: List[int] = Field(default_factory=list)


class TurnBriefInput(BaseModel):
    goal: str = Field(default="", max_length=240)
    constraints: List[str] = Field(default_factory=list, max_length=8)


class TurnRevisionInput(BaseModel):
    source_message_id: int = Field(gt=0)
    source_fingerprint: str = Field(min_length=8, max_length=64, pattern=r"^turn-[a-f0-9]+$")
    source_role: Literal["user", "assistant"]
    changed_fields: List[
        Literal["content", "goal", "constraints", "skill", "references"]
    ] = Field(default_factory=list, max_length=5)


class TurnSetupTraceInput(BaseModel):
    outcome: Literal["applied", "dismissed"]
    template_id: Optional[str] = Field(default=None, max_length=40)
    skill_id: Optional[int] = Field(default=None, gt=0)


class TurnRecoveryInput(BaseModel):
    source_run_id: str = Field(min_length=5, max_length=80, pattern=r"^run_[A-Za-z0-9_-]+$")
    source_message_id: int = Field(gt=0)
    # Navigation hints only. Recovery strategy/effects are rebuilt from the
    # server rollout; these optional v1 fields remain parseable for old UIs.
    schema_version: Optional[Literal[1, 2]] = None
    contract_sha256: Optional[str] = Field(default=None, min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$")
    strategy: Optional[Literal[
        "resume_from_checkpoint",
        "retry_failed_step",
        "continue_as_new_turn",
        "replan_from_checkpoint",
        "retry_read_step",
        "manual_review",
    ]] = None
    completed_steps: List[int] = Field(default_factory=list, max_length=32)
    side_effects_possible: bool = False


class ProjectQuestionReanswerInput(BaseModel):
    """One exact, server-prepared evidence snapshot for a new answer-only Turn."""

    question: str = Field(min_length=1, max_length=360)
    question_sha256: str = Field(
        min_length=64,
        max_length=64,
        pattern=r"^[a-f0-9]{64}$",
    )
    contract_sha256: str = Field(
        min_length=64,
        max_length=64,
        pattern=r"^[a-f0-9]{64}$",
    )
    attachment_ids: List[int] = Field(
        min_length=1,
        max_length=8,
    )


class SendMessageRequest(BaseModel):
    conversation_id: Optional[int] = None
    content: str
    project_id: Optional[int] = None
    skill_id: Optional[int] = None
    force_skill: bool = False
    disable_skill: bool = False
    knowledge_scope: str = "project"
    rag_doc_ids: List[int] = []
    file_ids: List[int] = []
    model: Optional[str] = None
    language: Optional[str] = None
    mention_context: Optional[MentionContext] = None
    turn_brief: Optional[TurnBriefInput] = None
    turn_revision: Optional[TurnRevisionInput] = None
    turn_setup_trace: Optional[TurnSetupTraceInput] = None
    turn_recovery: Optional[TurnRecoveryInput] = None
    project_question_reanswer: Optional[ProjectQuestionReanswerInput] = None
    action_confirmations: List[str] = []


class SteerChatRunRequest(BaseModel):
    """Text-only addition bound to one exact active Aria run."""

    expected_run_id: str = Field(min_length=5, max_length=80)
    content: str = Field(min_length=1, max_length=8_000)


class ConversationOut(BaseModel):
    id: int
    title: str
    project_id: Optional[int]
    skill_id: Optional[int]
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    metadata_json: str = "{}"
    created_at: datetime

    @property
    def metadata(self) -> dict:
        try:
            import json

            return json.loads(self.metadata_json)
        except Exception:
            return {}


class PendingChatActionOut(BaseModel):
    can_confirm: bool = True
    source_content: str
    call: dict


class ResolveProjectQuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=360)
    answer_message_id: int = Field(gt=0)
    resolution_summary: str = Field(min_length=1, max_length=600)
    expected_memory_version: int = Field(ge=1)
    expected_slot_version: int = Field(ge=1)
    answer_adoption_snapshot_sha256: Optional[str] = Field(
        default=None,
        min_length=64,
        max_length=64,
        pattern=r"^[0-9a-f]{64}$",
    )


class ReopenProjectQuestionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=600)
    expected_resolution_revision: int = Field(ge=1)
    expected_memory_version: int = Field(ge=1)
    expected_slot_version: int = Field(ge=1)


class CreateConversationRequest(BaseModel):
    project_id: Optional[int] = None
    skill_id: Optional[int] = None
    title: Optional[str] = None


class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None


class TestConnectionRequest(BaseModel):
    provider: str
    model: Optional[str] = None


class TestModelRequest(BaseModel):
    message: str
    model: str
    temperature: float = 0.7
    max_tokens: int = 100


class ExportConversationRequest(BaseModel):
    format: str
