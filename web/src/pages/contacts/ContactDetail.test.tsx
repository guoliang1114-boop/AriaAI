import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ContactDetail } from './ContactDetail'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    put: (...args: any[]) => mockPut(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: '5' }),
  useNavigate: () => mockNavigate,
  Link: ({ children }: any) => children,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: any) => children,
}))

function makeStakeholder(overrides: Partial<any> = {}) {
  return {
    id: 5,
    client_id: 1,
    name: '王五',
    role: '经理',
    organization_level: '高级',
    influence_type: '决策型',
    relationship_status: '良好',
    concerns: '',
    sensitivities: '',
    communication_preference: '邮件',
    contact: '13800000000',
    last_action: '',
    personality_profile: '',
    decision_style: '',
    communication_strategy: '',
    trust_signals: '',
    note: '',
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  }
}

function makeClient(overrides: Partial<any> = {}) {
  return {
    id: 1,
    name: '客户A',
    industry: 'IT',
    project_names: ['P1'],
    ...overrides,
  }
}

describe('ContactDetail', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    mockPut.mockClear()
    mockNavigate.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ContactDetail />)
    expect(screen.getAllByTestId('cx-skeleton').length).toBeGreaterThan(0)
  })

  it('renders contact data after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') {
        return Promise.resolve([makeClient()])
      }
      if (url === '/clients/1/stakeholders') {
        return Promise.resolve([makeStakeholder()])
      }
      return Promise.resolve({})
    })
    render(<ContactDetail />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '王五' })).toBeInTheDocument()
    })
  })

  it('shows not found when contact does not exist', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') return Promise.resolve([makeClient()])
      if (url === '/clients/1/stakeholders') return Promise.resolve([makeStakeholder({ id: 2, name: '李四' })])
      return Promise.resolve({})
    })
    render(<ContactDetail />)
    await waitFor(() => {
      expect(screen.getByText('没有找到这个联系人')).toBeInTheDocument()
    })
  })

  it('switches tabs', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') return Promise.resolve([makeClient()])
      if (url === '/clients/1/stakeholders') {
        return Promise.resolve([makeStakeholder({ last_action: '项目例会：讨论续约推进' })])
      }
      if (url === '/clients/1/projects') return Promise.resolve([{ id: 9, name: 'P1', status: 'opportunity' }])
      if (url === '/clients/1/stakeholders/5/history') return Promise.resolve([])
      return Promise.resolve({})
    })
    render(<ContactDetail />)
    await waitFor(() => screen.getByRole('heading', { name: '王五' }))
    fireEvent.click(screen.getByRole('button', { name: '接触历史' }))
    expect(screen.getByText('项目例会')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '相关项目' }))
    expect(screen.getAllByText('P1').length).toBeGreaterThanOrEqual(1)
  })
})
