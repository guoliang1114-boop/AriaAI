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
}

export interface ProjectMemoryDocument {
  name: string
  reason: string
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
  memory_version: number
  last_updated_at: string
  stale: boolean
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
}

export interface ClientMemoryStatusResponse {
  client_id: number
  has_memory: boolean
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
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
  status: 'running' | 'completed' | 'error'
  message?: string
  summary?: string
  error?: string
}

export interface GeneratedArtifact {
  id?: number
  conversation_id?: number
  project_id?: number | null
  name: string
  file_type: string
  path: string
  size_bytes?: number
  description?: string
  created_at?: string
}

export interface MessageMetadata {
  references?: Reference[]
  tool_calls?: ToolCallEvent[]
  artifacts?: GeneratedArtifact[]
  project_id?: number
}

export interface SendMessageRequest {
  conversation_id?: number
  content: string
  project_id?: number
  skill_id?: number
  knowledge_scope?: 'project' | 'client' | 'global'
  rag_doc_ids?: number[]
  file_ids?: number[]
}

export interface StreamEvent {
  type: 'conversation_id' | 'chunk' | 'text' | 'references' | 'tool_executing' | 'tool_result' | 'done' | 'error'
  id?: number
  content?: string
  references?: Reference[]
  tool_name?: string
  message?: string
  total?: number
  current?: number
  result?: Record<string, unknown>
  error?: string
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
