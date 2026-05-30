import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  // Admin group + the memory-ops admin item are filtered out for
  // non-admins now, so most tests seed localStorage with an admin
  // user. A separate test covers the non-admin filtering.
  beforeEach(() => {
    window.localStorage.setItem(
      'user',
      JSON.stringify({ id: 1, email: 'a@b.com', display_name: 'A', is_admin: true }),
    )
  })

  afterEach(() => {
    window.localStorage.removeItem('user')
  })

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

  it('hides the admin group and admin-only items from non-admin users', () => {
    window.localStorage.setItem(
      'user',
      JSON.stringify({ id: 2, email: 'b@b.com', display_name: 'B', is_admin: false }),
    )
    render(<SettingsLayout />)
    expect(screen.queryByText('管理员')).not.toBeInTheDocument()
    expect(screen.queryByText('记忆任务中心')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.users')).not.toBeInTheDocument()
    // Personal + AI groups still render with their non-admin items.
    expect(screen.getByText('个人')).toBeInTheDocument()
    expect(screen.getByText('AI 与记忆')).toBeInTheDocument()
  })
})
