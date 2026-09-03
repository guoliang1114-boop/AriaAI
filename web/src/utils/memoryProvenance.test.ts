import { describe, expect, it } from 'vitest'
import { memoryProvenanceHealth } from './memoryProvenance'

describe('memoryProvenanceHealth', () => {
  it('counts only direct and matched facts as verified', () => {
    expect(memoryProvenanceHealth({
      fact_count: 10,
      stale_fact_count: 1,
      direct_fact_count: 4,
      matched_fact_count: 2,
      scoped_fact_count: 3,
      unresolved_fact_count: 1,
    })).toEqual({
      total: 10,
      verified: 6,
      indirect: 3,
      unresolved: 1,
      stale: 1,
      verifiedRatio: 0.6,
      needsAttention: true,
    })
  })

  it('reports complete provenance only when every fact is verifiable and fresh', () => {
    expect(memoryProvenanceHealth({
      fact_count: 3,
      stale_fact_count: 0,
      direct_fact_count: 2,
      matched_fact_count: 1,
      scoped_fact_count: 0,
      unresolved_fact_count: 0,
    })).toMatchObject({ verifiedRatio: 1, needsAttention: false })
  })

  it('treats an absent ledger as neutral instead of inventing a quality issue', () => {
    expect(memoryProvenanceHealth(null)).toMatchObject({
      total: 0,
      verifiedRatio: 1,
      needsAttention: false,
    })
  })
})
