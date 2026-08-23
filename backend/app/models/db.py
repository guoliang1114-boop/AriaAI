from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Index, Text, UniqueConstraint
from sqlmodel import SQLModel, Field, Relationship
import json

from app.services.time_utils import utc_now_naive


# ── Clients ────────────────────────────────────────────────────────────────

class ClientRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    industry: str = ""
    contact: str = ""          # primary contact person name
    notes: str = ""
    client_memory_json: str = "{}"
    client_memory_stale: bool = True
    client_memory_version: int = 0
    client_memory_updated_at: Optional[datetime] = None
    client_memory_rebuild_status: str = "idle"
    client_memory_rebuild_failed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now_naive)

    documents: list["KnowledgeDocument"] = Relationship(back_populates="client")


class ClientStakeholder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: int = Field(foreign_key="clientrecord.id", index=True)
    name: str
    role: str = ""
    organization_level: str = ""
    influence_type: str = ""
    relationship_status: str = "unknown"
    concerns: str = ""
    sensitivities: str = ""
    communication_preference: str = ""
    contact: str = ""
    last_action: str = ""
    personality_profile: str = ""
    decision_style: str = ""
    communication_strategy: str = ""
    trust_signals: str = ""
    note: str = ""
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class ClientStakeholderHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    stakeholder_id: int = Field(foreign_key="clientstakeholder.id", index=True)
    client_id: int = Field(foreign_key="clientrecord.id", index=True)
    field_name: str
    old_value: str = ""
    new_value: str = ""
    trigger: str = ""           # manual | ai_analyze | system
    changed_at: datetime = Field(default_factory=utc_now_naive)


# ── Projects ────────────────────────────────────────────────────────────────

class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    client: str
    description: str = ""
    status: str = "lead"            # lead | opportunity | won | delivering | archived
    context_freshness: float = 1.0  # 0–1
    contract_amount: float = 0.0    # total contract value
    context_summary: str = ""       # AI-generated project context summary
    context_memory_json: str = "{}" # structured long-term project memory
    memory_stale: bool = True
    memory_version: int = 0
    memory_updated_at: Optional[datetime] = None
    memory_rebuild_status: str = "idle"
    memory_rebuild_failed_at: Optional[datetime] = None
    notes: str = ""                 # Accumulated project notes (from "沉淀到项目" actions)
    md_notes: str = ""              # Project-level Markdown notes
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)

    milestones: list["Milestone"] = Relationship(back_populates="project")
    files: list["ProjectFile"] = Relationship(back_populates="project")
    conversations: list["Conversation"] = Relationship(back_populates="project")
    payments: list["ProjectPayment"] = Relationship(back_populates="project")
    todos: list["ProjectTodo"] = Relationship(back_populates="project")
    members: list["ProjectMember"] = Relationship(back_populates="project")
    progress_updates: list["ProjectProgressUpdate"] = Relationship(back_populates="project")


