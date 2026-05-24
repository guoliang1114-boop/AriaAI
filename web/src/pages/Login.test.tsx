import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Login } from './Login'

const mockNavigate = vi.fn()
const mockLogin = vi.fn()
const mockPost = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}))

vi.mock('../api/client', () => ({
  api: {
    post: (...args: any[]) => mockPost(...args),
  },
}))

describe('Login', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockLogin.mockClear()
    mockPost.mockClear()
  })

  it('renders login form elements', () => {
    render(<Login />)
    expect(screen.getByPlaceholderText('name@example.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'login.signIn' })).toBeInTheDocument()
  })

  it('shows error when login fails', async () => {
    mockPost.mockRejectedValue({ response: { data: { detail: 'Invalid credentials' } } })
    render(<Login />)

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'login.signIn' }))

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    })
  })

  it('calls login and navigates on success', async () => {
    mockPost.mockResolvedValue({ token: 'abc123', user: { id: 1, email: 'test@example.com' } })
    render(<Login />)

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'login.signIn' }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('abc123', { id: 1, email: 'test@example.com' })
      expect(mockNavigate).toHaveBeenCalledWith('/')
    })
  })

  it('shows error when no token received', async () => {
    mockPost.mockResolvedValue({ token: null })
    render(<Login />)

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'login.signIn' }))

    await waitFor(() => {
      expect(screen.getByText(/no token received/i)).toBeInTheDocument()
    })
  })
})
