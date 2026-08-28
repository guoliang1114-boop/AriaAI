import type { MemorySlotListResponse } from '../types/api'

export function formatMemoryRebuildSummary(
  ledger: MemorySlotListResponse | null | undefined,
  isZh = true,
): string | null {
  const mode = ledger?.last_rebuild_mode
  if (!mode) return null
  const count = ledger?.last_rebuilt_slots?.length ?? 0

  if (mode === 'full_fallback') {
    return isZh ? '最近已自动回退全量更新' : 'Latest rebuild safely fell back to full'
  }
  if (mode === 'full') {
    return isZh ? '最近全量更新' : 'Latest rebuild was full'
  }
  if (mode === 'partial') {
    return isZh
      ? `最近局部更新 ${count} 个槽位`
      : `Latest rebuild updated ${count} slots`
  }
  if (mode === 'targeted_edit') {
    return isZh
      ? `最近定点更新 ${count} 个槽位`
      : `Latest edit updated ${count} slots`
  }
  return null
}
