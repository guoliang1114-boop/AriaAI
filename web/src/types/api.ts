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
export type ProjectStatus =
  | 'lead'
  | 'lead_discovery'
  | 'opportunity'
  | 'opportunity_qualified'
  | 'proposal'
  | 'negotiation'
  | 'contracting'
  | 'won'
  | 'delivering'
  | 'kickoff'
  | 'execution'
  | 'delivery'
  | 'support'
  | 'archived'

export interface Project {
  id: number
  name: string
  client: string
  description: string
  status: ProjectStatus
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

export interface ProjectMemoryListResponse {
  items: Project[]
  total: number
  limit: number
  offset: number
  counts: {
    all: number
    ready: number
    stale: number
    missing: number
  }
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
  pages?: {
    jobs?: {
      items: Array<Record<string, unknown>>
      total: number
      limit: number
      offset: number
    }
    failures?: {
      items: Array<Record<string, unknown>>
      total: number
      limit: number
      offset: number
    }
    successes?: {
      items: Array<Record<string, unknown>>
      total: number
      limit: number
      offset: number
    }
  }
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
  deleted_at?: string | null
  deleted_by_user_id?: number | null
  delete_reason?: string
  delete_batch_id?: string
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
  /** True when this todo is already one of the current week's focus items. */
  weekly_focus_promoted?: boolean
}

export interface ProjectProgressUpdate {
  id: number
  project_id: number
  content: string
  next_step: string
  risk: string
  created_by_user_id?: number | null
  created_by?: { id: number; display_name: string } | null
  created_at: string
}

export interface MyProjectTodo extends ProjectTodo {
  project_name: string
  priority?: 'low' | 'medium' | 'high'
}

// Weekly focus items ("每周重点事项")
export type WeeklyFocusStatus = 'in_progress' | 'done' | 'blocked'

export interface WeeklyFocusItem {
  id: number
  week_start: string
  owner_user_id: number
  owner?: { id: number; display_name: string } | null
  created_by_user_id?: number | null
  created_by?: { id: number; display_name: string } | null
  content: string
  status: WeeklyFocusStatus
  progress_note: string
  project_id?: number | null
  project_name?: string | null
  source_todo_id?: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface WeeklyFocusPerson {
  user: { id: number; display_name: string; is_admin: boolean }
  items: WeeklyFocusItem[]
  total_count: number
  done_count: number
}

export interface WeeklyFocusBoard {
  week_start: string
  stats: { total_items: number; done: number; people: number }
  people: WeeklyFocusPerson[]
}

export interface WeeklyFocusMyResponse {
  week_start: string
  items: WeeklyFocusItem[]
}

export interface WeeklyFocusCarryOverResponse {
  from_week: string
  to_week: string
  created_count: number
  items: WeeklyFocusItem[]
}

export interface UserSimple {
  id: number
  display_name: string
}

export interface ProjectMember {
  id: number
  project_id: number
  user_id: number
  role?: "owner" | "editor" | "viewer" | string
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
  progress_updates: ProjectProgressUpdate[]
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
  schema_version?: 1
  event_ordinal?: number
  tool_use_id?: string
  tool_name: string
  status: 'planned' | 'pending' | 'running' | 'completed' | 'error' | 'blocked' | 'conflict' | 'skipped' | 'suppressed' | 'confirmation_required'
  outcome?: 'pending' | 'succeeded' | 'failed' | 'waiting_confirmation' | 'skipped'
  terminal?: boolean
  message?: string
  summary?: string
  error?: string
  error_code?: string
  error_type?: string
  confirmation_token?: string
  details?: string[]
  step_index?: number
  step_total?: number
  step_title?: string
  has_recoverable_task?: boolean
  duration_ms?: number
  attempt_count?: number
  max_attempts?: number
  http_status?: number
  retryable?: boolean
  required_policy?: string
  retry_of_tool_use_id?: string
  recovery_of_tool_use_id?: string
}

/**
 * One iteration of the backend agent loop. Emitted as ``{"type": "agent_step", ...}``
 * after the agent finishes executing the tools it planned in that turn. The
 * frontend uses this to render a faithful "Step N — used K tools" timeline
 * that replaces the brittle 4-stage hardcoded progress strip.
 */
export interface AgentStepView {
  index: number
  tool_names: string[]
  duration_ms: number
  truncated: boolean
}

export interface PendingChatActionResponse {
  can_confirm: boolean
  source_content: string
  call: ToolCallEvent
}

export interface PendingToolAction {
  id: number
  trace_id: string
  conversation_id: number
  message_id?: number
  project_id?: number
  tool_name: string
  tool_input: Record<string, unknown>
  action_type: string
  risk_level?: string
  policy_at_creation?: string
  tool_input_hash?: string
  approval_batch_id?: string
  sequence_index?: number
  title: string
  description: string
  details: string[]
  status: string
  result?: Record<string, unknown> | null
  error_message?: string | null
  created_at: string
  expires_at?: string
}

export interface PendingActionsResponse {
  items: PendingToolAction[]
  has_pending: boolean
}

export interface ConfirmActionResponse {
  status: string
  result?: Record<string, unknown> | null
  error_message?: string | null
  message_id?: number | null
  approval_batch_id?: string | null
  action_ids?: number[] | null
}

export interface PendingToolConfirmation {
  confirmation_token?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_use_id?: string
  details?: string[]
  summary?: string
  stage?: string
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

export interface ChatTracePromptLayer {
  name: string
  chars?: number
  present?: boolean
  message_count?: number
  tool_count?: number
  tool_names?: string[]
  source_count?: number
}

export interface ChatTrace {
  id?: number
  trace_id: string
  conversation_id: number
  message_id?: number | null
  project_id?: number | null
  chat_mode: string
  action_policy: string
  intent_method?: string
  intent_reason?: string
  model_used?: string
  prompt_layers?: ChatTracePromptLayer[]
  tool_decisions?: ToolCallEvent[]
  artifacts?: GeneratedArtifact[]
  stage_timings?: Record<string, number | string>
  fallback_events?: Array<{
    type?: string
    tool_name?: string
    reason?: string
    stage?: string
    changes?: string[]
    required_policy?: string
    current_policy?: string
  }>
  metadata?: Record<string, unknown>
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
  pending_tool_confirmations?: PendingToolConfirmation[]
  resolved_action_confirmations?: string[]
  tool_action_result?: Record<string, unknown>
  tool_action_batch_result?: Record<string, unknown>
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
  /** Product Run Event v1: serialized RunActivityTimeline for the persisted view. */
  activity_timeline?: unknown
  /** V0.0.4 A4: routing decision snapshot (intent_method / intent_reason / chat_mode). */
  route_decision?: {
    method?: string
    reason?: string
    chat_mode?: string
  }
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
  action_confirmations?: string[]
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

export interface PlannedStep {
  index: number
  title: string
  description: string
  tool_name?: string | null
}

export interface TurnContract {
  mode: 'answer_only' | 'plan_only' | 'execute_now' | 'plan_then_execute' | string
  user_goal: string
  needs_tools: boolean
  needs_artifact: boolean
  artifact_type?: string | null
  target_scope: string
  execution_scope: string
  expected_response: string
  requires_confirmation: boolean
  write_allowed: boolean
  confidence: number
  source: string
  reason: string
  missing_info: string[]
}

export interface ChatPlanResponse {
  plan_id: string
  plan_text: string
  planned_tools: PlannedTool[]
  planned_steps: PlannedStep[]
  turn_contract: Partial<TurnContract>
  execution_mode: string
  requires_confirmation: boolean
  expected_output: string
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
  step_status?: ToolCallEvent['status']
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
  // Matches the backend ``KnowledgeDocument.size_bytes`` column. The old
  // ``size`` alias was always undefined in JSON since the server never
  // emitted that field, which is why the Knowledge list rendered "—"
  // for every row.
  size_bytes?: number
  vector_status: 'pending' | 'processing' | 'synced' | 'failed'
  uploaded_at: string
}

export interface KnowledgeStats {
  document_count: number
  total_vectors: number
}
