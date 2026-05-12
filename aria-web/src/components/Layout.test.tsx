import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from '../i18n/locales/en.json'
import zh from '../i18n/locales/zh.json'
import { Layout } from './Layout'

const mockGet = vi.fn((url: string) => {
  if (url === '/auth/me') return Promise.resolve({ display_name: 'Test User', email: 'test@example.com' })
  if (url === '/settings/') return Promise.resolve({ timezone: 'UTC' })
  if (url === '/messages/unread-count') return Promise.resolve({ unread_count: 5 })
  return Promise.resolve({})
})

vi.mock('../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(args[0]),
    post: vi.fn(() => Promise.resolve({})),
  },
}))

beforeEach(() => {
  localStorage.clear()
  mockGet.mockClear()
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
  it('renders Aria AI brand', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('Aria AI')).toBeInTheDocument()
    })
  })

  it('renders nav items', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('nav.dashboard')).toBeInTheDocument()
      expect(screen.getByText('nav.chat')).toBeInTheDocument()
      expect(screen.getByText('nav.skills')).toBeInTheDocument()
      expect(screen.getByText('nav.projects')).toBeInTheDocument()
      expect(screen.getByText('nav.knowledge')).toBeInTheDocument()
    })
  })

  it('renders user initials in avatar', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('TU')).toBeInTheDocument()
    })
  })

  it('shows unread badge', async () => {
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  it('shows 99+ for large unread count', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ display_name: 'Test User', email: 't@t.com' })
      if (url === '/settings/') return Promise.resolve({})
      if (url === '/messages/unread-count') return Promise.resolve({ unread_count: 150 })
      return Promise.resolve({})
    })
    renderLayout()
    await waitFor(() => {
      expect(screen.getByText('99+')).toBeInTheDocument()
    })
  })

  it('user menu toggles on avatar click', async () => {
    renderLayout()
    const user = (await import('@testing-library/user-event')).default.setup()
    await waitFor(() => {
      expect(screen.getByText('TU')).toBeInTheDocument()
    })
    await user.click(screen.getByText('TU'))
    await waitFor(() => {
      expect(screen.getByText('Test User')).toBeInTheDocument()
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })
  })

  it('fetches user data on mount', async () => {
    renderLayout()
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/auth/me')
      expect(mockGet).toHaveBeenCalledWith('/settings/')
      expect(mockGet).toHaveBeenCalledWith('/messages/unread-count')
    })
  })
})
