import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

const wrapClients = (items: any[]) => ({
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
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

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
    mockGet.mockImplementation((_url: string, config?: any) => {
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

  it('opens create client modal', async () => {
    mockGet.mockResolvedValue(wrapClients([]))
    render(<Clients />)
    const createButtons = await screen.findAllByRole('button', { name: /新建客户/ })
    fireEvent.click(createButtons[0])
    expect(screen.getByPlaceholderText(/客户名称/)).toBeInTheDocument()
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