class ProjectMemorySummary(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    summary_type: str = Field(index=True)
    language: str = Field(index=True)
    memory_version: int = Field(index=True)
    content: str = ""
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class ProjectMemorySnapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    memory_version: int = Field(index=True)
    trigger: str = Field(default="", index=True)
    memory_json: str = ""
    created_at: datetime = Field(default_factory=utc_now_naive, index=True)


class ClientMemorySummary(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: int = Field(foreign_key="clientrecord.id", index=True)
    summary_type: str = Field(index=True)
    language: str = Field(index=True)
    memory_version: int = Field(index=True)
    content: str = ""
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class ClientMemorySnapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: int = Field(foreign_key="clientrecord.id", index=True)
    memory_version: int = Field(index=True)
    trigger: str = Field(default="", index=True)
    memory_json: str = ""
    created_at: datetime = Field(default_factory=utc_now_naive, index=True)


class Milestone(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str
    is_done: bool = False
    priority: str = "medium"        # high | medium | low
    due_date: Optional[str] = None

    project: Optional[Project] = Relationship(back_populates="milestones")


class ProjectTodo(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    content: str
    is_done: bool = False
    due_date: Optional[str] = None
    assigned_to_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)

    project: Optional[Project] = Relationship(back_populates="todos")
    assigned_user: Optional["User"] = Relationship(sa_relationship_kwargs={"foreign_keys": "[ProjectTodo.assigned_to_user_id]"})


class ProjectProgressUpdate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    content: str
    next_step: str = ""
    risk: str = ""
    created_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive, index=True)

    project: Optional[Project] = Relationship(back_populates="progress_updates")
    created_by: Optional["User"] = Relationship(sa_relationship_kwargs={"foreign_keys": "[ProjectProgressUpdate.created_by_user_id]"})


class ProjectMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    role: str = Field(default="editor", index=True)  # owner | editor | viewer
    created_at: datetime = Field(default_factory=utc_now_naive)

    project: Optional[Project] = Relationship(back_populates="members")
    user: Optional["User"] = Relationship(sa_relationship_kwargs={"foreign_keys": "[ProjectMember.user_id]"})


class WeeklyFocusItem(SQLModel, table=True):
    """Per-person weekly key focus item ("每周重点事项").

    One row = one focus item for one person in one ISO week. ``week_start`` is
    the Monday of that week (``YYYY-MM-DD``), computed in the app timezone, so
    the team board and "my items" views simply filter by it. Lightweight
    follow-up: a single ``status`` + an in-place one-line ``progress_note``
    (no per-week history — that was the deliberately simpler option chosen).

    ``owner_user_id`` is *whose* item it is; ``created_by_user_id`` records who
    added it (the owner themselves, or an admin assigning it). ``project_id`` is
    an optional link to a project — items can be standalone or attached.
    """

    # One focus item per (week, source todo) — makes "设为本周重点" idempotent at
    # the DB layer even under concurrent promotes. Rows with NULL source_todo_id
    # (normal, hand-added items) are unconstrained, since NULLs are distinct in a
    # unique index on both SQLite and Postgres.
    __table_args__ = (
        Index("uq_weeklyfocusitem_week_source", "week_start", "source_todo_id", unique=True),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    week_start: str = Field(index=True)            # Monday of the week, "YYYY-MM-DD"
    owner_user_id: int = Field(foreign_key="user.id", index=True)
    created_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    content: str
    status: str = Field(default="in_progress")     # in_progress | done | blocked
    progress_note: str = ""
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)
    # Back-link when this item was promoted from a project todo ("设为本周重点").
    # Used to keep promotion idempotent and to flag the source todo as promoted.
    # No standalone index: the composite unique index below covers lookups
    # (find-by-source and promoted-ids both filter week_start + source_todo_id).
    source_todo_id: Optional[int] = Field(default=None, foreign_key="projecttodo.id")
    sort_order: int = 0
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)

    owner: Optional["User"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[WeeklyFocusItem.owner_user_id]"}
    )
    created_by: Optional["User"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[WeeklyFocusItem.created_by_user_id]"}
    )


class ProjectFolder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    name: str
    sort_order: int = 0

    files: list["ProjectFile"] = Relationship(back_populates="folder")


class ProjectFile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    folder_id: Optional[int] = Field(default=None, foreign_key="projectfolder.id", index=True)
    source_file_id: Optional[int] = Field(default=None, foreign_key="projectfile.id", index=True)
    name: str
    file_type: str                  # pdf | docx | xlsx | pptx | other
    path: str                       # relative to UPLOADS_DIR
    size_bytes: int = 0
    summary: str = ""               # AI-generated file summary (auto-generated on upload)
    origin: str = "uploaded"        # uploaded | ai_generated | markdown_derivative | manual
    uploaded_at: datetime = Field(default_factory=utc_now_naive)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    deleted_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    delete_reason: str = ""
    delete_batch_id: str = ""

    project: Optional[Project] = Relationship(back_populates="files")
    folder: Optional[ProjectFolder] = Relationship(back_populates="files")


class ProjectFileVersion(SQLModel, table=True):
    """Version snapshot for project files, primarily Markdown documents."""

    __table_args__ = (
        UniqueConstraint("project_file_id", "version_number", name="uq_projectfileversion_file_version"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    project_file_id: int = Field(foreign_key="projectfile.id", index=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    version_number: int = Field(index=True)
    name: str
    file_type: str = ""
    path: str = ""
    size_bytes: int = 0
    content_hash: str = Field(default="", index=True)
    content_snapshot: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    change_source: str = ""
    message_id: Optional[int] = Field(default=None, foreign_key="message.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive, index=True)


class ProjectPayment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    amount: float                   # positive = received, negative = expense
    payment_date: str               # YYYY-MM-DD
    note: str = ""
    payment_type: str = "received"  # received | expense | milestone_payment
    created_at: datetime = Field(default_factory=utc_now_naive)

    project: Optional[Project] = Relationship(back_populates="payments")


# ── Conversations & Messages ─────────────────────────────────────────────────

class Conversation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = "New Workstream"
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)
    skill_id: Optional[int] = Field(default=None, foreign_key="skill.id")
    owner_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)

    project: Optional[Project] = Relationship(back_populates="conversations")
    messages: list["Message"] = Relationship(back_populates="conversation")


class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    role: str                       # user | assistant
    content: str
    metadata_json: str = "{}"       # references: skill_id, doc_ids, project_id, etc.
    created_at: datetime = Field(default_factory=utc_now_naive)

    conversation: Optional[Conversation] = Relationship(back_populates="messages")
    
    def get_metadata(self) -> dict:
        try:
            return json.loads(self.metadata_json)
        except json.JSONDecodeError:
            return {}
    
    def set_metadata(self, value: dict):
        self.metadata_json = json.dumps(value, ensure_ascii=False)


class ConversationState(SQLModel, table=True):
    """Persistent working memory for multi-turn collaboration."""

    __table_args__ = (
        UniqueConstraint("conversation_id", name="uq_conversationstate_conversation_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)
    current_artifact_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))
    current_task_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))
    user_constraints_json: str = Field(default="[]", sa_column=Column(Text, nullable=False, default="[]"))
    decisions_json: str = Field(default="[]", sa_column=Column(Text, nullable=False, default="[]"))
    active_file_ids_json: str = Field(default="[]", sa_column=Column(Text, nullable=False, default="[]"))
    last_intent_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))
    summary: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    last_user_request: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    last_assistant_summary: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive, index=True)


