import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from 'axios'
import { getApiBaseUrlForAxios } from '../config/api'

interface ErrorResponsePayload {
  detail?: string
  message?: string
}

// File uploads (multipart/form-data) can take far longer than a JSON API
// call: a multi-MB PDF over a typical connection routinely exceeds the 15s
// default, which aborted the request client-side (ECONNABORTED) even though
// the backend had already saved the file. Give FormData bodies a generous
// timeout (aligned with nginx proxy_read_timeout = 300s) unless the caller
// passes an explicit timeout.
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

function withUploadTimeout(
  body: unknown,
  config?: AxiosRequestConfig,
): AxiosRequestConfig | undefined {
  const isUpload = typeof FormData !== 'undefined' && body instanceof FormData
  if (isUpload && config?.timeout === undefined) {
    return { ...config, timeout: UPLOAD_TIMEOUT_MS }
  }
  return config
}

class ApiClient {
  private client: AxiosInstance
  private isDev = import.meta.env.DEV

  constructor() {
    this.client = axios.create({
      baseURL: getApiBaseUrlForAxios(),
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Request interceptor - add auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('authToken')
        if (this.isDev) {
          console.log('[API] Request:', config.method?.toUpperCase(), config.url, 'Token:', token ? 'present' : 'missing')
        }
        if (token) {
          config.headers = config.headers || {}
          config.headers['X-Auth-Token'] = token
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // Response interceptor - handle errors
    this.client.interceptors.response.use(
      (response) => {
        if (this.isDev) {
          console.log('[API] Response:', response.config.method?.toUpperCase(), response.config.url, response.status)
        }
        return response
      },
      (error: AxiosError) => {
        this.handleError(error)
        return Promise.reject(error)
      }
    )
  }

  private handleError(error: AxiosError) {
    if (this.isDev) {
      console.log('[API] handleError called:', error.message)
    }

    // Handle timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error('[API] Request timeout')
      return
    }

    // Handle network error (backend not running)
    if (!error.response) {
      console.error('[API] Network error:', error.message)
      return
    }

    const status = error.response.status
    const data = error.response.data as ErrorResponsePayload | string | null

    console.error('[API] HTTP Error:', status, data)

    // Handle 503 Service Unavailable — broadcast so the global
    // listener in ``App.tsx`` can swap the route for ServiceDown.
    // We don't navigate here directly: the API client is
    // route-agnostic; the listener lives next to React Router.
    if (status === 503) {
      window.dispatchEvent(new CustomEvent('api:service-down'))
      return
    }

    // Handle 403 on /projects/{id}/* — almost always means the user
    // isn't a member of that project. Broadcast so the listener in
    // App.tsx can toast + redirect to /projects. We scope by URL
    // shape because /clients, /skills, /knowledge also return 403
    // for unrelated reasons and shouldn't trigger the project
    // membership bounce.
    if (status === 403) {
      const url = error.config?.url || ''
      const matchedProjectId = /\/projects\/(\d+)(?:\/|$)/.exec(url)?.[1]
      if (matchedProjectId) {
        window.dispatchEvent(
          new CustomEvent('aria:project-access-denied', {
            detail: { projectId: matchedProjectId, url },
          }),
        )
      }
    }

    // Handle 401 Unauthorized
    if (status === 401) {
      const currentPath = window.location.pathname
      if (!currentPath.includes('/login')) {
        console.warn('[API] 401 Unauthorized - redirecting to login')
        localStorage.removeItem('authToken')
        localStorage.removeItem('user')

        // Dispatch auth change event to notify AuthContext
        window.dispatchEvent(new Event('auth:logout'))

        // Replace current history so back button won't return to the 401 page
        window.location.replace('/login')
      }
    }
  }

  async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(path, config)
    return response.data
  }

  async post<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(path, body, withUploadTimeout(body, config))
    return response.data
  }

  async put<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(path, body, withUploadTimeout(body, config))
    return response.data
  }

  async patch<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.patch<T>(path, body, withUploadTimeout(body, config))
    return response.data
  }

  async delete<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(path, config)
    return response.data
  }
}

export const api = new ApiClient()
