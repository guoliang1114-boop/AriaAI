import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Clients } from './Clients'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

const mockGet = vi.fn()
const mockPost = vi.fn()

interface TestClient {
  id: number
  name: string
  industry: string
  contact: string
  notes: string
  created_at: string
  document_count: number
  project_names: string[]
}

const wrapClients = (items: TestClient[]) => ({
  items,
  total: items.length,
  limit: 10,
  offset: 0,
  stats: {
    total: items.length,
    active: items.filter((item) => item.project_names?.length).length,
    watch: items.filter((item) => !item.project_names?.length && (item.document_count || item.contact || item.notes)).length,
    dormant: items.filter((item) => !item.project_names?.length && !item.document_count && !item.contact && !item.notes).length,
  },
})

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Clients', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockGet.mockClear()
    mockPost.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Clients />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders clients after loading', async () => {
    mockGet.mockResolvedValue(wrapClients([
      { id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '备注', created_at: '2025-01-01', document_count: 2, project_names: ['项目1'] },
      { id: 2, name: '客户B', industry: '金融', contact: '李四', notes: '', created_at: '2025-01-02', document_count: 0, project_names: [] },
    ]))
    render(<Clients />)
    await waitFor(() => {
      expect(screen.getAllByText('客户A').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('客户B').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows empty state when no clients', async () => {
    mockGet.mockResolvedValue(wrapClients([]))
    render(<Clients />)
    await waitFor(() => {
      expect(screen.getByText('还没有客户')).toBeInTheDocument()
    })
  })

  it('filters clients by search query', async () => {
    const clients = [
      { id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '备注', created_at: '2025-01-01', document_count: 2, project_names: ['项目1'] },
      { id: 2, name: '客户B', industry: '金融', contact: '李四', notes: '', created_at: '2025-01-02', document_count: 0, project_names: [] },
    ]
    mockGet.mockImplementation((_url: string, config?: { params?: { search?: string } }) => {
      const keyword = config?.params?.search
      return Promise.resolve(wrapClients(keyword ? clients.filter((client) => client.name.includes(keyword)) : clients))
    })
    render(<Clients />)
    await waitFor(() => screen.getAllByText('客户A'))
    const searchInput = screen.getByPlaceholderText(/搜索/)
    fireEvent.change(searchInput, { target: { value: '客户A' } })
    await waitFor(() => {
      expect(screen.getAllByText('客户A').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('keeps the newest client search when requests finish out of order', async () => {
    const oldSearch = deferred<ReturnType<typeof wrapClients>>()
    const newSearch = deferred<ReturnType<typeof wrapClients>>()
    mockGet.mockImplementation((_url: string, config?: { params?: { search?: string } }) => {
      if (config?.params?.search === '旧客户') return oldSearch.promise
      if (config?.params?.search === '新客户') return newSearch.promise
      return Promise.resolve(wrapClients([
        { id: 1, name: '初始客户', industry: 'IT', contact: '', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] },
      ]))
    })

    render(<Clients />)
    await screen.findAllByText('初始客户')
    const searchInput = screen.getByLabelText('搜索客户')
    fireEvent.change(searchInput, { target: { value: '旧客户' } })
    await waitFor(() => expect(mockGet.mock.calls.some(([, config]) => config?.params?.search === '旧客户')).toBe(true))
    fireEvent.change(searchInput, { target: { value: '新客户' } })
    await waitFor(() => expect(mockGet.mock.calls.some(([, config]) => config?.params?.search === '新客户')).toBe(true))

    await act(async () => newSearch.resolve(wrapClients([
      { id: 3, name: '最新客户', industry: '咨询', contact: '', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] },
    ])))
    await screen.findAllByText('最新客户')
    await act(async () => oldSearch.resolve(wrapClients([
      { id: 2, name: '过期客户', industry: '金融', contact: '', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] },
    ])))
    expect(screen.getAllByText('最新客户').length).toBeGreaterThan(0)
    expect(screen.queryByText('过期客户')).not.toBeInTheDocument()
  })

  it('opens create client modal', async () => {
    mockGet.mockResolvedValue(wrapClients([]))
    render(<Clients />)
    const createButtons = await screen.findAllByRole('button', { name: /新建客户/ })
    fireEvent.click(createButtons[0])
    expect(screen.getByPlaceholderText(/客户名称/)).toBeInTheDocument()
  })

  it('ignores an AI suggestion response after the create dialog closes', async () => {
    const suggestion = deferred<Array<{ name: string; industry: string; contact: string; notes: string }>>()
    mockGet.mockResolvedValue(wrapClients([]))
    mockPost.mockReturnValue(suggestion.promise)
    render(<Clients />)

    const createButtons = await screen.findAllByRole('button', { name: /新建客户/ })
    fireEvent.click(createButtons[0])
    fireEvent.change(screen.getByPlaceholderText('输入公司名称或一句业务描述...'), { target: { value: '旧公司' } })
    fireEvent.click(screen.getByRole('button', { name: '生成建议' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/clients/ai-suggest', { query: '旧公司' }, { timeout: 60000 }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    await act(async () => suggestion.resolve([{ name: '过期建议', industry: 'IT', contact: '', notes: '' }]))
    fireEvent.click((await screen.findAllByRole('button', { name: /新建客户/ }))[0])
    expect(screen.queryByText('过期建议')).not.toBeInTheDocument()
  })

  it('submits create client form', async () => {
    mockGet.mockResolvedValue(wrapClients([]))
    mockPost.mockResolvedValue({ id: 1, name: '新客户', industry: 'IT', contact: '张三', notes: '' })
    render(<Clients />)
    const createButtons = await screen.findAllByRole('button', { name: /新建客户/ })
    fireEvent.click(createButtons[0])
    const nameInput = screen.getByPlaceholderText('请输入客户名称')
    fireEvent.change(nameInput, { target: { value: '新客户' } })
    const submitBtn = screen.getByRole('button', { name: /确认创建/ })
    fireEvent.click(submitBtn)
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled()
    })
  })
})
