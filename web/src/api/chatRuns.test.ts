import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/api', () => ({
  getApiBaseUrl: () => 'http://localhost:8000',
}))

import { requestChatRunCancellation } from './chatRuns'

describe('requestChatRunCancellation', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('posts an authenticated cancellation request for an Aria run', async () => {
    localStorage.setItem('authToken', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 202 }),
    )

    await expect(requestChatRunCancellation('run_abc')).resolves.toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8000/chat/runs/run_abc/cancel',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': 'test-token',
        },
      },
    )
  })

  it('rejects malformed run ids without making a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(requestChatRunCancellation('conversation-1')).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns false when the run is already gone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))

    await expect(requestChatRunCancellation('run_gone')).resolves.toBe(false)
  })
})
