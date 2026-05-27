import { describe, it, expect, beforeEach } from 'vitest'
import {
  getBrowserTimeZone,
  isValidTimeZone,
  getStoredAppTimeZone,
  getResolvedAppTimeZone,
  setAppTimeZone,
  parseAppDateTime,
  formatDatePartsKey,
  formatTimeOnly,
  formatDateOnly,
  formatDateTime,
  APP_TIMEZONE_STORAGE_KEY,
  BROWSER_TIMEZONE_VALUE,
  DEFAULT_APP_TIMEZONE,
} from './timezone'

describe('getBrowserTimeZone', () => {
  it('returns a valid timezone string', () => {
    const tz = getBrowserTimeZone()
    expect(typeof tz).toBe('string')
    expect(tz.length).toBeGreaterThan(0)
  })

  it('returns IANA timezone format', () => {
    const tz = getBrowserTimeZone()
    // IANA timezones contain / or are UTC
    expect(tz === 'UTC' || tz.includes('/')).toBe(true)
  })
})

describe('isValidTimeZone', () => {
  it('returns true for valid timezones', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Europe/London')).toBe(true)
  })

  it('returns false for invalid timezones', () => {
    expect(isValidTimeZone('Invalid/Zone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone('not-a-tz')).toBe(false)
  })
})

describe('getStoredAppTimeZone', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns Beijing timezone when nothing stored', () => {
    expect(getStoredAppTimeZone()).toBe(DEFAULT_APP_TIMEZONE)
  })

  it('returns stored valid timezone', () => {
    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, 'Asia/Shanghai')
    expect(getStoredAppTimeZone()).toBe('Asia/Shanghai')
  })

  it('falls back to the app default for invalid stored timezone', () => {
    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, 'Invalid/Zone')
    expect(getStoredAppTimeZone()).toBe(DEFAULT_APP_TIMEZONE)
  })

  it('returns browser keyword when stored as browser', () => {
    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, BROWSER_TIMEZONE_VALUE)
    expect(getStoredAppTimeZone()).toBe(BROWSER_TIMEZONE_VALUE)
  })
})

describe('setAppTimeZone', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores a valid timezone', () => {
    setAppTimeZone('Europe/London')
    expect(localStorage.getItem(APP_TIMEZONE_STORAGE_KEY)).toBe('Europe/London')
  })

  it('falls back to the app default for invalid timezone', () => {
    setAppTimeZone('Bad/Zone')
    expect(localStorage.getItem(APP_TIMEZONE_STORAGE_KEY)).toBe(DEFAULT_APP_TIMEZONE)
  })

  it('dispatches a custom event', () => {
    let eventDetail: string | undefined
    const handler = (e: Event) => {
      eventDetail = (e as CustomEvent).detail
    }
    window.addEventListener('app:timezone-changed', handler)
    setAppTimeZone('Asia/Tokyo')
    expect(eventDetail).toBe('Asia/Tokyo')
    window.removeEventListener('app:timezone-changed', handler)
  })
})

describe('getResolvedAppTimeZone', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns browser timezone when stored is "browser"', () => {
    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, BROWSER_TIMEZONE_VALUE)
    const resolved = getResolvedAppTimeZone()
    expect(resolved).toBe(getBrowserTimeZone())
  })

  it('returns stored timezone when set explicitly', () => {
    localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, 'Asia/Shanghai')
    expect(getResolvedAppTimeZone()).toBe('Asia/Shanghai')
  })
})

describe('formatDatePartsKey', () => {
  it('formats a date string to YYYY-MM-DD', () => {
    const result = formatDatePartsKey('2024-01-15T10:30:00Z', 'UTC')
    expect(result).toBe('2024-01-15')
  })

  it('formats a Date object', () => {
    const result = formatDatePartsKey(new Date('2024-12-25T00:00:00Z'), 'UTC')
    expect(result).toBe('2024-12-25')
  })

  it('formats a timestamp', () => {
    const ts = new Date('2024-06-01T12:00:00Z').getTime()
    const result = formatDatePartsKey(ts, 'UTC')
    expect(result).toBe('2024-06-01')
  })

  it('respects timezone parameter', () => {
    // 2024-01-15T00:30:00Z is still 2024-01-14 in America/New_York
    const result = formatDatePartsKey('2024-01-15T00:30:00Z', 'America/New_York')
    expect(result).toBe('2024-01-14')
  })
})

describe('parseAppDateTime', () => {
  it('treats backend ISO timestamps without timezone as UTC', () => {
    expect(parseAppDateTime('2026-05-27T03:51:17').toISOString()).toBe('2026-05-27T03:51:17.000Z')
  })
})

describe('formatTimeOnly', () => {
  it('returns a string containing time digits', () => {
    const result = formatTimeOnly('2024-01-15T14:30:00Z', undefined, 'UTC')
    expect(result).toMatch(/\d/)
  })

  it('formats backend UTC timestamps in the selected app timezone', () => {
    const result = formatTimeOnly('2026-05-27T03:51:17', { hour12: false }, 'Asia/Shanghai')
    expect(result).toBe('11:51')
  })
})

describe('formatDateOnly', () => {
  it('returns a string containing date parts', () => {
    const result = formatDateOnly('2024-01-15T14:30:00Z', undefined, 'UTC')
    expect(result).toMatch(/\d/)
  })
})

describe('formatDateTime', () => {
  it('returns a string containing date and time', () => {
    const result = formatDateTime('2024-01-15T14:30:00Z', undefined, undefined, 'UTC')
    expect(result).toMatch(/\d/)
  })
})
  it('defaults to Beijing timezone when no value is stored', () => {
    expect(getResolvedAppTimeZone()).toBe(DEFAULT_APP_TIMEZONE)
  })
