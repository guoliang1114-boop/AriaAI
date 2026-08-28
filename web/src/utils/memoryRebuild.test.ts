import { describe, expect, it } from 'vitest'

import type { MemorySlotListResponse } from '../types/api'
import { formatMemoryRebuildSummary } from './memoryRebuild'

const ledger = (mode: string, slots: string[]): MemorySlotListResponse => ({
  scope: 'project',
  entity_id: 7,
  memory_version: 3,
  slot_count: 12,
  stale_slot_count: 0,
  slots: [],
  last_rebuild_mode: mode,
  last_rebuilt_slots: slots,
})

describe('formatMemoryRebuildSummary', () => {
  it('shows the bounded slot count for a partial rebuild', () => {
    expect(formatMemoryRebuildSummary(ledger('partial', ['key_risks', 'financial_status'])))
      .toBe('最近局部更新 2 个槽位')
  })

  it('makes a safe full fallback visible', () => {
    expect(formatMemoryRebuildSummary(ledger('full_fallback', []), false))
      .toBe('Latest rebuild safely fell back to full')
  })
})
