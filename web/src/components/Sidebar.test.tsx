import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from '../i18n/locales/en.json'
import zh from '../i18n/locales/zh.json'
import { Sidebar } from './Sidebar'

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

function renderSidebar(path = '/chat') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('Sidebar', () => {
  it('renders AriaAI brand', () => {
    renderSidebar()
    expect(screen.getByText('AriaAI')).toBeInTheDocument()
  })

  it('renders all navigation links', () => {
    renderSidebar()
    const links = screen.getAllByRole('link')
    const hrefs = links.map(l => l.getAttribute('href'))
    expect(hrefs).toContain('/chat')
    expect(hrefs).toContain('/skills')
    expect(hrefs).toContain('/projects')
    expect(hrefs).toContain('/knowledge')
    expect(hrefs).toContain('/settings')
  })

  it('renders buttons (new task + logout)', () => {
    renderSidebar()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('has a link to /chat for new task', () => {
    renderSidebar()
    const links = screen.getAllByRole('link')
    const chatLinks = links.filter(l => l.getAttribute('href') === '/chat')
    expect(chatLinks.length).toBeGreaterThanOrEqual(1)
  })

  it('logout clears auth token', async () => {
    localStorage.setItem('authToken', 'test-token')
    renderSidebar()
    const user = (await import('@testing-library/user-event')).default.setup()
    const buttons = screen.getAllByRole('button')
    // The logout button is the last one in the sidebar
    const logoutBtn = buttons[buttons.length - 1]
    await user.click(logoutBtn)
    expect(localStorage.getItem('authToken')).toBeNull()
  })
})
