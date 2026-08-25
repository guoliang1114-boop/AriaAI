import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ProjectMemorySettings } from './ProjectMemorySettings'
import type { ProjectMemoryListResponse } from '../../types/api'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockToast = { showToast: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() }

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' } }),
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => mockToast,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function memoryList(items: ProjectMemoryListResponse['items']): ProjectMemoryListResponse {
  return {
    items,
    total: items.length,
    limit: 10,
    offset: 0,
    counts: { all: items.length, ready: items.length, stale: 0, missing: 0 },
  }
}

describe('ProjectMemorySettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    mockPost.mockResolvedValue({
      processed_count: 0,
      queued_count: 0,
      rebuilt_count: 0,
      rebuilt: [],
    })
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ProjectMemorySettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders projects after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/memory/list') {
        return Promise.resolve({
          items: [
          { id: 1, name: '项目A', client_id: 1, status: 'active', stage: 'execution', category: 'SaaS', created_at: '2025-01-01' },
          ],
          total: 1,
          limit: 10,
          offset: 0,
          counts: { all: 1, ready: 0, stale: 0, missing: 1 },
        })
      }
      if (url === '/projects/memory/jobs') {
        return Promise.resolve({ jobs: [], batch_rebuild: null })
      }
      return Promise.resolve({})
    })
    render(<ProjectMemorySettings />)
    await waitFor(() => {
      expect(screen.getByText('项目A')).toBeInTheDocument()
    })
  })

  it('filters projects by search query', async () => {
    mockGet.mockImplementation((url: string, config?: { params?: { search?: string } }) => {
      if (url === '/projects/memory/list') {
        const allItems = [
          { id: 1, name: '项目A', client_id: 1, client: '客户A', status: 'active', stage: 'execution', category: 'SaaS', created_at: '2025-01-01' },
          { id: 2, name: '项目B', client_id: 2, client: '客户B', status: 'active', stage: 'planning', category: 'Finance', created_at: '2025-01-01' },
        ]
        const items = config?.params?.search === '项目B' ? allItems.slice(1) : allItems
        return Promise.resolve({
          items,
          total: items.length,
          limit: 10,
          offset: 0,
          counts: { all: items.length, ready: 0, stale: 0, missing: items.length },
        })
      }
      if (url === '/projects/memory/jobs') {
        return Promise.resolve({ jobs: [], batch_rebuild: null })
      }
      return Promise.resolve({})
    })
    render(<ProjectMemorySettings />)
    await waitFor(() => screen.getByText('项目A'))
    const searchInput = screen.getByPlaceholderText(/搜索项目/)
    fireEvent.change(searchInput, { target: { value: '项目B' } })
    await waitFor(() => {
      expect(screen.queryByText('项目A')).not.toBeInTheDocument()
      expect(screen.getByText('项目B')).toBeInTheDocument()
    })
  })

  it('keeps the newest search result when an older request finishes later', async () => {
    const firstSearch = deferred<ProjectMemoryListResponse>()
    const secondSearch = deferred<ProjectMemoryListResponse>()
    mockGet.mockImplementation((url: string, config?: { params?: { search?: string } }) => {
      if (url === '/projects/memory/jobs') return Promise.resolve({ jobs: [], batch_rebuild: null })
      if (url !== '/projects/memory/list') return Promise.resolve({})
      if (config?.params?.search === '旧请求') return firstSearch.promise
      if (config?.params?.search === '新请求') return secondSearch.promise
      return Promise.resolve(memoryList([
        { id: 1, name: '初始项目', client_id: 1, status: 'active', stage: 'execution', category: 'SaaS', created_at: '2025-01-01', memory_version: 1 },
      ]))
    })

    render(<ProjectMemorySettings />)
    await screen.findByText('初始项目')
    const searchInput = screen.getByPlaceholderText(/搜索项目/)
    fireEvent.change(searchInput, { target: { value: '旧请求' } })
    await waitFor(() => {
      expect(mockGet.mock.calls.some(([, config]) => config?.params?.search === '旧请求')).toBe(true)
    })
    fireEvent.change(searchInput, { target: { value: '新请求' } })
    await waitFor(() => {
      expect(mockGet.mock.calls.some(([, config]) => config?.params?.search === '新请求')).toBe(true)
    })

    await act(async () => {
      secondSearch.resolve(memoryList([
        { id: 3, name: '最新结果', client_id: 1, status: 'active', stage: 'execution', category: 'SaaS', created_at: '2025-01-01', memory_version: 1 },
      ]))
    })
    await screen.findByText('最新结果')

    await act(async () => {
      firstSearch.resolve(memoryList([
        { id: 2, name: '过期结果', client_id: 1, status: 'active', stage: 'execution', category: 'SaaS', created_at: '2025-01-01', memory_version: 1 },
      ]))
    })
    expect(screen.getByText('最新结果')).toBeInTheDocument()
    expect(screen.queryByText('过期结果')).not.toBeInTheDocument()
  })
})
