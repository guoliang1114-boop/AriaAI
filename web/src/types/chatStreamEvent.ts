import type {
  GeneratedArtifact,
  KnowledgeEvidenceManifest,
  ProjectQuestionReanswerEvidenceManifest,
  Reference,
  ToolCallEvent,
} from './api'
import type {
  ContextMemoryLayer,
  ContextReceiptEvent,
  ContextWarningCode,
  TurnReceiptEvent,
} from './productRunEvent'

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
  project_question_reanswer_evidence?: ProjectQuestionReanswerEvidenceManifest
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
  world_state?: ContextReceiptEvent['world_state']
  message_id?: number | string
  assistant_message_id?: number | string
  run_rollout?: Record<string, unknown>
  turn_interrupted?: Record<string, unknown>
  phase_error?: Record<string, unknown>
  delivery_failed?: boolean
  final_status?: 'completed' | 'waiting_confirmation' | 'failed' | 'cancelled'
  error_code?: string
  error_message?: string
  retryable?: boolean
  fallback_content?: string
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

const CONTEXT_WARNING_CODES = new Set<ContextWarningCode>([
  'project_memory_missing',
  'project_memory_stale',
  'client_memory_stale',
  'user_preference_overridden',
  'memory_retrieval_truncated',
  'skill_match_ambiguous',
  'context_compacted',
  'project_world_state_changed',
  'project_world_state_truncated',
])

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function nonNegativeInt(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function optionalNonNegativeInt(value: unknown): number | undefined {
  return value == null ? undefined : nonNegativeInt(value)
}

function normalizeContextMemoryLayer(value: unknown): ContextMemoryLayer | null {
  if (!value || typeof value !== 'object') return null
  const layer = value as ContextMemoryLayer
  if (!['user', 'client', 'project'].includes(layer.scope)) return null
  return {
    scope: layer.scope,
    status: layer.status,
    version: nonNegativeInt(layer.version),
    retrieval_mode: layer.retrieval_mode,
    query_facets: stringList(layer.query_facets),
    selected_slots: stringList(layer.selected_slots),
    stale_slots: Array.isArray(layer.stale_slots) ? stringList(layer.stale_slots) : undefined,
    selected_slot_count: nonNegativeInt(layer.selected_slot_count),
    stale_slot_count: optionalNonNegativeInt(layer.stale_slot_count),
    available_slot_count: nonNegativeInt(layer.available_slot_count),
    omitted_slot_count: nonNegativeInt(layer.omitted_slot_count),
    selected_item_count: nonNegativeInt(layer.selected_item_count),
    evidence_ref_count: optionalNonNegativeInt(layer.evidence_ref_count),
    direct_fact_count: optionalNonNegativeInt(layer.direct_fact_count),
    matched_fact_count: optionalNonNegativeInt(layer.matched_fact_count),
    scoped_fact_count: optionalNonNegativeInt(layer.scoped_fact_count),
    unresolved_fact_count: optionalNonNegativeInt(layer.unresolved_fact_count),
    truncated: Boolean(layer.truncated),
    overridden_dimensions: Array.isArray(layer.overridden_dimensions)
      ? layer.overridden_dimensions.filter((item) => (
        ['language', 'tone', 'format', 'verbosity'] as unknown[]
      ).includes(item))
      : [],
  }
}

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

  const memory = event.memory
  const skill = event.skill
  const evidence = event.evidence
  const normalized: ContextReceiptEvent = {
    type: 'context_receipt',
    schema_version: 1,
    run_id: event.run_id,
    scope: event.scope,
    memory: {
      status: memory.status,
      version: nonNegativeInt(memory.version),
      raw_context_available: Boolean(memory.raw_context_available),
      retrieval_mode: memory.retrieval_mode,
      query_facets: stringList(memory.query_facets),
      selected_slots: stringList(memory.selected_slots),
      stale_slots: Array.isArray(memory.stale_slots)
        ? stringList(memory.stale_slots)
        : undefined,
      selected_slot_count: nonNegativeInt(memory.selected_slot_count),
      stale_slot_count: optionalNonNegativeInt(memory.stale_slot_count),
      available_slot_count: nonNegativeInt(memory.available_slot_count),
      omitted_slot_count: nonNegativeInt(memory.omitted_slot_count),
      selected_item_count: nonNegativeInt(memory.selected_item_count),
      evidence_ref_count: optionalNonNegativeInt(memory.evidence_ref_count),
      direct_fact_count: optionalNonNegativeInt(memory.direct_fact_count),
      matched_fact_count: optionalNonNegativeInt(memory.matched_fact_count),
      scoped_fact_count: optionalNonNegativeInt(memory.scoped_fact_count),
      unresolved_fact_count: optionalNonNegativeInt(memory.unresolved_fact_count),
      truncated: Boolean(memory.truncated),
      layers: Array.isArray(memory.layers)
        ? memory.layers
          .map(normalizeContextMemoryLayer)
          .filter((layer): layer is ContextMemoryLayer => layer !== null)
        : undefined,
    },
    skill: {
      status: skill.status,
      usage_mode: skill.usage_mode,
      id: skill.id == null ? undefined : String(skill.id),
      name: skill.name == null ? undefined : String(skill.name),
      source: skill.source == null ? undefined : String(skill.source),
      reason: String(skill.reason || ''),
      confidence: Math.max(0, Math.min(1, Number(skill.confidence) || 0)),
      candidates: Array.isArray(skill.candidates)
        ? skill.candidates.map((candidate) => ({
          id: candidate.id == null ? undefined : String(candidate.id),
          name: String(candidate.name || ''),
          score: nonNegativeInt(candidate.score),
        }))
        : undefined,
    },
    evidence: {
      workspace_context: Boolean(evidence.workspace_context),
      attached_file_count: nonNegativeInt(evidence.attached_file_count),
      knowledge_reference_count: nonNegativeInt(evidence.knowledge_reference_count),
      history_message_count: nonNegativeInt(evidence.history_message_count),
      conversation_capsule: Boolean(evidence.conversation_capsule),
      user_preferences: Boolean(evidence.user_preferences),
      compacted: Boolean(evidence.compacted),
    },
    warnings: event.warnings.filter(
      (warning): warning is ContextWarningCode => CONTEXT_WARNING_CODES.has(warning),
    ),
  }

  if (event.project) {
    normalized.project = {
      id: String(event.project.id),
      name: String(event.project.name),
    }
  }
  if (event.world_state) {
    normalized.world_state = {
      current_version: String(event.world_state.current_version || ''),
      previous_version: event.world_state.previous_version == null
        ? null
        : String(event.world_state.previous_version),
      baseline: Boolean(event.world_state.baseline),
      changed: Boolean(event.world_state.changed),
      changed_categories: Array.isArray(event.world_state.changed_categories)
        ? event.world_state.changed_categories.filter((category) => [
          'project',
          'milestones',
          'todos',
          'files',
          'progress',
          'financials',
          'stakeholders',
          'deliverables',
        ].includes(category))
        : [],
      categories: Object.fromEntries(
        Object.entries(event.world_state.categories || {}).map(([category, counts]) => [
          category,
          {
            added: nonNegativeInt(counts?.added),
            removed: nonNegativeInt(counts?.removed),
            updated: nonNegativeInt(counts?.updated),
            current_count: nonNegativeInt(counts?.current_count),
          },
        ]),
      ),
      truncated: Boolean(event.world_state.truncated),
    }
  }
  return normalized
}
