import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStream } from './useChatStream'

function successfulStream() {
  return new Response(
    'data: {"type":"text","content":"回答"}\n\n' +
      'data: {"type":"done"}\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('useChatStream Skill control', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(successfulStream())))
    localStorage.setItem('authToken', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.removeItem('authToken')
  })

  it('sends explicit and disabled Skill choices as mutually exclusive controls', async () => {
    const callbacks = {
      onUserMessage: vi.fn(),
      onAssistantMessage: vi.fn(),
      onError: vi.fn(),
    }
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      ...callbacks,
    }))

    await act(async () => result.current.send('使用专业方法分析', { skillId: 7 }))
    await act(async () => result.current.send('这次只普通回答', { disableSkill: true }))

    const requests = vi.mocked(fetch).mock.calls.map((call) => {
      const init = call[1] as RequestInit
      return JSON.parse(String(init.body)) as Record<string, unknown>
    })
    expect(requests[0]).toMatchObject({
      skill_id: 7,
      force_skill: true,
      disable_skill: false,
    })
    expect(requests[1]).toMatchObject({
      skill_id: null,
      force_skill: false,
      disable_skill: true,
    })
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('sends exact project-object references and mirrors them into the optimistic message', async () => {
    const onUserMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage: vi.fn(),
    }))
    const mentionContext = {
      file_ids: [11],
      stakeholder_ids: [12],
      milestone_ids: [13],
    }

    await act(async () => result.current.send('分析这些明确对象', { mentionContext }))

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ mention_context: mentionContext })
    expect(JSON.parse(onUserMessage.mock.calls[0][0].metadata_json)).toMatchObject({
      mention_context: mentionContext,
    })
  })

  it('sends the structured Turn Brief and mirrors it into the optimistic message', async () => {
    const onUserMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage: vi.fn(),
    }))
    const turnBrief = {
      goal: '识别三项关键风险',
      constraints: ['只分析，不修改项目内容'],
    }

    await act(async () => result.current.send('分析当前方案', { turnBrief }))

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ turn_brief: turnBrief })
    expect(JSON.parse(onUserMessage.mock.calls[0][0].metadata_json)).toMatchObject({
      turn_brief: turnBrief,
    })
  })

  it('persists revision attribution on the request and both optimistic messages', async () => {
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
    }))
    const turnRevision = {
      source_message_id: 91,
      source_fingerprint: 'turn-1a2b3c4d',
      source_role: 'assistant' as const,
      changed_fields: ['goal', 'constraints'] as const,
    }

    await act(async () => result.current.send('按修订后的目标重试', {
      turnRevision: { ...turnRevision, changed_fields: [...turnRevision.changed_fields] },
    }))

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ turn_revision: turnRevision })
    expect(JSON.parse(onUserMessage.mock.calls[0][0].metadata_json)).toMatchObject({
      turn_revision: turnRevision,
    })
    expect(JSON.parse(onAssistantMessage.mock.calls[0][0].metadata_json)).toMatchObject({
      turn_revision: turnRevision,
    })
  })

  it('sends setup attribution and the server-verified recovery contract', async () => {
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
    }))
    const turnSetupTrace = {
      outcome: 'applied' as const,
      template_id: 'risk_review',
      skill_id: 7,
    }
    const turnRecovery = {
      source_run_id: 'run_interrupted',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [1],
      side_effects_possible: true,
    }

    await act(async () => result.current.send('继续未完成部分', {
      turnSetupTrace,
      turnRecovery,
    }))

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      turn_setup_trace: turnSetupTrace,
      turn_recovery: turnRecovery,
    })
    expect(JSON.parse(onUserMessage.mock.calls[0][0].metadata_json)).toMatchObject({
      turn_setup_trace: turnSetupTrace,
      turn_recovery: turnRecovery,
    })
    expect(JSON.parse(onAssistantMessage.mock.calls[0][0].metadata_json)).toMatchObject({
      turn_recovery: turnRecovery,
    })
  })

  it('keeps the streaming React key stable while retaining the persisted message id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"text","content":"回答"}\n\n'
      + 'data: {"type":"message_persisted","message_id":52}\n\n'
      + 'data: {"type":"done","assistant_message_id":52}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage: vi.fn(),
      onAssistantMessage,
    }))

    await act(async () => result.current.send('测试稳定消息键'))

    const message = onAssistantMessage.mock.calls[0][0]
    expect(message.id).not.toBe(52)
    expect(JSON.parse(message.metadata_json)).toMatchObject({ persisted_message_id: 52 })
  })

  it('admits only one send before React has committed the busy state', async () => {
    let resolveResponse!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage: vi.fn(),
      onAssistantMessage: vi.fn(),
    }))

    let firstSend!: Promise<void>
    act(() => {
      firstSend = result.current.send('第一条')
      void result.current.send('同一帧内的重复发送')
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveResponse(successfulStream())
      await firstSend
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
