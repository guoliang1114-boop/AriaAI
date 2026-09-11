import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceDown } from './ServiceDown'

const mocks = vi.hoisted(() => ({ get: vi.fn(), navigate: vi.fn(), state: {} as Record<string, unknown> }))
vi.mock('../api/client', () => ({ api: { get: mocks.get } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useLocation: () => ({ state: mocks.state }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }))

describe('service recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.get.mockReset().mockResolvedValue({})
    mocks.navigate.mockReset()
    mocks.state = { from: '/knowledge', reason: 'user-memory-unavailable' }
  })
  afterEach(() => vi.useRealTimers())

  it.each(['manual', 'automatic'])('rechecks the failing dependency and returns to the original page (%s)', async mode => {
    render(<ServiceDown />)
    await act(async () => {
      if (mode === 'manual') fireEvent.click(screen.getByRole('button', { name: '立即重试' }))
      else await vi.advanceTimersByTimeAsync(15000)
    })
    expect(mocks.get).toHaveBeenCalledWith('/user-memory')
    expect(mocks.navigate).toHaveBeenCalledWith('/knowledge', { replace: true })
    expect(screen.queryByText(/数据库索引升级|5–15|替你存好|仅备用模型/)).not.toBeInTheDocument()
  })

  it('keeps retrying a transient failure but reports a genuine permission denial', async () => {
    mocks.get.mockRejectedValueOnce({ response: { status: 503 } }).mockRejectedValueOnce({ response: { status: 403 } })
    render(<ServiceDown />)
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(mocks.navigate).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(mocks.navigate).toHaveBeenCalledWith('/403', { replace: true })
  })

  it.each(['https://example.com', '//example.com', '/503'])('does not navigate to an unsafe or looping return path (%s)', async from => {
    mocks.state = { from }
    render(<ServiceDown />)
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(mocks.get).toHaveBeenCalledWith('/health')
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true })
  })
})
