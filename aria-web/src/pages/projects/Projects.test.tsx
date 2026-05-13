import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh.json'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve([])),
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

describe('Projects page', () => {
  it('renders without crashing', async () => {
    initI18n()
    const { Projects } = await import('./Projects')
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/projects']}>
          <Projects />
        </MemoryRouter>
      </I18nextProvider>,
    )
    await waitFor(() => {
      expect(document.body.textContent).toBeTruthy()
    })
  })
})
