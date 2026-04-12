/**
 * Unified Enums for AriaAI
 * 
 * These enums are the single source of truth, aligned with backend.
 * Backend values: lead | opportunity | won | delivering | archived
 */

// =============================================================================
// Project Status (Backend Source of Truth)
// =============================================================================

/** 
 * Core project statuses stored in database.
 * UI may display sub-stages, but these are the values persisted to backend.
 */
export type ProjectStatus = 
  | 'lead'           // Business phase: initial contact/discovery
  | 'opportunity'    // Business phase: qualified, in discussion
  | 'won'            // Business phase: contracted
  | 'delivering'     // Delivery phase: active work
  | 'archived'       // Final state: completed or closed

/** Display labels for project status */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: '线索',
  opportunity: '机会',
  won: '已签约',
  delivering: '交付中',
  archived: '已归档',
}

/** Options for select dropdowns */
export const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'lead', label: '线索' },
  { value: 'opportunity', label: '机会' },
  { value: 'won', label: '已签约' },
  { value: 'delivering', label: '交付中' },
  { value: 'archived', label: '已归档' },
]

/** Status colors for UI consistency */
export const PROJECT_STATUS_COLORS: Record<ProjectStatus, { text: string; bg: string; border: string }> = {
  lead:           { text: 'text-blue-600',      bg: 'bg-blue-50',       border: 'border-blue-200' },
  opportunity:    { text: 'text-amber-600',     bg: 'bg-amber-50',      border: 'border-amber-200' },
  won:            { text: 'text-emerald-600',   bg: 'bg-emerald-50',    border: 'border-emerald-200' },
  delivering:     { text: 'text-purple-600',    bg: 'bg-purple-50',     border: 'border-purple-200' },
  archived:       { text: 'text-gray-500',      bg: 'bg-gray-50',       border: 'border-gray-200' },
}

/** 
 * UI sub-stages mapping to backend status.
 * This is a UI-only concept for more granular display.
 */
export const UI_SUB_STAGES: Record<string, ProjectStatus> = {
  // Business phase
  lead_discovery: 'lead',
  opportunity_qualified: 'opportunity',
  proposal: 'opportunity',
  negotiation: 'opportunity',
  contracting: 'won',
  // Delivery phase
  kickoff: 'delivering',
  execution: 'delivering',
  delivery: 'delivering',
  support: 'delivering',
  // Final
  archived: 'archived',
}

/** Convert UI sub-stage to backend status */
export function toBackendStatus(uiStage: string): ProjectStatus {
  return UI_SUB_STAGES[uiStage] || (uiStage as ProjectStatus)
}

/** Get display label for any stage (handles both backend status and UI sub-stages) */
export function getStageLabel(stage: string): string {
  const backendStatus = toBackendStatus(stage)
  const subStageLabels: Record<string, string> = {
    lead_discovery: '发现线索',
    opportunity_qualified: '确认机会',
    proposal: '方案阶段',
    negotiation: '商务谈判',
    contracting: '合同签署',
    kickoff: '项目启动',
    execution: '执行中',
    delivery: '交付验收',
    support: '运维支持',
    archived: '已归档',
  }
  return subStageLabels[stage] || PROJECT_STATUS_LABELS[backendStatus] || stage
}

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
