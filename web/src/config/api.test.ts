import { describe, it, expect, beforeEach } from 'vitest'

// We test the exported functions directly. import.meta.env is statically bound
// at build time, so we can't stub it per-test. Instead we test the localStorage
// priority and the utility functions that don't depend on env detection.
import {
  getApiConfig,
  getApiBaseUrl,
  getApiBaseUrlForAxios,
  saveApiBaseUrl,
  resetApiBaseUrl,
  migrateOldServerUrl,
} from './api'

describe('getApiConfig', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns localStorage URL when set (highest priority)', () => {
    localStorage.setItem('serverUrl', 'http://custom.api:3000')
    const config = getApiConfig()
    expect(config.url).toBe('http://custom.api:3000')
    expect(config.source).toBe('localStorage')
    expect(config.isDefault).toBe(false)
  })

  it('returns a valid config when nothing is set', () => {
    const config = getApiConfig()
    expect(config.url).toBeTruthy()
    expect(typeof config.url).toBe('string')
    expect(['env', 'default']).toContain(config.source)
  })

  it('localStorage takes precedence over env', () => {
    localStorage.setItem('serverUrl', 'http://local:4000')
    const config = getApiConfig()
    expect(config.url).toBe('http://local:4000')
    expect(config.source).toBe('localStorage')
  })

  it('returns non-default source when localStorage is set', () => {
    localStorage.setItem('serverUrl', 'http://custom')
    const config = getApiConfig()
    expect(config.isDefault).toBe(false)
  })
})

describe('getApiBaseUrl', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the URL string from getApiConfig', () => {
    localStorage.setItem('serverUrl', 'http://test:1234')
    expect(getApiBaseUrl()).toBe('http://test:1234')
  })
})

describe('getApiBaseUrlForAxios', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the same as getApiBaseUrl', () => {
    localStorage.setItem('serverUrl', 'http://test:5678')
    expect(getApiBaseUrlForAxios()).toBe(getApiBaseUrl())
  })
})

describe('saveApiBaseUrl', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves URL to localStorage', () => {
    saveApiBaseUrl('http://new.api:8080')
    expect(localStorage.getItem('serverUrl')).toBe('http://new.api:8080')
  })

  it('dispatches api:url_changed event', () => {
    let called = false
    const handler = () => { called = true }
    window.addEventListener('api:url_changed', handler)
    saveApiBaseUrl('http://test')
    expect(called).toBe(true)
    window.removeEventListener('api:url_changed', handler)
  })
})

describe('resetApiBaseUrl', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('removes serverUrl from localStorage', () => {
    localStorage.setItem('serverUrl', 'http://test')
    resetApiBaseUrl()
    expect(localStorage.getItem('serverUrl')).toBeNull()
  })

  it('dispatches api:url_changed event', () => {
    let called = false
    const handler = () => { called = true }
    window.addEventListener('api:url_changed', handler)
    resetApiBaseUrl()
    expect(called).toBe(true)
    window.removeEventListener('api:url_changed', handler)
  })
})

describe('migrateOldServerUrl', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('migrates old apiBaseURL key to serverUrl', () => {
    localStorage.setItem('apiBaseURL', 'http://old.api')
    migrateOldServerUrl()
    expect(localStorage.getItem('serverUrl')).toBe('http://old.api')
    expect(localStorage.getItem('apiBaseURL')).toBeNull()
  })

  it('does not overwrite existing serverUrl', () => {
    localStorage.setItem('serverUrl', 'http://existing')
    localStorage.setItem('apiBaseURL', 'http://old')
    migrateOldServerUrl()
    expect(localStorage.getItem('serverUrl')).toBe('http://existing')
  })

  it('does nothing when no old key exists', () => {
    migrateOldServerUrl()
    expect(localStorage.getItem('serverUrl')).toBeNull()
  })
})
