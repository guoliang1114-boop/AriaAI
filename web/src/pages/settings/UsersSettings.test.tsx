import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { UsersSettings } from './UsersSettings'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPatch = vi.fn()
const mockDelete = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    patch: (...args: any[]) => mockPatch(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('UsersSettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    mockPatch.mockClear()
    mockDelete.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<UsersSettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders users after loading', async () => {
    mockGet.mockResolvedValue([
      { id: 1, email: 'a@example.com', display_name: 'Alice', is_admin: true, is_active: true },
      { id: 2, email: 'b@example.com', display_name: 'Bob', is_admin: false, is_active: true },
    ])
    render(<UsersSettings />)
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
  })

  it('filters users by search query', async () => {
    mockGet.mockResolvedValue([
      { id: 1, email: 'alice@example.com', display_name: 'Alice', is_admin: false, is_active: true },
      { id: 2, email: 'bob@example.com', display_name: 'Bob', is_admin: false, is_active: true },
    ])
    render(<UsersSettings />)
    await waitFor(() => screen.getByText('Alice'))
    const searchInput = screen.getByPlaceholderText(/search/i) || screen.getAllByRole('textbox')[0]
    fireEvent.change(searchInput, { target: { value: 'Bob' } })
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('deletes a user', async () => {
    mockGet.mockResolvedValue([
      { id: 1, email: 'a@example.com', display_name: 'Alice', is_admin: false, is_active: true },
    ])
    mockDelete.mockResolvedValue({})
    render(<UsersSettings />)
    await waitFor(() => screen.getByText('Alice'))
    const deleteBtn = screen.getByTitle('users.delete')
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(screen.getByText('users.deleteUser')).toBeInTheDocument()
    })
  })
})
