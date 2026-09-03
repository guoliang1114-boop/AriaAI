import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, TurnRecoveryPreviewV1, TurnRecoveryPreviewV2 } from '../../../types/api'
import type { ContextReceiptEvent } from '../../../types/productRunEvent'
import { ProjectChatMessage } from './ChatMessage'
import { api } from '../../../api/client'

vi.mock('../../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))

const ambiguousReceipt: ContextReceiptEvent = {
  type: 'context_receipt',
  schema_version: 1,
  run_id: 'run-1',
  scope: 'project',
  memory: {
    status: 'ready',
    version: 3,
    raw_context_available: true,
    retrieval_mode: 'focused',
    query_facets: ['risk'],
    selected_slots: ['key_risks'],
    selected_slot_count: 1,
    available_slot_count: 4,
    omitted_slot_count: 3,
    selected_item_count: 2,
    truncated: false,
  },
  skill: {
    status: 'ambiguous',
    usage_mode: 'none',
    reason: 'auto_skill_ambiguous_advisory_match',
    confidence: 0.94,
    candidates: [
      { id: '7', name: '舞弊风险评估', score: 94 },
      { id: '8', name: '合规调查', score: 93 },
    ],
  },
  evidence: {
    workspace_context: true,
    attached_file_count: 0,
    knowledge_reference_count: 0,
    history_message_count: 4,
    conversation_capsule: true,
    user_preferences: false,
    compacted: false,
  },
  warnings: ['skill_match_ambiguous'],
}

describe('ProjectChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a verified generated artifact actionable without project_file_id', () => {
    const onArtifactClick = vi.fn()
    const recoveredArtifact = {
      id: 42,
      name: '已核验的旧报告.pdf',
      file_type: 'pdf',
      path: 'generated/verified-report.pdf',
      recovery_verified: true,
      recovered_from_run_id: 'run-source',
    }
    const message: Message = {
      id: 20,
      conversation_id: 4,
      role: 'assistant',
      content: '已复用原任务产出。',
      metadata_json: JSON.stringify({ artifacts: [recoveredArtifact] }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onArtifactClick={onArtifactClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /已核验的旧报告\.pdf.*下载/ }))

    expect(onArtifactClick).toHaveBeenCalledWith(recoveredArtifact)
  })

  it('turns persisted ambiguous Skill candidates into next-turn actions', () => {
    const onSkillSelect = vi.fn()
    const message: Message = {
      id: 12,
      conversation_id: 4,
      role: 'assistant',
      content: '需要先确认使用哪一种专业方法。',
      metadata_json: JSON.stringify({ context_receipt: ambiguousReceipt }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onSkillSelect={onSkillSelect}
      />,
    )
    fireEvent.click(screen.getByText(/Skill 待选择/))
    fireEvent.click(screen.getByRole('button', { name: '下一轮使用 舞弊风险评估' }))

    expect(onSkillSelect).toHaveBeenCalledWith(7, '舞弊风险评估')
  })

  it('shows layered memory routing and current-turn preference overrides', () => {
    const layeredReceipt: ContextReceiptEvent = {
      ...ambiguousReceipt,
      memory: {
        ...ambiguousReceipt.memory,
        layers: [
          {
            scope: 'user',
            status: 'ready',
            version: 2,
            retrieval_mode: 'focused',
            query_facets: [],
            selected_slots: ['response_preferences.tone'],
            selected_slot_count: 1,
            available_slot_count: 3,
            omitted_slot_count: 2,
            selected_item_count: 1,
            truncated: false,
            overridden_dimensions: ['language', 'verbosity'],
          },
          {
            scope: 'client',
            status: 'stale',
            version: 5,
            retrieval_mode: 'focused',
            query_facets: ['relationship'],
            selected_slots: ['relationship_signals'],
            selected_slot_count: 1,
            available_slot_count: 4,
            omitted_slot_count: 3,
            selected_item_count: 2,
            truncated: false,
            overridden_dimensions: [],
          },
        ],
      },
      warnings: ['user_preference_overridden', 'client_memory_stale'],
    }
    const message: Message = {
      id: 19,
      conversation_id: 4,
      role: 'assistant',
      content: '已按本轮要求回答。',
      metadata_json: JSON.stringify({ context_receipt: layeredReceipt }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(<ProjectChatMessage message={message} projectId={3} />)
    fireEvent.click(screen.getByText(/本轮依据/))

    expect(screen.getByText(/个人偏好 v2：使用 1 项/)).toBeInTheDocument()
    expect(screen.getByText(/覆盖已保存的语言、详略偏好/)).toBeInTheDocument()
    expect(screen.getByText(/客户记忆 v5：使用 2 项.*待刷新/)).toBeInTheDocument()
  })

  it('distinguishes loaded, retained, summarized, and truncated conversation history', () => {
    const receipt: ContextReceiptEvent = {
      ...ambiguousReceipt,
      evidence: {
        ...ambiguousReceipt.evidence,
        history_message_count: 42,
        history_retained_message_count: 6,
        history_summarized_message_count: 36,
        history_truncated_message_count: 1,
        compacted: true,
      },
    }
    const message: Message = {
      id: 31,
      conversation_id: 4,
      role: 'assistant',
      content: '已基于保留上下文回答。',
      metadata_json: JSON.stringify({ context_receipt: receipt }),
      created_at: '2026-09-03T00:00:00Z',
    }

    render(<ProjectChatMessage message={message} projectId={3} />)
    fireEvent.click(screen.getByText(/本轮依据/))

    expect(screen.getByText(/近期对话保留 6\/42 条/)).toBeInTheDocument()
    expect(screen.getByText(/较早 36 条已生成有界摘要/)).toBeInTheDocument()
    expect(screen.getByText(/近期 1 条有截短/)).toBeInTheDocument()
  })

  it('shows the exact Skill release, loaded resources, tool boundary, and verification receipt', () => {
    const receipt: ContextReceiptEvent = {
      ...ambiguousReceipt,
      skill: {
        status: 'applied',
        usage_mode: 'workflow',
        id: '7',
        name: '咨询提案',
        source: 'explicit',
        reason: 'forced_by_user',
        confidence: 1,
        runtime: {
          schema_version: 1,
          load_status: 'loaded',
          package_kind: 'bundled',
          release_id: '17',
          version: '2.1.0',
          release_status: 'stable',
          release_sha256: 'abcdef12'.padEnd(64, '0'),
          instruction_loaded: true,
          instruction_complete: true,
          progressive_loading: true,
          resource_count: 2,
          resource_names: [
            'references/proposal-structure.md',
            'references/quality-checklist.md',
          ],
          script_resource_count: 0,
          scripts_executable: false,
          tool_contract_valid: true,
          declared_tool_count: 2,
          granted_tool_count: 1,
          policy_filtered_tool_count: 1,
          verification_status: 'available',
          verification_step_count: 8,
          verification_source_count: 1,
          verification_context_complete: true,
        },
      },
      warnings: [],
    }
    const message: Message = {
      id: 21,
      conversation_id: 4,
      role: 'assistant',
      content: '提案已经完成。',
      metadata_json: JSON.stringify({ context_receipt: receipt }),
      created_at: '2026-09-03T00:00:00Z',
    }

    render(<ProjectChatMessage message={message} projectId={3} />)
    fireEvent.click(screen.getByText(/工作流：咨询提案/))

    expect(screen.getByLabelText('Skill 本轮加载回执')).toHaveTextContent('Skill 发布 v2.1.0 · 稳定版 · abcdef12')
    expect(screen.getByLabelText('Skill 本轮加载回执')).toHaveTextContent('本轮按需加载 1 份指令 + 2 项资源')
    expect(screen.getByLabelText('Skill 本轮加载回执')).toHaveTextContent('Skill 工具 1/2 可用')
    expect(screen.getByLabelText('Skill 本轮加载回执')).toHaveTextContent('完成校验已声明 · 8 项检查')
    expect(screen.getByLabelText('Skill 本轮加载回执')).toHaveTextContent('包内脚本不会自动执行')
  })

  it('shows a persisted user Brief and restores its exact turn controls', () => {
    const onTurnBriefReuse = vi.fn()
    const message: Message = {
      id: 13,
      conversation_id: 4,
      role: 'user',
      content: '分析 @「访谈纪要.docx」',
      metadata_json: JSON.stringify({
        turn_brief: { goal: '识别关键风险', constraints: ['只分析'] },
        mention_context: { file_ids: [11] },
        skill_id: 7,
      }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onTurnBriefReuse={onTurnBriefReuse}
      />,
    )
    fireEvent.click(screen.getByText(/本轮 Brief/))
    fireEvent.click(screen.getByRole('button', { name: '复用此历史 Brief' }))

    expect(onTurnBriefReuse).toHaveBeenCalledWith(expect.objectContaining({
      content: message.content,
      draft: { goal: '识别关键风险', constraintsText: '只分析' },
      mentionContext: { file_ids: [11], stakeholder_ids: [], milestone_ids: [] },
      skillId: 7,
      sourceMessageId: 13,
      sourceRole: 'user',
      sourceFingerprint: expect.stringMatching(/^turn-[a-f0-9]{8}$/),
    }))
  })

  it('turns an assistant Turn Contract into a visible revise-and-retry action', () => {
    const onTurnBriefReuse = vi.fn()
    const message: Message = {
      id: 14,
      conversation_id: 4,
      role: 'assistant',
      content: '这里是分析结论。',
      metadata_json: JSON.stringify({
        turn_contract: {
          user_goal: '评估报告结构',
          user_constraints: ['只分析，不修改项目内容'],
          mode: 'plan_only',
          write_allowed: false,
        },
      }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onTurnBriefReuse={onTurnBriefReuse}
      />,
    )
    fireEvent.click(screen.getByText(/本轮执行契约/))
    fireEvent.click(screen.getByRole('button', { name: '基于此执行契约修订并重试' }))

    expect(onTurnBriefReuse).toHaveBeenCalledWith(expect.objectContaining({
      content: '评估报告结构',
      draft: {
        goal: '评估报告结构',
        constraintsText: '只分析，不修改项目内容',
      },
      mentionContext: undefined,
      skillId: undefined,
      sourceMessageId: 14,
      sourceRole: 'assistant',
      sourceFingerprint: expect.stringMatching(/^turn-[a-f0-9]{8}$/),
    }))
  })

  it('renders persisted revision attribution and can locate its source', () => {
    const onTurnRevisionSourceOpen = vi.fn()
    const message: Message = {
      id: 15,
      conversation_id: 4,
      role: 'assistant',
      content: '修订后的分析。',
      metadata_json: JSON.stringify({
        turn_revision: {
          source_message_id: 14,
          source_fingerprint: 'turn-1a2b3c4d',
          source_role: 'assistant',
          changed_fields: ['goal', 'constraints'],
        },
      }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onTurnRevisionSourceOpen={onTurnRevisionSourceOpen}
      />,
    )
    expect(screen.getByLabelText('本轮修订效果归因')).toHaveTextContent('已调整 目标 / 约束')
    fireEvent.click(screen.getByRole('button', { name: '定位修订来源消息' }))
    expect(onTurnRevisionSourceOpen).toHaveBeenCalledWith(14, 'turn-1a2b3c4d')
  })

  it('loads and displays a v2 recovery preview before requiring a second confirmation', async () => {
    const preview: TurnRecoveryPreviewV2 = {
      schema_version: 2,
      source_run_id: 'run_interrupted',
      source_message_id: 16,
      source_status: 'cancelled',
      strategy: 'manual_review',
      can_continue: true,
      completed_steps: [0, 1],
      side_effects_possible: true,
      completed_effect_count: 2,
      pending_effect_count: 1,
      world_state_change: { changed: true, changed_categories: ['files'] },
      duplicate_policy: 'block_completed_effects',
      warning_codes: ['world_state_changed', 'completed_effects_present'],
      contract_sha256: 'sha256-current-preview',
      suggested_content: '核对中断轮次。',
    }
    vi.mocked(api.get).mockResolvedValueOnce(preview)
    const onTurnRecovery = vi.fn().mockResolvedValue(undefined)
    const message: Message = {
      id: 16,
      conversation_id: 4,
      role: 'assistant',
      content: '本轮在第二步中断。',
      metadata_json: JSON.stringify({
        turn_interrupted: { reason: 'user_interrupted' },
        run_rollout: { run_id: 'run_interrupted', status: 'cancelled' },
      }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onTurnRecovery={onTurnRecovery}
      />,
    )

    expect(api.get).not.toHaveBeenCalled()
    expect(onTurnRecovery).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '核对恢复状态' }))

    expect(await screen.findByText('已完成副作用 · 2')).toBeInTheDocument()
    expect(screen.getByText(/待处理副作用 · 1/)).toBeInTheDocument()
    expect(screen.getByText(/项目状态 · 已变化/)).toBeInTheDocument()
    expect(screen.getByText(/重复动作策略 · 跳过已完成动作/)).toBeInTheDocument()
    expect(screen.queryByText(/block_completed_effects/)).not.toBeInTheDocument()
    expect(screen.getByText('项目状态已经变化')).toBeInTheDocument()
    expect(onTurnRecovery).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '核对并继续' }))

    await waitFor(() => {
      expect(onTurnRecovery).toHaveBeenCalledWith(preview)
    })
    expect(api.get).toHaveBeenCalledWith('/chat/conversations/4/recovery-preview', {
      params: { run_id: 'run_interrupted', message_id: 16 },
    })
    expect(screen.queryByText(/安全继续/)).not.toBeInTheDocument()
  })

  it('labels v1 recovery as unverifiable and never describes it as safe', async () => {
    const preview: TurnRecoveryPreviewV1 = {
      schema_version: 1,
      source_run_id: 'run_legacy',
      source_message_id: 16,
      source_status: 'failed',
      strategy: 'continue_as_new_turn',
      can_continue: true,
      completed_steps: [0],
      side_effects_possible: false,
      completed_tool_call_count: 1,
      warning_codes: ['legacy_recovery_unverified'],
      suggested_content: '继续处理。',
    }
    vi.mocked(api.get).mockResolvedValueOnce(preview)
    const onTurnRecovery = vi.fn().mockResolvedValue(undefined)
    const message: Message = {
      id: 16,
      conversation_id: 4,
      role: 'assistant',
      content: '旧版中断轮次。',
      metadata_json: JSON.stringify({
        turn_interrupted: { reason: 'failed' },
        run_rollout: { run_id: 'run_legacy', status: 'failed' },
      }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onTurnRecovery={onTurnRecovery}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '核对恢复状态' }))

    expect(await screen.findByText(/旧版恢复记录无法验证已发生的副作用/)).toBeInTheDocument()
    expect(screen.queryByText(/安全继续/)).not.toBeInTheDocument()
    expect(onTurnRecovery).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '核对并继续' }))
    await waitFor(() => expect(onTurnRecovery).toHaveBeenCalledWith(preview))
  })

  it('reloads the preview after a stale confirmation contract without resubmitting', async () => {
    const original: TurnRecoveryPreviewV2 = {
      schema_version: 2,
      source_run_id: 'run_stale',
      source_message_id: 16,
      source_status: 'cancelled',
      strategy: 'replan_from_checkpoint',
      can_continue: true,
      completed_steps: [0],
      side_effects_possible: true,
      completed_effect_count: 1,
      pending_effect_count: 1,
      world_state_change: { changed: false },
      duplicate_policy: 'block_completed_effects',
      warning_codes: [],
      contract_sha256: 'sha256-stale',
      suggested_content: '重新规划。',
    }
    const refreshed: TurnRecoveryPreviewV2 = {
      ...original,
      pending_effect_count: 3,
      world_state_change: { changed: true, changed_categories: ['milestones'] },
      warning_codes: ['world_state_changed'],
      contract_sha256: 'sha256-refreshed',
    }
    vi.mocked(api.get)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(refreshed)
    const onTurnRecovery = vi.fn().mockRejectedValueOnce({ response: { status: 409 } })
    const message: Message = {
      id: 16,
      conversation_id: 4,
      role: 'assistant',
      content: '状态可能已经变化。',
      metadata_json: JSON.stringify({
        turn_interrupted: { reason: 'user_interrupted' },
        run_rollout: { run_id: 'run_stale', status: 'cancelled' },
      }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(
      <ProjectChatMessage
        message={message}
        projectId={3}
        onTurnRecovery={onTurnRecovery}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '核对恢复状态' }))
    await screen.findByText(/待处理副作用 · 1/)
    fireEvent.click(screen.getByRole('button', { name: '重新规划' }))

    expect(await screen.findByText('状态已变化，请重新核对')).toBeInTheDocument()
    expect(await screen.findByText(/待处理副作用 · 3/)).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(onTurnRecovery).toHaveBeenCalledTimes(1)
  })

  it('stores categorical feedback without a free-text field', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        feedback: {
          schema_version: 1,
          rating: 'unhelpful',
          reasons: [],
          updated_at: '2026-08-25T00:00:00Z',
        },
      })
      .mockResolvedValueOnce({
        feedback: {
          schema_version: 1,
          rating: 'unhelpful',
          reasons: ['missing_context'],
          updated_at: '2026-08-25T00:00:01Z',
        },
      })
    const message: Message = {
      id: 17,
      conversation_id: 4,
      role: 'assistant',
      content: '分析结果。',
      metadata_json: '{}',
      created_at: '2026-08-25T00:00:00Z',
    }

    render(<ProjectChatMessage message={message} projectId={3} />)
    fireEvent.click(screen.getByRole('button', { name: '没帮助' }))
    await screen.findByLabelText('没帮助的原因')
    fireEvent.click(screen.getByRole('button', { name: '缺少上下文' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenLastCalledWith('/chat/messages/17/feedback', {
        rating: 'unhelpful',
        reasons: ['missing_context'],
      })
    })
    const [, body] = vi.mocked(api.post).mock.calls.at(-1) || []
    expect(body).not.toHaveProperty('content')
    expect(body).not.toHaveProperty('comment')
  })

  it('renders the same persisted Product Run timeline after refresh', () => {
    const message: Message = {
      id: 18,
      conversation_id: 4,
      role: 'assistant',
      content: '已完成风险分析。',
      metadata_json: JSON.stringify({
        activity_timeline: {
          run_id: 'run_timeline',
          display_mode: 'skill',
          skill: { name: '审计计划与风险评估', source: 'auto' },
          steps: [{
            index: 1,
            title: '读取项目文档',
            status: 'completed',
            duration_ms: 320,
            items: [{ tool_name: '读取项目 Markdown 文档', status: 'completed' }],
          }],
          artifacts: [],
          memory_candidates: [],
          steering: [],
          final_status: 'completed',
          text: '已完成风险分析。',
        },
      }),
      created_at: '2026-08-25T00:00:00Z',
    }

    render(<ProjectChatMessage message={message} projectId={3} />)

    expect(screen.getByLabelText('Aria 运行时间线')).toHaveTextContent('Skill · 审计计划与风险评估')
    fireEvent.click(screen.getByRole('button', { name: /Skill · 审计计划与风险评估/ }))
    expect(screen.getByText('读取项目文档')).toBeInTheDocument()
    expect(screen.getByText('读取项目 Markdown 文档')).toBeInTheDocument()
  })
})
