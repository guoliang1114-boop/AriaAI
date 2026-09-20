import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { emptyTimeline, reduceRunActivity } from '../stores/runActivityReducer'
import { parseChatStreamEvent, toContextReceiptEvent } from './chatStreamEvent'
import { isProductRunEvent } from './productRunEvent'
import { isProductRunEventType } from './productRunEventValidation'
import type { ProductRunEvent } from './productRunEvent'

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../backend/tests/fixtures/product_run_events_v1.json'), 'utf8')) as {
  event_types: string[]
  scenarios: Array<{ name: string; events: unknown[] }>
  variants: unknown[]
}
const allEvents = [...fixture.scenarios.flatMap(scenario => scenario.events), ...fixture.variants]
const scenario = (name: string) => fixture.scenarios.find(item => item.name === name)!.events

describe('Product Run v1 cross-language contract', () => {
  it('type-checks actual Python builder output against the public TypeScript union', () => {
    // A virtual source file allows real TypeScript checking of JSON literals;
    // casting imported JSON to ProductRunEvent[] would hide contract drift.
    const filename = resolve(process.cwd(), 'src/types/__wire_contract__.ts')
    const source = `import type { ProductRunEvent } from './productRunEvent';\nexport const events: ProductRunEvent[] = ${JSON.stringify(allEvents)};`
    const options: ts.CompilerOptions = {
      strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    }
    const host = ts.createCompilerHost(options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === filename
      ? ts.createSourceFile(filename, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
    const program = ts.createProgram([filename], options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    expect(diagnostics).toEqual([])
  })

  it('accepts every backend event type and the generated enum variants at both frontend boundaries', () => {
    expect(fixture.event_types).toHaveLength(17)
    expect(fixture.event_types.every(isProductRunEventType)).toBe(true)
    for (const event of allEvents) {
      expect(isProductRunEvent(event), JSON.stringify(event)).toBe(true)
      expect(parseChatStreamEvent(event)).toEqual(event)
    }
  })

  it('keeps quiet chat quiet and folds complex work without losing identities', () => {
    const fold = (name: string) => scenario(name).reduce((timeline, event) => {
      expect(isProductRunEvent(event)).toBe(true)
      return reduceRunActivity(timeline, event as ProductRunEvent)
    }, emptyTimeline())
    expect(fold('quiet')).toMatchObject({ display_mode: 'quiet', steps: [], text: '合成回答', message_id: 101, final_status: 'completed' })
    const task = fold('task')
    expect(task).toMatchObject({
      display_mode: 'skill', text: '合成交付完成', final_status: 'completed', message_id: '103',
      steering: [{ steering_id: 'steer_contract', sequence: 1 }],
      steps: [{ index: 1, status: 'completed', items: [{ status: 'completed' }] }],
      task: { task_id: '31', status: 'completed', progress_pct: 100 },
      artifacts: [{ id: '57', output_id: 'out_contract', verification: { verification_id: 91 } }],
      memory_candidates: [{ id: '18', status: 'pending_review', scope: 'project' }],
    })
    expect(task.context_receipt?.skill.runtime?.deliverable?.deliverable_id).toBe('board-deck')
    expect(JSON.parse(JSON.stringify(task))).toEqual(expect.objectContaining({ artifacts: task.artifacts, memory_candidates: task.memory_candidates }))
    expect(fold('approval')).toMatchObject({ final_status: 'waiting_confirmation', confirmation: { action: '更新合成项目', params_snapshot: { project_id: 42 } } })
    expect(fold('failed')).toMatchObject({ final_status: 'failed', error: { code: 'MODEL_TIMEOUT' } })
    expect(fold('cancelled')).toMatchObject({ final_status: 'cancelled' })
  })

  it('retains legacy receipts without newly added fields and preserves additive fields', () => {
    const receipt = structuredClone(scenario('quiet').find(event => (event as { type: string }).type === 'context_receipt')) as Record<string, unknown>
    delete receipt.schema_version
    const memory = receipt.memory as Record<string, unknown>
    for (const key of ['layers', 'stale_slots', 'stale_slot_count', 'evidence_ref_count', 'direct_fact_count', 'matched_fact_count', 'scoped_fact_count', 'unresolved_fact_count']) delete memory[key]
    const evidence = receipt.evidence as Record<string, unknown>
    for (const key of ['knowledge_retrieval_mode', 'knowledge_legacy_fallback', 'knowledge_source_scoped_unavailable', 'history_retained_message_count', 'history_summarized_message_count', 'history_truncated_message_count']) delete evidence[key]
    expect(parseChatStreamEvent(receipt)).toMatchObject({ schema_version: 1, memory: { status: 'not_applicable' } })
    expect(parseChatStreamEvent({ type: 'status', message: 'Legacy status' })).toEqual({ type: 'status', message: 'Legacy status' })
    expect(parseChatStreamEvent({ type: 'done', future_field: true })).toMatchObject({ future_field: true })
    expect(parseChatStreamEvent({ type: 'run_failed', run_id: 'run_future', error_code: 'NEW_CODE', error_message: 'Future failure', future_field: true })).toMatchObject({ error_code: 'NEW_CODE', future_field: true })
  })

  it('preserves the complete deliverable receipt while stripping private provider fields', () => {
    const raw = structuredClone(scenario('task').find(event => (event as { type: string }).type === 'context_receipt')) as Record<string, unknown>
    const runtime = (raw.skill as Record<string, unknown>).runtime as Record<string, unknown>
    const deliverable = runtime.deliverable as Record<string, unknown>
    const expected = structuredClone(deliverable)
    deliverable.private_prompt = 'PRIVATE_SOURCE'
    const parsed = parseChatStreamEvent(raw)!
    const normalized = toContextReceiptEvent(parsed)!
    expect(normalized.skill.runtime?.deliverable).toEqual(expected)
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE_SOURCE')
  })
})

describe('Product Run event field validation', () => {
  it.each([
    { type: 'text_delta', content: {} },
    { type: 'step_started', step_index: 0, title: 'Bad step' },
    { type: 'step_completed', step_index: 1, status: 'running', duration_ms: 1 },
    { type: 'tool_progress', step_index: 1, title: 'Bad progress', status: 'running', progress: Infinity },
    { type: 'task_update', task_id: '1', status: 'running', progress_pct: 101 },
    { type: 'artifact_ready', artifact_id: '1', artifact_type: 'pdf', verification: { status: 'passed' } },
    { type: 'memory_candidate_ready', candidate_id: '1', scope: 'project', candidate_type: 'risk', status: 'accepted' },
    { type: 'confirmation_required', action: 'Write', impact: 'Project', params_snapshot: [] },
    { type: 'message_persisted', message_id: true },
  ])('does not send malformed $type payloads to the reducer', event => {
    const raw = { run_id: 'run_invalid', ...event }
    expect(isProductRunEvent(raw)).toBe(false)
    expect(parseChatStreamEvent(raw)).toBeNull()
  })

  it.each([
    { type: 'run_started', timestamp: [] },
    { type: 'run_done', final_status: 'running' },
    { type: 'run_done', final_status: 'completed', message_id: {} },
    { type: 'run_failed', error_code: 'UNKNOWN', error_message: {} },
  ])('turns malformed $type into an explicit stream error', event => {
    const raw = { run_id: 'run_invalid', ...event }
    expect(isProductRunEvent(raw)).toBe(false)
    expect(parseChatStreamEvent(raw)).toEqual({ type: 'error', error_code: 'INVALID_PRODUCT_RUN_EVENT', message: '运行事件格式无效，请重新发起本轮请求' })
  })

  it('rejects damaged nested receipts without throwing or converting string flags to approvals', () => {
    const raw = structuredClone(scenario('task').find(event => (event as { type: string }).type === 'context_receipt')) as Record<string, unknown>
    const skill = raw.skill as Record<string, unknown>
    skill.candidates = [null]
    expect(parseChatStreamEvent(raw)).toBeNull()
    delete raw.schema_version
    skill.confidence = { toString: null }
    expect(parseChatStreamEvent(raw)).toBeNull()
    const turn = structuredClone(scenario('quiet').find(event => (event as { type: string }).type === 'turn_receipt')) as Record<string, unknown>
    turn.write_allowed = 'false'
    expect(parseChatStreamEvent(turn)).toBeNull()
    expect(isProductRunEventType('__proto__')).toBe(false)
    expect(isProductRunEventType('constructor')).toBe(false)
  })
})
