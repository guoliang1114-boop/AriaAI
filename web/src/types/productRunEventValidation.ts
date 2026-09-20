import type { ContextSkillRuntimeContract, ProductRunEvent, ProductRunEventType } from './productRunEvent'

type Check = (value: unknown) => boolean
type Fields = Record<string, Check>

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const string: Check = value => typeof value === 'string'
const nonEmpty: Check = value => typeof value === 'string' && Boolean(value.trim())
const boolean: Check = value => typeof value === 'boolean'
const finite: Check = value => typeof value === 'number' && Number.isFinite(value)
const count: Check = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const positive: Check = value => count(value) && Number(value) > 0
const identity: Check = value => nonEmpty(value) || positive(value)
const sha256: Check = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const oneOf = (...values: unknown[]): Check => value => values.includes(value)
const array = (check: Check): Check => value => Array.isArray(value) && value.every(check)
const strings = array(string)
const shape = (required: Fields, optional: Fields = {}): Check => value => object(value)
  && Object.entries(required).every(([key, check]) => check(value[key]))
  && Object.entries(optional).every(([key, check]) => value[key] === undefined || check(value[key]))
const values = (check: Check): Check => value => object(value) && Object.values(value).every(check)

const displayMode = oneOf('quiet', 'contextual', 'task', 'skill', 'confirmation', 'debug')
const skillSource = oneOf('explicit', 'auto', 'conversation')
const toolStatus = oneOf('pending', 'running', 'completed', 'failed')
const finalStatus = oneOf('completed', 'waiting_confirmation', 'failed', 'cancelled')
const memoryStatus = oneOf('not_applicable', 'missing', 'stale', 'ready')
const retrievalMode = oneOf('none', 'overview', 'focused', 'full')
const layerScope = oneOf('user', 'client', 'project')
const knowledgeMode = oneOf('none', 'source_scoped', 'legacy_fallback', 'legacy_explicit', 'legacy')
const worldCategory = oneOf('project', 'milestones', 'todos', 'files', 'progress', 'financials', 'stakeholders', 'deliverables')
const warning = oneOf(
  'project_memory_missing', 'project_memory_stale', 'client_memory_stale', 'user_preference_overridden',
  'memory_retrieval_truncated', 'skill_match_ambiguous', 'skill_instructions_missing',
  'skill_instructions_compacted', 'skill_tool_contract_invalid', 'skill_verification_not_declared',
  'context_compacted', 'project_world_state_changed', 'project_world_state_truncated',
  'knowledge_legacy_fallback', 'knowledge_source_scoped_unavailable',
)
const memoryFields = {
  status: memoryStatus, version: count, retrieval_mode: retrievalMode,
  query_facets: strings, selected_slots: strings, selected_slot_count: count,
  available_slot_count: count, omitted_slot_count: count, selected_item_count: count, truncated: boolean,
}
// These fields were added after v1 receipts were already persisted.
const memoryOptional = {
  stale_slots: strings, stale_slot_count: count, evidence_ref_count: count,
  direct_fact_count: count, matched_fact_count: count, scoped_fact_count: count, unresolved_fact_count: count,
}
const memoryLayer = shape({
  ...memoryFields, scope: layerScope,
  overridden_dimensions: array(oneOf('language', 'tone', 'format', 'verbosity')),
}, memoryOptional)

const deliverable = shape({
  schema_version: oneOf(1), deliverable_id: nonEmpty, name: nonEmpty, formats: strings,
  default_format: nonEmpty, stage: string, save_targets: strings, requires_review: boolean,
  business_verifiers: array(shape({ verifier_id: nonEmpty, expected_min: positive })),
  contract_sha256: sha256, catalog_sha256: sha256, skill_release_sha256: value => value === '' || sha256(value),
})

export function isContextSkillDeliverable(value: unknown): value is NonNullable<ContextSkillRuntimeContract['deliverable']> {
  return deliverable(value)
}

const skillRuntime = shape({
  schema_version: oneOf(1), load_status: oneOf('loaded', 'compacted', 'degraded'),
  package_kind: oneOf('bundled', 'custom'), version: string, release_status: string,
  instruction_loaded: boolean, instruction_complete: boolean, progressive_loading: boolean,
  resource_count: count, resource_names: strings, script_resource_count: count, scripts_executable: oneOf(false),
  tool_contract_valid: boolean, declared_tool_count: count, granted_tool_count: count, policy_filtered_tool_count: count,
  verification_status: oneOf('available', 'not_declared'), verification_step_count: count,
  verification_source_count: count, verification_context_complete: boolean,
}, { release_id: string, release_sha256: sha256, verification_plan_sha256: sha256, deliverable })

