import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import { useConversationKnowledge } from './useConversationKnowledge'

vi.mock('../../../api/client', () => ({ api: { get: vi.fn() } }))
const payload = (id = 7, unavailable = 0) => ({
  namespace: 'source_scoped', documents: [{ id, title: `资料 ${id}` }], unavailable_count: unavailable,
})

describe('conversation knowledge restoration', () => {
  beforeEach(() => vi.resetAllMocks())

  it('blocks before restore, retains edits across renders, and restores persisted scope on reopen', async () => {
    vi.mocked(api.get).mockResolvedValue(payload())
    const { result, rerender, unmount } = renderHook(() => useConversationKnowledge(3, 4))
    expect(result.current.blocked).toBe(true)
    await waitFor(() => expect(result.current.blocked).toBe(false))
    expect(result.current.documents[0].id).toBe(7)
    act(() => result.current.remove(7))
    rerender()
    expect(result.current.documents).toEqual([])
    expect(api.get).toHaveBeenCalledTimes(1)
    unmount()
    const reopened = renderHook(() => useConversationKnowledge(3, 4))
    await waitFor(() => expect(reopened.result.current.documents).toHaveLength(1))
    expect(api.get).toHaveBeenLastCalledWith('/chat/conversations/4/knowledge-context')
  })

  it('never shows a previous conversation while the next one loads or accepts a late response', async () => {
    let resolveOld!: (value: unknown) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(payload(8))
    const { result, rerender } = renderHook(({ conversationId }) => useConversationKnowledge(3, conversationId), {
      initialProps: { conversationId: 4 },
    })
    rerender({ conversationId: 5 })
    expect(result.current.blocked).toBe(true)
    expect(result.current.documents).toEqual([])
    await waitFor(() => expect(result.current.documents[0]?.id).toBe(8))
    await act(async () => resolveOld(payload(7)))
    expect(result.current.documents[0].id).toBe(8)
  })

  it('does not expose old project scope when the project changes', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(payload()).mockImplementationOnce(() => new Promise(() => {}))
    const { result, rerender } = renderHook(({ projectId }) => useConversationKnowledge(projectId, 4), {
      initialProps: { projectId: 3 },
    })
    await waitFor(() => expect(result.current.blocked).toBe(false))
    rerender({ projectId: 9 })
    expect(result.current.blocked).toBe(true)
    expect(result.current.documents).toEqual([])
  })

  it('requires confirmation after revocation and removal does not silently confirm it', async () => {
    vi.mocked(api.get).mockResolvedValue(payload(7, 1))
    const { result } = renderHook(() => useConversationKnowledge(3, 4))
    await waitFor(() => expect(result.current.unavailable).toBe(1))
    act(() => result.current.remove(7))
    expect(result.current.blocked).toBe(true)
    act(() => result.current.confirmRemaining())
    expect(result.current.blocked).toBe(false)
    expect(result.current.documents).toEqual([])
  })

  it('fails closed on network failure and allows an explicit retry', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(payload())
    const { result } = renderHook(() => useConversationKnowledge(3, 4))
    await waitFor(() => expect(result.current.error).toBe(true))
    act(() => result.current.clear())
    expect(result.current.blocked).toBe(true)
    act(() => result.current.refresh())
    expect(result.current.pending).toBe(true)
    await waitFor(() => expect(result.current.blocked).toBe(false))
  })

  it.each([
    null, {}, { ...payload(), namespace: 'legacy' },
    { ...payload(), documents: [{ id: '7', title: '资料' }] },
    { ...payload(), unavailable_count: -1 },
    { ...payload(), unavailable_count: 20 },
  ])('fails closed for malformed response %#', async value => {
    vi.mocked(api.get).mockResolvedValue(value)
    const { result } = renderHook(() => useConversationKnowledge(3, 4))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.blocked).toBe(true)
    expect(result.current.documents).toEqual([])
  })

  it('uses an empty latest scope without resurrecting an older selection', async () => {
    vi.mocked(api.get).mockResolvedValue({ namespace: 'source_scoped', documents: [], unavailable_count: 0 })
    const { result } = renderHook(() => useConversationKnowledge(3, 4))
    await waitFor(() => expect(result.current.blocked).toBe(false))
    expect(result.current.documents).toEqual([])
  })
})
