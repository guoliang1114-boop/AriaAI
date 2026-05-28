import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from './i18n/locales/en.json'
import zh from './i18n/locales/zh.json'

// Mock the API client so authenticated routes don't hang on /auth/me,
// /user-memory, /settings/, and /messages/unread-count network calls.
// The crucial mock is /user-memory returning ``onboarding_seen: true`` —
// without it Layout's first-run gate redirects every authenticated
// route to /onboarding, which would shadow the AdminGuard test.
vi.mock('./api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url === '/auth/me')
        return { id: 1, display_name: 'Test', email: 't@example.com', is_admin: false }
      if (url === '/user-memory')
        return {
          preferences: { personal_info: { onboarding_seen: true } },
          version: 1,
          updated_at: '',
        }
      if (url === '/settings/') return { timezone: 'UTC' }
      if (url === '/messages/unread-count') return { unread_count: 0 }
      return {}
    }),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
}))

import App from './App'

beforeAll(() => {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      resources: {
        'en-US': { translation: en },
        'zh-CN': { translation: zh },
      },
      lng: 'en-US',
      fallbackLng: 'en-US',
      interpolation: { escapeValue: false },
    })
  }
})

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('AuthGuard', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('redirects to /login when not authenticated', async () => {
    renderAt('/')
    await waitFor(() => {
      expect(screen.getByText('Sign In')).toBeInTheDocument()
    })
  })

  it('shows protected content when authenticated', async () => {
    localStorage.setItem('authToken', 'test-token')
    localStorage.setItem('user', JSON.stringify({ name: 'Test', is_admin: false }))
    renderAt('/')
    await waitFor(() => {
      expect(screen.queryByText('Sign In')).not.toBeInTheDocument()
    })
  })

  it('login page is accessible without authentication', async () => {
    renderAt('/login')
    await waitFor(() => {
      expect(screen.getByText('Sign In')).toBeInTheDocument()
    })
  })
})

describe('AdminGuard', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('redirects non-admin to /403', async () => {
    localStorage.setItem('authToken', 'test-token')
    localStorage.setItem('user', JSON.stringify({ name: 'Test', is_admin: false }))
    renderAt('/settings/memory-ops')
    await waitFor(() => {
      expect(screen.getByText("You don't have access to this area")).toBeInTheDocument()
    })
  })

  it('allows admin to access admin routes', async () => {
    localStorage.setItem('authToken', 'test-token')
    localStorage.setItem('user', JSON.stringify({ name: 'Admin', is_admin: true }))
    renderAt('/settings/users')
    await waitFor(() => {
      expect(screen.queryByText("You don't have access to this area")).not.toBeInTheDocument()
    })
  })
})

describe('Route configuration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders NotFound for unknown routes', async () => {
    localStorage.setItem('authToken', 'test-token')
    localStorage.setItem('user', JSON.stringify({ name: 'Test', is_admin: false }))
    renderAt('/this-route-does-not-exist')
    await waitFor(() => {
      expect(screen.getByText("This page doesn't exist")).toBeInTheDocument()
    })
  })

  it('/403 page is accessible without auth', async () => {
    renderAt('/403')
    await waitFor(() => {
      expect(screen.getByText("You don't have access to this area")).toBeInTheDocument()
    })
  })
})
