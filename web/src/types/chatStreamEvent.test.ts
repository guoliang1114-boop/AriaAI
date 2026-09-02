import { describe, expect, it } from 'vitest'
import {
  parseChatStreamEvent,
  toContextReceiptEvent,
  toTurnReceiptEvent,
} from './chatStreamEvent'

describe('parseChatStreamEvent', () => {
  it('accepts a typed SSE envelope without discarding forward-compatible fields', () => {
    const event = parseChatStreamEvent({
      type: 'done',
      artifacts: [],
      future_protocol_field: 'preserved',
    })

    expect(event?.type).toBe('done')
    expect(event).toMatchObject({ future_protocol_field: 'preserved' })
  })

  it.each([null, undefined, 'done', {}, { type: '' }, { type: 42 }])(
    'rejects malformed SSE envelopes: %p',
    (value) => {
      expect(parseChatStreamEvent(value)).toBeNull()
    },
  )
})

describe('chat receipt normalization', () => {
  it('normalizes a complete turn receipt and rejects an incomplete one', () => {
    const valid = parseChatStreamEvent({
      type: 'turn_receipt',
      run_id: 'run_1',
      summary: '先确认范围，再形成建议',
      mode: 'answer_only',
      target_scope: 'project',
      execution_scope: 'injected_project_context',
      expected_response: '项目建议',
      write_allowed: false,
      requires_confirmation: false,
      steering_supported: true,
      user_constraints: ['只分析', '只分析', '输出为 Markdown'],
    })
    const incomplete = parseChatStreamEvent({ type: 'turn_receipt', run_id: 'run_2' })

    expect(valid && toTurnReceiptEvent(valid)).toMatchObject({
      run_id: 'run_1',
      target_scope: 'project',
      steering_supported: true,
      user_constraints: ['只分析', '输出为 Markdown'],
    })
    expect(incomplete && toTurnReceiptEvent(incomplete)).toBeNull()
  })

  it('accepts a context receipt only when its memory, skill, and evidence blocks exist', () => {
    const valid = parseChatStreamEvent({
      type: 'context_receipt',
      run_id: 'run_1',
      scope: 'project',
      memory: {
        status: 'ready',
        version: 3,
        raw_context_available: true,
        retrieval_mode: 'focused',
        query_facets: ['risk'],
        selected_slots: ['risks'],
        selected_slot_count: 1,
        available_slot_count: 3,
        omitted_slot_count: 2,
        selected_item_count: 2,
        truncated: false,
        layers: [
          {
            scope: 'user',
            status: 'ready',
            version: 2,
            retrieval_mode: 'focused',
            query_facets: [],
            selected_slots: ['response_preferences.tone'],
            selected_slot_count: 1,
            available_slot_count: 2,
            omitted_slot_count: 1,
            selected_item_count: 1,
            truncated: false,
            overridden_dimensions: ['language'],
          },
        ],
      },
      skill: {
        status: 'applied',
        usage_mode: 'advisory',
        reason: 'matched',
        confidence: 0.92,
        runtime: {
          schema_version: 1,
          load_status: 'loaded',
          package_kind: 'bundled',
          release_id: '17',
          version: '2.1.0',
          release_status: 'stable',
          release_sha256: 'a'.repeat(64),
          instruction_loaded: true,
          instruction_complete: true,
          progressive_loading: true,
          resource_count: 1,
          resource_names: ['references/quality-checklist.md'],
          script_resource_count: 0,
          scripts_executable: false,
          tool_contract_valid: true,
          declared_tool_count: 2,
          granted_tool_count: 1,
          policy_filtered_tool_count: 1,
          verification_status: 'available',
          verification_step_count: 7,
          verification_source_count: 1,
          verification_context_complete: true,
          prompt: 'private instructions',
        },
      },
      evidence: {
        workspace_context: true,
        attached_file_count: 0,
        knowledge_reference_count: 2,
        history_message_count: 4,
        conversation_capsule: true,
        user_preferences: true,
        compacted: false,
      },
      warnings: [],
    })
    const incomplete = parseChatStreamEvent({
      type: 'context_receipt',
      run_id: 'run_2',
      scope: 'project',
      skill: { name: 'not-a-context-receipt' },
    })

    expect(valid && toContextReceiptEvent(valid)).toMatchObject({
      run_id: 'run_1',
      memory: {
        version: 3,
        layers: [{ scope: 'user', overridden_dimensions: ['language'] }],
      },
      skill: {
        runtime: {
          release_id: '17',
          version: '2.1.0',
          resource_count: 1,
          granted_tool_count: 1,
          verification_step_count: 7,
        },
      },
    })
    expect(JSON.stringify(valid && toContextReceiptEvent(valid))).not.toContain('private instructions')
    expect(incomplete && toContextReceiptEvent(incomplete)).toBeNull()
  })

  it('whitelists context receipt fields so private source trust data cannot reach UI state', () => {
    const raw = parseChatStreamEvent({
      type: 'context_receipt',
      run_id: 'run_private',
      scope: 'project',
      memory: {
        status: 'ready',
        version: 3,
        raw_context_available: true,
        retrieval_mode: 'focused',
        query_facets: ['risk'],
        selected_slots: ['key_risks'],
        selected_slot_count: 1,
        available_slot_count: 1,
        omitted_slot_count: 0,
        selected_item_count: 1,
        truncated: false,
        _source_snapshots: { 'project:1': 'private-hash' },
        layers: [
          {
            scope: 'project',
            status: 'ready',
            version: 3,
            retrieval_mode: 'focused',
            query_facets: ['risk'],
            selected_slots: ['key_risks'],
            selected_slot_count: 1,
            available_slot_count: 1,
            omitted_slot_count: 0,
            selected_item_count: 1,
            truncated: false,
            overridden_dimensions: [],
            source_sha256: 'private-hash',
          },
        ],
      },
      skill: {
        status: 'not_used',
        usage_mode: 'none',
        reason: '',
        confidence: 0,
        _source_attributions: [{ source_ids: ['project:1'] }],
      },
      evidence: {
        workspace_context: true,
        attached_file_count: 0,
        knowledge_reference_count: 0,
        history_message_count: 0,
        conversation_capsule: false,
        user_preferences: false,
        compacted: false,
        source_sha256: 'private-hash',
      },
      warnings: [],
    })

    const receipt = raw && toContextReceiptEvent(raw)
    const serialized = JSON.stringify(receipt)
    expect(receipt).not.toBeNull()
    expect(serialized).not.toContain('_source_snapshots')
    expect(serialized).not.toContain('_source_attributions')
    expect(serialized).not.toContain('source_sha256')
    expect(serialized).not.toContain('private-hash')
  })
})
