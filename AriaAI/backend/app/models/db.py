from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, Relationship
import json


# ── Clients ────────────────────────────────────────────────────────────────

class ClientRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    industry: str = ""
    contact: str = ""          # primary contact person name
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)

    documents: list["KnowledgeDocument"] = Relationship(back_populates="client")


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
    notes: str = ""                 # Accumulated project notes (from "沉淀到项目" actions)
    md_notes: str = ""              # Project-level Markdown notes
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    milestones: list["Milestone"] = Relationship(back_populates="project")
    files: list["ProjectFile"] = Relationship(back_populates="project")
    conversations: list["Conversation"] = Relationship(back_populates="project")
    payments: list["ProjectPayment"] = Relationship(back_populates="project")
    todos: list["ProjectTodo"] = Relationship(back_populates="project")
    members: list["ProjectMember"] = Relationship(back_populates="project")


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
    assigned_to_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    project: Optional[Project] = Relationship(back_populates="todos")
    assigned_user: Optional["User"] = Relationship(sa_relationship_kwargs={"foreign_keys": "[ProjectTodo.assigned_to_user_id]"})


class ProjectMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

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
    name: str
    file_type: str                  # pdf | docx | xlsx | pptx | other
    path: str                       # relative to UPLOADS_DIR
    size_bytes: int = 0
    summary: str = ""               # AI-generated file summary (auto-generated on upload)
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

    project: Optional[Project] = Relationship(back_populates="files")
    folder: Optional[ProjectFolder] = Relationship(back_populates="files")


class ProjectPayment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    amount: float                   # positive = received, negative = expense
    payment_date: str               # YYYY-MM-DD
    note: str = ""
    payment_type: str = "received"  # received | expense | milestone_payment
    created_at: datetime = Field(default_factory=datetime.utcnow)

    project: Optional[Project] = Relationship(back_populates="payments")


# ── Conversations & Messages ─────────────────────────────────────────────────

class Conversation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = "New Workstream"
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)
    skill_id: Optional[int] = Field(default=None, foreign_key="skill.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    project: Optional[Project] = Relationship(back_populates="conversations")
    messages: list["Message"] = Relationship(back_populates="conversation")


class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    role: str                       # user | assistant
    content: str
    metadata_json: str = "{}"       # references: skill_id, doc_ids, project_id, etc.
    created_at: datetime = Field(default_factory=datetime.utcnow)

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
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
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
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
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
    
    created_at: datetime = Field(default_factory=datetime.utcnow)


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
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── Templates ─────────────────────────────────────────────────────────────────

class Template(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    category: str
    file_type: str                  # pptx | docx
    path: str
    tags_json: str = "[]"
    status: Optional[str] = None   # active | archived
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

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
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserToken(SQLModel, table=True):
    """支持多设备同时登录 - 每个设备一个 token"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    token: str = Field(index=True, unique=True)
    device_info: str = ""  # 设备信息（可选）
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used_at: datetime = Field(default_factory=datetime.utcnow)
    
    user: Optional[User] = Relationship()
