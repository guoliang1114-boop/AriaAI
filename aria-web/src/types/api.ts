// API Response Types

// Auth
export interface User {
  id: number
  email: string
  display_name: string
  is_admin: boolean
  is_active: boolean
}

export interface LoginResponse {
  token: string
  user: User
}

export interface LoginRequest {
  email: string
  password: string
}

// Project
export interface Project {
  id: number
  name: string
  client: string
  description: string
  status: 'lead' | 'opportunity' | 'won' | 'delivering' | 'archived'
  created_at: string
  updated_at: string
  context_summary?: string
  notes?: string
  md_notes?: string
  contract_amount?: number
  context_freshness?: number
  context_memory_json?: string
  memory_stale?: boolean
  memory_version?: number
  memory_updated_at?: string | null
  memory_rebuild_status?: string
  memory_rebuild_failed_at?: string | null
}

export interface ProjectMemoryDocument {
  name: string
  reason: string
}

export interface ProjectMemoryEditableSlot {
  ai: string[]
  pinned: string[]
}

export interface ProjectMemoryClientPromotion {
  client_id: number
  client_name: string
  promoted_at: string
  trigger: string
}

export interface ProjectMemory {
  project_brief: string
  current_stage: string
  current_objective: string
  recent_progress: string[]
  key_risks: string[]
  open_questions: string[]
  next_actions: string[]
  important_documents: ProjectMemoryDocument[]
  financial_status: string
  delivery_signals: string[]
  stakeholder_notes: string[]
  key_risks_detail?: ProjectMemoryEditableSlot
  open_questions_detail?: ProjectMemoryEditableSlot
  stakeholder_notes_detail?: ProjectMemoryEditableSlot
  memory_version: number
  last_updated_at: string
  stale: boolean
  rebuild_log?: Array<{ at: string; trigger: string; version: number }>
  _coverage?: Record<string, number | string>
  _client_promotion?: ProjectMemoryClientPromotion
}

export interface ProjectMemoryResponse {
  project_id: number
  memory: ProjectMemory
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
  memory_rebuild_status?: string
  memory_rebuild_failed_at?: string | null
}

export interface ProjectMemoryBatchRebuildItem {
  project_id: number
  memory: ProjectMemory
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
}

export interface ProjectMemoryBatchRebuildResponse {
  ok: boolean
  requested_count: number
  rebuilt_count: number
  rebuilt: ProjectMemoryBatchRebuildItem[]
  skipped: Array<{ project_id: number; reason: string }>
}

export interface ProjectMemoryBatchWarmSummariesResponse {
  ok: boolean
  requested_count: number
  processed_count: number
  warmed_count: number
  queued_count?: number
  processed: Array<{
    project_id: number
    summary_types: string[]
    memory_version: number
    mode?: 'queued' | 'inline'
  }>
  skipped: Array<{ project_id: number; reason: string }>
}

export interface ProjectMemoryJob {
  project_id: number
  project_name: string
  client: string
  job_type: 'rebuild' | 'summary_warm'
  language?: string | null
  job_id: string
  next_run_at?: string | null
  memory_stale: boolean
  memory_version: number
  retry_count?: number
  max_retries?: number
  status_note?: string
  status_source?: 'scheduler' | 'project_status' | string
  trigger?: string | null
  summary_types?: string[]
}

export interface ProjectMemoryJobsResponse {
  jobs: ProjectMemoryJob[]
  count: number
  budget?: {
    used: number
    limit: number
    remaining: number
  }
  recent_failures?: Array<{
    scope: 'project'
    project_id: number
    project_name: string
    client?: string
    category?: string
    stage: string
    message: string
    retry_count?: number
    failed_at: string
  }>
  recent_successes?: Array<{
    scope: 'project'
    project_id: number
    project_name: string
    client?: string
    stage: string
    status?: 'success' | string
    message: string
    trigger?: string
    version?: number
    completed_at: string
  }>
}

export type ProjectMemorySummaryType =
  | 'overview'
  | 'risk'
  | 'stakeholder'
  | 'delivery'
  | 'client-facing'
  | 'financial'
  | 'documents'

export interface ProjectMemoryStatusResponse {
  project_id: number
  has_memory: boolean
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
  memory_rebuild_status?: string
  memory_rebuild_failed_at?: string | null
}

export interface ProjectMemorySummaryResponse {
  project_id: number
  summary_type: ProjectMemorySummaryType | string
  content: string
  source_memory_version: number
  memory_stale: boolean
  generated_at: string
  cached?: boolean
}

export interface ProjectMemorySummariesResponse {
  project_id: number
  source_memory_version: number
  memory_stale: boolean
  cached?: boolean
  summaries: Partial<Record<ProjectMemorySummaryType, ProjectMemorySummaryResponse>>
}

