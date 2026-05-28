import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
        // Default: name already set → the first-run modal stays closed and
        // existing tests below don't have to know about it.
        return Promise.resolve({
          preferences: { personal_info: { preferred_name: '李总' } },
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
        <Layout />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('Layout', () => {
  it('renders brand name', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('Aria AI')).toBeInTheDocument()
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
      expect(screen.queryByText('Aria AI')).not.toBeInTheDocument()
    })
  })

  it('renders user initials from display_name', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('JD')).toBeInTheDocument()
    })
    expect(screen.getByTestId('user-initials')).toHaveStyle({
      fontSize: '11px',
      lineHeight: '1',
      transform: 'scale(1)',
    })
  })

  it('uses cached user initials before /auth/me resolves', () => {
    localStorage.setItem('user', JSON.stringify({ display_name: 'Guo Liang', email: 'guo@example.com' }))
    renderLayout()

    expect(screen.getByRole('button', { name: 'User menu' })).toHaveTextContent('GL')
    expect(screen.getByTestId('user-initials')).toHaveStyle({
      fontSize: '11px',
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

  it('does not show the first-run modal when a preferred name is already set', async () => {
    renderLayout()
    // Modal must not appear after the (mocked) /user-memory resolves with a name.
    await waitFor(() => {
      expect(screen.getByText('Aria AI')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('first-run-preferred-name-modal')).not.toBeInTheDocument()
  })

  it('shows the first-run modal when /user-memory has no preferred_name', async () => {
    // Override the default mock for this one test: empty preferences.
    const { api } = await import('../api/client')
    const getMock = api.get as unknown as ReturnType<typeof vi.fn>
    getMock.mockImplementationOnce(async (url: string) => {
      // /auth/me fires first
      return { display_name: 'John Doe', email: 'john@example.com' }
    })
    getMock.mockImplementationOnce(async () => ({ timezone: 'UTC' }))
    getMock.mockImplementationOnce(async () => ({
      preferences: {},
      version: 0,
      updated_at: '',
    }))
    getMock.mockImplementationOnce(async () => ({ unread_count: 0 }))

    renderLayout()
    await waitFor(() => {
      expect(screen.getByTestId('first-run-preferred-name-modal')).toBeInTheDocument()
    })
  })
})
