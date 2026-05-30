import { Outlet, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
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
  Palette,
  HelpCircle,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { User } from '../types/api'
import { primaryRouteLoaders } from '../routeLoaders'
import { DEFAULT_APP_TIMEZONE, setAppTimeZone } from '../utils/timezone'
import { CxLogo } from './codex/CxLogo'

interface UserMemoryFetchResponse {
  preferences: Record<string, unknown>
  version: number
  updated_at: string
}

/**
 * Has the user finished the post-login preferences onboarding flow?
 *
 * Stored as ``personal_info.onboarding_seen: true`` in user memory, which is
 * written by ``PreferenceOnboarding`` whether the user saves preferences or
 * clicks "稍后再说". Treating "seen" (rather than "preferred_name set") as
 * the gate matches the V0.0.4 follow-up decision that ALL personal preferences
 * are optional — we just need each user to land on the welcome page once.
 */
function hasSeenOnboarding(preferences: Record<string, unknown> | null): boolean {
  if (!preferences || typeof preferences !== 'object') return false
  const personal = (preferences as { personal_info?: unknown }).personal_info
  if (!personal || typeof personal !== 'object') return false
  return (personal as { onboarding_seen?: unknown }).onboarding_seen === true
}

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
  // ``null`` = haven't checked yet (don't redirect). Once loaded we know
  // whether the user has been through the post-login onboarding flow.
  const [userMemoryPrefs, setUserMemoryPrefs] = useState<Record<string, unknown> | null>(null)
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

  // First-run gate: fetch /user-memory once so we can decide whether to mount
  // the 称呼 modal. On fetch failure we fail open (empty prefs) — locking the
  // entire app out because of an API hiccup is worse than skipping onboarding.
  useEffect(() => {
    api
      .get<UserMemoryFetchResponse>('/user-memory')
      .then((response) => {
        setUserMemoryPrefs(response.preferences || {})
      })
      .catch(() => {
        setUserMemoryPrefs({})
      })
  }, [])

  // Per-route bundles are preloaded on nav-link hover/focus via
  // ``primaryRouteLoaders[item.path]`` below, so the most-likely-next
  // route is already warmed up by the time the user clicks. The
  // previous blanket ``warmPrimaryRoutes()`` (which prefetched all 9
  // primary routes on every mount) created several seconds of network
  // contention on slow connections — fast users got faster, slow users
  // got 10s+ of background traffic competing with the current page's
  // own data calls. Dropped in favor of the hover-only path.
  //
  // Exception: ``/chat`` is the single most common destination from the
  // workspace and gets pre-warmed regardless of hover, scheduled on the
  // browser's idle queue so it never competes with the current page's
  // own data calls. Cold-cache visits to /chat used to wait for the
  // 17.7 kB gzip chunk + its lucide-icon children before any React
  // code ran — a noticeable stall on slow connections. If the user is
  // already on /chat we skip (avoid a redundant import).
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) return
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const schedule = idle ?? ((cb: () => void) => window.setTimeout(cb, 1200))
    const handle = schedule(() => {
      void primaryRouteLoaders['/chat']?.()
    })
    return () => {
      const cancelIdle = (window as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
      if (cancelIdle) cancelIdle(handle as number)
      else window.clearTimeout(handle as number)
    }
  }, [location.pathname])

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
  const initialsScale = initials.length > 2 ? 0.85 : 1

  // First-run gate: ``null`` = still loading. Once loaded, redirect to
  // /onboarding ONLY if the user has not yet been through the flow. We do
  // this from Layout (rather than at the route level) so the redirect waits
  // until /user-memory has resolved — otherwise we'd flash the workspace
  // for one render before bouncing the user away.
  if (userMemoryPrefs !== null && !hasSeenOnboarding(userMemoryPrefs)) {
    return <Navigate to="/onboarding" replace />
  }

  const renderNavLink = (
    item: { path: string; label: string; icon: typeof LayoutDashboard },
    options?: { mobile?: boolean },
  ) => {
    const isActive =
      location.pathname === item.path ||
      (item.path !== '/' && location.pathname.startsWith(item.path))
    const preloadRoute = () => {
      const loader = primaryRouteLoaders[item.path]
      if (loader) void loader()
    }
    // Per ``direction-codex-part1.jsx:106``: bg-tint + ink + 500 active,
    // transparent + ink-mute + 400 idle, the ``.row-hov`` class supplies
    // hover via bg-tint background.
    return (
      <NavLink
        key={item.path}
        to={item.path}
        onMouseEnter={preloadRoute}
        onFocus={preloadRoute}
        className={`row-hov flex items-center gap-1.5 ${options?.mobile ? 'min-w-fit' : ''}`}
        style={{
          padding: '6px 12px',
          fontSize: 13.5,
          fontWeight: isActive ? 500 : 400,
          background: isActive ? 'var(--color-codex-bg-tint)' : 'transparent',
          color: isActive
            ? 'var(--color-codex-ink)'
            : 'var(--color-codex-ink-mute)',
          borderRadius: 'var(--codex-r-sm, 3px)',
        }}
      >
        <item.icon className="h-3.5 w-3.5" />
        <span>{item.label}</span>
      </NavLink>
    )
  }

  return (
    <div
      className="theme-codex flex h-full flex-col"
      style={{
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
      }}
    >
      {isProjectDetailRoute ? null : (
        <header
          className="sticky top-0 z-50"
          style={{
            background: 'var(--color-codex-bg)',
            borderBottom: '1px solid var(--color-codex-line)',
          }}
        >
          <div className="flex h-14 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <NavLink to="/" className="flex flex-shrink-0 items-center" aria-label="Aria AI">
                {/* Matches ``direction-codex-part1.jsx:101`` — small ink
                    monogram + "Aria" wordmark, no "AI" suffix. */}
                <CxLogo size={22} />
              </NavLink>

              <nav className="hidden items-center gap-0.5 md:flex">
                {navItems.map((item) => renderNavLink(item))}
              </nav>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate('/messages')}
                className="relative flex h-7 w-7 items-center justify-center transition-colors"
                style={{
                  color: 'var(--color-codex-ink-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
                  e.currentTarget.style.color = 'var(--color-codex-ink)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-codex-ink-soft)'
                }}
                title="Messages"
              >
                <Bell className="h-3.5 w-3.5" />
                {unreadCount > 0 ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 font-mono"
                    style={{
                      minWidth: 18,
                      padding: '2px 5px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      lineHeight: 1,
                      background: 'var(--color-codex-bad)',
                      color: 'var(--color-codex-bg-elev)',
                      borderRadius: 'var(--codex-r-pill, 999px)',
                    }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                ) : null}
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex h-7 w-7 items-center justify-center overflow-hidden"
                  style={{
                    background: 'var(--color-codex-accent-bg)',
                    color: 'var(--color-codex-accent-ink)',
                    borderRadius: 'var(--codex-r-pill, 999px)',
                  }}
                  aria-label="User menu"
                  title={user?.display_name || 'User'}
                >
                  {initials ? (
                    <span
                      className="block text-center font-semibold leading-none"
                      data-testid="user-initials"
                      style={{
                        fontSize: 11,
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
                  <div
                    role="menu"
                    aria-label={t('settings.title')}
                    className="animate-fade-in absolute right-0 top-full z-50 mt-2"
                    style={{
                      width: 300,
                      background: 'var(--color-codex-bg-elev)',
                      border: '1px solid var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-md, 6px)',
                      boxShadow: '0 12px 36px -8px rgba(0,0,0,0.18)',
                    }}
                  >
                    {/* Pointer up to the avatar */}
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: -7,
                        right: 12,
                        width: 12,
                        height: 12,
                        background: 'var(--color-codex-bg-elev)',
                        borderTop: '1px solid var(--color-codex-line)',
                        borderLeft: '1px solid var(--color-codex-line)',
                        transform: 'rotate(45deg)',
                      }}
                    />

                    {/* Identity card */}
                    <div
                      className="flex items-center gap-3"
                      style={{
                        padding: '16px 18px 14px',
                        borderBottom: '1px solid var(--color-codex-line-soft)',
                      }}
                    >
                      <span
                        className="inline-flex flex-shrink-0 items-center justify-center"
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 999,
                          background: 'var(--color-codex-accent-bg)',
                          color: 'var(--color-codex-accent-ink)',
                          fontSize: 16,
                          fontWeight: 500,
                        }}
                      >
                        {initials || <UserRound className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--color-codex-ink)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {user?.display_name || 'User'}
                        </p>
                        <p
                          className="truncate font-mono"
                          style={{
                            margin: '2px 0 0',
                            fontSize: 11.5,
                            color: 'var(--color-codex-ink-mute)',
                          }}
                        >
                          {user?.email || ''}
                        </p>
                      </div>
                    </div>

                    {/* Primary items */}
                    <div
                      style={{
                        padding: '8px 10px',
                        borderBottom: '1px solid var(--color-codex-line-soft)',
                      }}
                    >
                      {[
                        { to: '/settings', icon: UserRound, label: t('settings.profile.title', { defaultValue: '个人资料' }) },
                        { to: '/settings/appearance', icon: Palette, label: t('settings.appearance.title', { defaultValue: '外观' }) },
                        { to: '/settings/preferences', icon: Settings, label: t('settings.preferences.title', { defaultValue: '偏好设置' }) },
                        { to: '/messages', icon: Bell, label: t('settings.messages.title', { defaultValue: '消息中心' }) },
                        { to: '/settings/about', icon: HelpCircle, label: t('settings.about.title', { defaultValue: '帮助文档' }) },
                      ].map((entry) => (
                        <NavLink
                          key={entry.to}
                          to={entry.to}
                          role="menuitem"
                          onClick={() => setShowUserMenu(false)}
                          className="row-hov flex w-full items-center gap-2.5"
                          style={{
                            padding: '8px 8px',
                            fontSize: 13,
                            color: 'var(--color-codex-ink-soft)',
                            borderRadius: 'var(--codex-r-sm, 6px)',
                          }}
                        >
                          <entry.icon
                            className="h-3.5 w-3.5 flex-shrink-0"
                            style={{ color: 'var(--color-codex-ink-mute)' }}
                          />
                          <span className="flex-1">{entry.label}</span>
                        </NavLink>
                      ))}
                    </div>

                    {/* Logout */}
                    <div style={{ padding: '8px 10px' }}>
                      <button
                        onClick={handleLogout}
                        role="menuitem"
                        className="row-hov cx-no-hover flex w-full items-center gap-2.5"
                        style={{
                          padding: '8px 8px',
                          fontSize: 13,
                          color: 'var(--color-codex-bad)',
                          borderRadius: 'var(--codex-r-sm, 6px)',
                        }}
                      >
                        <LogOut
                          className="h-3.5 w-3.5 flex-shrink-0"
                          style={{ color: 'var(--color-codex-bad)' }}
                        />
                        <span className="flex-1 text-left">{t('settings.signOut')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto px-3 py-2 md:hidden"
            style={{ borderTop: '1px solid var(--color-codex-line-soft)' }}
          >
            {navItems.map((item) => renderNavLink(item, { mobile: true }))}
          </nav>
        </header>
      )}

      <main
        className="app-ui flex-1 overflow-auto"
        style={{ background: 'var(--color-codex-bg)' }}
      >
        <Outlet />
      </main>
    </div>
  )
}
