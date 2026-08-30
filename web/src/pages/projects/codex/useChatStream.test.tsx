import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStream } from './useChatStream'

function successfulStream() {
  return new Response(
    'data: {"type":"run_started","run_id":"run_success","timestamp":"2026-08-30T00:00:00Z"}\n\n' +
      'data: {"type":"text","content":"回答"}\n\n' +
      'data: {"type":"done"}\n\n' +
      'data: {"type":"run_done","run_id":"run_success","final_status":"completed"}\n\n',
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

  it('rejects a stale recovery preview without ghost messages or a retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ detail: 'recovery preview is stale' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    ))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
      onError,
    }))
    const turnRecovery = {
      schema_version: 2 as const,
      source_run_id: 'run_stale',
      source_message_id: 91,
      strategy: 'replan_from_checkpoint' as const,
      completed_steps: [1],
      side_effects_possible: true,
      completed_effect_count: 1,
      pending_effect_count: 2,
      world_state_change: { changed: true },
      duplicate_policy: 'block_completed_effects',
      warning_codes: ['world_state_changed'],
      contract_sha256: 'sha256-stale-preview',
    }

    await act(async () => {
      await expect(result.current.send('重新规划未完成部分', { turnRecovery }))
        .rejects.toMatchObject({
          name: 'TurnRecoveryPreviewConflictError',
          response: { status: 409 },
        })
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onUserMessage).not.toHaveBeenCalled()
    expect(onAssistantMessage).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.streamingContent).toBe('')
    expect(result.current.streamingMessageId).toBe(0)
  })

  it('rejects a failed recovery request instead of reporting false success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ detail: 'recovery reservation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    ))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
      onError,
    }))
    const turnRecovery = {
      schema_version: 2 as const,
      source_run_id: 'run_failed_reservation',
      source_message_id: 91,
      strategy: 'manual_review' as const,
      completed_steps: [],
      side_effects_possible: true,
      completed_effect_count: 0,
      pending_effect_count: 1,
      world_state_change: { changed: false },
      duplicate_policy: 'manual_review_required',
      warning_codes: ['manual_review_required'],
      contract_sha256: 'a'.repeat(64),
    }

    await act(async () => {
      await expect(result.current.send('核对恢复状态', { turnRecovery }))
        .rejects.toThrow('服务异常 (500)')
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onUserMessage).not.toHaveBeenCalled()
    expect(onAssistantMessage).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.streamingMessageId).toBe(0)
  })

  it('rejects a recovery network failure without an optimistic message', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network unavailable'))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
      onError,
    }))
    const turnRecovery = {
      source_run_id: 'run_network_failure',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    await act(async () => {
      await expect(result.current.send('核对恢复状态', { turnRecovery }))
        .rejects.toThrow('network unavailable')
    })

    expect(onUserMessage).not.toHaveBeenCalled()
    expect(onAssistantMessage).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.streamingMessageId).toBe(0)
  })

  it('rejects a recovery stream error instead of resolving into a success toast', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"error","message":"recovery run failed"}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
      onError,
    }))
    const turnRecovery = {
      source_run_id: 'run_stream_failure',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    await act(async () => {
      await expect(result.current.send('恢复中断轮次', { turnRecovery }))
        .rejects.toThrow('recovery run failed')
    })

    expect(onUserMessage).not.toHaveBeenCalled()
    expect(onAssistantMessage).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not publish a recovery user bubble when reserved-run activation fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"run_failed","run_id":"run_activation_failed","error_code":"POLICY_REJECTED","error_message":"恢复预留无法启动","retryable":false}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
    }))
    const turnRecovery = {
      schema_version: 2 as const,
      source_run_id: 'run_source',
      source_message_id: 91,
      strategy: 'manual_review' as const,
      completed_steps: [],
      side_effects_possible: true,
      completed_effect_count: 0,
      pending_effect_count: 1,
      world_state_change: { changed: false },
      duplicate_policy: 'manual_review_required',
      warning_codes: ['manual_review_required'],
      contract_sha256: 'c'.repeat(64),
    }

    await act(async () => {
      await expect(result.current.send('继续恢复', { turnRecovery }))
        .rejects.toThrow('恢复预留无法启动')
    })

    expect(onUserMessage).not.toHaveBeenCalled()
    expect(onAssistantMessage).not.toHaveBeenCalled()
  })

  it('rejects a recovery stopped before the server activates its reserved run', async () => {
    vi.mocked(fetch).mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    }))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
    }))
    const turnRecovery = {
      source_run_id: 'run_source',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    let sendPromise!: Promise<void>
    await act(async () => {
      sendPromise = result.current.send('继续恢复', { turnRecovery })
      await Promise.resolve()
    })
    const rejected = expect(sendPromise).rejects.toThrow('恢复运行已取消')
    act(() => result.current.stop())
    await act(async () => rejected)

    expect(onUserMessage).not.toHaveBeenCalled()
    expect(onAssistantMessage).not.toHaveBeenCalled()
    expect(result.current.streamingMessageId).toBe(0)
    expect(result.current.status).toBe('idle')
  })

  it('rejects a stopped recovery even when the server confirms a cancelled terminal', async () => {
    const encoder = new TextEncoder()
    let finishCancelledRun!: () => void
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"run_started","run_id":"run_recovery_cancelled","timestamp":"2026-08-30T00:00:00Z"}\n\n',
        ))
        finishCancelledRun = () => {
          controller.enqueue(encoder.encode(
            'data: {"type":"run_done","run_id":"run_recovery_cancelled","final_status":"cancelled"}\n\n',
          ))
          controller.close()
        }
      },
    })
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).includes('/cancel')) return Promise.resolve(new Response(null, { status: 202 }))
      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
    })
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
    }))
    const turnRecovery = {
      source_run_id: 'run_source',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    let sendPromise!: Promise<void>
    await act(async () => {
      sendPromise = result.current.send('继续恢复', { turnRecovery })
    })
    await waitFor(() => expect(result.current.activeRunId).toBe('run_recovery_cancelled'))
    const rejected = expect(sendPromise).rejects.toThrow('恢复运行已取消')
    act(() => result.current.stop())
    await act(async () => {
      finishCancelledRun()
      await rejected
    })

    expect(onUserMessage).toHaveBeenCalledTimes(1)
    expect(onAssistantMessage).not.toHaveBeenCalled()
    expect(result.current.streamingMessageId).toBe(0)
    expect(result.current.status).toBe('idle')
  })

  it('rejects recovery when a Product failure follows a legacy done event', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"run_started","run_id":"run_terminal_failure","timestamp":"2026-08-30T00:00:00Z"}\n\n'
      + 'data: {"type":"text","content":"已保存失败说明"}\n\n'
      + 'data: {"type":"done","assistant_message_id":92}\n\n'
      + 'data: {"type":"run_failed","run_id":"run_terminal_failure","error_code":"PERSISTENCE_ERROR","error_message":"终态保存失败","retryable":false}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
      onError,
    }))
    const turnRecovery = {
      schema_version: 2 as const,
      source_run_id: 'run_source',
      source_message_id: 91,
      strategy: 'manual_review' as const,
      completed_steps: [],
      side_effects_possible: true,
      completed_effect_count: 0,
      pending_effect_count: 1,
      world_state_change: { changed: false },
      duplicate_policy: 'manual_review_required',
      warning_codes: ['manual_review_required'],
      contract_sha256: 'b'.repeat(64),
    }

    await act(async () => {
      await expect(result.current.send('继续恢复', { turnRecovery }))
        .rejects.toThrow('终态保存失败')
    })

    expect(onUserMessage).toHaveBeenCalledTimes(1)
    expect(onAssistantMessage).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('rejects recovery when the stream closes without a Product success terminal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"text","content":"只有旧版完成帧"}\n\n'
      + 'data: {"type":"done"}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage: vi.fn(),
      onAssistantMessage,
    }))
    const turnRecovery = {
      source_run_id: 'run_missing_terminal',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    await act(async () => {
      await expect(result.current.send('继续恢复', { turnRecovery }))
        .rejects.toThrow('缺少可验证的成功终态')
    })

    expect(onAssistantMessage).not.toHaveBeenCalled()
  })

  it('rejects recovery when run_done has no matching run_started identity', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"text","content":"未绑定启动身份"}\n\n'
      + 'data: {"type":"done"}\n\n'
      + 'data: {"type":"run_done","run_id":"run_unbound","final_status":"completed"}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onUserMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage: vi.fn(),
    }))
    const turnRecovery = {
      source_run_id: 'run_source',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    await act(async () => {
      await expect(result.current.send('继续恢复', { turnRecovery }))
        .rejects.toThrow('缺少匹配的启动身份')
    })
    expect(onUserMessage).not.toHaveBeenCalled()
  })

  it('rejects recovery when run_done belongs to a different run', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"run_started","run_id":"run_expected","timestamp":"2026-08-30T00:00:00Z"}\n\n'
      + 'data: {"type":"text","content":"身份漂移"}\n\n'
      + 'data: {"type":"done"}\n\n'
      + 'data: {"type":"run_done","run_id":"run_other","final_status":"completed"}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onUserMessage = vi.fn()
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage,
      onAssistantMessage,
    }))
    const turnRecovery = {
      source_run_id: 'run_source',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    await act(async () => {
      await expect(result.current.send('继续恢复', { turnRecovery }))
        .rejects.toThrow('缺少匹配的启动身份')
    })
    expect(onUserMessage).toHaveBeenCalledTimes(1)
    expect(onAssistantMessage).not.toHaveBeenCalled()
  })

  it('rejects a second recovery send while another request is in flight', async () => {
    let resolveResponse!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage: vi.fn(),
      onAssistantMessage: vi.fn(),
    }))
    const turnRecovery = {
      source_run_id: 'run_concurrent_recovery',
      source_message_id: 91,
      strategy: 'continue_as_new_turn' as const,
      completed_steps: [],
      side_effects_possible: true,
    }

    let firstSend!: Promise<void>
    await act(async () => {
      firstSend = result.current.send('第一个恢复', { turnRecovery })
      await Promise.resolve()
    })
    await act(async () => {
      await expect(result.current.send('第二个恢复', { turnRecovery }))
        .rejects.toThrow('本次恢复未发送')
    })
    resolveResponse(successfulStream())
    await act(async () => firstSend)

    expect(fetch).toHaveBeenCalledTimes(1)
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

  it('folds Product Run events and persists the final activity timeline', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      'data: {"type":"run_started","run_id":"run_timeline","timestamp":"2026-08-26T00:00:00Z","display_mode":"skill","skill":{"name":"风险评估","source":"auto"}}\n\n'
      + 'data: {"type":"step_started","run_id":"run_timeline","step_index":1,"title":"读取项目文档"}\n\n'
      + 'data: {"type":"tool_progress","run_id":"run_timeline","step_index":1,"title":"读取项目文档","status":"completed"}\n\n'
      + 'data: {"type":"step_completed","run_id":"run_timeline","step_index":1,"status":"completed","duration_ms":120}\n\n'
      + 'data: {"type":"text_delta","run_id":"run_timeline","content":"回答"}\n\n'
      + 'data: {"type":"text","content":"回答"}\n\n'
      + 'data: {"type":"run_done","run_id":"run_timeline","final_status":"completed","message_id":53}\n\n'
      + 'data: {"type":"done","assistant_message_id":53}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const onAssistantMessage = vi.fn()
    const { result } = renderHook(() => useChatStream({
      projectId: 3,
      conversationId: 4,
      onUserMessage: vi.fn(),
      onAssistantMessage,
    }))

    await act(async () => result.current.send('运行时间线测试'))

    const metadata = JSON.parse(onAssistantMessage.mock.calls[0][0].metadata_json)
    expect(metadata.activity_timeline).toMatchObject({
      run_id: 'run_timeline',
      final_status: 'completed',
      skill: { name: '风险评估', source: 'auto' },
      steps: [{ title: '读取项目文档', status: 'completed', duration_ms: 120 }],
    })
  })
})
