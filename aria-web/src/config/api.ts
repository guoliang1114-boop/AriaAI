/**
 * Unified API Configuration
 * 
 * This is the single source of truth for API base URL configuration.
 * Priority order:
 * 1. localStorage.serverUrl (user saved setting)
 * 2. import.meta.env.VITE_API_URL (environment variable)
 * 3. Default: '/api' (production) or 'http://127.0.0.1:8000' (development)
 */

const DEV_DEFAULT_URL = 'http://127.0.0.1:8000'
const PROD_DEFAULT_URL = '/api'

/** Detect if running in production mode */
function isProduction(): boolean {
  return import.meta.env.PROD || window.location.hostname !== 'localhost'
}

/** Get default URL based on environment */
function getDefaultUrl(): string {
  return isProduction() ? PROD_DEFAULT_URL : DEV_DEFAULT_URL
}

/** Source of the current API URL */
export type ApiUrlSource = 'localStorage' | 'env' | 'default'

export interface ApiConfig {
  url: string
  source: ApiUrlSource
  isDefault: boolean
}

export function getApiConfig(): ApiConfig {
  // Priority 1: User saved setting
  const savedUrl = localStorage.getItem('serverUrl')
  if (savedUrl) {
    return { url: savedUrl, source: 'localStorage', isDefault: false }
  }
  
  // Priority 2: Environment variable
  const envUrl = import.meta.env.VITE_API_URL
  if (envUrl) {
    return { url: envUrl, source: 'env', isDefault: false }
  }
  
  // Priority 3: Default
  return { url: getDefaultUrl(), source: 'default', isDefault: true }
}

/** Get API base URL (backward compatible) */
export function getApiBaseUrl(): string {
  return getApiConfig().url
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
