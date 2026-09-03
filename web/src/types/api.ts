// API Response Types

import type { ArtifactVerificationSummary } from './productRunEvent'

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
  /** Stable client identity. Absent only while talking to a pre-migration API. */
  client_id?: number | null
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

export interface MemoryRebuildLogEntry {
  at: string
  trigger: string
  version: number
  mode?: 'partial' | 'full' | 'full_fallback' | 'targeted_edit' | string
  rebuilt_slots?: string[]
  fallback_reason?: string
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
  rebuild_log?: MemoryRebuildLogEntry[]
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

export interface MemorySlotEvidenceRef {
  source_type: string
  source_id: string
  source_label: string
  captured_at: string
}

export interface MemorySlotState {
  slot_key: string
  slot_version: number
  aggregate_memory_version: number
  status: 'ready' | 'stale' | 'corrupt'
  value_sha256: string
  evidence_count: number
  evidence_refs: MemorySlotEvidenceRef[]
  stale_reason: string
  stale_at?: string | null
  updated_at?: string | null
}

export interface MemoryReadAuthorityReport {
  schema_version: 1
  read_mode: 'slot_ledger' | 'hybrid_aggregate_fallback'
  expected_slot_count: number
  ledger_row_count: number
  ledger_value_count: number
  ready_slot_count: number
  stale_slot_count: number
  stale_slots: string[]
  missing_slot_count: number
  missing_slots: string[]
  corrupt_slot_count: number
  corrupt_slots: string[]
  aggregate_fallback_slot_count: number
  aggregate_fallback_slots: string[]
  divergent_slot_count: number
  divergent_slots: string[]
  divergent_slot_details: Array<{
    slot_key: string
    ledger_value_type: 'null' | 'boolean' | 'string' | 'array' | 'object' | 'number' | 'other'
    aggregate_value_type: 'null' | 'boolean' | 'string' | 'array' | 'object' | 'number' | 'other'
    aggregate_version_relation: 'behind' | 'equal' | 'ahead'
  }>
  unexpected_slot_count: number
  aggregate_only_key_count: number
  aggregate_only_keys: string[]
  aggregate_only_unknown_key_count: number
  business_slot_cutover_ready: boolean
  dual_write_consistent: boolean
  aggregate_container_retirement_ready: boolean
}

export interface MemorySlotListResponse {
  scope: 'project' | 'client'
  entity_id: number
  memory_version: number
  slot_count: number
  stale_slot_count: number
  slots: MemorySlotState[]
  read_authority?: MemoryReadAuthorityReport
  last_rebuild_mode?: 'partial' | 'full' | 'full_fallback' | 'targeted_edit' | string | null
  last_rebuilt_slots?: string[]
  last_rebuild_fallback_reason?: string | null
}

export interface MemoryFactEvidenceRef extends MemorySlotEvidenceRef {
  relation: 'direct_source_id' | 'label_match' | 'slot_scope' | 'legacy_aggregate' | string
}

export interface MemoryFactState {
  fact_key: string
  slot_key: string
  source_kind: 'pinned' | 'ai' | 'item' | 'value' | string
  ordinal: number
  first_seen_memory_version: number
  last_seen_memory_version: number
  status: 'ready' | 'stale' | 'corrupt' | 'retired'
  provenance_status: 'direct' | 'matched' | 'scoped' | 'legacy' | 'unresolved'
  value_sha256: string
  value_preview: string
  evidence_count: number
  evidence_refs: MemoryFactEvidenceRef[]
  stale_reason: string
  stale_at?: string | null
  retired_at?: string | null
  updated_at?: string | null
}

export interface MemoryFactListResponse {
  scope: 'project' | 'client'
  entity_id: number
  memory_version: number
  fact_count: number
  stale_fact_count: number
  direct_fact_count: number
  matched_fact_count: number
  scoped_fact_count: number
  unresolved_fact_count: number
  facts: MemoryFactState[]
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
  rebuild_log?: MemoryRebuildLogEntry[]
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

export interface ProjectInteractionMetrics {
  project_id: number
  sample_limit: number
  schema_version: number
  assistant_turn_count: number
  feedback_count: number
  feedback_coverage: number | null
  helpful_count: number
  helpful_rate: number | null
  revision_feedback_count: number
  revision_success_rate: number | null
  turn_setup: {
    requested_count: number
    applied_count: number
    dismissed_count: number
    adoption_rate: number | null
  }
  negative_reasons: Record<string, number>
  skill_runs: {
    schema_version: number
    run_count: number
    versioned_run_count: number
    items: Array<{
      skill_id: number | null
      skill_name: string
      version: string | null
      release_status: string | null
      release_sha256: string | null
      run_count: number
      completed_count: number
      failed_count: number
      cancelled_count: number
      waiting_confirmation_count: number
      completion_rate: number | null
      feedback_count: number
      feedback_coverage: number | null
      helpful_count: number
      helpful_rate: number | null
      wrong_skill_count: number
      revision_feedback_count: number
      revision_success_rate: number | null
      average_duration_ms: number
      activation_sources: Record<'explicit' | 'auto' | 'conversation' | 'other', number>
    }>
    privacy: {
      reads_message_content: boolean
      stores_free_text_feedback: boolean
      stores_user_identity: boolean
    }
  }
  privacy: {
    stores_message_content: boolean
    stores_free_text_feedback: boolean
    stores_user_identity: boolean
  }
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
  package_version?: string
  package_status?: 'preview' | 'stable' | 'deprecated'
  package_sha256?: string
  active_release_id?: number | null
  created_at?: string
  updated_at?: string
}

export interface SkillDeliverableCatalogItem {
  schema_version: 1
  deliverable_id: string
  name: string
  when_to_use: string
  minimum_content: string
  format_label: string
  formats: string[]
  default_format: string
  stage:
    | 'diagnosis_and_analysis'
    | 'solution_design'
    | 'execution'
    | 'executive_communication'
    | 'evidence_and_archive'
    | string
  save_targets: string[]
  memory_policy: 'explicit_user_confirmation'
  requires_review: boolean
  business_verifiers: Array<{
    verifier_id: string
    expected_min: number
  }>
  contract_sha256: string
}

export interface SkillDeliverableCatalog {
  schema_version: 1
  skill_id: number
  skill_name: string
  skill_version: string
  skill_release_sha256: string
  items: SkillDeliverableCatalogItem[]
  catalog_sha256: string
  item_count: number
  source: 'immutable_skill_release_markdown'
  release_assignment?: {
    release_id?: number | null
    rollout_id?: number | null
    variant?: string
  }
}

export interface SkillDeliverableReference {
  schema_version: 1
  deliverable_id: string
  name: string
  formats: string[]
  default_format: string
  stage: string
  save_targets: string[]
  requires_review: boolean
  business_verifiers: Array<{
    verifier_id: string
    expected_min: number
  }>
  contract_sha256: string
  catalog_sha256: string
  skill_release_sha256: string
}

export interface SkillReleaseSummary {
  id: number
  skill_id?: number | null
  skill_name: string
  version: string
  status: 'preview' | 'stable' | 'deprecated'
  sha256: string
  source: 'create' | 'update' | 'sync' | 'migration' | 'rollback' | string
  rollback_of_release_id?: number | null
  is_active: boolean
  created_at: string
}

export interface SkillReleaseListResponse {
  items: SkillReleaseSummary[]
  active_release_id?: number | null
}

export interface SkillRolloutVariantHealth {
  run_count: number
  terminal_count: number
  completed_count: number
  failed_count: number
  cancelled_count: number
  completion_rate?: number | null
  failure_rate?: number | null
}

export interface SkillRolloutSummary {
  id: number
  skill_id?: number | null
  baseline_release?: SkillReleaseSummary | null
  candidate_release?: SkillReleaseSummary | null
  percentage: number
  status: 'active' | 'paused' | 'completed' | 'rolled_back'
  min_sample_size: number
  max_failure_rate: number
  auto_stop: boolean
  stop_reason?: string | null
  health: {
    baseline: SkillRolloutVariantHealth
    candidate: SkillRolloutVariantHealth
    privacy: {
      reads_message_content: boolean
      stores_prompt_content: boolean
      stores_user_identity: boolean
    }
  }
  created_at: string
  updated_at: string
  stopped_at?: string | null
}

export interface SkillRolloutListResponse {
  items: SkillRolloutSummary[]
}

export interface SkillSummary {
  id: number
  name: string
  category: string
  description: string
  estimated_time: string
  package_version?: string
  package_status?: 'preview' | 'stable' | 'deprecated'
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

export type ConversationContinuityStatus = 'ready' | 'unavailable' | 'invalid'

export interface ConversationContinuityBlocker {
  kind: 'tool_failure' | 'waiting_confirmation' | string
  tool_name: string
  summary: string
}

export interface ConversationContinuityState {
  capsule_message_id: number
  updated_at: string
  active_goal: string
  next_goal: string
  turn_mode: 'answer_only' | 'plan_only' | 'execute_now' | 'plan_then_execute'
  confirmed_constraints: string[]
  decisions: string[]
  blockers: ConversationContinuityBlocker[]
  active_artifact?: Record<string, string | number | boolean> | null
  active_task?: Record<string, string | number | boolean> | null
  source_message_ids: number[]
  capsule_sha256: string
}

export interface ProjectQuestionResolution {
  id: number
  question: string
  status: 'resolved' | 'needs_review'
  review_reason:
    | ''
    | 'question_reappeared'
    | 'project_memory_stale'
    | 'project_memory_changed'
    | 'answer_unavailable'
    | 'answer_changed'
    | 'answer_evidence_changed'
  resolution_summary: string
  answer_message_id?: number | null
  answer_conversation_id?: number | null
  answer_available: boolean
  resolution_revision: number
  resolved_memory_version: number
  resolved_slot_version: number
  resolved_at: string
  answer_adoption?: ProjectQuestionResolutionAdoption
}

export type ProjectQuestionPriority = 'low' | 'normal' | 'high' | 'critical'
export type ProjectQuestionWorkbenchStatus = 'open' | 'resolved' | 'needs_review'

export interface ProjectQuestionProfile {
  owner_user_id?: number | null
  priority: ProjectQuestionPriority
  due_date: string
  revision: number
  updated_at: string
}

export interface ProjectQuestionWorkbenchResolution {
  id: number
  resolution_revision: number
  resolution_summary: string
  answer_message_id?: number | null
  answer_conversation_id?: number | null
  answer_available: boolean
  resolved_memory_version: number
  resolved_slot_version: number
  resolved_at: string
  answer_adoption?: ProjectQuestionResolutionAdoption
}

export interface ProjectQuestionResolutionAdoption {
  status:
    | 'bound'
    | 'legacy_unbound'
    | 'answer_unavailable'
    | 'answer_changed'
    | 'evidence_changed'
  integrity_review_reason: string
  snapshot_sha256?: string
  answer_content_sha256?: string
  evidence_identity_fingerprint?: string
  readiness_score?: number
  readiness_band?: ProjectQuestionReadinessBand
  warnings?: string[]
  answer_content_bound: boolean
  evidence_basis_bound: boolean
  requires_human_confirmation: true
  is_correctness_verdict: false
}

export interface ProjectQuestionWorkbenchItem {
  question: string
  question_sha256: string
  status: ProjectQuestionWorkbenchStatus
  review_reason:
    | ''
    | 'question_reappeared'
    | 'project_memory_stale'
    | 'project_memory_changed'
    | 'answer_unavailable'
    | 'answer_changed'
    | 'answer_evidence_changed'
  profile: ProjectQuestionProfile
  resolution?: ProjectQuestionWorkbenchResolution | null
}

export interface ProjectQuestionWorkbenchMember {
  user_id: number
  display_name: string
  role: 'owner' | 'editor' | 'viewer' | string
}

export interface ProjectQuestionAnswerCandidate {
  message_id: number
  conversation_id: number
  conversation_title: string
  preview: string
  created_at: string
}

export type ProjectQuestionReadinessBand = 'strong' | 'review' | 'weak' | 'unrated'

export interface ProjectQuestionEvidenceSource {
  source_type: 'knowledge_document' | 'project_memory' | 'remediation_attachment'
  evidence_id: string
  citation_key: string
  title: string
  document_id?: number
  chunk_index?: number
  retrieval_score?: number
  memory_slot?: string
  memory_version?: number
  provenance_status?: string
  fact_evidence_count?: number
  attachment_id?: number
  execution_id?: number
  evidence_kind?: ProjectQuestionRemediationEvidenceKind
  support_level?: ProjectQuestionRemediationEvidenceSupportLevel
  review_status?: ProjectQuestionRemediationEvidenceReviewStatus
  review_revision?: number
  review_reason?: string
  reviewed_by_user_id?: number | null
  reviewed_at?: string
  acceptance_is_truth_verdict?: false
  note?: string
  reference_locator?: string
  project_file_id?: number | null
  knowledge_document_id?: number | null
  message_id?: number | null
  attached_at?: string
}

export interface ProjectQuestionAnswerAssessment {
  contract: 'deterministic_selection_readiness'
  readiness_score: number
  readiness_band: ProjectQuestionReadinessBand
  relevance: {
    score: number
    matched_question_terms: string[]
  }
  evidence: {
    status: 'cited' | 'uncited' | 'invalid' | 'not_available'
    score: number
    available_count: number
    cited_count: number
    knowledge_cited_count: number
    memory_cited_count: number
    remediation_cited_count: number
    remediation_aligned_count: number
    invalid_citation_count: number
    current_question_source_count: number
    question_aligned_count: number
    verified_aligned_count: number
    alignment_rate?: number | null
    support_rate?: number | null
    sources: ProjectQuestionEvidenceSource[]
  }
  run_evaluation: {
    status: 'available' | 'not_available' | 'invalid'
    verdict: string
    score?: number | null
  }
  feedback: {
    status: 'available' | 'not_available' | 'invalid'
    rating: '' | 'helpful' | 'unhelpful'
    reasons: string[]
  }
  warnings: string[]
  requires_human_confirmation: true
  is_correctness_verdict: false
}

export interface ProjectQuestionEvidenceCandidate extends ProjectQuestionAnswerCandidate {
  is_selected_resolution: boolean
  assessment: ProjectQuestionAnswerAssessment
}

export interface ProjectQuestionEvidenceReview {
  schema_version: 1
  project_id: number
  question: string
  question_sha256: string
  question_evidence: {
    status: 'available' | 'context_only' | 'not_available' | 'unavailable'
    source_count: number
    supporting_source_count: number
    memory: {
      status: 'available' | 'stale' | 'not_available' | 'unavailable'
      memory_version: number
      memory_stale: boolean
      retrieval_mode: string
      selected_slots: string[]
      source_count: number
      supporting_source_count: number
      sources: ProjectQuestionEvidenceSource[]
    }
    knowledge: {
      status: 'available' | 'not_available' | 'unavailable'
      source_count: number
      supporting_source_count: number
      sources: ProjectQuestionEvidenceSource[]
    }
    attachments: {
      status: 'available' | 'not_available'
      source_count: number
      supporting_source_count: number
      sources: ProjectQuestionEvidenceSource[]
    }
  }
  summary: {
    evaluated_candidate_count: number
    returned_candidate_count: number
    recommended_message_id?: number | null
    bands: Record<ProjectQuestionReadinessBand, number>
    truncated: boolean
    evidence_identity_fingerprint?: string
    attachment_evidence_identity_fingerprint?: string
  }
  candidates: ProjectQuestionEvidenceCandidate[]
  assessment_contract: {
    name: 'deterministic_selection_readiness'
    dimensions: string[]
    requires_human_confirmation: true
    is_correctness_verdict: false
  }
  privacy: {
    includes_bounded_answer_previews: boolean
    includes_full_answer_content: false
    includes_retrieved_chunk_content: false
    includes_bounded_attachment_notes: boolean
    includes_bounded_review_reasons: boolean
    includes_prompt_content: false
    includes_tool_inputs: false
    includes_tool_outputs: false
    includes_hidden_reasoning: false
  }
}

export interface ProjectQuestionAnswerAdoptionPreview {
  schema_version: 1
  project_id: number
  question: string
  question_sha256: string
  memory_version: number
  slot_version: number
  snapshot_sha256: string
  resolution_summary: string
  answer: ProjectQuestionAnswerCandidate & { content_sha256: string }
  evidence_identity_fingerprint: string
  attachment_evidence_identity_fingerprint: string
  assessment: ProjectQuestionAnswerAssessment
  contract: {
    name: 'project_question_answer_adoption'
    preview_resolves_question: false
    requires_explicit_confirmation: true
    reauthorizes_on_confirmation: true
    rechecks_current_question: true
    rechecks_answer_content: true
    rechecks_current_evidence_basis: true
    confirmation_resolves_question: true
    mutates_historical_messages: false
    writes_long_term_memory_before_confirmation: false
    sends_messages: false
    executes_tools: false
    is_correctness_verdict: false
  }
  privacy: {
    includes_bounded_answer_preview: true
    includes_full_answer_content: false
    includes_retrieved_chunk_content: false
    includes_bounded_source_metadata: true
    includes_prompt_content: false
    includes_tool_inputs: false
    includes_tool_outputs: false
    includes_hidden_reasoning: false
  }
}

export interface ProjectQuestionReanswerInput {
  question: string
  question_sha256: string
  contract_sha256: string
  attachment_ids: number[]
}

export interface ProjectQuestionReanswerPreparedSource {
  attachment_id: number
  citation_key: string
  evidence_kind: ProjectQuestionRemediationEvidenceKind
  title: string
  support_level: ProjectQuestionRemediationEvidenceSupportLevel
  review_status: ProjectQuestionRemediationEvidenceReviewStatus
  review_revision: number
  evidence_sha256: string
  external_reference_not_fetched: boolean
}

export interface ProjectQuestionReanswerPreparation {
  schema_version: 1
  project_id: number
  question: string
  question_sha256: string
  suggested_prompt: string
  input: ProjectQuestionReanswerInput
  sources: ProjectQuestionReanswerPreparedSource[]
  contract: {
    name: 'project_question_evidence_reanswer'
    answer_only: true
    requires_current_open_question: true
    requires_current_evidence_snapshot: true
    cites_only_emitted_keys: true
    mutates_historical_messages: false
    acceptance_is_truth_verdict: false
    writes_long_term_memory: false
    fetches_external_references: false
    sends_messages: false
    executes_tools: false
    automatically_resolves_question: false
  }
  privacy: {
    includes_bounded_source_titles: boolean
    includes_source_content: false
    includes_review_reasons: false
    includes_prompt_or_hidden_reasoning: false
  }
}

export interface ProjectQuestionReanswerEvidenceManifest {
  schema_version: 1
  manifest_id: string
  contract_sha256: string
  project_id: number
  question_sha256: string
  status: 'available' | 'cited' | 'uncited' | 'invalid' | 'partial' | 'not_available'
  entries: Array<{
    attachment_id: number
    evidence_id: string
    evidence_sha256: string
    citation_key: string
    evidence_kind: ProjectQuestionRemediationEvidenceKind
    title: string
    support_level: ProjectQuestionRemediationEvidenceSupportLevel
    review_status: ProjectQuestionRemediationEvidenceReviewStatus
    review_revision: number
    source_content_sha256: string
    external_reference_not_fetched: boolean
  }>
  cited_evidence_ids: string[]
  invalid_citation_keys: string[]
  acceptance_is_truth_verdict: false
}

export type ProjectQuestionRemediationStatus =
  | 'evidence_collection_required'
  | 'targeted_review_required'
  | 'verification_ready'

export type ProjectQuestionRemediationActionKind =
  | 'clarification_question'
  | 'evidence_request'
  | 'internal_check'
  | 'candidate_review'
  | 'human_verification'

export interface ProjectQuestionRemediationGap {
  code: string
  severity: 'blocking' | 'warning'
  title: string
  detail: string
}

export interface ProjectQuestionRemediationAction {
  action_id: string
  kind: ProjectQuestionRemediationActionKind
  title: string
  draft: string
  rationale: string
  suggested_owner_role: string
  suggested_channel: 'manual'
  blocking: boolean
  acceptance_criteria: string
  editable_fields: ['title', 'draft', 'owner_user_id']
  execution_mode: 'manual_only'
}

export interface ProjectQuestionRemediationPlan {
  schema_version: 1
  project_id: number
  question: string
  question_sha256: string
  status: ProjectQuestionRemediationStatus
  question_archetype: 'confirmation' | 'timing' | 'quantitative' | 'ownership' | 'general'
  evidence_target:
    | 'written_confirmation'
    | 'dated_record'
    | 'source_system_record'
    | 'ownership_record'
    | 'primary_source'
  basis: {
    question_sha256: string
    evidence_status: 'available' | 'context_only' | 'not_available' | 'unavailable'
    source_count: number
    supporting_source_count: number
    memory_version: number
    memory_stale: boolean
    evaluated_candidate_count: number
    strong_candidate_count: number
    recommended_message_id?: number | null
    gap_codes: string[]
    evidence_identity_fingerprint: string
    fingerprint: string
  }
  gaps: ProjectQuestionRemediationGap[]
  actions: ProjectQuestionRemediationAction[]
  plan_contract: {
    name: 'deterministic_evidence_gap_remediation'
    generation_method: 'rules_only'
    persists_changes: false
    sends_messages: false
    executes_tools: false
    requires_human_confirmation: true
  }
  privacy: {
    includes_question_text: true
    includes_answer_previews: false
    includes_source_titles: false
    includes_retrieved_chunk_content: false
    includes_prompt_content: false
    includes_tool_inputs: false
    includes_tool_outputs: false
    includes_hidden_reasoning: false
  }
}

export type ProjectQuestionRemediationPromotionTargetKind =
  | 'project_todo'
  | 'communication_request'

export type ProjectQuestionRemediationPromotionStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'failed'
  | 'expired'

export interface ProjectQuestionRemediationPromotionTarget {
  kind: ProjectQuestionRemediationPromotionTargetKind
  id: number
  content?: string
  is_done?: boolean
  subject?: string
  body?: string
  recipient_label?: string
  owner_user_id?: number | null
  due_date?: string | null
  status?: 'ready_for_manual_send' | 'sent_manually' | 'completed' | 'cancelled'
  delivery_mode?: 'manual_only'
  delivered?: false
  execution?: {
    id: number
    status: ProjectQuestionRemediationExecutionStatus
    revision: number
    evidence_count: number
    allowed_actions: ProjectQuestionRemediationExecutionAction[]
    delivered_by_aria: false
  } | null
}

export interface ProjectQuestionRemediationPromotion {
  schema_version: 1
  id: number
  project_id: number
  question: string
  question_sha256: string
  status: ProjectQuestionRemediationPromotionStatus
  revision: number
  snapshot_sha256: string
  evidence_basis_fingerprint: string
  preview: {
    project_id: number
    question_sha256: string
    target_kind: ProjectQuestionRemediationPromotionTargetKind
    action_kind: ProjectQuestionRemediationActionKind
    source_action_id: string
    title: string
    draft: string
    owner_user_id?: number | null
    due_date: string
    recipient_label: string
  }
  created_by_user_id?: number | null
  decided_by_user_id?: number | null
  failure_code: string
  decision_reason: string
  expires_at: string
  expired: boolean
  decided_at?: string | null
  created_at: string
  updated_at: string
  target?: ProjectQuestionRemediationPromotionTarget | null
  contract: {
    name: 'project_question_remediation_promotion'
    persists_frozen_preview: true
    requires_explicit_confirmation: true
    reauthorizes_on_confirmation: true
    rechecks_current_evidence_basis: true
    creates_target_before_confirmation: false
    sends_messages: false
    executes_tools: false
    outbound_delivery: false
    delivery_mode: 'manual_only' | 'not_applicable'
  }
}

export type ProjectQuestionRemediationExecutionStatus =
  | 'active'
  | 'ready_for_manual_send'
  | 'sent_manually'
  | 'completed'
  | 'cancelled'

export type ProjectQuestionRemediationExecutionAction =
  | 'attach_evidence'
  | 'mark_sent'
  | 'complete'
  | 'cancel'

export type ProjectQuestionRemediationEvidenceKind =
  | 'project_file'
  | 'knowledge_document'
  | 'message'
  | 'external_reference'
  | 'manual_note'

export type ProjectQuestionRemediationEvidenceSupportLevel =
  | 'direct'
  | 'review_required'

export type ProjectQuestionRemediationEvidenceReviewStatus =
  | 'not_required'
  | 'pending'
  | 'accepted'
  | 'rejected'

export type ProjectQuestionRemediationEvidenceReviewDecision =
  | 'accepted'
  | 'rejected'

export interface ProjectQuestionRemediationEvidenceReviewEvent {
  id: number
  revision: number
  previous_status: 'pending' | 'accepted' | 'rejected'
  status: ProjectQuestionRemediationEvidenceReviewDecision
  actor_user_id?: number | null
  reason: string
  created_at: string
}

export interface ProjectQuestionRemediationEvidenceReview {
  schema_version: 1
  status: ProjectQuestionRemediationEvidenceReviewStatus
  revision: number
  reason: string
  reviewed_by_user_id?: number | null
  reviewed_at?: string | null
  history: ProjectQuestionRemediationEvidenceReviewEvent[]
  history_truncated: boolean
  allowed_decisions: ProjectQuestionRemediationEvidenceReviewDecision[]
  human_judgment_only: true
  acceptance_is_truth_verdict: false
}

export interface ProjectQuestionRemediationEvidenceAttachment {
  id: number
  execution_id: number
  project_id: number
  question_sha256: string
  execution_revision: number
  evidence_sha256: string
  evidence_kind: ProjectQuestionRemediationEvidenceKind
  support_level: ProjectQuestionRemediationEvidenceSupportLevel
  title: string
  note: string
  reference_locator: string
  project_file_id?: number | null
  knowledge_document_id?: number | null
  message_id?: number | null
  attached_by_user_id?: number | null
  attached_at: string
  review: ProjectQuestionRemediationEvidenceReview
}

export interface ProjectQuestionRemediationExecutionEvent {
  id: number
  revision: number
  action: 'created' | 'marked_sent' | 'completed' | 'cancelled' | 'evidence_attached'
  status: ProjectQuestionRemediationExecutionStatus
  actor_user_id?: number | null
  evidence_attachment_id?: number | null
  note: string
  created_at: string
}

export interface ProjectQuestionRemediationExecution {
  schema_version: 1
  id: number
  project_id: number
  source_promotion_id: number
  question: string
  question_sha256: string
  target_kind: ProjectQuestionRemediationPromotionTargetKind
  status: ProjectQuestionRemediationExecutionStatus
  revision: number
  evidence_count: number
  last_transition_note: string
  created_by_user_id?: number | null
  last_transition_by_user_id?: number | null
  last_transition_at: string
  created_at: string
  updated_at: string
  target?: (ProjectQuestionRemediationPromotionTarget & {
    delivered_by_aria?: false
    manual_delivery_attested?: boolean
  }) | null
  evidence: ProjectQuestionRemediationEvidenceAttachment[]
  events: ProjectQuestionRemediationExecutionEvent[]
  truncated: { evidence: boolean; events: boolean }
  allowed_actions: ProjectQuestionRemediationExecutionAction[]
  question_resolution_status: 'open' | 'resolved'
  contract: ProjectQuestionRemediationExecutionContract
  evidence_review_contract: ProjectQuestionRemediationEvidenceReviewContract
}

export interface ProjectQuestionRemediationExecutionContract {
  name: 'project_question_remediation_execution'
  manual_send_is_user_attestation: true
  delivered_by_aria: false
  outbound_delivery: false
  sends_messages: false
  executes_tools: false
  completion_requires_evidence: true
  evidence_is_project_scoped: true
  evidence_events_are_append_only: true
  automatically_resolves_question: false
}

export interface ProjectQuestionRemediationEvidenceReviewContract {
  name: 'project_question_remediation_evidence_review'
  human_judgment_only: true
  acceptance_is_truth_verdict: false
  writes_long_term_memory: false
  fetches_external_references: false
  sends_messages: false
  executes_tools: false
  automatically_resolves_question: false
  reauthorizes_on_decision: true
  uses_optimistic_revision: true
  events_are_append_only: true
}

export interface ProjectQuestionRemediationExecutionList {
  schema_version: 1
  project_id: number
  items: ProjectQuestionRemediationExecution[]
  count: number
  counts: Record<ProjectQuestionRemediationExecutionStatus, number>
  contract: ProjectQuestionRemediationExecutionContract
}

export interface ProjectQuestionWorkbench {
  schema_version: 1
  project_id: number
  can_write: boolean
  memory: {
    status: 'ready' | 'stale' | 'missing'
    memory_version: number
    slot_version: number
    stale: boolean
  }
  counts: Record<ProjectQuestionWorkbenchStatus, number>
  questions: ProjectQuestionWorkbenchItem[]
  members: ProjectQuestionWorkbenchMember[]
  answer_candidates: ProjectQuestionAnswerCandidate[]
  truncated: {
    resolutions: boolean
    profiles: boolean
    answer_candidates: boolean
  }
  privacy: {
    includes_bounded_answer_previews: boolean
    includes_full_answer_content: boolean
    includes_prompt_content: boolean
    includes_tool_inputs: boolean
    includes_hidden_reasoning: boolean
  }
}

export interface ConversationContinuitySnapshot {
  schema_version: 2
  conversation_id: number
  project_id?: number | null
  status: ConversationContinuityStatus
  reason_code: string
  state?: ConversationContinuityState | null
  project_questions: {
    status: 'ready' | 'stale' | 'missing' | 'not_applicable'
    memory_version: number
    slot_version: number
    stale: boolean
    items: string[]
    resolved: ProjectQuestionResolution[]
  }
  privacy: {
    includes_bounded_conversation_state: boolean
    includes_bound_answer_message_content: boolean
    includes_prompt_content: boolean
    includes_tool_inputs: boolean
    includes_hidden_reasoning: boolean
  }
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
  type: 'skill' | 'doc' | 'file' | 'milestone' | 'memory' | 'question_evidence'
  id: number
  title: string
  schema_version?: 1
  evidence_id?: string
  citation_key?: string
  chunk_index?: number
  score?: number
  content_sha256?: string
  memory_version?: number
  memory_slot?: string
}

export interface KnowledgeEvidenceManifest {
  schema_version: 1
  manifest_id: string
  knowledge_scope: string
  project_id?: number | null
  status: 'available' | 'cited' | 'uncited' | 'invalid' | 'partial' | 'not_available'
  entries: Array<{
    evidence_id: string
    citation_key: string
    source_type: 'knowledge_document'
    document_id: number
    title: string
    chunk_index: number
    score: number
    content_sha256: string
  }>
  cited_evidence_ids: string[]
  invalid_citation_keys: string[]
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
  output_id?: string
  run_id?: string
  source_tool?: string
  content_sha256?: string
  output_record_version?: number
  deliverable_id?: string
  deliverable_name?: string
  deliverable_contract_sha256?: string
  deliverable_catalog_sha256?: string
  deliverable_skill_release_sha256?: string
  deliverable_business_verifiers_json?: string
  deliverable?: SkillDeliverableReference
  persistence_status?: "persisted" | "failed" | string
  recovery_verified?: boolean
  recovered_from_run_id?: string
  verification?: ArtifactVerificationSummary
}

export interface ArtifactProjectSaveResponse {
  schema_version: 1
  artifact_id: number
  project_id: number
  project_file_id: number
  target: 'project_documents'
  created: boolean
  content_sha256: string
  saved_by_user_id?: number | null
  saved_at: string
  delivery_status: ArtifactDeliveryStatus
  final_delivery_allowed: boolean
  writes_memory: false
  invalidates_derived_project_memory: boolean
  writes_knowledge_base: false
  sends_external_messages: false
}

export interface KnowledgeSourceSummary {
  id: number
  name: string
  source_type: string
  scope_type: string
  scope_id?: number | null
  owner_user_id?: number | null
  status: string
  can_write?: boolean
}

export interface ArtifactKnowledgeArchive {
  schema_version: 1
  archive_id: number
  artifact_id: number
  source_id?: number | null
  source_name: string
  source_scope_type: string
  source_scope_id?: number | null
  document_id?: number | null
  document_status: string
  job_id?: number | null
  job_status?: string | null
  content_sha256: string
  deliverable_contract_sha256: string
  requested_by_user_id?: number | null
  created_at: string
  writes_project_memory: false
  writes_client_memory: false
  sends_external_messages: false
  archive_created?: boolean
  document_created?: boolean
  indexing_enqueued?: boolean
}

export type ArtifactAcceptanceReviewStatus =
  | "blocked"
  | "not_required"
  | "pending"
  | "accepted"
  | "rejected"

export type ArtifactDeliveryStatus =
  | "blocked"
  | "review_required"
  | "changes_required"
  | "ready"

export interface ArtifactAcceptanceHistoryEvent {
  id: number
  revision: number
  previous_status: "pending" | "accepted" | "rejected"
  status: "accepted" | "rejected"
  actor_user_id?: number | null
  reason: string
  created_at: string
}

export interface ArtifactAcceptanceProjection {
  schema_version: 1
  artifact_id: number
  verification_id: number
  content_sha256: string
  evidence_sha256: string
  verification_plan_sha256: string
  verification_status: ArtifactVerificationSummary["status"]
  technical_status: ArtifactVerificationSummary["technical_status"]
  review_status: ArtifactAcceptanceReviewStatus
  delivery_status: ArtifactDeliveryStatus
  final_delivery_allowed: boolean
  revision: number
  reason: string
  reviewed_by_user_id?: number | null
  reviewed_at?: string | null
  history: ArtifactAcceptanceHistoryEvent[]
  history_limit: number
  allowed_decisions: Array<"accepted" | "rejected">
  human_judgment_only: true
  acceptance_is_truth_verdict: false
  deliverable?: Pick<
    SkillDeliverableReference,
    'deliverable_id' | 'name' | 'contract_sha256' | 'catalog_sha256' | 'skill_release_sha256'
  > | null
  business_automation: {
    registry_version: number
    status: "not_configured" | "passed" | "failed" | "partial"
    check_count: number
    passed_count: number
    failed_count: number
    skipped_count: number
    not_applicable_count?: number
    checks: Array<{
      position: number
      verifier_id?: string
      metric?: string
      expected_min?: number
      actual?: number
      status: "passed" | "failed" | "skipped"
      code?: string
    }>
    registered_verifier_count: number
    skill_package_code_executable: false
  }
}

export interface MemoryCandidate {
  schema_version: number
  id: number
  scope: "user" | "project" | "client"
  candidate_type: string
  content: string
  content_sha256: string
  source_type: string
  source_id: string
  source_run_id: string
  source_refs: Array<{ source_type: string; source_id: string; label?: string }>
  project_id?: number | null
  client_id?: number | null
  confidence: number
  status: "pending" | "accepted" | "rejected" | "archived"
  created_by: "user" | "ai" | "system" | string
  target_slot: string
  base_memory_version?: number | null
  memory_relation?: {
    status: 'additive' | 'duplicate' | 'stale_base' | string
    target_slot: string
    base_memory_version?: number | null
    current_memory_version: number
    base_changed: boolean
    duplicate: boolean
    requires_confirmation: boolean
    current_value_count: number
    current_values_preview: string[]
  } | null
  applied_memory_version?: number | null
  resolved_by_user_id?: number | null
  decision_note: string
  created_at?: string | null
  resolved_at?: string | null
}

export interface MemoryCandidateListResponse {
  items: MemoryCandidate[]
  count: number
}

export interface MemoryCandidateCreateResponse {
  candidate: MemoryCandidate
  created: boolean
  product_event?: Record<string, unknown> | null
}

export interface RunOutputRecord {
  schema_version: number
  output_id: string
  run_id: string
  kind: 'artifact' | 'memory_candidate'
  status: 'produced' | 'persisted' | 'pending_review' | 'accepted' | 'rejected' | 'failed'
  source?: Record<string, string>
  artifact?: {
    name: string
    file_type: string
    path_sha256: string
    generated_file_id?: number
    project_file_id?: number
    size_bytes?: number
    content_sha256?: string
  }
  memory_candidate?: {
    candidate_id: number
    scope: 'user' | 'project' | 'client'
    candidate_type: string
    content_sha256: string
    applied_memory_version?: number | null
  }
  failure?: { code: string; message: string }
}

export interface ChatTracePromptLayer {
  name: string
  kind?: string
  trust?: string
  chars?: number
  estimated_tokens?: number
  content_sha256?: string
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

export interface ChatTraceContextDiagnostic {
  manifest_valid: boolean
  manifest_reason: string
  compacted: boolean
  system_compacted: boolean
  history_compacted: boolean
  source_count: number
  included_source_count: number
  history_messages_before: number
  history_messages_after: number
  summarized_messages: number
  truncated_recent_messages: number
  estimated_total_before: number
  estimated_total_after: number
  context_window_tokens: number
  compaction_strategy: string
  summary_injected: boolean
  oldest_retained_message_index?: number | null
  prompt_manifest_present: boolean
  prompt_manifest_valid: boolean
  prompt_manifest_reason: string
  prompt_layer_count: number
  prompt_manifest_sha256: string
}

export interface ChatTraceExecutionDiagnostic {
  tool_decision_count: number
  tool_status_counts: Record<string, number>
  artifact_count: number
  fallback_count: number
  fallback_types: string[]
  timings: Record<string, number>
}

export interface ChatTraceDiagnostic {
  schema_version: 1
  id?: number | null
  trace_id: string
  conversation_id: number
  message_id?: number | null
  project_id?: number | null
  created_at?: string
  routing: {
    chat_mode: string
    action_policy: string
    intent_method: string
    intent_reason: string
    model_used: string
  }
  context: ChatTraceContextDiagnostic
  execution: ChatTraceExecutionDiagnostic
  privacy: {
    includes_prompt_content: false
    includes_message_content: false
    includes_tool_inputs: false
    includes_tool_outputs: false
    includes_hidden_reasoning: false
  }
}

export interface ChatTraceDiagnosticList {
  schema_version: 1
  conversation_id: number
  items: ChatTraceDiagnostic[]
  next_before_id?: number | null
  has_more: boolean
}

export interface ChatTraceDiagnosticComparison {
  schema_version: 1
  conversation_id: number
  base: ChatTraceDiagnostic
  target: ChatTraceDiagnostic
  changes: Array<{
    field: string
    before: string | number | boolean | null
    after: string | number | boolean | null
  }>
  warnings: string[]
  privacy: ChatTraceDiagnostic['privacy']
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
  knowledge_evidence?: KnowledgeEvidenceManifest
  tool_calls?: ToolCallEvent[]
  artifacts?: GeneratedArtifact[]
  run_outputs?: RunOutputRecord[]
  memory_candidates?: Array<{
    candidate_id: number
    scope: 'user' | 'project' | 'client'
    candidate_type: string
    status: 'pending' | 'accepted' | 'rejected' | 'archived'
    content_sha256: string
  }>
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
  interaction_feedback?: MessageFeedback
  turn_setup_trace?: TurnSetupTraceInput & { schema_version?: 1 }
  turn_recovery?: TurnRecoveryInput
  project_world_state?: Record<string, unknown>
  project_world_state_change?: Record<string, unknown>
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

export interface ProjectMentionables {
  files: Array<{ id: number; name: string; file_type: string }>
  stakeholders: Array<{ id: number; name: string; role: string }>
  milestones: Array<{ id: number; title: string; due_date: string | null; is_done: boolean }>
}

export interface TurnBriefInput {
  goal?: string
  constraints?: string[]
}

export type TurnRevisionField = 'content' | 'goal' | 'constraints' | 'skill' | 'references'

export interface TurnRevisionInput {
  source_message_id: number
  source_fingerprint: string
  source_role: 'user' | 'assistant'
  changed_fields: TurnRevisionField[]
}

export interface TurnSetupTraceInput {
  outcome: 'applied' | 'dismissed'
  template_id?: string
  skill_id?: number
}

export type TurnRecoveryStrategyV1 =
  | 'resume_from_checkpoint'
  | 'retry_failed_step'
  | 'continue_as_new_turn'

export type TurnRecoveryStrategyV2 =
  | 'replan_from_checkpoint'
  | 'retry_read_step'
  | 'manual_review'

export type TurnRecoveryStrategy = TurnRecoveryStrategyV1 | TurnRecoveryStrategyV2

export interface TurnRecoveryWorldStateChange {
  changed: boolean
  current_version?: string | null
  source_version?: string | null
  changed_categories?: string[]
}

interface TurnRecoveryInputBase {
  source_run_id: string
  source_message_id: number
  completed_steps: number[]
  side_effects_possible: boolean
}

export interface TurnRecoveryInputV1 extends TurnRecoveryInputBase {
  schema_version?: 1
  strategy: TurnRecoveryStrategyV1
}

export interface TurnRecoveryInputV2 extends TurnRecoveryInputBase {
  schema_version: 2
  strategy: TurnRecoveryStrategyV2
  completed_effect_count: number
  pending_effect_count: number
  world_state_change: TurnRecoveryWorldStateChange
  duplicate_policy: string
  warning_codes: string[]
  contract_sha256: string
}

export type TurnRecoveryInput = TurnRecoveryInputV1 | TurnRecoveryInputV2

export interface TurnRecoveryPreviewV1 extends TurnRecoveryInputV1 {
  schema_version: 1
  source_status: string
  can_continue: boolean
  completed_tool_call_count: number
  warning_codes: string[]
  suggested_content: string
}

export interface TurnRecoveryPreviewV2 extends TurnRecoveryInputV2 {
  schema_version: 2
  source_status: string
  can_continue: boolean
  suggested_content: string
}

export type TurnRecoveryPreview = TurnRecoveryPreviewV1 | TurnRecoveryPreviewV2

export type ProjectRecoveryState = 'ready' | 'continued' | 'projection_missing'

export interface ProjectRecoveryCenterItem {
  run_id: string
  conversation_id: number
  conversation_title: string
  source_message_id?: number | null
  assistant_message_id?: number | null
  source_status: 'cancelled' | 'failed' | 'interrupted' | string
  phase: string
  reason: {
    category: 'worker_lost' | 'timeout' | 'provider_failure' | 'user_cancelled' | 'worker_interrupted' | 'runtime_failure' | string
    code: string
  }
  retryable: boolean
  recovery_state: ProjectRecoveryState
  can_review: boolean
  projection_available: boolean
  child_run?: {
    run_id: string
    status: string
    assistant_message_id?: number | null
    updated_at?: string | null
  } | null
  unapplied_input_count: number
  unapplied_input_message_ids: number[]
  applied_input_count: number
  started_at: string
  completed_at?: string | null
  updated_at: string
}

export interface ProjectRecoveryCenter {
  schema_version: 1
  project_id: number
  generated_at: string
  summary: {
    returned_count: number
    ready_count: number
    continued_count: number
    projection_missing_count: number
    attention_count: number
    unapplied_input_count: number
    oldest_attention_at?: string | null
    truncated: boolean
  }
  items: ProjectRecoveryCenterItem[]
  privacy: {
    includes_message_content: boolean
    includes_prompt_content: boolean
    includes_worker_lease_token: boolean
  }
}

export type MessageFeedbackRating = 'helpful' | 'unhelpful'
export type MessageFeedbackReason =
  | 'inaccurate'
  | 'missing_context'
  | 'wrong_skill'
  | 'wrong_action'
  | 'unclear'
  | 'incomplete'

export interface MessageFeedback {
  schema_version: 1
  rating: MessageFeedbackRating
  reasons: MessageFeedbackReason[]
  updated_at: string
}

export interface TurnSetupSuggestion {
  template?: {
    id: string
    label: string
    reason: string
  } | null
  skill: {
    state: 'auto' | 'off' | 'selected' | 'recommended' | 'ambiguous'
    reason: string
    confidence: number
    skill_id?: number | null
    skill_name: string
    candidates: Array<{ id: number; name: string; score: number }>
  }
  catalog_fingerprint: string
}

export interface SendMessageRequest {
  conversation_id?: number
  content: string
  project_id?: number
  skill_id?: number
  force_skill?: boolean
  disable_skill?: boolean
  knowledge_scope?: 'project' | 'client' | 'global'
  rag_doc_ids?: number[]
  file_ids?: number[]
  model?: string
  mention_context?: MentionContext
  turn_brief?: TurnBriefInput
  turn_revision?: TurnRevisionInput
  turn_setup_trace?: TurnSetupTraceInput
  turn_recovery?: TurnRecoveryInput
  skill_deliverable?: SkillDeliverableSelectionInput
  action_confirmations?: string[]
}

export interface SkillDeliverableSelectionInput {
  deliverable_id: string
  catalog_sha256: string
  contract_sha256: string
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
  user_constraints: string[]
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
