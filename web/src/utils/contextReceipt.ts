import type { ContextMemoryLayer } from '../types/productRunEvent'

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
  const overrideLabels = layer.overridden_dimensions.map(
    (dimension) => OVERRIDE_DIMENSION_LABELS[dimension],
  )
  const overrideLabel = overrideLabels.length > 0
    ? `；本轮要求覆盖已保存的${overrideLabels.join('、')}偏好`
    : ''
  return `${MEMORY_SCOPE_LABELS[layer.scope]}${versionLabel}：${usageLabel}${freshnessLabel}${overrideLabel}`
}
