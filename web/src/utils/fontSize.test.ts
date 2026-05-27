import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_FONT_SIZE_STORAGE_KEY,
  applyAppFontSize,
  bootstrapAppFontSize,
  getStoredAppFontSize,
  isAppFontSize,
  setAppFontSize,
} from './fontSize'

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.style.fontSize = ''
})

describe('fontSize util', () => {
  it('defaults to medium when nothing is stored', () => {
    expect(getStoredAppFontSize()).toBe('medium')
  })

  it('returns the stored value when valid, falls back when not', () => {
    window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, 'large')
    expect(getStoredAppFontSize()).toBe('large')

    window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, 'gigantic')
    expect(getStoredAppFontSize()).toBe('medium')
  })

  it('isAppFontSize guards the allowed values', () => {
    expect(isAppFontSize('small')).toBe(true)
    expect(isAppFontSize('medium')).toBe(true)
    expect(isAppFontSize('large')).toBe(true)
    expect(isAppFontSize('xl')).toBe(false)
    expect(isAppFontSize(undefined)).toBe(false)
  })

  it('applyAppFontSize sets the root font-size in px', () => {
    applyAppFontSize('small')
    expect(document.documentElement.style.fontSize).toBe('15px')
    applyAppFontSize('large')
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('setAppFontSize persists to localStorage and applies immediately', () => {
    setAppFontSize('large')
    expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe('large')
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('setAppFontSize coerces invalid input to the default', () => {
    // @ts-expect-error testing runtime coercion of an invalid value
    setAppFontSize('huge')
    expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe('medium')
    expect(document.documentElement.style.fontSize).toBe('16px')
  })

  it('bootstrapAppFontSize applies the stored size', () => {
    window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, 'small')
    bootstrapAppFontSize()
    expect(document.documentElement.style.fontSize).toBe('15px')
  })
})
