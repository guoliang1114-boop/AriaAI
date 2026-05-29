import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SkillCategoryPage } from './Skills'

const mockGet = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ categoryId: 'strategy' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children }: any) => children,
  MemoryRouter: ({ children }: any) => children,
  Routes: ({ children }: any) => children,
  Route: ({ element }: any) => element,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: any) => children,
}))

describe('SkillCategoryPage', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockNavigate.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(
      <MemoryRouter initialEntries={['/skills/category/strategy']}>
        <Routes>
          <Route path="/skills/category/:categoryId" element={<SkillCategoryPage />} />
        </Routes>
      </MemoryRouter>
    )
    // SkillsLoading now renders a structured skeleton (CxSkeleton +
    // CxTopProgress) per the design's CxLoading pattern. At least one
    // ``cx-skeleton`` block being present is enough to assert the
    // loading shell rendered.
    expect(document.querySelectorAll('[data-testid="cx-skeleton"]').length).toBeGreaterThan(0)
  })

  it('renders skills after loading', async () => {
    mockGet.mockResolvedValue([
      { id: 1, name: 'Skill A', category: 'strategy', description: 'Desc A', type: 'quick', estimated_time: '5m' },
      { id: 2, name: 'Skill B', category: 'strategy', description: 'Desc B', type: 'deep', estimated_time: '30m' },
    ])
    render(
      <MemoryRouter initialEntries={['/skills/category/strategy']}>
        <Routes>
          <Route path="/skills/category/:categoryId" element={<SkillCategoryPage />} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText('Skill A')).toBeInTheDocument()
    })
  })

  it('filters skills by search query', async () => {
    mockGet.mockResolvedValue([
      { id: 1, name: 'Skill A', category: 'strategy', description: 'Desc A', type: 'quick', estimated_time: '5m' },
      { id: 2, name: 'Skill B', category: 'strategy', description: 'Desc B', type: 'deep', estimated_time: '30m' },
    ])
    render(
      <MemoryRouter initialEntries={['/skills/category/strategy']}>
        <Routes>
          <Route path="/skills/category/:categoryId" element={<SkillCategoryPage />} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => screen.getByText('Skill A'))
    const searchInput = screen.getByPlaceholderText(/搜索/) || screen.getAllByRole('textbox')[0]
    fireEvent.change(searchInput, { target: { value: 'Skill B' } })
    expect(screen.queryByText('Skill A')).not.toBeInTheDocument()
    expect(screen.getByText('Skill B')).toBeInTheDocument()
  })
})
