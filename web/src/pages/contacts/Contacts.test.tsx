import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ClientStakeholder } from '../../types/api'
import { Contacts } from './Contacts'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

const mockGet = vi.fn()

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

const clientA: TestClient = { id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] }
const contactWang: ClientStakeholder = {
  id: 10,
  client_id: 1,
  name: '王五',
  role: '经理',
  contact: 'wang@example.com',
  relationship_status: '',
  note: '',
  organization_level: '',
  influence_type: '',
  communication_preference: '',
  personality_profile: '',
  decision_style: '',
  communication_strategy: '',
  trust_signals: '',
  concerns: '',
  sensitivities: '',
  last_action: '',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
}
const wrapContacts = (items: Array<{ client: TestClient; stakeholder: ClientStakeholder }>) => ({
  items,
  total: items.length,
  limit: 10,
  offset: 0,
  clients: [clientA],
  partial_failures: 0,
})

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Contacts', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockGet.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Contacts />)
    expect(screen.getAllByTestId('cx-skeleton').length).toBeGreaterThan(0)
  })

  it('renders contacts after loading', async () => {
    mockGet.mockResolvedValue(wrapContacts([{ client: clientA, stakeholder: contactWang }]))
    render(<Contacts />)
    await waitFor(() => {
      expect(screen.getAllByText('王五').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows error when load fails', async () => {
    mockGet.mockRejectedValue(new Error('fail'))
    render(<Contacts />)
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument()
    })
  })

  it('filters contacts by level', async () => {
    mockGet.mockResolvedValue(wrapContacts([{ client: clientA, stakeholder: contactWang }]))
    render(<Contacts />)
    await waitFor(() => screen.getAllByText('王五'))
    const filterButtons = screen.getAllByRole('button', { name: /执行/ })
    fireEvent.click(filterButtons[0])
    await waitFor(() => {
      expect(screen.getAllByText('王五').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('keeps the newest contact search when requests finish out of order', async () => {
    const oldSearch = deferred<ReturnType<typeof wrapContacts>>()
    const newSearch = deferred<ReturnType<typeof wrapContacts>>()
    mockGet.mockImplementation((_url: string, config?: { params?: { search?: string } }) => {
      if (config?.params?.search === '旧联系人') return oldSearch.promise
      if (config?.params?.search === '新联系人') return newSearch.promise
      return Promise.resolve(wrapContacts([{ client: clientA, stakeholder: contactWang }]))
    })

    render(<Contacts />)
    await screen.findAllByText('王五')
    const searchInput = screen.getByLabelText('搜索联系人')
    fireEvent.change(searchInput, { target: { value: '旧联系人' } })
    await waitFor(() => expect(mockGet.mock.calls.some(([, config]) => config?.params?.search === '旧联系人')).toBe(true))
    fireEvent.change(searchInput, { target: { value: '新联系人' } })
    await waitFor(() => expect(mockGet.mock.calls.some(([, config]) => config?.params?.search === '新联系人')).toBe(true))

    await act(async () => newSearch.resolve(wrapContacts([{
      client: clientA,
      stakeholder: { ...contactWang, id: 12, name: '最新联系人' },
    }])))
    await screen.findAllByText('最新联系人')
    await act(async () => oldSearch.resolve(wrapContacts([{
      client: clientA,
      stakeholder: { ...contactWang, id: 11, name: '过期联系人' },
    }])))
    expect(screen.getAllByText('最新联系人').length).toBeGreaterThan(0)
    expect(screen.queryByText('过期联系人')).not.toBeInTheDocument()
  })
})
