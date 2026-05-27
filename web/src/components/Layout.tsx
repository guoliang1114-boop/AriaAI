import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  MessageSquare,
  Bell,
  Wrench,
  FolderKanban,
  Building2,
  Users,
  BookOpen,
  LogOut,
  Settings,
  UserRound,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { User } from '../types/api'
import { primaryRouteLoaders, warmPrimaryRoutes } from '../routeLoaders'
import { DEFAULT_APP_TIMEZONE, setAppTimeZone } from '../utils/timezone'

function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<User>
    if (!parsed || typeof parsed !== 'object') return null
    const displayName = typeof parsed.display_name === 'string' ? parsed.display_name.trim() : ''
    const email = typeof parsed.email === 'string' ? parsed.email : ''
    if (!displayName && !email) return null
    return {
      id: typeof parsed.id === 'number' ? parsed.id : 0,
      email,
      display_name: displayName || email,
      is_admin: !!parsed.is_admin,
      is_active: parsed.is_active !== false,
    }
  } catch {
    return null
  }
}

function getUserInitials(user: User | null) {
  const name = user?.display_name?.trim()
  if (!name) return ''
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
  }
  return Array.from(words[0] || name).slice(0, 2).join('').toUpperCase()
}

export function Layout() {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const location = useLocation()
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [user, setUser] = useState<User | null>(() => getStoredUser())
  const [unreadCount, setUnreadCount] = useState(0)
  const isProjectDetailRoute = /^\/projects\/(?!new(?:\/|$))[^/]+/.test(location.pathname)

  const navItems = [
    { path: '/', label: isZh ? '工作台' : 'Workspace', icon: LayoutDashboard },
    { path: '/chat', label: t('nav.chat'), icon: MessageSquare },
    { path: '/skills', label: t('nav.skills'), icon: Wrench },
    { path: '/projects', label: t('nav.projects'), icon: FolderKanban },
    { path: '/clients', label: t('nav.clients') || '客户', icon: Building2 },
    { path: '/contacts', label: isZh ? '联系人' : 'Contacts', icon: Users },
    { path: '/knowledge', label: t('nav.knowledge'), icon: BookOpen },
  ]

  useEffect(() => {
    api.get<User>('/auth/me')
      .then((nextUser) => {
        setUser(nextUser)
        localStorage.setItem('user', JSON.stringify(nextUser))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    api.get<Record<string, string>>('/settings/')
      .then((settings) => {
        setAppTimeZone(settings.timezone || DEFAULT_APP_TIMEZONE)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const scheduleWarmup = () => {
      void warmPrimaryRoutes()
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(scheduleWarmup, { timeout: 1200 })
      return () => window.cancelIdleCallback(idleId)
    }

    const timer = setTimeout(scheduleWarmup, 400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const loadUnreadCount = () => {
      api
        .get<{ unread_count: number }>('/messages/unread-count')
        .then((result) => setUnreadCount(result.unread_count || 0))
        .catch(() => {})
    }

    loadUnreadCount()
    const handleMessagesUpdated = () => loadUnreadCount()
    window.addEventListener('messages:updated', handleMessagesUpdated)
    return () => {
      window.removeEventListener('messages:updated', handleMessagesUpdated)
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    window.location.href = '/login'
  }

  const initials = getUserInitials(user)
  const initialsScale = initials.length >= 2 ? 0.82 : 0.92

  return (
    <div className="flex h-full flex-col bg-surface">
      {isProjectDetailRoute ? null : (
        <header className="glass sticky top-0 z-50 border-b border-outline/10">
          <div className="flex h-14 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <NavLink to="/" className="flex flex-shrink-0 items-center gap-2">
                <span className="font-manrope text-lg font-bold text-primary">Aria AI</span>
              </NavLink>

              <nav className="hidden items-center gap-0.5 md:flex">
                {navItems.map((item) => {
                  const isActive =
                    location.pathname === item.path ||
                    (item.path !== '/' && location.pathname.startsWith(item.path))
                  const preloadRoute = () => {
                    const loader = primaryRouteLoaders[item.path]
                    if (loader) void loader()
                  }

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onMouseEnter={preloadRoute}
                      onFocus={preloadRoute}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-secondary-container/50 text-primary'
                          : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  )
                })}
              </nav>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate('/messages')}
                className="relative flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-low hover:text-on-surface"
                title="Messages"
              >
                <Bell className="h-3.5 w-3.5" />
                {unreadCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-error px-1.5 py-0.5 text-xs font-semibold leading-none text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                ) : null}
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gradient-primary text-white"
                  aria-label="User menu"
                  title={user?.display_name || 'User'}
                >
                  {initials ? (
                    <span
                      className="block max-w-[18px] text-center font-semibold leading-none"
                      data-testid="user-initials"
                      style={{
                        fontSize: '8px',
                        lineHeight: 1,
                        transform: `scale(${initialsScale})`,
                        transformOrigin: 'center',
                      }}
                    >
                      {initials}
                    </span>
                  ) : (
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>

                {showUserMenu && (
                  <div className="animate-fade-in absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-outline/10 bg-surface-container-lowest py-1.5 shadow-lg">
                    <div className="border-b border-outline/10 px-4 py-2.5">
                      <p className="text-sm font-medium text-on-surface">{user?.display_name || 'User'}</p>
                      <p className="truncate text-xs text-on-surface-muted">{user?.email || ''}</p>
                    </div>
                    <NavLink
                      to="/messages"
                      onClick={() => setShowUserMenu(false)}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-low"
                    >
                      <Bell className="h-4 w-4" />
                      Messages
                    </NavLink>
                    <NavLink
                      to="/settings"
                      onClick={() => setShowUserMenu(false)}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-low"
                    >
                      <Settings className="h-4 w-4" />
                      {t('settings.title')}
                    </NavLink>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-low"
                    >
                      <LogOut className="h-4 w-4" />
                      {t('settings.signOut')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-outline/10 px-3 py-2 md:hidden">
            {navItems.map((item) => {
              const isActive =
                location.pathname === item.path ||
                (item.path !== '/' && location.pathname.startsWith(item.path))
              const preloadRoute = () => {
                const loader = primaryRouteLoaders[item.path]
                if (loader) void loader()
              }

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onMouseEnter={preloadRoute}
                  onFocus={preloadRoute}
                  className={`flex min-w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-secondary-container/60 text-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>
        </header>
      )}

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
