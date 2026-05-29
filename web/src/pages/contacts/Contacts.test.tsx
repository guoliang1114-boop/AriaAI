import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Contacts } from './Contacts'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

const mockGet = vi.fn()
const mockPut = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    put: (...args: any[]) => mockPut(...args),
  },
}))

describe('Contacts', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockGet.mockClear()
    mockPut.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Contacts />)
    expect(screen.getAllByTestId('cx-skeleton').length).toBeGreaterThan(0)
  })

  it('renders contacts after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') {
        return Promise.resolve([
          { id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] },
        ])
      }
      if (url === '/clients/1/stakeholders') {
        return Promise.resolve([
          { id: 10, name: '王五', role: '经理', contact: 'wang@example.com', relationship_status: '', note: '', organization_level: '', influence_type: '', communication_preference: '', personality_profile: '', decision_style: '', communication_strategy: '', trust_signals: '' },
        ])
      }
      return Promise.resolve([])
    })
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
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') {
        return Promise.resolve([
          { id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] },
        ])
      }
      if (url === '/clients/1/stakeholders') {
        return Promise.resolve([
          { id: 10, name: '王五', role: '经理', contact: 'wang@example.com', relationship_status: '', note: '', organization_level: '', influence_type: '', communication_preference: '', personality_profile: '', decision_style: '', communication_strategy: '', trust_signals: '' },
        ])
      }
      return Promise.resolve([])
    })
    render(<Contacts />)
    await waitFor(() => screen.getAllByText('王五'))
    const filterButtons = screen.getAllByRole('button', { name: /执行/ })
    fireEvent.click(filterButtons[0])
    await waitFor(() => {
      expect(screen.getAllByText('王五').length).toBeGreaterThanOrEqual(1)
    })
  })
})
