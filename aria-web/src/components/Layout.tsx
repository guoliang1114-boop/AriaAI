import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  MessageSquare,
  Wrench,
  FolderKanban,
  Building2,
  BookOpen,
  LogOut,
  Settings
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { User } from '../types/api'

export function Layout() {
  const { t } = useTranslation()
  const location = useLocation()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [user, setUser] = useState<User | null>(null)

  const navItems = [
    { path: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { path: '/chat', label: t('nav.chat'), icon: MessageSquare },
    { path: '/skills', label: t('nav.skills'), icon: Wrench },
    { path: '/projects', label: t('nav.projects'), icon: FolderKanban },
    { path: '/clients', label: t('nav.clients') || '客户', icon: Building2 },
    { path: '/knowledge', label: t('nav.knowledge'), icon: BookOpen },
  ]

  useEffect(() => {
    api.get<User>('/auth/me').then(setUser).catch(() => {})
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    window.location.href = '/login'
  }

  const initials = user?.display_name
    ? user.display_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'A'

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Top Navigation */}
      <header className="glass sticky top-0 z-50 border-b border-outline/10">
        <div className="flex items-center justify-between px-6 h-14">
          {/* Logo + Nav */}
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2 flex-shrink-0">
              <span className="font-manrope text-lg font-bold text-primary">Aria AI</span>
            </NavLink>

            <nav className="hidden md:flex items-center gap-0.5">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path ||
                  (item.path !== '/' && location.pathname.startsWith(item.path))
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'text-primary bg-secondary-container/50'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </NavLink>
                )
              })}
            </nav>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center text-white font-semibold text-xs"
                title={user?.display_name || 'User'}
              >
                {initials}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-surface-container-lowest rounded-xl shadow-lg border border-outline/10 py-1.5 animate-fade-in z-50">
                  <div className="px-4 py-2.5 border-b border-outline/10">
                    <p className="text-sm font-medium text-on-surface">{user?.display_name || 'User'}</p>
                    <p className="text-xs text-on-surface-muted truncate">{user?.email || ''}</p>
                  </div>
                  <NavLink
                    to="/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    {t('settings.title')}
                  </NavLink>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
