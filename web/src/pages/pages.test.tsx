import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from '../i18n/locales/en.json'
import zh from '../i18n/locales/zh.json'

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn((url: string) => {
      if (url === '/clients/list') {
        return Promise.resolve({ items: [], total: 0, limit: 10, offset: 0, stats: { total: 0, active: 0, watch: 0, dormant: 0 } })
      }
      if (url === '/contacts') {
        return Promise.resolve({ items: [], total: 0, limit: 10, offset: 0, clients: [], partial_failures: 0 })
      }
      if (url === '/knowledge/documents/list') {
        return Promise.resolve({ items: [], total: 0, limit: 10, offset: 0, categories: [], recent: [], indexed_count: 0, total_size: 0 })
      }
      if (url === '/knowledge/stats') {
        return Promise.resolve({ document_count: 0, total_vectors: 0 })
      }
      if (url === '/skills/meta/list') {
        return Promise.resolve({ items: [], total: 0, limit: 10, offset: 0, categories: [] })
      }
      if (url === '/auth/users/list') {
        return Promise.resolve({ items: [], total: 0, limit: 10, offset: 0 })
      }
      if (url === '/messages/admin/list') {
        return Promise.resolve({ items: [], total: 0, limit: 10, offset: 0, published_count: 0, total_read_count: 0 })
      }
      return Promise.resolve([])
    }),
    post: vi.fn(() => Promise.resolve({})),
    put: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
}))

function initI18n() {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } },
      lng: 'en-US', fallbackLng: 'en-US', interpolation: { escapeValue: false },
    })
  }
}

function renderPage(path: string, Component: React.ComponentType) {
  initI18n()
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Component />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('Chat page smoke test', () => {
  it('renders without crashing', async () => {
    const { Chat } = await import('../pages/chat/Chat')
    renderPage('/chat', Chat)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('Clients page smoke test', () => {
  it('renders without crashing', async () => {
    const { Clients } = await import('../pages/clients/Clients')
    renderPage('/clients', Clients)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('Contacts page smoke test', () => {
  it('renders without crashing', async () => {
    const { Contacts } = await import('../pages/contacts/Contacts')
    renderPage('/contacts', Contacts)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('Knowledge page smoke test', () => {
  it('renders without crashing', async () => {
    const { Knowledge } = await import('../pages/knowledge/Knowledge')
    renderPage('/knowledge', Knowledge)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('Projects page smoke test', () => {
  it('renders without crashing', async () => {
    const { Projects } = await import('../pages/projects/Projects')
    renderPage('/projects', Projects)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('Skills page smoke test', () => {
  it('renders Skills without crashing', async () => {
    const { Skills } = await import('../pages/skills/Skills')
    renderPage('/skills', Skills)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('SettingsLayout smoke test', () => {
  it('renders without crashing', async () => {
    const { SettingsLayout } = await import('../pages/settings/SettingsLayout')
    renderPage('/settings', SettingsLayout)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('MessagesPage smoke test', () => {
  it('renders without crashing', async () => {
    const { MessagesPage } = await import('../pages/messages/MessagesPage')
    renderPage('/messages', MessagesPage)
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})
