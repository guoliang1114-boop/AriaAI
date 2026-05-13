import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ProjectMemoryTab } from './ProjectMemoryTab'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: any) => children,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => children,
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

vi.mock('./useProjectDetailData', () => ({
  dispatchProjectMemoryStateUpdated: vi.fn(),
}))

vi.mock('./ProjectMemoryInsightCard', () => ({
  ProjectMemoryInsightCard: ({ title }: any) => <div data-testid="insight-card">{title}</div>,
}))

vi.mock('./ProjectMemorySlotCard', () => ({
  ProjectMemorySlotCard: ({ label }: any) => <div data-testid="slot-card">{label}</div>,
}))

vi.mock('./ProjectOverviewMemoryCard', () => ({
  ProjectOverviewMemoryCard: () => <div data-testid="memory-card">Memory</div>,
}))

function makeProjectDetail(): any {
  return {
    project: { id: 1, name: '项目A', status: 'delivering', stage: 'execution', category: 'SaaS', client_id: 1, contract_amount: 1000000, context_summary: '' },
    files: [],
    milestones: [],
    folders: [],
    md_notes: '',
    todos: [],
    members: [],
    financials: { payments: [] },
  }
}

describe('ProjectMemoryTab', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
  })

  it('renders memory data after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/1/memory') return Promise.resolve({ summary: '摘要', insights: [], slots: [] })
      if (url === '/projects/1/memory/snapshots') return Promise.resolve([])
      if (url === '/clients') return Promise.resolve([])
      return Promise.resolve({})
    })
    render(<ProjectMemoryTab projectId="1" projectDetail={makeProjectDetail()} />)
    await waitFor(() => {
      expect(screen.getByTestId('memory-card')).toBeInTheDocument()
    })
  })
})
