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
  created_at: string
  updated_at: string
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

export interface SendMessageRequest {
  conversation_id?: number
  content: string
  project_id?: number
  skill_id?: number
  rag_doc_ids?: number[]
  file_ids?: number[]
}

export interface StreamEvent {
  type: 'conversation_id' | 'chunk' | 'references' | 'done' | 'error'
  id?: number
  content?: string
  references?: Reference[]
  error?: string
}

export interface Reference {
  type: 'skill' | 'doc' | 'file' | 'milestone'
  id: number
  title: string
}

// Knowledge Base
export interface KnowledgeDocument {
  id: number
  name: string
  file_type: string
  path: string
  category: string
  size?: number
  vector_status: 'pending' | 'processing' | 'synced' | 'failed'
  uploaded_at: string
}

export interface KnowledgeStats {
  document_count: number
  total_vectors: number
}