const verification = shape({
  schema_version: oneOf(1), verification_id: positive, verifier_version: positive,
  status: oneOf('passed', 'failed', 'partial', 'manual_required'),
  technical_status: oneOf('passed', 'failed', 'unsupported'),
  skill_status: oneOf('not_declared', 'manual_required', 'context_incomplete'),
  content_sha256: sha256, evidence_sha256: sha256,
  automated_check_count: count, automated_passed_count: count, automated_failed_count: count,
  automated_skipped_count: count, skill_check_count: count, metrics: values(finite),
}, { verification_plan_sha256: sha256, skill_release_sha256: sha256 })

// Validate fields before dispatch, while allowing additive fields from newer
// compatible servers. This describes wire data, never business authorization.
const schemas = {
  run_started: shape({ timestamp: nonEmpty }, {
    display_mode: displayMode, skill: shape({ name: nonEmpty }, { id: string, source: skillSource }),
  }),
  turn_receipt: shape({
    summary: nonEmpty, user_constraints: strings,
    mode: oneOf('answer_only', 'plan_only', 'execute_now', 'plan_then_execute'),
    target_scope: oneOf('chat', 'project', 'workspace'),
    execution_scope: oneOf('chat_only', 'injected_project_context', 'read_tools', 'project_write', 'workspace_write'),
    expected_response: nonEmpty, write_allowed: boolean, requires_confirmation: boolean, steering_supported: boolean,
  }),
  context_receipt: shape({
    schema_version: oneOf(1), scope: oneOf('chat', 'project', 'client_portfolio', 'workspace'),
    memory: shape({ ...memoryFields, raw_context_available: boolean }, { ...memoryOptional, layers: array(memoryLayer) }),
    skill: shape({ status: oneOf('applied', 'ambiguous', 'not_used'), usage_mode: oneOf('none', 'advisory', 'workflow'), reason: string, confidence: finite }, {
      id: string, name: string, source: string,
      candidates: array(shape({ name: string, score: finite }, { id: string })), runtime: skillRuntime,
    }),
    evidence: shape({
      workspace_context: boolean, attached_file_count: count, knowledge_reference_count: count,
      history_message_count: count, conversation_capsule: boolean, user_preferences: boolean, compacted: boolean,
    }, {
      knowledge_retrieval_mode: knowledgeMode, knowledge_legacy_fallback: boolean, knowledge_source_scoped_unavailable: boolean,
      history_retained_message_count: count, history_summarized_message_count: count, history_truncated_message_count: count,
    }),
    warnings: array(warning),
  }, {
    project: shape({ id: string, name: string }),
    world_state: shape({
      current_version: string, previous_version: value => value === null || string(value),
      baseline: boolean, changed: boolean, changed_categories: array(worldCategory),
      categories: values(shape({ added: count, removed: count, updated: count, current_count: count })), truncated: boolean,
    }),
  }),
  steering_applied: shape({ steering_id: nonEmpty, sequence: positive, content_preview: string }, { message_id: positive }),
  status: shape({ message: nonEmpty }, { display_mode: displayMode, progress: finite }),
  text_delta: shape({ content: string }),
  reference_delta: shape({ source: nonEmpty }, { url: string, title: string }),
  step_started: shape({ step_index: positive, title: nonEmpty }, { step_total: positive }),
  step_completed: shape({ step_index: positive, status: oneOf('completed', 'failed'), duration_ms: count }, { truncated: boolean }),
  tool_progress: shape({ step_index: positive, title: nonEmpty, status: toolStatus }, { detail: string, progress: finite }),
  task_update: shape({ task_id: nonEmpty, status: toolStatus }, {
    progress_pct: value => count(value) && Number(value) <= 100, current_step: positive, total_steps: positive, step_title: string,
  }),
  confirmation_required: shape({ action: nonEmpty, impact: nonEmpty }, { params_snapshot: object, deadline: string }),
  artifact_ready: shape({ artifact_id: nonEmpty, artifact_type: oneOf('pptx', 'docx', 'xlsx', 'pdf', 'markdown') }, {
    download_url: string, preview_url: string, source_tool: string, output_id: string, content_sha256: sha256, verification,
  }),
  memory_candidate_ready: shape({ candidate_id: nonEmpty, scope: layerScope, candidate_type: nonEmpty, status: oneOf('pending_review') }, { content_sha256: sha256 }),
  message_persisted: shape({ message_id: identity }, { parent_run_id: nonEmpty }),
  run_done: shape({ final_status: finalStatus }, { message_id: identity, artifact_ids: strings }),
  // New error codes are an additive extension of the v1 failure contract.
  run_failed: shape({ error_code: nonEmpty, error_message: nonEmpty }, { retryable: boolean, fallback_content: string }),
} satisfies Record<ProductRunEventType, Check>

export function isProductRunEventType(value: unknown): value is ProductRunEventType {
  return typeof value === 'string' && Object.hasOwn(schemas, value)
}

export function isProductRunEvent(value: unknown): value is ProductRunEvent {
  return object(value) && nonEmpty(value.run_id) && isProductRunEventType(value.type) && schemas[value.type](value)
}