export interface ProjectMemorySnapshot {
  id: number
  project_id: number
  memory_version: number
  trigger: string
  created_at: string
}

export interface MemorySnapshotDiffField {
  field: string
  label: string
  kind: 'value' | 'list' | 'object' | string
  before?: unknown
  after?: unknown
  added?: unknown[]
  removed?: unknown[]
}

export interface MemorySnapshotDiffResponse {
  scope: 'project' | 'client'
  entity_id: number
  from_snapshot: {
    id: number
    memory_version: number
    trigger: string
    created_at: string
  }
  to: {
    type: 'current' | string
    memory_version: number
    created_at?: string | null
  }
  summary: {
    changed: number
    added: number
    removed: number
    unchanged: number
  }
  fields: MemorySnapshotDiffField[]
}

export interface ClientMemory {
  client_profile: string
  decision_patterns: string[]
  key_contacts: Array<{ name: string; role: string; note: string }>
  lessons_learned: string[]
  project_history: Array<{ project_name: string; status: string; outcome: string; key_factor: string }>
  sensitive_topics: string[]
  memory_version: number
  last_updated_at: string
  stale: boolean
  rebuild_log?: Array<{ at: string; trigger: string; version: number }>
  source_project_ids?: number[]
}

export interface ClientMemoryResponse {
  client_id: number
  memory: ClientMemory
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
  memory_rebuild_status?: 'idle' | 'queued' | 'rebuilding' | 'failed' | string
  memory_rebuild_failed_at?: string | null
}

export interface ClientMemoryStatusResponse {
  client_id: number
  has_memory: boolean
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
  memory_rebuild_status?: 'idle' | 'queued' | 'rebuilding' | 'failed' | string
  memory_rebuild_failed_at?: string | null
}

export interface ClientMemorySnapshot {
  id: number
  client_id: number
  memory_version: number
  trigger: string
  created_at: string
}

export interface ClientStakeholder {
  id: number
  client_id: number
  name: string
  role: string
  organization_level: string
  influence_type: string
  relationship_status: string
  concerns: string
  sensitivities: string
  communication_preference: string
  contact: string
  last_action: string
  personality_profile: string
  decision_style: string
  communication_strategy: string
  trust_signals: string
  note: string
  created_at: string
  updated_at: string
}

export interface ClientMemoryBatchRebuildItem {
  client_id: number
  memory: ClientMemory
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
  memory_rebuild_status?: 'idle' | 'queued' | 'rebuilding' | 'failed' | string
  memory_rebuild_failed_at?: string | null
}

export interface ClientMemoryBatchRebuildResponse {
  ok: boolean
  requested_count: number
  rebuilt_count: number
  rebuilt: ClientMemoryBatchRebuildItem[]
  skipped: Array<{ client_id: number; reason: string }>
}

export interface ClientMemoryJob {
  client_id: number
  client_name: string
  industry: string
  job_type: 'rebuild' | 'summary_warm' | string
  job_id: string
  language?: string | null
  next_run_at?: string | null
  memory_stale: boolean
  memory_version: number
  retry_count?: number
  max_retries?: number
  trigger?: string | null
  summary_types?: string[]
}

export interface ClientMemoryJobsResponse {
  jobs: ClientMemoryJob[]
  count: number
  budget?: {
    used: number
    limit: number
    remaining: number
  }
  recent_failures?: Array<{
    scope: 'client'
    client_id: number
    client_name: string
    category?: string
    stage: string
    message: string
    retry_count?: number
    failed_at: string
  }>
  recent_successes?: Array<{
    scope: 'client'
    client_id: number
    client_name: string
    stage: string
    status?: 'success' | string
    message: string
    trigger?: string
    version?: number
    completed_at: string
  }>
}

export interface MemoryOperationsSummaryResponse {
  counts: {
    jobs: number
    rebuild_jobs: number
    summary_warm_jobs: number
    retrying_jobs: number
    recent_failures: number
    recent_successes: number
    manual_attention: number
  }
  failure_summary: {
    category_counts: Record<string, number>
    scope_counts: {
      project: number
      client: number
    }
    top_category: string
    top_category_count: number
    manual_attention_categories: string[]
  }
  budget: {
    project?: BudgetShape
    client?: BudgetShape
    project_low: boolean
    client_low: boolean
  }
  recent_failures: Array<Record<string, unknown>>
  recent_successes: Array<Record<string, unknown>>
}

export interface BudgetShape {
  used: number
  limit: number
  remaining: number
}

export interface ClientMemoryBatchWarmSummariesResponse {
  ok: boolean
  requested_count: number
  processed_count: number
  warmed_count: number
  queued_count?: number
  processed: Array<{
    client_id: number
    summary_types: string[]
    memory_version: number
    mode?: 'queued' | 'inline'
  }>
  skipped: Array<{ client_id: number; reason: string }>
}

