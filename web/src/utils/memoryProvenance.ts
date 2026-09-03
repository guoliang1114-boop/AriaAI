export interface MemoryProvenanceCounts {
  fact_count: number
  stale_fact_count: number
  direct_fact_count: number
  matched_fact_count: number
  scoped_fact_count: number
  unresolved_fact_count: number
}

export interface MemoryProvenanceHealth {
  total: number
  verified: number
  indirect: number
  unresolved: number
  stale: number
  verifiedRatio: number
  needsAttention: boolean
}

function count(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value || 0)) : 0
}

/** Summarize fact provenance without treating scoped context as verified proof. */
export function memoryProvenanceHealth(
  value: MemoryProvenanceCounts | null | undefined,
): MemoryProvenanceHealth {
  if (!value) {
    return {
      total: 0,
      verified: 0,
      indirect: 0,
      unresolved: 0,
      stale: 0,
      verifiedRatio: 1,
      needsAttention: false,
    }
  }
  const total = count(value.fact_count)
  const verified = Math.min(
    total,
    count(value.direct_fact_count) + count(value.matched_fact_count),
  )
  const indirect = count(value.scoped_fact_count)
  const unresolved = count(value.unresolved_fact_count)
  const stale = count(value.stale_fact_count)
  return {
    total,
    verified,
    indirect,
    unresolved,
    stale,
    verifiedRatio: total > 0 ? verified / total : 1,
    needsAttention: total > 0 && (verified < total || stale > 0),
  }
}
