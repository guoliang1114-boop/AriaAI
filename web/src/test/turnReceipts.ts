import type { ContextReceiptEvent, TurnReceiptEvent } from '../types/productRunEvent'

export const liveTurnReceipt: TurnReceiptEvent = {
  type: 'turn_receipt', run_id: 'live-run-1', summary: '分阶段汇总进展，不超过 300 字',
  user_constraints: ['不超过 300 字'], mode: 'answer_only', target_scope: 'project',
  execution_scope: 'injected_project_context', expected_response: '直接回答',
  write_allowed: false, requires_confirmation: false, steering_supported: true,
}

export const liveContextReceipt: ContextReceiptEvent = {
  type: 'context_receipt', schema_version: 1, run_id: 'live-run-1', scope: 'project',
  memory: { status: 'ready', version: 6, raw_context_available: true, retrieval_mode: 'focused',
    query_facets: ['progress'], selected_slots: ['progress'], selected_slot_count: 8,
    available_slot_count: 8, omitted_slot_count: 0, selected_item_count: 1, truncated: false,
    layers: [{ scope: 'project', status: 'ready', version: 6, retrieval_mode: 'focused',
      query_facets: ['progress'], selected_slots: ['progress'], selected_slot_count: 8,
      available_slot_count: 8, omitted_slot_count: 0, selected_item_count: 1, truncated: false,
      scoped_fact_count: 1, unresolved_fact_count: 0, overridden_dimensions: [] }],
  },
  skill: { status: 'not_used', usage_mode: 'none', reason: 'answer_only', confidence: 1 },
  evidence: { workspace_context: false, attached_file_count: 0, knowledge_reference_count: 0,
    history_message_count: 1, conversation_capsule: false, user_preferences: true, compacted: false },
  world_state: { current_version: '94690a22986e', previous_version: null, baseline: true,
    changed: false, changed_categories: [], categories: {}, truncated: false },
  warnings: [],
}