export type ClientMemorySummaryType =
  | 'overview'
  | 'stakeholder'
  | 'lessons'
  | 'client-facing'
  | 'risk'
  | 'opportunity'
  | 'relationship'
  | 'delivery'

export interface ClientMemorySummaryResponse {
  client_id: number
  language: string
  summary_type: ClientMemorySummaryType | string
  content: string
  memory_version: number
  generated_at: string
  cached?: boolean
}

export interface SystemMessage {
  id: number
  title: string
  content: string
  level: 'info' | 'success' | 'warning' | 'error'
  link: string
  is_published: boolean
  created_at: string
  updated_at: string
  created_by_user_id?: number | null
  created_by_display_name?: string
  is_read: boolean
  read_at?: string | null
}

export interface SystemMessageListResponse {
  items: SystemMessage[]
  unread_count: number
}

export interface SystemMessageAdminItem {
  id: number
  title: string
  content: string
  level: 'info' | 'success' | 'warning' | 'error'
  link: string
  is_published: boolean
  created_at: string
  updated_at: string
  created_by_user_id?: number | null
  created_by_display_name?: string
  read_count: number
}

export interface Milestone {
  id: number
  project_id: number
  title: string
  is_done: boolean
  priority: 'low' | 'medium' | 'high'
  due_date?: string
  created_at: string
}

export interface ProjectFile {
  id: number
  project_id: number
  name: string
  file_type: string
  path: string
  size: number
  summary?: string
  uploaded_at: string
  folder_id?: number | null
  source_file_id?: number | null
  origin?: string
}

export interface ProjectFolder {
  id: number
  project_id: number
  name: string
  sort_order: number
}

export interface ProjectPayment {
  id: number
  project_id: number
  amount: number
  payment_date: string
  note: string
  payment_type: 'received' | 'expense' | 'milestone_payment' | 'invoiced'
  created_at: string
}

export interface ProjectTodo {
  id: number
  project_id: number
  content: string
  is_done: boolean
  due_date?: string | null
  assigned_to_user_id?: number | null
  assigned_user?: { id: number; display_name: string } | null
  created_at: string
  updated_at: string
}

export interface MyProjectTodo {
  id: number
  project_id: number
  project_name: string
  content: string
  due_date?: string | null
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  id: number
  project_id: number
  user_id: number
  user: { id: number; display_name: string }
  created_at: string
}

export interface ProjectFinancials {
  contract_amount: number
  total_received: number
  total_expense: number
  total_invoiced: number
  uncollected: number
  remaining: number
  payments: ProjectPayment[]
}

export interface ProjectDetail {
  project: Project
  files: ProjectFile[]
  milestones: Milestone[]
  folders: ProjectFolder[]
  md_notes: string
  todos: ProjectTodo[]
  members: ProjectMember[]
  financials: ProjectFinancials
}

export interface ProjectMeetingBriefing {
  project: {
    id: number
    name: string
    client: string
    status: string
    description: string
    contract_amount: number
    memory_version: number
    memory_stale: boolean
    memory_updated_at?: string | null
  }
  client: {
    id?: number | null
    name: string
    industry: string
    memory_version: number
    memory_stale: boolean
    memory_updated_at?: string | null
  }
  memory: {
    project_brief: string
    current_objective: string
    recent_progress: string[]
    key_risks: string[]
    open_questions: string[]
    next_actions: string[]
    delivery_signals: string[]
    stakeholder_notes: string[]
    financial_status: string
    important_documents: Array<{ name?: string; reason?: string }>
  }
  client_memory: {
    client_profile: string
    decision_patterns: string[]
    lessons_learned: string[]
    sensitive_topics: string[]
    project_history: Array<{ project_name?: string; status?: string; outcome?: string; key_factor?: string }>
  }
  stakeholders: Array<{
    name?: string
    role?: string
    organization_level?: string
    influence_type?: string
    relationship_status?: string
    concerns?: string
    sensitivities?: string
    communication_preference?: string
    contact?: string
    last_action?: string
    note?: string
  }>
  meeting_card: {
    say: string[]
    avoid: string[]
    confirm: string[]
    experience: string[]
  }
  signals: {
    upcoming_milestones: Array<{ id: number; title: string; due_date?: string | null; priority?: string }>
    pending_todos: Array<{ id: number; content: string; due_date?: string | null }>
    recent_documents: Array<{ id: number; name: string; summary?: string; uploaded_at?: string }>
    communication_sources: Array<{
      type: 'markdown_note' | 'project_note' | 'chat' | string
      label: string
      target?: 'notes' | 'chat' | string
      conversation_id?: number
      message_id?: number
      role?: string
      excerpt: string
      created_at?: string
    }>
  }
  generated_at: string
}

