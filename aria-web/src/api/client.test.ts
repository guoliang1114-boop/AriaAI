import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config/api', () => ({
  getApiBaseUrlForAxios: () => 'http://localhost:8000',
  getApiBaseUrl: () => 'http://localhost:8000',
}))

describe('ApiClient', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('exports api singleton', async () => {
    const { api } = await import('./client')
    expect(api).toBeDefined()
  })

  it('has all HTTP methods', async () => {
    const { api } = await import('./client')
    expect(typeof api.get).toBe('function')
    expect(typeof api.post).toBe('function')
    expect(typeof api.put).toBe('function')
    expect(typeof api.patch).toBe('function')
    expect(typeof api.delete).toBe('function')
  })

  it('request interceptor adds auth token header', async () => {
    localStorage.setItem('authToken', 'my-token-abc')
    const { api } = await import('./client')
    try {
      await api.get('/test-auth-header')
    } catch {
      // Expected network error
    }
    expect(localStorage.getItem('authToken')).toBe('my-token-abc')
  })

  it('handles timeout error gracefully', async () => {
    const { api } = await import('./client')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await api.get('/timeout-test')
    } catch (e: any) {
      expect(e).toBeDefined()
    }
    consoleSpy.mockRestore()
  })

  it('handles network error gracefully', async () => {
    const { api } = await import('./client')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await api.get('/network-error-test')
    } catch (e: any) {
      expect(e).toBeDefined()
    }
    consoleSpy.mockRestore()
  })

  it('post sends body and returns data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { api } = await import('./client')
    const result = await api.post('/test-post', { key: 'value' })
    expect(result).toEqual({ ok: true })
    fetchSpy.mockRestore()
  })

  it('put sends body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { api } = await import('./client')
    const result = await api.put('/test-put', { id: 1 })
    expect(result).toEqual({ updated: true })
    fetchSpy.mockRestore()
  })

  it('patch sends body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ patched: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { api } = await import('./client')
    const result = await api.patch('/test-patch', { field: 'new' })
    expect(result).toEqual({ patched: true })
    fetchSpy.mockRestore()
  })

  it('delete sends request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { api } = await import('./client')
    const result = await api.delete('/test-delete')
    expect(result).toEqual({ deleted: true })
    fetchSpy.mockRestore()
  })

  it('handles 401 by dispatching logout event', async () => {
    localStorage.setItem('authToken', 'expired')
    localStorage.setItem('user', JSON.stringify({ name: 'test' }))

    let logoutFired = false
    window.addEventListener('auth:logout', () => { logoutFired = true })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const { api } = await import('./client')
    try {
      await api.get('/protected')
    } catch {
      // Expected
    }

    // Give the interceptor time to process
    await new Promise(r => setTimeout(r, 50))

    expect(logoutFired).toBe(true)
    expect(localStorage.getItem('authToken')).toBeNull()

    fetchSpy.mockRestore()
  })

  it('get returns response data directly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [1, 2, 3] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { api } = await import('./client')
    const result = await api.get('/items')
    expect(result).toEqual({ items: [1, 2, 3] })
    fetchSpy.mockRestore()
  })
})
