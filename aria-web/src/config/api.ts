/**
 * Unified API Configuration
 * 
 * This is the single source of truth for API base URL configuration.
 * Priority order:
 * 1. localStorage.serverUrl (user saved setting)
 * 2. import.meta.env.VITE_API_URL (environment variable)
 * 3. Default: 'http://127.0.0.1:8000'
 */

const DEFAULT_API_URL = 'http://127.0.0.1:8000'

export function getApiBaseUrl(): string {
  // Priority 1: User saved setting
  const savedUrl = localStorage.getItem('serverUrl')
  if (savedUrl) {
    return savedUrl
  }
  
  // Priority 2: Environment variable
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  
  // Priority 3: Default
  return DEFAULT_API_URL
}

export function getApiBaseUrlForAxios(): string {
  const baseUrl = getApiBaseUrl()
  // For axios, if the URL is relative (starts with /), use it as-is
  // Otherwise, use the full URL
  return baseUrl
}

export function saveApiBaseUrl(url: string): void {
  localStorage.setItem('serverUrl', url)
  // Dispatch event to notify all components
  window.dispatchEvent(new Event('api:url_changed'))
}

export function resetApiBaseUrl(): void {
  localStorage.removeItem('serverUrl')
  window.dispatchEvent(new Event('api:url_changed'))
}

// For backward compatibility - check if we need to migrate old storage key
export function migrateOldServerUrl(): void {
  const oldKey = 'apiBaseURL'
  const oldValue = localStorage.getItem(oldKey)
  if (oldValue && !localStorage.getItem('serverUrl')) {
    localStorage.setItem('serverUrl', oldValue)
    localStorage.removeItem(oldKey)
  }
}

// Run migration on load
migrateOldServerUrl()
