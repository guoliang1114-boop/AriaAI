import type { ContextReceiptEvent } from '../types/productRunEvent'

/** Surface limitations, not routine retrieval telemetry. Full receipts stay in details. */
export function AnswerContextNotice({ receipt }: { receipt: ContextReceiptEvent | null }) {
  if (!receipt) return null
  const notices = [
    receipt.memory.status === 'missing' ? '项目记忆尚未生成，已使用项目原始信息' : '',
    receipt.memory.status === 'stale' ? '项目记忆待刷新，已优先使用当前项目信息' : '',
    receipt.skill.status === 'ambiguous' ? '技能待选择，本轮未额外启用技能' : '',
    receipt.skill.runtime && ['degraded', 'compacted'].includes(receipt.skill.runtime.load_status)
      ? '技能上下文未完整加载，请核对回答详情' : '',
    receipt.evidence.knowledge_source_scoped_unavailable ? '知识检索暂不可用，请核对回答依据'
      : receipt.evidence.knowledge_legacy_fallback ? '本轮使用兼容知识来源' : '',
    (receipt.memory.layers || []).some(layer => layer.scope === 'client' && layer.status === 'stale')
      ? '客户记忆待刷新' : '',
    // Scope-level provenance is not the same as an unresolved fact. Its
    // trace counts stay in diagnostics rather than warning on every answer.
    (receipt.memory.unresolved_fact_count || 0) > 0 || (receipt.memory.layers || []).some(layer => (layer.unresolved_fact_count || 0) > 0)
      ? '部分记忆尚待核实' : '',
    receipt.warnings.includes('skill_tool_contract_invalid') ? '技能工具不可用，请检查技能配置' : '',
    receipt.warnings.includes('skill_instructions_missing') ? '技能指令未加载，本轮能力可能受限' : '',
    receipt.warnings.includes('memory_retrieval_truncated') || receipt.warnings.includes('project_world_state_truncated')
      ? '部分项目信息未完整加载，请核对回答依据' : '',
  ].filter(Boolean)
  if (!notices.length) return null
  return <p role="status" style={{ marginTop: 8, fontSize: 12, color: 'var(--color-codex-warn)' }}>
    {notices.join(' · ')}
  </p>
}
