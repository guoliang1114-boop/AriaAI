import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsLayout } from './SettingsLayout'

vi.mock('react-router-dom', () => ({
  NavLink: ({ children, to }: { children: any; to: string }) => {
    const childContent = typeof children === 'function' ? children({ isActive: false }) : children
    return <a href={to}>{childContent}</a>
  },
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh' } }),
}))

describe('SettingsLayout', () => {
  it('renders settings title and outlet', () => {
    render(<SettingsLayout />)
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('renders navigation items', () => {
    render(<SettingsLayout />)
    expect(screen.getByText('settings.profile')).toBeInTheDocument()
    expect(screen.getByText('settings.aiModel')).toBeInTheDocument()
    expect(screen.getByText('项目记忆')).toBeInTheDocument()
  })

  it('toggles nav collapse and persists to localStorage', () => {
    localStorage.clear()
    render(<SettingsLayout />)
    const toggleBtn = screen.getByRole('button')
    fireEvent.click(toggleBtn)
    expect(localStorage.getItem('aria-settings-nav-collapsed')).toBe('true')
    fireEvent.click(toggleBtn)
    expect(localStorage.getItem('aria-settings-nav-collapsed')).toBe('false')
  })
})
