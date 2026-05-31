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

vi.mock('./ProjectMemorySlotCard', () => ({
  ProjectMemorySlotCard: ({ title }: any) => <div data-testid="slot-card">{title}</div>,
}))

function makeProjectDetail(): any {
  return {
    project: {
      id: 1,
      name: '项目A',
      status: 'delivering',
      memory_version: 12,
      memory_updated_at: '2026-05-31T08:00:00Z',
      memory_stale: false,
    },
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

  it('renders the memory header strip and structured section divider after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/1/memory') {
        return Promise.resolve({
          project_id: 1,
          memory: {
            project_brief: '一句话项目简介',
            current_stage: '机会期',
            current_objective: 'Q3 POC',
            recent_progress: [],
            key_risks: ['关键风险一'],
            open_questions: [],
            next_actions: ['下一步动作'],
            important_documents: [],
            financial_status: '',
            delivery_signals: [],
            stakeholder_notes: [],
            memory_version: 12,
            last_updated_at: '2026-05-31T08:00:00Z',
            stale: false,
          },
          memory_version: 12,
          memory_stale: false,
          memory_updated_at: '2026-05-31T08:00:00Z',
        })
      }
      if (url === '/projects/1/memory/snapshots') return Promise.resolve([])
      return Promise.resolve({})
    })
    render(<ProjectMemoryTab projectId="1" projectDetail={makeProjectDetail()} />)
    await waitFor(() => {
      expect(screen.getByText('项目记忆 v12')).toBeInTheDocument()
      expect(screen.getByText('结构化记忆')).toBeInTheDocument()
    })
  })
})
