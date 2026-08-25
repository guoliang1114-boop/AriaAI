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
