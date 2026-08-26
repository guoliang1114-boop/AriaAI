import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '../../../types/api'
import type { ContextReceiptEvent } from '../../../types/productRunEvent'
import { ProjectChatMessage } from './ChatMessage'

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
})
