import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from '../i18n/locales/en.json'
import zh from '../i18n/locales/zh.json'
import { Layout } from './Layout'

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ display_name: 'John Doe', email: 'john@example.com' })
      if (url === '/settings/') return Promise.resolve({ timezone: 'UTC' })
      if (url === '/messages/unread-count') return Promise.resolve({ unread_count: 7 })
      if (url === '/user-memory')
        // Default: onboarding already done → no redirect to /onboarding and
        // the existing layout assertions below run as normal.
        return Promise.resolve({
          preferences: { personal_info: { preferred_name: '李总', onboarding_seen: true } },
          version: 1,
          updated_at: '',
        })
      return Promise.resolve({})
    }),
    put: vi.fn(() => Promise.resolve({ preferences: {}, version: 1, updated_at: '' })),
    post: vi.fn(() => Promise.resolve({})),
  },
}))

beforeEach(() => {
  localStorage.clear()
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } },
      lng: 'en-US',
      fallbackLng: 'en-US',
      interpolation: { escapeValue: false },
    })
  }
})

function renderLayout(path = '/') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/403" element={<div data-testid="forbidden-stub">403</div>} />
          <Route path="/onboarding" element={<div data-testid="onboarding-stub">onboarding</div>} />
          <Route path="*" element={<Layout />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('Layout', () => {
  it('renders brand name', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByTestId('cx-logo')).toBeInTheDocument()
    })
  })

  it('renders nav links', async () => {
    renderLayout()
    await waitFor(() => {
      const links = screen.getAllByRole('link')
      const hrefs = links.map(l => l.getAttribute('href'))
      expect(hrefs).toContain('/')
      expect(hrefs).toContain('/chat')
      expect(hrefs).toContain('/projects')
      expect(hrefs).toContain('/knowledge')
    })
  })

  it('hides primary navigation on project detail routes', async () => {
    renderLayout('/projects/27')
    await waitFor(() => {
      expect(screen.queryByTestId('cx-logo')).not.toBeInTheDocument()
    })
  })

  it('renders user initials from display_name', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('JD')).toBeInTheDocument()
    })
    expect(screen.getByTestId('user-initials')).toHaveStyle({
      fontSize: '12px',
      lineHeight: '1',
      transform: 'scale(1)',
    })
  })

  it('uses cached user initials before /auth/me resolves', () => {
    localStorage.setItem('user', JSON.stringify({ display_name: 'Guo Liang', email: 'guo@example.com' }))
    renderLayout()

    expect(screen.getByRole('button', { name: 'User menu' })).toHaveTextContent('GL')
    expect(screen.getByTestId('user-initials')).toHaveStyle({
      fontSize: '12px',
      transform: 'scale(1)',
    })
  })

  it('does not flash a placeholder letter while user data loads', () => {
    renderLayout()

    expect(screen.getByRole('button', { name: 'User menu' })).toHaveTextContent('')
  })

  it('shows unread badge count', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument()
    })
  })

  it('does not redirect to /onboarding when onboarding_seen is true', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByTestId('cx-logo')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('onboarding-stub')).not.toBeInTheDocument()
  })

  it('redirects to /onboarding when /user-memory has no onboarding_seen flag', async () => {
    const { api } = await import('../api/client')
    const getMock = api.get as unknown as ReturnType<typeof vi.fn>
    // Reorder is not deterministic across effects; intercept by URL instead.
    getMock.mockImplementation((url: string) => {
      if (url === '/auth/me')
        return Promise.resolve({ display_name: 'John Doe', email: 'john@example.com' })
      if (url === '/settings/') return Promise.resolve({ timezone: 'UTC' })
      if (url === '/messages/unread-count') return Promise.resolve({ unread_count: 0 })
      if (url === '/user-memory')
        return Promise.resolve({ preferences: {}, version: 0, updated_at: '' })
      return Promise.resolve({})
    })

    renderLayout()
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-stub')).toBeInTheDocument()
    })
    // The Layout header should NOT render once the redirect lands.
    expect(screen.queryByTestId('cx-logo')).not.toBeInTheDocument()
  })

  it('redirects to /403 instead of /onboarding when /user-memory is unavailable', async () => {
    const { api } = await import('../api/client')
    const getMock = api.get as unknown as ReturnType<typeof vi.fn>
    getMock.mockImplementation((url: string) => {
      if (url === '/auth/me')
        return Promise.resolve({ display_name: 'John Doe', email: 'john@example.com' })
      if (url === '/settings/') return Promise.resolve({ timezone: 'UTC' })
      if (url === '/messages/unread-count') return Promise.resolve({ unread_count: 0 })
      if (url === '/user-memory')
        return Promise.reject({ response: { status: 503 } })
      return Promise.resolve({})
    })

    renderLayout()
    await waitFor(() => {
      expect(screen.getByTestId('forbidden-stub')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('onboarding-stub')).not.toBeInTheDocument()
  })
})
