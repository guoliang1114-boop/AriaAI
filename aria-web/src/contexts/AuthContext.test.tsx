import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AuthProvider, useAuth } from './AuthContext'

function TestComponent() {
  const { isAuthenticated, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{isAuthenticated ? 'authenticated' : 'anonymous'}</span>
      <button onClick={() => login('test-token', { name: 'Test User', is_admin: false })}>
        Login
      </button>
      <button onClick={logout}>Logout</button>
    </div>
  )
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <TestComponent />
    </AuthProvider>,
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts unauthenticated when no token in localStorage', () => {
    renderWithProvider()
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
  })

  it('starts authenticated when token exists in localStorage', () => {
    localStorage.setItem('authToken', 'existing-token')
    renderWithProvider()
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
  })

  it('login sets token and user in localStorage and updates state', async () => {
    const user = userEvent.setup()
    renderWithProvider()

    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')

    await user.click(screen.getByText('Login'))

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(localStorage.getItem('authToken')).toBe('test-token')
    expect(JSON.parse(localStorage.getItem('user')!)).toEqual({
      name: 'Test User',
      is_admin: false,
    })
  })

  it('logout clears token and user from localStorage and updates state', async () => {
    const user = userEvent.setup()
    localStorage.setItem('authToken', 'existing-token')
    localStorage.setItem('user', JSON.stringify({ name: 'Test' }))
    renderWithProvider()

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')

    await user.click(screen.getByText('Logout'))

    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    expect(localStorage.getItem('authToken')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('responds to auth:logout event', () => {
    localStorage.setItem('authToken', 'token')
    renderWithProvider()

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')

    act(() => {
      window.dispatchEvent(new Event('auth:logout'))
    })

    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
  })

  it('useAuth throws when used outside AuthProvider', () => {
    function BadComponent() {
      useAuth()
      return null
    }

    // Suppress console.error for this expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<BadComponent />)).toThrow('useAuth must be used within AuthProvider')
    spy.mockRestore()
  })
})
