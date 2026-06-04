import { beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh.json'
import { api } from '../../api/client'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn((url: string) => {
      if (url === '/settings/') return Promise.resolve({ language: 'en-US' })
      if (url === '/auth/me') return Promise.resolve({ display_name: 'Test', email: 't@t.com' })
      return Promise.resolve({})
    }),
    put: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function initI18n() {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } },
      lng: 'en-US', fallbackLng: 'en-US', interpolation: { escapeValue: false },
    })
  }
}

function renderWithProviders(Component: React.ComponentType, path: string) {
  initI18n()
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Component />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('SettingsLayout', () => {
  it('renders without crashing', async () => {
    const { SettingsLayout } = await import('./SettingsLayout')
    const { container } = renderWithProviders(SettingsLayout, '/settings')
    expect(container).toBeTruthy()
  })
})

describe('LanguageSettings', () => {
  it('renders language options', async () => {
    const { LanguageSettings } = await import('./LanguageSettings')
    renderWithProviders(LanguageSettings, '/settings/language')
    await waitFor(() => {
      expect(screen.getByText('简体中文')).toBeInTheDocument()
      expect(screen.getByText('English')).toBeInTheDocument()
    })
  })
})

describe('AboutSettings', () => {
  it('renders without crashing', async () => {
    const { AboutSettings } = await import('./AboutSettings')
    renderWithProviders(AboutSettings, '/settings/about')
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('ProfileSettings', () => {
  it('renders without crashing', async () => {
    const { ProfileSettings } = await import('./ProfileSettings')
    renderWithProviders(ProfileSettings, '/settings')
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})

describe('AISettings', () => {
  it('renders without crashing', async () => {
    const { AISettings } = await import('./AISettings')
    renderWithProviders(AISettings, '/settings/ai')
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })

  it('persists the low-cost model as the intent router model', async () => {
    const getMock = api.get as unknown as ReturnType<typeof vi.fn>
    getMock.mockImplementation((url: string) => {
      if (url === '/settings/') {
        return Promise.resolve({
          language: 'en-US',
          selected_model: 'claude-sonnet-4-6',
          intent_router_model: 'kimi-k2.6',
        })
      }
      return Promise.resolve({})
    })

    const { AISettings } = await import('./AISettings')
    renderWithProviders(AISettings, '/settings/ai')

    await waitFor(() => {
      expect(screen.getByText('Low-cost model')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/settings/intent_router_model', { value: 'kimi-k2.6' })
      expect(api.put).toHaveBeenCalledWith('/settings/intent_router_provider', { value: 'kimi' })
    })
  })
})
