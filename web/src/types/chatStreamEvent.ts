import type {
  GeneratedArtifact,
  KnowledgeEvidenceManifest,
  Reference,
  ToolCallEvent,
} from './api'
import type { ContextReceiptEvent, TurnReceiptEvent } from './productRunEvent'

/**
 * Wire shape used by the legacy `/chat/send` SSE endpoint.
 *
 * The endpoint currently emits both the original chat events (`text`, `done`,
 * `tool_result`, …) and Product Run v1 receipts. Keeping the boundary in one
 * shared type prevents the standalone and project chat clients from silently
 * drifting apart while the protocol is consolidated.
 */
export interface ChatStreamEvent {
  type: string
  schema_version?: number
  run_id?: string
  content?: string
  message?: string
  error?: string
  stage?: string
  key?: string
  duration_ms?: number
  tool_name?: string
  result?: unknown
  references?: Reference[]
  knowledge_evidence?: KnowledgeEvidenceManifest
  artifacts?: GeneratedArtifact[]
  tool_calls?: ToolCallEvent[]
  skill_progress?: unknown[]
  stage_timings?: Record<string, number>
  action_policy?: string
  tool_access_policy?: string
  intent_reason?: string
  intent_method?: string
  tools_granted?: string[]
  tools_granted_count?: number
  chat_mode?: string
  turn_contract?: Record<string, unknown>
  conversation_id?: number
  title?: string
  summary?: string
  user_constraints?: unknown[]
  mode?: TurnReceiptEvent['mode']
  target_scope?: TurnReceiptEvent['target_scope']
  execution_scope?: TurnReceiptEvent['execution_scope']
  expected_response?: string
  write_allowed?: boolean
  requires_confirmation?: boolean
  steering_supported?: boolean
  content_preview?: string
  scope?: ContextReceiptEvent['scope']
  project?: ContextReceiptEvent['project']
  memory?: ContextReceiptEvent['memory']
  skill?:
    | ContextReceiptEvent['skill']
    | { id?: string | number; name?: string; source?: string }
  evidence?: ContextReceiptEvent['evidence']
  warnings?: ContextReceiptEvent['warnings']
}

/** Validate the minimum envelope before application code reads an SSE frame. */
export function parseChatStreamEvent(value: unknown): ChatStreamEvent | null {
  if (!value || typeof value !== 'object') return null
  const type = (value as { type?: unknown }).type
  if (typeof type !== 'string' || !type.trim()) return null
  return value as ChatStreamEvent
}

const TURN_MODES = new Set<TurnReceiptEvent['mode']>([
  'answer_only',
  'plan_only',
  'execute_now',
  'plan_then_execute',
])
const TARGET_SCOPES = new Set<TurnReceiptEvent['target_scope']>(['chat', 'project', 'workspace'])
const EXECUTION_SCOPES = new Set<TurnReceiptEvent['execution_scope']>([
  'chat_only',
  'injected_project_context',
  'read_tools',
  'project_write',
  'workspace_write',
])

export function toTurnReceiptEvent(event: ChatStreamEvent): TurnReceiptEvent | null {
  if (
    event.type !== 'turn_receipt'
    || typeof event.run_id !== 'string'
    || typeof event.summary !== 'string'
    || !event.mode
    || !TURN_MODES.has(event.mode)
    || !event.target_scope
    || !TARGET_SCOPES.has(event.target_scope)
    || !event.execution_scope
    || !EXECUTION_SCOPES.has(event.execution_scope)
    || typeof event.expected_response !== 'string'
  ) return null

  const userConstraints = Array.isArray(event.user_constraints)
    ? event.user_constraints
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.replace(/\s+/gu, ' ').trim().slice(0, 160))
      .filter((item, index, items) => items.indexOf(item) === index)
      .slice(0, 8)
    : []

  return {
    type: 'turn_receipt',
    run_id: event.run_id,
    summary: event.summary,
    user_constraints: userConstraints,
    mode: event.mode,
    target_scope: event.target_scope,
    execution_scope: event.execution_scope,
    expected_response: event.expected_response,
    write_allowed: Boolean(event.write_allowed),
    requires_confirmation: Boolean(event.requires_confirmation),
    steering_supported: Boolean(event.steering_supported),
  }
}

function isContextReceiptSkill(value: ChatStreamEvent['skill']): value is ContextReceiptEvent['skill'] {
  if (!value || typeof value !== 'object') return false
  return (
    'status' in value
    && 'usage_mode' in value
    && 'reason' in value
    && 'confidence' in value
  )
}

const CONTEXT_SCOPES = new Set<ContextReceiptEvent['scope']>([
  'chat',
  'project',
  'client_portfolio',
  'workspace',
])

export function toContextReceiptEvent(event: ChatStreamEvent): ContextReceiptEvent | null {
  if (
    event.type !== 'context_receipt'
    || typeof event.run_id !== 'string'
    || !event.scope
    || !CONTEXT_SCOPES.has(event.scope)
    || !event.memory
    || !isContextReceiptSkill(event.skill)
    || !event.evidence
    || !Array.isArray(event.warnings)
  ) return null

  return {
    type: 'context_receipt',
    schema_version: 1,
    run_id: event.run_id,
    scope: event.scope,
    project: event.project,
    memory: event.memory,
    skill: event.skill,
    evidence: event.evidence,
    warnings: event.warnings,
  }
}
