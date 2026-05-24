import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MigrationSettings } from './MigrationSettings'

const mockGet = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' } }),
}))

describe('MigrationSettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<MigrationSettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders governance data after loading', async () => {
    mockGet.mockResolvedValue({
      mode: 'alembic',
      current_revision: 'abc123',
      latest_revision: 'abc123',
      known_revisions: ['abc123', 'def456'],
      pending_revisions: [],
      pending_count: 0,
      up_to_date: true,
    })
    render(<MigrationSettings />)
    await waitFor(() => {
      expect(screen.getByText('迁移状态正常')).toBeInTheDocument()
      expect(screen.getByText('alembic')).toBeInTheDocument()
      expect(screen.getAllByText('abc123')[0]).toBeInTheDocument()
    })
  })

  it('shows warning state when pending migrations exist', async () => {
    mockGet.mockResolvedValue({
      mode: 'alembic',
      current_revision: 'abc123',
      latest_revision: 'def456',
      known_revisions: ['abc123', 'def456'],
      pending_revisions: ['def456'],
      pending_count: 1,
      up_to_date: false,
    })
    render(<MigrationSettings />)
    await waitFor(() => {
      expect(screen.getByText('需要关注迁移状态')).toBeInTheDocument()
      expect(screen.getAllByText('def456')[0]).toBeInTheDocument()
    })
  })

  it('shows error state when load fails', async () => {
    mockGet.mockRejectedValue(new Error('network error'))
    render(<MigrationSettings />)
    await waitFor(() => {
      expect(screen.getByText(/加载迁移状态失败/)).toBeInTheDocument()
    })
  })

  it('refreshes on button click', async () => {
    mockGet.mockResolvedValue({
      mode: 'alembic',
      pending_count: 0,
      up_to_date: true,
    })
    render(<MigrationSettings />)
    await waitFor(() => screen.getByText('迁移状态正常'))
    mockGet.mockClear()
    mockGet.mockResolvedValue({
      mode: 'alembic',
      pending_count: 0,
      up_to_date: true,
    })
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }))
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/health/db/migrations')
    })
  })
})
