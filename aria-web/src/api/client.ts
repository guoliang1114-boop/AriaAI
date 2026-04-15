import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from 'axios'
import { getApiBaseUrlForAxios } from '../config/api'

interface ErrorResponsePayload {
  detail?: string
  message?: string
}

class ApiClient {
  private client: AxiosInstance
  private isRedirecting = false

  constructor() {
    this.client = axios.create({
      baseURL: getApiBaseUrlForAxios(),
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Request interceptor - add auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('authToken')
        console.log('[API] Request:', config.method?.toUpperCase(), config.url, 'Token:', token ? 'present' : 'missing')
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
        console.log('[API] Response:', response.config.method?.toUpperCase(), response.config.url, response.status)
        return response
      },
      (error: AxiosError) => {
        this.handleError(error)
        return Promise.reject(error)
      }
    )
  }

  private handleError(error: AxiosError) {
    console.log('[API] handleError called:', error.message)

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

    // Handle 401 Unauthorized
    if (status === 401) {
      console.log('[API] 401 detected, checking redirect...')
      const currentPath = window.location.pathname
      console.log('[API] Current path:', currentPath)
      
      if (!currentPath.includes('/login') && !this.isRedirecting) {
        this.isRedirecting = true
        console.warn('[API] 401 Unauthorized - redirecting to login')
        localStorage.removeItem('authToken')
        localStorage.removeItem('user')
        
        // Dispatch auth change event to notify AuthContext
        window.dispatchEvent(new Event('auth:logout'))
        
        // Use setTimeout to ensure this happens after current execution
        setTimeout(() => {
          window.location.href = '/login'
        }, 100)
      }
    }
  }

  async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(path, config)
    return response.data
  }

  async post<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(path, body, config)
    return response.data
  }

  async put<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(path, body, config)
    return response.data
  }

  async patch<T>(path: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.patch<T>(path, body, config)
    return response.data
  }

  async delete<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(path, config)
    return response.data
  }
}

export const api = new ApiClient()
