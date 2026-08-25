import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ClientStakeholder } from '../../types/api'
import { ContactDetail } from './ContactDetail'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()
const mockNavigate = vi.fn()
let mockContactId = '5'

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: mockContactId }),
  useNavigate: () => mockNavigate,
  Link: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children: ReactNode }) => children,
}))

function makeStakeholder(overrides: Partial<ClientStakeholder> = {}): ClientStakeholder {
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

interface TestClient {
  id: number
  name: string
  industry: string
  project_names: string[]
}

function makeClient(overrides: Partial<TestClient> = {}): TestClient {
  return {
    id: 1,
    name: '客户A',
    industry: 'IT',
    project_names: ['P1'],
    ...overrides,
  }
}

interface TestBundle {
  client: TestClient
  stakeholder: ClientStakeholder
  sibling_stakeholders: ClientStakeholder[]
  projects: Array<{ id: number; name: string; status: string }>
  history: Array<Record<string, unknown>>
}

// Helper for the new single-shot ``GET /contacts/{id}`` bundle that
// replaced the old per-client stakeholder fan-out.
function makeBundle(overrides: Partial<TestBundle> = {}): TestBundle {
  return {
    client: makeClient(),
    stakeholder: makeStakeholder(),
    sibling_stakeholders: [makeStakeholder()],
    projects: [],
    history: [],
    ...overrides,
  }
}

describe('ContactDetail', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    mockPut.mockClear()
    mockNavigate.mockClear()
    mockContactId = '5'
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ContactDetail />)
    expect(screen.getAllByTestId('cx-skeleton').length).toBeGreaterThan(0)
  })

  it('renders contact data after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/contacts/5') return Promise.resolve(makeBundle())
      return Promise.resolve({})
    })
    render(<ContactDetail />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '王五' })).toBeInTheDocument()
    })
  })

  it('shows not found when contact does not exist', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/contacts/5') {
        return Promise.reject({ response: { status: 404 } })
      }
      return Promise.resolve({})
    })
    render(<ContactDetail />)
    await waitFor(() => {
      expect(screen.getByText('没有找到这个联系人')).toBeInTheDocument()
    })
  })

  it('switches tabs', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/contacts/5') {
        return Promise.resolve(
          makeBundle({
            stakeholder: makeStakeholder({ last_action: '项目例会：讨论续约推进' }),
            projects: [{ id: 9, name: 'P1', status: 'opportunity' }],
            history: [],
          }),
        )
      }
      return Promise.resolve({})
    })
    render(<ContactDetail />)
    await waitFor(() => screen.getByRole('heading', { name: '王五' }))
    fireEvent.click(screen.getByRole('button', { name: '接触历史' }))
    expect(screen.getByText('项目例会')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '相关项目' }))
    expect(screen.getAllByText('P1').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps the newest contact when route requests finish out of order', async () => {
    let resolveFirst!: (value: TestBundle) => void
    let resolveSecond!: (value: TestBundle) => void
    const first = new Promise<TestBundle>((resolve) => { resolveFirst = resolve })
    const second = new Promise<TestBundle>((resolve) => { resolveSecond = resolve })
    mockGet.mockImplementation((url: string) => url === '/contacts/5' ? first : second)

    const { rerender } = render(<ContactDetail />)
    mockContactId = '6'
    rerender(<ContactDetail />)

    await act(async () => resolveSecond(makeBundle({ stakeholder: makeStakeholder({ id: 6, name: '最新联系人' }) })))
    await screen.findByRole('heading', { name: '最新联系人' })
    await act(async () => resolveFirst(makeBundle({ stakeholder: makeStakeholder({ id: 5, name: '过期联系人' }) })))
    expect(screen.getByRole('heading', { name: '最新联系人' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '过期联系人' })).not.toBeInTheDocument()
  })
})
