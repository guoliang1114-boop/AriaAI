import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppTimeZone } from './useAppTimeZone'
import { APP_TIMEZONE_STORAGE_KEY, APP_TIMEZONE_EVENT, DEFAULT_APP_TIMEZONE } from '../utils/timezone'

describe('useAppTimeZone', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns initial stored and resolved timezone', () => {
    const { result } = renderHook(() => useAppTimeZone())
    expect(result.current.storedTimeZone).toBe(DEFAULT_APP_TIMEZONE)
    expect(result.current.resolvedTimeZone).toBe(DEFAULT_APP_TIMEZONE)
  })

  it('returns stored timezone from localStorage', () => {
    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, 'Asia/Shanghai')
    const { result } = renderHook(() => useAppTimeZone())
    expect(result.current.storedTimeZone).toBe('Asia/Shanghai')
    expect(result.current.resolvedTimeZone).toBe('Asia/Shanghai')
  })

  it('updates when storage event fires', () => {
    const { result } = renderHook(() => useAppTimeZone())
    expect(result.current.storedTimeZone).toBe(DEFAULT_APP_TIMEZONE)

    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, 'Europe/London')
    act(() => {
      window.dispatchEvent(new Event('storage'))
    })

    expect(result.current.storedTimeZone).toBe('Europe/London')
    expect(result.current.resolvedTimeZone).toBe('Europe/London')
  })

  it('updates when custom timezone event fires', () => {
    const { result } = renderHook(() => useAppTimeZone())
    expect(result.current.storedTimeZone).toBe(DEFAULT_APP_TIMEZONE)

    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, 'America/New_York')
    act(() => {
      window.dispatchEvent(new CustomEvent(APP_TIMEZONE_EVENT, { detail: 'America/New_York' }))
    })

    expect(result.current.storedTimeZone).toBe('America/New_York')
    expect(result.current.resolvedTimeZone).toBe('America/New_York')
  })

  it('cleans up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useAppTimeZone())

    expect(addSpy).toHaveBeenCalledWith('storage', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith(APP_TIMEZONE_EVENT, expect.any(Function))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith(APP_TIMEZONE_EVENT, expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
