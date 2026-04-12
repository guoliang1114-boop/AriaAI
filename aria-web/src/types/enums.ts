/**
 * Unified Enums for AriaAI
 * 
 * These enums should be kept in sync with the backend.
 */

// Project Status - aligned with backend: lead | opportunity | won | delivering | archived
export type ProjectStatus = 
  | 'lead'           // 线索阶段
  | 'opportunity'    // 机会阶段
  | 'won'            // 已签约
  | 'delivering'     // 交付中
  | 'archived'       // 已归档

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: '线索',
  opportunity: '机会',
  won: '已签约',
  delivering: '交付中',
  archived: '已归档',
}

export const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'lead', label: '线索' },
  { value: 'opportunity', label: '机会' },
  { value: 'won', label: '已签约' },
  { value: 'delivering', label: '交付中' },
  { value: 'archived', label: '已归档' },
]

// LLM Provider
export type LLMProvider = 'claude' | 'kimi' | 'bigmodel'

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude (Anthropic)',
  kimi: 'Kimi (Moonshot)',
  bigmodel: 'BigModel (智谱AI)',
}

// Milestone Priority
export type MilestonePriority = 'low' | 'medium' | 'high'

export const PRIORITY_LABELS: Record<MilestonePriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

// Payment Type
export type PaymentType = 'received' | 'expense' | 'milestone_payment' | 'invoiced'

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  received: '收款',
  expense: '支出',
  milestone_payment: '里程碑付款',
  invoiced: '已开票',
}

// Vector Status
export type VectorStatus = 'pending' | 'indexed' | 'failed'

export const VECTOR_STATUS_LABELS: Record<VectorStatus, string> = {
  pending: '处理中',
  indexed: '已索引',
  failed: '失败',
}
