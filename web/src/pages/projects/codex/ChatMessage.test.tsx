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
})
