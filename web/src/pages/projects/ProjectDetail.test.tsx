import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProjectDetail } from './ProjectDetail'

const mockUseProjectDetailData = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: any) => children,
  HelmetProvider: ({ children }: any) => children,
}))

vi.mock('./useProjectDetailData', () => ({
  useProjectDetailData: (...args: any[]) => mockUseProjectDetailData(...args),
}))

vi.mock('./ProjectOverviewTab', () => ({
  ProjectOverviewTab: () => <div data-testid="project-overview-tab">Overview</div>,
}))

vi.mock('./ProjectBriefingTab', () => ({
  ProjectBriefingTab: () => <div data-testid="project-briefing-tab">Briefing</div>,
}))

vi.mock('./ProjectMilestonesTab', () => ({
  ProjectMilestonesTab: () => <div data-testid="project-milestones-tab">Milestones</div>,
}))

vi.mock('./ProjectFinancialsTab', () => ({
  ProjectFinancialsTab: () => <div data-testid="project-financials-tab">Financials</div>,
}))

vi.mock('./ProjectMemoryTab', () => ({
  ProjectMemoryTab: () => <div data-testid="project-memory-tab">Memory</div>,
}))

vi.mock('./ProjectStakeholdersTab', () => ({
  ProjectStakeholdersTab: () => <div data-testid="project-stakeholders-tab">Stakeholders</div>,
}))

vi.mock('./ProjectDetailLayout', () => ({
  ProjectDetailLayout: ({ children }: any) => <div data-testid="project-detail-layout">{children}</div>,
}))

function renderWithRouter(ui: React.ReactElement, initialEntries = ['/projects/123/overview']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/projects/:id/*" element={ui} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProjectDetail', () => {
  beforeEach(() => {
    mockUseProjectDetailData.mockClear()
  })

  it('renders loading state initially', () => {
    mockUseProjectDetailData.mockReturnValue({
      error: null,
      errorStatus: null,
      initialLoading: true,
      isRefreshing: false,
      projectDetail: null,
      refreshProjectDetail: vi.fn(),
    })
    renderWithRouter(<ProjectDetail />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders overview tab by default', async () => {
    mockUseProjectDetailData.mockReturnValue({
      error: null,
      errorStatus: null,
      initialLoading: false,
      isRefreshing: false,
      projectDetail: { project: { id: 123, name: '测试项目' } },
      refreshProjectDetail: vi.fn(),
    })
    renderWithRouter(<ProjectDetail />)
    await waitFor(() => {
      expect(screen.getByTestId('project-overview-tab')).toBeInTheDocument()
    })
  })

  it('shows error state when project not found', async () => {
    mockUseProjectDetailData.mockReturnValue({
      error: 'Not found',
      errorStatus: 404,
      initialLoading: false,
      isRefreshing: false,
      projectDetail: null,
      refreshProjectDetail: vi.fn(),
    })
    renderWithRouter(<ProjectDetail />)
    await waitFor(() => {
      expect(screen.getByText('没有找到这个项目')).toBeInTheDocument()
    })
  })

  it('renders briefing tab', async () => {
    mockUseProjectDetailData.mockReturnValue({
      error: null,
      errorStatus: null,
      initialLoading: false,
      isRefreshing: false,
      projectDetail: { project: { id: 123, name: '测试项目' } },
      refreshProjectDetail: vi.fn(),
    })
    renderWithRouter(<ProjectDetail />, ['/projects/123/briefing'])
    await waitFor(() => {
      expect(screen.getByTestId('project-briefing-tab')).toBeInTheDocument()
    })
  })
})
