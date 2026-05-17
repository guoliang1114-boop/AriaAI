from datetime import datetime
from typing import Optional
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


class ProjectMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive)

    project: Optional[Project] = Relationship(back_populates="members")
    user: Optional["User"] = Relationship(sa_relationship_kwargs={"foreign_keys": "[ProjectMember.user_id]"})


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

    project: Optional[Project] = Relationship(back_populates="files")
    folder: Optional[ProjectFolder] = Relationship(back_populates="files")


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
