import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '../../../types/api'
import type { ContextReceiptEvent } from '../../../types/productRunEvent'
import { ProjectChatMessage } from './ChatMessage'
import { api } from '../../../api/client'

vi.mock('../../../api/client', () => ({
  api: { post: vi.fn() },
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

  it('turns an interrupted rollout into a safe one-click continuation', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '从中断状态安全继续' }))

    await waitFor(() => {
      expect(onTurnRecovery).toHaveBeenCalledWith('run_interrupted', 16)
    })
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
