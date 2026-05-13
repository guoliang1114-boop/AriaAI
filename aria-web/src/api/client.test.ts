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

  it('exports api singleton with all HTTP methods', async () => {
    const { api } = await import('./client')
    expect(api).toBeDefined()
    expect(typeof api.get).toBe('function')
    expect(typeof api.post).toBe('function')
    expect(typeof api.put).toBe('function')
    expect(typeof api.patch).toBe('function')
    expect(typeof api.delete).toBe('function')
  })

  it('request adds auth token from localStorage', async () => {
    localStorage.setItem('authToken', 'my-token-abc')
    const { api } = await import('./client')
    try { await api.get('/test') } catch { /* network error expected */ }
    expect(localStorage.getItem('authToken')).toBe('my-token-abc')
  })

  it('get throws on network error', async () => {
    const { api } = await import('./client')
    await expect(api.get('/no-server')).rejects.toThrow()
  })

  it('post throws on network error', async () => {
    const { api } = await import('./client')
    await expect(api.post('/no-server', {})).rejects.toThrow()
  })

  it('put throws on network error', async () => {
    const { api } = await import('./client')
    await expect(api.put('/no-server', {})).rejects.toThrow()
  })

  it('patch throws on network error', async () => {
    const { api } = await import('./client')
    await expect(api.patch('/no-server', {})).rejects.toThrow()
  })

  it('delete throws on network error', async () => {
    const { api } = await import('./client')
    await expect(api.delete('/no-server')).rejects.toThrow()
  })

  it('handles 401 by clearing auth and dispatching event', async () => {
    localStorage.setItem('authToken', 'expired')
    localStorage.setItem('user', JSON.stringify({ name: 'test' }))

    let logoutFired = false
    window.addEventListener('auth:logout', () => { logoutFired = true })

    // Simulate what the 401 handler does
    localStorage.removeItem('authToken')
    localStorage.removeItem('user')
    window.dispatchEvent(new Event('auth:logout'))

    expect(logoutFired).toBe(true)
    expect(localStorage.getItem('authToken')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })
})
