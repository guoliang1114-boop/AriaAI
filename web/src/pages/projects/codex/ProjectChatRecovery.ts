import type {
  TurnRecoveryInput,
  TurnRecoveryPreview,
} from '../../../types/api'

export function buildTurnRecoveryInput(preview: TurnRecoveryPreview): TurnRecoveryInput {
  if (preview.schema_version === 2) {
    return {
      schema_version: 2,
      source_run_id: preview.source_run_id,
      source_message_id: preview.source_message_id,
      strategy: preview.strategy,
      completed_steps: preview.completed_steps,
      side_effects_possible: preview.side_effects_possible,
      completed_effect_count: preview.completed_effect_count,
      pending_effect_count: preview.pending_effect_count,
      world_state_change: preview.world_state_change,
      duplicate_policy: preview.duplicate_policy,
      warning_codes: preview.warning_codes,
      contract_sha256: preview.contract_sha256,
    }
  }
  return {
    schema_version: 1,
    source_run_id: preview.source_run_id,
    source_message_id: preview.source_message_id,
    strategy: preview.strategy,
    completed_steps: preview.completed_steps,
    side_effects_possible: preview.side_effects_possible,
  }
}

export function isTurnRecoveryPreviewConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const response = (error as { response?: unknown }).response
  if (!response || typeof response !== 'object') return false
  return (response as { status?: unknown }).status === 409
}

const TURN_RECOVERY_DUPLICATE_POLICY_LABELS: Record<string, string> = {
  verified_persisted_artifact_only: '仅保留可验证的已持久化结果',
  block_completed_effects: '跳过已完成动作',
  retry_read_only: '仅重试只读步骤',
  manual_review_required: '人工核对后处理',
}

export function turnRecoveryDuplicatePolicyLabel(policy: string): string {
  return TURN_RECOVERY_DUPLICATE_POLICY_LABELS[policy] || '保守核对'
}

export function buildTurnRecoveryContent(preview: TurnRecoveryPreview): string {
  const serverSuggestion = preview.suggested_content.trim()
  if (preview.schema_version === 1) {
    return [
      '这是旧版恢复记录，无法验证此前是否已经产生副作用。请先核对已保存结果与当前项目状态，不要直接重放任何历史动作。',
      serverSuggestion,
    ].filter(Boolean).join('\n\n')
  }
  const instruction = preview.strategy === 'replan_from_checkpoint'
    ? '请基于已保存检查点和当前项目状态重新规划；保留已完成结果，不要重复执行已完成动作。'
    : preview.strategy === 'retry_read_step'
      ? '请只核对并重试恢复契约允许的只读步骤；不要重放写入或破坏性动作。'
      : '请先人工核对已完成和待处理影响，列出差异与风险；不要执行或重放任何历史动作，等待我确认下一步。'
  return [instruction, serverSuggestion].filter(Boolean).join('\n\n')
}

export function turnRecoveryToastCopy(preview: TurnRecoveryPreview): {
  title: string
  description: string
} {
  if (preview.schema_version === 1) {
    return {
      title: '已创建核对轮次',
      description: '旧版恢复记录无法验证已发生的副作用；本轮会先核对当前状态，不会直接重放历史动作。',
    }
  }
  const effectSummary = `已完成 ${preview.completed_effect_count} 项、待处理 ${preview.pending_effect_count} 项副作用`
  const stateSummary = preview.world_state_change.changed ? '，项目状态已有变化' : '，项目状态未检测到变化'
  if (preview.strategy === 'replan_from_checkpoint') {
    return {
      title: '已创建重新规划轮次',
      description: `${effectSummary}${stateSummary}；将按“${turnRecoveryDuplicatePolicyLabel(preview.duplicate_policy)}”策略避免重复动作。`,
    }
  }
  if (preview.strategy === 'retry_read_step') {
    return {
      title: '已创建核对继续轮次',
      description: `${effectSummary}${stateSummary}；只会按恢复契约处理可重试的只读步骤。`,
    }
  }
  return {
    title: '已创建人工核对轮次',
    description: `${effectSummary}${stateSummary}；不会自动重放历史动作，请先核对后再决定。`,
  }
}
