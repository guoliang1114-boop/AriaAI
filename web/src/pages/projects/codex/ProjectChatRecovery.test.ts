import { describe, expect, it } from 'vitest'
import type { TurnRecoveryPreviewV1, TurnRecoveryPreviewV2 } from '../../../types/api'
import {
  buildTurnRecoveryContent,
  buildTurnRecoveryInput,
  isTurnRecoveryPreviewConflict,
  turnRecoveryDuplicatePolicyLabel,
  turnRecoveryToastCopy,
} from './ProjectChatRecovery'

const v2Preview: TurnRecoveryPreviewV2 = {
  schema_version: 2,
  source_run_id: 'run_v2',
  source_message_id: 42,
  source_status: 'cancelled',
  strategy: 'manual_review',
  can_continue: true,
  completed_steps: [0, 1],
  side_effects_possible: true,
  completed_effect_count: 2,
  pending_effect_count: 1,
  world_state_change: {
    changed: true,
    current_version: 'world-2',
    source_version: 'world-1',
    changed_categories: ['files'],
  },
  duplicate_policy: 'block_completed_effects',
  warning_codes: ['world_state_changed'],
  contract_sha256: 'sha256-contract-v2',
  suggested_content: '核对已保存结果。',
}

describe('project chat turn recovery contract', () => {
  it('round-trips the complete v2 preview contract, including its CAS hash', () => {
    expect(buildTurnRecoveryInput(v2Preview)).toEqual({
      schema_version: 2,
      source_run_id: 'run_v2',
      source_message_id: 42,
      strategy: 'manual_review',
      completed_steps: [0, 1],
      side_effects_possible: true,
      completed_effect_count: 2,
      pending_effect_count: 1,
      world_state_change: {
        changed: true,
        current_version: 'world-2',
        source_version: 'world-1',
        changed_categories: ['files'],
      },
      duplicate_policy: 'block_completed_effects',
      warning_codes: ['world_state_changed'],
      contract_sha256: 'sha256-contract-v2',
    })
  })

  it('turns manual review into a non-executing verification turn', () => {
    const content = buildTurnRecoveryContent(v2Preview)
    const toast = turnRecoveryToastCopy(v2Preview)

    expect(content).toContain('不要执行或重放任何历史动作')
    expect(content).toContain('等待我确认下一步')
    expect(toast.title).toBe('已创建人工核对轮次')
    expect(`${toast.title}${toast.description}`).not.toContain('安全继续')
  })

  it('uses user-facing duplicate policy labels and falls back conservatively', () => {
    expect(turnRecoveryDuplicatePolicyLabel('verified_persisted_artifact_only'))
      .toBe('仅保留可验证的已持久化结果')
    expect(turnRecoveryDuplicatePolicyLabel('block_completed_effects')).toBe('跳过已完成动作')
    expect(turnRecoveryDuplicatePolicyLabel('future_policy_code')).toBe('保守核对')

    const toast = turnRecoveryToastCopy({
      ...v2Preview,
      strategy: 'replan_from_checkpoint',
    })
    expect(toast.description).toContain('跳过已完成动作')
    expect(toast.description).not.toContain('block_completed_effects')
  })

  it('marks legacy recovery as unable to verify side effects', () => {
    const preview: TurnRecoveryPreviewV1 = {
      schema_version: 1,
      source_run_id: 'run_v1',
      source_message_id: 7,
      source_status: 'failed',
      strategy: 'continue_as_new_turn',
      can_continue: true,
      completed_steps: [],
      side_effects_possible: false,
      completed_tool_call_count: 0,
      warning_codes: ['legacy_recovery_unverified'],
      suggested_content: '核对后继续。',
    }
    const content = buildTurnRecoveryContent(preview)
    const toast = turnRecoveryToastCopy(preview)

    expect(content).toContain('无法验证此前是否已经产生副作用')
    expect(content).toContain('不要直接重放任何历史动作')
    expect(`${toast.title}${toast.description}`).not.toContain('安全继续')
  })

  it('recognizes only an HTTP 409 as an expired recovery preview', () => {
    expect(isTurnRecoveryPreviewConflict({ response: { status: 409 } })).toBe(true)
    expect(isTurnRecoveryPreviewConflict({ response: { status: 400 } })).toBe(false)
    expect(isTurnRecoveryPreviewConflict(new Error('network'))).toBe(false)
  })
})
