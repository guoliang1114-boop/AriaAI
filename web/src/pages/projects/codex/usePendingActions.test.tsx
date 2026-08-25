import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import type { PendingToolAction } from '../../../types/api'
import { usePendingActions } from './usePendingActions'

vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const pendingAction: PendingToolAction = {
  id: 42,
  trace_id: 'trace-1',
  conversation_id: 7,
  project_id: 3,
  tool_name: 'write_project_office_document',
  tool_input: { project_id: 3, title: 'Report' },
  action_type: 'write',
  risk_level: 'medium',
  policy_at_creation: 'modify_existing_file',
  tool_input_hash: 'hash',
  approval_batch_id: '',
  sequence_index: 0,
  title: 'Create report',
  description: 'Create the report document',
  details: ['文件：Report.docx'],
  status: 'pending',
  created_at: '2026-06-04T00:00:00',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('usePendingActions', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
  })

  it('keeps the approval card busy until a background action settles', async () => {
    const onResolved = vi.fn()
    let actionPolls = 0
    let resolveActionPoll: ((action: PendingToolAction) => void) | undefined
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/chat/conversations/7/pending-actions') {
        return { items: [pendingAction], has_pending: true }
      }
      if (path === '/chat/actions/42') {
        actionPolls += 1
        return new Promise<PendingToolAction>((resolve) => {
          resolveActionPoll = resolve
        })
      }
      throw new Error(`Unexpected GET ${path}`)
    })
    vi.mocked(api.post).mockResolvedValue({
      status: 'executing',
      result: { success: true, queued: true, background: true },
      action_ids: [42],
    })

    const { result } = renderHook(() => usePendingActions(7, onResolved))
    await waitFor(() => expect(result.current.batches).toHaveLength(1))

    let promise: Promise<void> | undefined
    act(() => {
      promise = result.current.confirm(result.current.batches[0])
    })
    await waitFor(() => expect(result.current.actingKey).toBe('single:42'))
    act(() => {
      resolveActionPoll?.({ ...pendingAction, status: 'completed', result: { success: true } })
    })
    await act(async () => {
      await promise
    })

    expect(api.post).toHaveBeenCalledWith('/chat/actions/42/confirm', { approved: true })
    expect(actionPolls).toBe(1)
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(result.current.actingKey).toBeNull()
  })

  it('keeps approvals scoped to the newest selected conversation', async () => {
    const oldRequest = deferred<{ items: PendingToolAction[]; has_pending: boolean }>()
    const newRequest = deferred<{ items: PendingToolAction[]; has_pending: boolean }>()
    vi.mocked(api.get)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)

    const onResolved = vi.fn()
    const { result, rerender } = renderHook(
      ({ conversationId }) => usePendingActions(conversationId, onResolved),
      { initialProps: { conversationId: 7 } },
    )
    rerender({ conversationId: 8 })

    const newestAction = { ...pendingAction, id: 88, conversation_id: 8, title: 'Newest approval' }
    await act(async () => newRequest.resolve({ items: [newestAction], has_pending: true }))
    await waitFor(() => expect(result.current.batches[0]?.actions[0]?.id).toBe(88))

    await act(async () => oldRequest.resolve({ items: [pendingAction], has_pending: true }))
    expect(result.current.batches[0]?.actions[0]?.id).toBe(88)
  })
})
