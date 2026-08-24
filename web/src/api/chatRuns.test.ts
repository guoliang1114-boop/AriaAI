import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/api', () => ({
  getApiBaseUrl: () => 'http://localhost:8000',
}))

import { requestChatRunCancellation, requestChatRunSteering } from './chatRuns'

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

  it('binds a steering addition to the expected active run', async () => {
    localStorage.setItem('authToken', 'test-token')
    const payload = {
      run_id: 'run_abc',
      expected_run_id: 'run_abc',
      status: 'steering_accepted',
      conversation_id: 9,
      steering_id: 'steer_1',
      sequence: 1,
      message_id: 41,
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(requestChatRunSteering('run_abc', '控制在十页')).resolves.toEqual(payload)
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8000/chat/runs/run_abc/steer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expected_run_id: 'run_abc', content: '控制在十页' }),
      }),
    )
  })

  it('does not submit empty steering content', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(requestChatRunSteering('run_abc', '  ')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
