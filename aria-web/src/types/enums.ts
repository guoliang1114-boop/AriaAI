import {
  Archive,
  Cog,
  FileText,
  Handshake,
  Headphones,
  Lightbulb,
  Package,
  PenTool,
  Rocket,
  Target,
  type LucideIcon,
} from 'lucide-react'

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

export type ProjectStage =
  | 'lead_discovery'
  | 'opportunity_qualified'
  | 'proposal'
  | 'negotiation'
  | 'contracting'
  | 'kickoff'
  | 'execution'
  | 'delivery'
  | 'support'
  | 'archived'

export type ProjectPhase = 'business' | 'delivery' | 'archived'

export interface ProjectStageConfig {
  id: ProjectStage
  label: string
  labelZh: string
  description: string
  color: string
  bgColor: string
  borderColor: string
  lightColor: string
  icon: LucideIcon
  phase: ProjectPhase
}

export const PROJECT_STAGE_CONFIGS: ProjectStageConfig[] = [
  {
    id: 'lead_discovery',
    label: 'Lead Discovery',
    labelZh: '线索发现',
    description: '初步接触，需求挖掘',
    color: 'text-slate-600',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
    lightColor: 'bg-slate-200',
    icon: Lightbulb,
    phase: 'business',
  },
  {
    id: 'opportunity_qualified',
    label: 'Opportunity Qualified',
    labelZh: '商机确认',
    description: '需求明确，预算确认',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    lightColor: 'bg-blue-200',
    icon: Target,
    phase: 'business',
  },
  {
    id: 'proposal',
    label: 'Proposal & Bidding',
    labelZh: '方案投标',
    description: '方案设计，投标应标',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    lightColor: 'bg-indigo-200',
    icon: FileText,
    phase: 'business',
  },
  {
    id: 'negotiation',
    label: 'Negotiation',
    labelZh: '商务谈判',
    description: '价格商议，条款确定',
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    lightColor: 'bg-violet-200',
    icon: Handshake,
    phase: 'business',
  },
  {
    id: 'contracting',
    label: 'Contracting',
    labelZh: '合同签订',
    description: '合同签署，正式立项',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    lightColor: 'bg-purple-200',
    icon: PenTool,
    phase: 'business',
  },
  {
    id: 'kickoff',
    label: 'Project Kickoff',
    labelZh: '项目启动',
    description: '团队组建，计划制定',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200',
    lightColor: 'bg-cyan-200',
    icon: Rocket,
    phase: 'delivery',
  },
  {
    id: 'execution',
    label: 'Execution',
    labelZh: '项目执行',
    description: '按计划推进，阶段性交付',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    lightColor: 'bg-emerald-200',
    icon: Cog,
    phase: 'delivery',
  },
  {
    id: 'delivery',
    label: 'Final Delivery',
    labelZh: '项目交付',
    description: '最终交付，客户验收',
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    lightColor: 'bg-teal-200',
    icon: Package,
    phase: 'delivery',
  },
  {
    id: 'support',
    label: 'Ongoing Support',
    labelZh: '运维支持',
    description: '售后支持，持续优化',
    color: 'text-sky-600',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    lightColor: 'bg-sky-200',
    icon: Headphones,
    phase: 'delivery',
  },
  {
    id: 'archived',
    label: 'Archived',
    labelZh: '已归档',
    description: '项目完成，历史归档',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    lightColor: 'bg-gray-200',
    icon: Archive,
    phase: 'archived',
  },
]

export const PROJECT_STAGE_IDS = PROJECT_STAGE_CONFIGS.map(stage => stage.id)

export function resolveProjectStage(status: string): ProjectStageConfig {
  const explicit = PROJECT_STAGE_CONFIGS.find(stage => stage.id === status)
  if (explicit) return explicit

  const backendStatus = toBackendStatus(status)
  const fallbackStageMap: Record<ProjectStatus, ProjectStage> = {
    lead: 'lead_discovery',
    opportunity: 'opportunity_qualified',
    won: 'contracting',
    delivering: 'execution',
    archived: 'archived',
  }

  const mappedStage = fallbackStageMap[backendStatus] || 'lead_discovery'
  return PROJECT_STAGE_CONFIGS.find(stage => stage.id === mappedStage) || PROJECT_STAGE_CONFIGS[0]
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
export type VectorStatus = 'pending' | 'processing' | 'synced' | 'failed'

export const VECTOR_STATUS_LABELS: Record<VectorStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  synced: '已索引',
  failed: '失败',
}
