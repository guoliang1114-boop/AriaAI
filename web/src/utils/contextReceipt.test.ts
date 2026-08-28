import { describe, expect, it } from 'vitest'

import type { ContextMemoryLayer } from '../types/productRunEvent'
import { contextMemoryLayerLabel } from './contextReceipt'


function layer(overrides: Partial<ContextMemoryLayer> = {}): ContextMemoryLayer {
  return {
    scope: 'project',
    status: 'stale',
    version: 7,
    retrieval_mode: 'focused',
    query_facets: ['financial'],
    selected_slots: ['financial_status', 'key_risks'],
    stale_slots: ['financial_status'],
    selected_slot_count: 2,
    stale_slot_count: 1,
    available_slot_count: 9,
    omitted_slot_count: 7,
    selected_item_count: 3,
    evidence_ref_count: 4,
    matched_fact_count: 2,
    scoped_fact_count: 1,
    unresolved_fact_count: 0,
    truncated: false,
    overridden_dimensions: [],
    ...overrides,
  }
}


describe('contextMemoryLayerLabel', () => {
  it('shows slot-level freshness and provenance without memory content', () => {
    expect(contextMemoryLayerLabel(layer())).toBe(
      '项目记忆 v7：使用 3 项 / 2 个槽位（待刷新）；其中 1 个已用槽位待刷新；4 个来源引用；事实溯源 2 条匹配 / 1 条范围来源 / 0 条待补证',
    )
  })

  it('keeps persisted pre-slot-ledger receipts compatible', () => {
    expect(contextMemoryLayerLabel(layer({
      stale_slots: undefined,
      stale_slot_count: undefined,
      evidence_ref_count: undefined,
      matched_fact_count: undefined,
      scoped_fact_count: undefined,
      unresolved_fact_count: undefined,
    })))
      .toContain('项目记忆 v7：使用 3 项 / 2 个槽位（待刷新）')
  })
})
