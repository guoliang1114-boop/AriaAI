import type { ContextMemoryLayer, ContextReceiptEvent } from '../types/productRunEvent'

const MEMORY_SCOPE_LABELS: Record<ContextMemoryLayer['scope'], string> = {
  user: '个人偏好',
  client: '客户记忆',
  project: '项目记忆',
}

const OVERRIDE_DIMENSION_LABELS: Record<
  ContextMemoryLayer['overridden_dimensions'][number],
  string
> = {
  language: '语言',
  tone: '语气',
  format: '格式',
  verbosity: '详略',
}

export function contextMemoryLayerLabel(layer: ContextMemoryLayer): string {
  const versionLabel = layer.version > 0 ? ` v${layer.version}` : ''
  const usageLabel = layer.selected_item_count > 0
    ? `使用 ${layer.selected_item_count} 项 / ${layer.selected_slot_count} 个槽位`
    : layer.status === 'missing'
      ? '未设置或未生成'
      : '本轮未调用'
  const freshnessLabel = layer.status === 'stale' ? '（待刷新）' : ''
  const staleSlotCount = layer.stale_slot_count ?? layer.stale_slots?.length ?? 0
  const slotFreshnessLabel = staleSlotCount > 0
    ? `；其中 ${staleSlotCount} 个已用槽位待刷新`
    : ''
  const evidenceLabel = (layer.evidence_ref_count ?? 0) > 0
    ? `；${layer.evidence_ref_count} 个来源引用`
    : ''
  const factTraceCount = (layer.direct_fact_count ?? 0)
    + (layer.matched_fact_count ?? 0)
    + (layer.scoped_fact_count ?? 0)
    + (layer.unresolved_fact_count ?? 0)
  const factTraceLabel = factTraceCount > 0
    ? layer.direct_fact_count == null
      ? `；事实溯源 ${layer.matched_fact_count ?? 0} 条匹配 / ${layer.scoped_fact_count ?? 0} 条范围来源 / ${layer.unresolved_fact_count ?? 0} 条待补证`
      : `；事实溯源 ${layer.direct_fact_count} 条来源直连 / ${layer.matched_fact_count ?? 0} 条标签匹配 / ${layer.scoped_fact_count ?? 0} 条范围来源 / ${layer.unresolved_fact_count ?? 0} 条待补证`
    : ''
  const overrideLabels = layer.overridden_dimensions.map(
    (dimension) => OVERRIDE_DIMENSION_LABELS[dimension],
  )
  const overrideLabel = overrideLabels.length > 0
    ? `；本轮要求覆盖已保存的${overrideLabels.join('、')}偏好`
    : ''
  return `${MEMORY_SCOPE_LABELS[layer.scope]}${versionLabel}：${usageLabel}${freshnessLabel}${slotFreshnessLabel}${evidenceLabel}${factTraceLabel}${overrideLabel}`
}

export function contextHistoryEvidenceLabel(
  evidence: ContextReceiptEvent['evidence'],
): string {
  const loaded = evidence.history_message_count
  if (loaded <= 0) return ''
  const retained = evidence.history_retained_message_count ?? loaded
  const summarized = evidence.history_summarized_message_count ?? 0
  const truncated = evidence.history_truncated_message_count ?? 0
  const parts = [
    retained === loaded && summarized === 0
      ? `${retained} 条近期对话`
      : `近期对话保留 ${retained}/${loaded} 条`,
  ]
  if (summarized > 0) parts.push(`较早 ${summarized} 条已生成有界摘要`)
  if (truncated > 0) parts.push(`近期 ${truncated} 条有截短`)
  return parts.join(' · ')
}
