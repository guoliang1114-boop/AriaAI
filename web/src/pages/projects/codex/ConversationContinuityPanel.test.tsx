import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import type { ConversationContinuitySnapshot } from '../../../types/api'
import { ConversationContinuityPanel } from './ConversationContinuityPanel'

vi.mock('../../../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

const readySnapshot: ConversationContinuitySnapshot = {
  schema_version: 2,
  conversation_id: 12,
  project_id: 9,
  status: 'ready',
  reason_code: '',
  state: {
    capsule_message_id: 42,
    updated_at: '2026-08-31T08:00:00',
    active_goal: '完成风险方案',
    next_goal: '完成风险方案',
    turn_mode: 'plan_only',
    confirmed_constraints: ['只分析，不执行'],
    decisions: ['采用分阶段交付'],
    blockers: [{ kind: 'tool_failure', tool_name: 'read_project_file', summary: '风险文件暂不可读' }],
    active_artifact: { project_file_id: 18, name: '风险清单.md' },
    active_task: null,
    source_message_ids: [40],
    capsule_sha256: 'a'.repeat(64),
  },
  project_questions: {
    status: 'stale',
    memory_version: 3,
    slot_version: 2,
    stale: true,
    items: ['客户是否确认范围？'],
    resolved: [],
  },
  privacy: {
    includes_bounded_conversation_state: true,
    includes_bound_answer_message_content: false,
    includes_prompt_content: false,
    includes_tool_inputs: false,
    includes_hidden_reasoning: false,
  },
}

describe('ConversationContinuityPanel', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
  })

  it('shows validated state and only prepares user-reviewed next-turn drafts', async () => {
    vi.mocked(api.get).mockResolvedValue(readySnapshot)
    const onPrepare = vi.fn()
    const onLocateMessage = vi.fn()
    render(
      <ConversationContinuityPanel
        conversationId={12}
        refreshKey={4}
        latestAssistantMessage={{ id: 42, content: '已经确认交付范围。' }}
        onPrepare={onPrepare}
        onLocateMessage={onLocateMessage}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '查看当前协作状态' }))

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/chat/conversations/12/continuity'))
    expect(await screen.findByText('完成风险方案')).toBeInTheDocument()
    expect(screen.getByText('只分析，不执行')).toBeInTheDocument()
    expect(screen.getByText('采用分阶段交付')).toBeInTheDocument()
    expect(screen.getByText('当前产物：风险清单.md')).toBeInTheDocument()
    expect(screen.getByText('风险文件暂不可读')).toBeInTheDocument()
    expect(screen.getByText('客户是否确认范围？')).toBeInTheDocument()
    expect(screen.getByText('记忆 v3 待刷新')).toBeInTheDocument()
    expect(screen.getByText(/不包含回答正文、提示词、工具输入或隐藏推理/)).toBeInTheDocument()
    expect(screen.queryByText('must-not-leak')).not.toBeInTheDocument()

    const blocker = screen.getByText('风险文件暂不可读').parentElement
    expect(blocker).not.toBeNull()
    await userEvent.click(within(blocker as HTMLElement).getByRole('button', { name: '加入输入框' }))
    expect(onPrepare).toHaveBeenCalledWith('请先处理当前阻塞：风险文件暂不可读')
    expect(onPrepare).toHaveBeenCalledTimes(1)
  })

  it('locates the capsule message and prepares project questions without sending', async () => {
    vi.mocked(api.get).mockResolvedValue(readySnapshot)
    const onPrepare = vi.fn()
    const onLocateMessage = vi.fn()
    render(
      <ConversationContinuityPanel
        conversationId={12}
        refreshKey={4}
        latestAssistantMessage={{ id: 42, content: '已经确认交付范围。' }}
        onPrepare={onPrepare}
        onLocateMessage={onLocateMessage}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '查看当前协作状态' }))
    await screen.findByText('完成风险方案')

    await userEvent.click(screen.getByRole('button', { name: '查看来源消息' }))
    expect(onLocateMessage).toHaveBeenCalledWith(42)
    expect(onPrepare).not.toHaveBeenCalled()

    const question = screen.getByText('客户是否确认范围？').parentElement
    expect(question).not.toBeNull()
    await userEvent.click(within(question as HTMLElement).getByRole('button', { name: '加入输入框' }))
    expect(onPrepare).toHaveBeenCalledWith(
      '请基于当前项目事实回答并推进这个待确认问题：客户是否确认范围？',
    )
  })

  it('fails closed for an invalid capsule while keeping independent project questions', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...readySnapshot,
      status: 'invalid',
      reason_code: 'capsule_fingerprint_mismatch',
      state: null,
    })
    render(
      <ConversationContinuityPanel
        conversationId={12}
        refreshKey={4}
        latestAssistantMessage={{ id: 42, content: '已经确认交付范围。' }}
        onPrepare={vi.fn()}
        onLocateMessage={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '查看当前协作状态' }))

    expect(await screen.findByText(/连续性状态校验失败/)).toBeInTheDocument()
    expect(screen.queryByText('完成风险方案')).not.toBeInTheDocument()
    expect(screen.getByText('客户是否确认范围？')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看来源消息' })).not.toBeInTheDocument()
  })

  it('disables draft actions while another turn is running', async () => {
    vi.mocked(api.get).mockResolvedValue(readySnapshot)
    render(
      <ConversationContinuityPanel
        conversationId={12}
        refreshKey={4}
        disabled
        latestAssistantMessage={{ id: 42, content: '已经确认交付范围。' }}
        onPrepare={vi.fn()}
        onLocateMessage={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '查看当前协作状态' }))
    await screen.findByText('完成风险方案')

    const draftButtons = screen.getAllByRole('button', { name: '加入输入框' })
    expect(draftButtons.length).toBeGreaterThan(0)
    draftButtons.forEach((button) => expect(button).toBeDisabled())
    expect(screen.getByText(/当前轮次结束后可将下一步加入输入框/)).toBeInTheDocument()
  })

  it('requires explicit confirmation to resolve and reopen a project question', async () => {
    const writableSnapshot: ConversationContinuitySnapshot = {
      ...readySnapshot,
      project_questions: {
        ...readySnapshot.project_questions,
        status: 'ready',
        stale: false,
      },
    }
    const resolvedSnapshot: ConversationContinuitySnapshot = {
      ...writableSnapshot,
      project_questions: {
        ...writableSnapshot.project_questions,
        memory_version: 4,
        slot_version: 3,
        items: [],
        resolved: [{
          id: 71,
          question: '客户是否确认范围？',
          status: 'resolved',
          review_reason: '',
          resolution_summary: '客户已书面确认范围。',
          answer_message_id: 42,
          answer_conversation_id: 12,
          answer_available: true,
          resolution_revision: 1,
          resolved_memory_version: 4,
          resolved_slot_version: 3,
          resolved_at: '2026-08-31T09:00:00',
        }],
      },
    }
    const reopenedSnapshot: ConversationContinuitySnapshot = {
      ...resolvedSnapshot,
      project_questions: {
        ...resolvedSnapshot.project_questions,
        memory_version: 5,
        slot_version: 4,
        items: ['客户是否确认范围？'],
        resolved: [],
      },
    }
    vi.mocked(api.get).mockResolvedValue(writableSnapshot)
    vi.mocked(api.post)
      .mockResolvedValueOnce(resolvedSnapshot)
      .mockResolvedValueOnce(reopenedSnapshot)
    render(
      <ConversationContinuityPanel
        conversationId={12}
        refreshKey={4}
        latestAssistantMessage={{ id: 42, content: '客户已书面确认范围。' }}
        onPrepare={vi.fn()}
        onLocateMessage={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '查看当前协作状态' }))
    await screen.findByText('客户是否确认范围？')

    await userEvent.click(screen.getByRole('button', { name: '标记已解决' }))
    expect(screen.getByText(/将绑定最近回答 #42/)).toBeInTheDocument()
    const confirmResolution = screen.getByRole('button', { name: '确认解决' })
    expect(confirmResolution).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: '解决摘要' }), '客户已书面确认范围。')
    await userEvent.click(confirmResolution)

    await waitFor(() => expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/chat/conversations/12/continuity/questions/resolve',
      {
        question: '客户是否确认范围？',
        answer_message_id: 42,
        resolution_summary: '客户已书面确认范围。',
        expected_memory_version: 3,
        expected_slot_version: 2,
      },
    ))
    expect(await screen.findByText('最近已解决问题')).toBeInTheDocument()
    expect(screen.getByText('结论：客户已书面确认范围。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '重新打开' }))
    const confirmReopen = screen.getByRole('button', { name: '确认重新打开' })
    expect(confirmReopen).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: '重新打开原因' }), '客户新增范围例外。')
    await userEvent.click(confirmReopen)

    await waitFor(() => expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/chat/conversations/12/continuity/questions/71/reopen',
      {
        reason: '客户新增范围例外。',
        expected_resolution_revision: 1,
        expected_memory_version: 4,
        expected_slot_version: 3,
      },
    ))
    expect(screen.queryByText('最近已解决问题')).not.toBeInTheDocument()
    expect(screen.getByText('客户是否确认范围？')).toBeInTheDocument()
  })
})