export interface ProjectMeetingBriefingRefineResponse {
  project_id: number
  meeting_type: string
  content: string
  source_memory_version: number
  generated_at: string
  cached?: boolean
}

// Skill
export interface Skill {
  id: number
  name: string
  category: string
  description: string
  system_prompt: string
  user_template: string
  estimated_time: string
  tools_definition_json: string
  max_tokens?: number
  created_at?: string
  updated_at?: string
}

export interface SkillSummary {
  id: number
  name: string
  category: string
  description: string
  estimated_time: string
  created_at?: string
  updated_at?: string
}

// Chat
export interface Conversation {
  id: number
  title: string
  project_id?: number
  skill_id?: number
  created_at: string
  updated_at: string
}

export interface Message {
  id: number
  conversation_id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata_json: string
  created_at: string
}

export interface Reference {
  type: 'skill' | 'doc' | 'file' | 'milestone'
  id: number
  title: string
}

export interface ToolCallEvent {
  tool_name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  message?: string
  summary?: string
  error?: string
  details?: string[]
  status_stage?: string
  step_index?: number
  step_total?: number
  step_title?: string
  has_recoverable_task?: boolean
}

export interface GeneratedArtifact {
  id?: number
  project_file_id?: number
  conversation_id?: number
  project_id?: number | null
  name: string
  file_type: string
  path: string
  size_bytes?: number
  description?: string
  created_at?: string
}

export interface TaskRunStep {
  id: number
  key: string
  title: string
  step_type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | string
  sort_order: number
  output?: Record<string, unknown>
  error_message?: string
}

export interface TaskRunArtifact {
  id?: number
  project_file_id?: number
  name: string
  file_type: string
  path: string
  metadata?: Record<string, unknown>
}

export interface TaskRunEvent {
  id?: number
  task_run_id?: number
  step_id?: number | null
  event_type: string
  message?: string
  payload?: Record<string, unknown>
  created_at?: string
}

export interface TaskRun {
  id: number
  project_id?: number
  conversation_id?: number | null
  task_type: string
  goal: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | 'paused' | string
  current_step_key?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error_code?: string
  error_message?: string
  retry_count?: number
  created_at?: string
  updated_at?: string
  started_at?: string | null
  completed_at?: string | null
  steps?: TaskRunStep[]
  artifacts?: TaskRunArtifact[]
  events?: TaskRunEvent[]
}

export interface MessageMetadata {
  references?: Reference[]
  tool_calls?: ToolCallEvent[]
  artifacts?: GeneratedArtifact[]
  task_run?: TaskRun
  task_run_id?: number
  task_type?: string
  pending_markdown_saves?: Array<{
    tool_use_id?: string
    project_id?: number
    file_id?: number | null
    file_name?: string | null
    mode?: 'replace' | 'append' | 'create' | string
    content?: string
    summary?: string | null
    folder_id?: number | null
    saved?: boolean
    saved_result?: Record<string, unknown>
    original_content?: string
  }>
  project_id?: number
  truncated?: boolean
}

export interface MentionContext {
  file_ids?: number[]
  stakeholder_ids?: number[]
  milestone_ids?: number[]
}

export interface SendMessageRequest {
  conversation_id?: number
  content: string
  project_id?: number
  skill_id?: number
  force_skill?: boolean
  knowledge_scope?: 'project' | 'client' | 'global'
  rag_doc_ids?: number[]
  file_ids?: number[]
  model?: string
  mention_context?: MentionContext
}

export interface ChatModel {
  id: string
  name: string
  provider: string
  available: boolean
}

export interface PlannedTool {
  name: string
  description: string
  input_summary: string
}

export interface ChatPlanResponse {
  plan_text: string
  planned_tools: PlannedTool[]
}

export interface StreamEvent {
  type: 'conversation_id' | 'chunk' | 'text' | 'status' | 'references' | 'tool_executing' | 'tool_result' | 'task_run' | 'truncated' | 'done' | 'error'
  id?: number
  content?: string
  stage?: string
  references?: Reference[]
  tool_name?: string
  message?: string
  step_index?: number
  step_total?: number
  step_title?: string
  step_status?: 'pending' | 'running' | 'completed' | 'error'
  total?: number
  current?: number
  result?: Record<string, unknown>
  task?: TaskRun
  artifacts?: GeneratedArtifact[]
  task_run_id?: number
  task_type?: string
  error?: string
  can_continue?: boolean
}

// Knowledge Base
export interface KnowledgeDocument {
  id: number
  name: string
  file_type: string
  path: string
  category: string
  project_id?: number | null
  client_id?: number | null
  size?: number
  vector_status: 'pending' | 'processing' | 'synced' | 'failed'
  uploaded_at: string
}

export interface KnowledgeStats {
  document_count: number
  total_vectors: number
}
