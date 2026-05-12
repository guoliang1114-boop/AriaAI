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
  it('renders all navigation items', () => {
    renderSidebar()
    expect(screen.getByText('nav.chat')).toBeInTheDocument()
    expect(screen.getByText('nav.skills')).toBeInTheDocument()
    expect(screen.getByText('nav.projects')).toBeInTheDocument()
    expect(screen.getByText('nav.knowledge')).toBeInTheDocument()
    expect(screen.getByText('nav.settings')).toBeInTheDocument()
  })

  it('renders AriaAI brand', () => {
    renderSidebar()
    expect(screen.getByText('AriaAI')).toBeInTheDocument()
  })

  it('renders new task button', () => {
    renderSidebar()
    expect(screen.getByText('nav.newTask')).toBeInTheDocument()
  })

  it('renders logout button', () => {
    renderSidebar()
    expect(screen.getByText('settings.signOut')).toBeInTheDocument()
  })

  it('logout clears auth token', async () => {
    localStorage.setItem('authToken', 'test-token')
    renderSidebar()
    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(screen.getByText('settings.signOut'))
    expect(localStorage.getItem('authToken')).toBeNull()
  })

  it('nav items are links with correct hrefs', () => {
    renderSidebar()
    const chatLink = screen.getByText('nav.chat').closest('a')
    expect(chatLink).toHaveAttribute('href', '/chat')
    const projectsLink = screen.getByText('nav.projects').closest('a')
    expect(projectsLink).toHaveAttribute('href', '/projects')
  })
})
