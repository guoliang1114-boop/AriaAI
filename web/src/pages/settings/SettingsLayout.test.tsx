import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsLayout } from './SettingsLayout'

vi.mock('react-router-dom', () => ({
  NavLink: ({ children, to, style }: { children: any; to: string; style?: any }) => {
    const props = { isActive: false }
    const childContent = typeof children === 'function' ? children(props) : children
    const resolvedStyle = typeof style === 'function' ? style(props) : style
    return <a href={to} style={resolvedStyle}>{childContent}</a>
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
    // Desktop sidebar + mobile/tablet pill row both render the items,
    // so use getAllByText. As long as at least one match per item is
    // there, the routes are wired.
    expect(screen.getAllByText('settings.profile').length).toBeGreaterThan(0)
    expect(screen.getAllByText('settings.aiModel').length).toBeGreaterThan(0)
    expect(screen.getAllByText('项目记忆').length).toBeGreaterThan(0)
  })

  it('groups items under the three section labels', () => {
    render(<SettingsLayout />)
    expect(screen.getByText('个人')).toBeInTheDocument()
    expect(screen.getByText('AI 与记忆')).toBeInTheDocument()
    expect(screen.getByText('管理员')).toBeInTheDocument()
  })
})