class ChatTrace(SQLModel, table=True):
    """Append-only machine-readable trace for one chat turn."""

    id: Optional[int] = Field(default=None, primary_key=True)
    trace_id: str = Field(index=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    message_id: Optional[int] = Field(default=None, foreign_key="message.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)

    chat_mode: str = Field(default="", index=True)
    action_policy: str = Field(default="", index=True)
    intent_method: str = ""
    intent_reason: str = ""
    model_used: str = ""

    prompt_layers_json: str = "[]"
    tool_decisions_json: str = "[]"
    artifacts_json: str = "[]"
    stage_timings_json: str = "{}"
    fallback_events_json: str = "[]"
    metadata_json: str = "{}"

    created_at: datetime = Field(default_factory=utc_now_naive, index=True)

    def get_payload(self) -> dict:
        def parse_json(value: str, fallback):
            try:
                return json.loads(value or "")
            except json.JSONDecodeError:
                return fallback

        return {
            "id": self.id,
            "trace_id": self.trace_id,
            "conversation_id": self.conversation_id,
            "message_id": self.message_id,
            "project_id": self.project_id,
            "chat_mode": self.chat_mode,
            "action_policy": self.action_policy,
            "intent_method": self.intent_method,
            "intent_reason": self.intent_reason,
            "model_used": self.model_used,
            "prompt_layers": parse_json(self.prompt_layers_json, []),
            "tool_decisions": parse_json(self.tool_decisions_json, []),
            "artifacts": parse_json(self.artifacts_json, []),
            "stage_timings": parse_json(self.stage_timings_json, {}),
            "fallback_events": parse_json(self.fallback_events_json, []),
            "metadata": parse_json(self.metadata_json, {}),
            "created_at": self.created_at,
        }


class PendingToolAction(SQLModel, table=True):
    """Human-in-the-loop pending tool execution record."""

    id: Optional[int] = Field(default=None, primary_key=True)
    trace_id: str = Field(default="", index=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    message_id: Optional[int] = Field(default=None, foreign_key="message.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)

    tool_name: str = ""
    tool_input_json: str = "{}"

    action_type: str = ""       # e.g. delete_files, modify_document
    risk_level: str = "medium"  # low | medium | high | destructive
    policy_at_creation: str = ""
    # Versioned HITAS approval-envelope fingerprint. Legacy rows may contain
    # the pre-v2 input-only SHA-256 during their short pending lifetime.
    tool_input_hash: str = ""
    approval_batch_id: str = Field(default="", index=True)
    sequence_index: int = 0
    title: str = ""             # UI title
    description: str = ""       # UI description
    details_json: str = "[]"    # JSON list of detail strings

    status: str = "pending"     # pending | confirmed | rejected | executing | completed | failed | skipped
    confirmed_by_user_id: Optional[int] = None
    confirmed_at: Optional[datetime] = None
    result_json: Optional[str] = None
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=utc_now_naive)
    expires_at: Optional[datetime] = None

    def get_payload(self) -> dict:
        def parse_json(value: str, fallback):
            try:
                return json.loads(value or "")
            except json.JSONDecodeError:
                return fallback

        return {
            "id": self.id,
            "trace_id": self.trace_id,
            "conversation_id": self.conversation_id,
            "message_id": self.message_id,
            "project_id": self.project_id,
            "tool_name": self.tool_name,
            "tool_input": parse_json(self.tool_input_json, {}),
            "action_type": self.action_type,
            "risk_level": self.risk_level,
            "policy_at_creation": self.policy_at_creation,
            "tool_input_hash": self.tool_input_hash,
            "approval_batch_id": self.approval_batch_id,
            "sequence_index": self.sequence_index,
            "title": self.title,
            "description": self.description,
            "details": parse_json(self.details_json, []),
            "status": self.status,
            "confirmed_by_user_id": self.confirmed_by_user_id,
            "confirmed_at": self.confirmed_at.isoformat() if self.confirmed_at else None,
            "result": parse_json(self.result_json, None),
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }


# ── Knowledge Base ────────────────────────────────────────────────────────────

class KnowledgeDocument(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    file_type: str
    path: str
    category: str = ""
    vector_status: str = "pending"  # pending | processing | synced | failed
    vector_progress: float = 0.0
    chunk_count: int = 0
    uploaded_at: datetime = Field(default_factory=utc_now_naive)
    client_id: Optional[int] = Field(default=None, foreign_key="clientrecord.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)

    client: Optional[ClientRecord] = Relationship(back_populates="documents")
    chunks: list["DocumentChunk"] = Relationship(back_populates="document")


class DocumentChunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="knowledgedocument.id", index=True)
    chunk_index: int
    content: str
    embedding_json: str = "[]"      # JSON-encoded float list

    document: Optional[KnowledgeDocument] = Relationship(back_populates="chunks")

    @property
    def embedding(self) -> list[float]:
        return json.loads(self.embedding_json)

    @embedding.setter
    def embedding(self, value: list[float]):
        self.embedding_json = json.dumps(value)


# ── External Service Integration ─────────────────────────────────────────────

class ExternalService(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    slug: str = Field(unique=True, index=True)          # e.g. 'ctools', 'notion'
    name: str                                           # Display name
    description: str = ""
    base_url: str                                       # API base URL
    auth_type: str = "bearer_token"                     # bearer_token | api_key | oauth2 | basic_auth | custom
    auth_config_json: str = "{}"                        # Extra auth config (header names, etc.)
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class ExternalServiceCredential(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    service_id: int = Field(foreign_key="externalservice.id", index=True)
    scope: str = "system"                               # system | user
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    credential_type: str = "token"                      # token | api_key | oauth2 | basic | custom
    encrypted_value: str                                # Fernet-encrypted JSON payload
    expires_at: Optional[datetime] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


# ── Skills ────────────────────────────────────────────────────────────────────

class Skill(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    category: str                   # quick_tool | deep_task | guided_workflow
    description: str = ""
    system_prompt: str = ""
    user_template: str = ""         # pre-filled chat input template shown to user
    estimated_time: str = ""
    max_tokens: int = 4096          # Claude API max_tokens for this skill
    # 新版：完整的 tools 定义（Claude 标准格式，JSON Schema）
    tools_definition_json: str = "[]"  # [{"name": "...", "description": "...", "input_schema": {...}}]
    # 旧版兼容：简单的工具名称列表
    tools_json: str = "[]"          # JSON list of tool names
    builtin_key: str = ""           # Stable source key for built-in Skill sync
    builtin_hash: str = ""          # Source hash; changed files update built-ins on startup

    @property
    def tools(self) -> list[str]:
        return json.loads(self.tools_json)

    @tools.setter
    def tools(self, value: list[str]):
        self.tools_json = json.dumps(value)

    @property
    def tools_definition(self) -> list[dict]:
        """返回 Claude 标准的 tools 定义列表"""
        return json.loads(self.tools_definition_json)

    @tools_definition.setter
    def tools_definition(self, value: list[dict]):
        self.tools_definition_json = json.dumps(value)


# ── Tool Calls ────────────────────────────────────────────────────────────────
# 存储 Claude Function Calling 的工具调用历史

class ToolCall(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    message_id: Optional[int] = Field(default=None, foreign_key="message.id")
    
    # 工具调用信息
    tool_name: str                  # 工具名称
    tool_input_json: str = "{}"     # 输入参数（JSON）
    tool_output_json: str = "{}"    # 输出结果（JSON）
    
    # 状态
    status: str = "pending"         # pending | running | success | failed
    error_message: str = ""         # 错误信息（如果失败）
    
    # 生成的文件（如果有）
    output_file_id: Optional[int] = Field(default=None, foreign_key="generatedfile.id")
    
    created_at: datetime = Field(default_factory=utc_now_naive)
    completed_at: Optional[datetime] = None


# ── Generated Files ───────────────────────────────────────────────────────────
# AI 生成的文件（PPT、Word、Excel、PDF 等）

class GeneratedFile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    
    name: str                       # 文件名
    file_type: str                  # pptx | docx | xlsx | pdf | md | txt | json
    path: str                       # 相对 UPLOADS_DIR 的路径
    size_bytes: int = 0
    
    # 元数据
    description: str = ""           # 文件描述
    mime_type: str = ""             # MIME 类型
    run_id: str = Field(default="", index=True)
    output_id: str = Field(default="", index=True)
    source_tool: str = ""
    content_sha256: str = Field(default="", index=True)
    output_record_version: int = 1
    
    created_at: datetime = Field(default_factory=utc_now_naive)


# ── Scheduled Tasks ───────────────────────────────────────────────────────────

class ScheduledTask(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    skill_id: Optional[int] = Field(default=None, foreign_key="skill.id")
    prompt: str = ""
    frequency: str                  # daily | weekly | monthly | cron expression
    cron_expr: str = ""
    is_enabled: bool = True
    status: str = "scheduled"       # scheduled | running | success | failed
    last_run: Optional[datetime] = None
    next_run: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now_naive)


# ── Durable Task Runs ─────────────────────────────────────────────────────────

class TaskRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)
    conversation_id: Optional[int] = Field(default=None, foreign_key="conversation.id", index=True)
    parent_task_id: Optional[int] = Field(default=None, foreign_key="taskrun.id", index=True)
    created_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    task_type: str = Field(index=True)
    goal: str = ""
    status: str = Field(default="pending", index=True)  # pending | running | completed | failed | canceled
    current_step_key: str = ""
    input_json: str = "{}"
    output_json: str = "{}"
    error_code: str = ""
    error_message: str = ""
    retry_count: int = 0
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class TaskStep(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_run_id: int = Field(foreign_key="taskrun.id", index=True)
    key: str = Field(index=True)
    title: str
    step_type: str = Field(index=True)
    status: str = Field(default="pending", index=True)  # pending | running | completed | failed | skipped
    sort_order: int = 0
    input_json: str = "{}"
    output_json: str = "{}"
    error_code: str = ""
    error_message: str = ""
    retryable: bool = True
    retry_count: int = 0
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class TaskEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_run_id: int = Field(foreign_key="taskrun.id", index=True)
    step_id: Optional[int] = Field(default=None, foreign_key="taskstep.id", index=True)
    event_type: str = Field(index=True)
    message: str = ""
    payload_json: str = "{}"
    created_at: datetime = Field(default_factory=utc_now_naive, index=True)


class TaskArtifact(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_run_id: int = Field(foreign_key="taskrun.id", index=True)
    step_id: Optional[int] = Field(default=None, foreign_key="taskstep.id", index=True)
    project_file_id: Optional[int] = Field(default=None, foreign_key="projectfile.id", index=True)
    name: str
    file_type: str
    path: str = ""
    metadata_json: str = "{}"
    created_at: datetime = Field(default_factory=utc_now_naive)


# ── Templates ─────────────────────────────────────────────────────────────────

class Template(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    category: str
    file_type: str                  # pptx | docx
    path: str
    tags_json: str = "[]"
    status: Optional[str] = None   # active | archived
    uploaded_at: datetime = Field(default_factory=utc_now_naive)

    @property
    def tags(self) -> list[str]:
        return json.loads(self.tags_json)

    @tags.setter
    def tags(self, value: list[str]):
        self.tags_json = json.dumps(value)


# ── Settings ──────────────────────────────────────────────────────────────────

class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str


# ── Users ──────────────────────────────────────────────────────────────────────

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    display_name: str = ""
    password_hash: str
    is_admin: bool = False
    is_active: bool = True
    auth_token: Optional[str] = None  # 保留用于兼容旧版
    created_at: datetime = Field(default_factory=utc_now_naive)


class UserToken(SQLModel, table=True):
    """支持多设备同时登录 - 每个设备一个 token"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    token: str = Field(index=True, unique=True)
    device_info: str = ""  # 设备信息（可选）
    created_at: datetime = Field(default_factory=utc_now_naive)
    last_used_at: datetime = Field(default_factory=utc_now_naive)

    user: Optional[User] = Relationship()


class UserMemory(SQLModel, table=True):
    """用户层记忆（V0.0.4 主干 B v1）。

    存放跨项目的个人偏好/工作风格/语言偏好等。**只装显式偏好**，不写入客户事实或
    项目业务结论（那些归 client/project memory）。一个用户一行，preferences_json
    存 JSON 对象。详见 ``docs/12-记忆系统优化方案.md`` 与
    ``docs/13-V0.0.4迭代计划.md`` §3 / §5。
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True, index=True)
    preferences_json: str = Field(default="{}")
    version: int = Field(default=1)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)

    user: Optional[User] = Relationship()


class MemoryCandidate(SQLModel, table=True):
    """Source-linked proposal that must be reviewed before durable memory use."""

    __table_args__ = (
        Index(
            "uq_memorycandidate_owner_source_digest",
            "owner_user_id",
            "scope",
            "candidate_type",
            "source_type",
            "source_id",
            "content_sha256",
            unique=True,
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    owner_user_id: int = Field(foreign_key="user.id", index=True)
    scope: str = Field(index=True)  # user | project | client
    candidate_type: str = Field(index=True)
    content: str = Field(sa_column=Column(Text, nullable=False))
    content_sha256: str = Field(index=True)
    source_type: str = Field(default="manual", index=True)
    source_id: str = Field(default="", index=True)
    source_run_id: str = Field(default="", index=True)
    source_refs_json: str = Field(default="[]", sa_column=Column(Text, nullable=False, default="[]"))
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)
    client_id: Optional[int] = Field(default=None, foreign_key="clientrecord.id", index=True)
    confidence: float = 1.0
    status: str = Field(default="pending", index=True)
    created_by: str = "user"  # user | ai | system
    target_slot: str = ""
    applied_memory_version: Optional[int] = None
    resolved_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    decision_note: str = ""
    created_at: datetime = Field(default_factory=utc_now_naive, index=True)
    resolved_at: Optional[datetime] = None

    owner: Optional[User] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[MemoryCandidate.owner_user_id]"}
    )
    resolved_by: Optional[User] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[MemoryCandidate.resolved_by_user_id]"}
    )


class SystemMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    content: str
    level: str = "info"  # info | success | warning | error
    link: str = ""
    is_published: bool = True
    created_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class SystemMessageRead(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    message_id: int = Field(foreign_key="systemmessage.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    read_at: datetime = Field(default_factory=utc_now_naive)
