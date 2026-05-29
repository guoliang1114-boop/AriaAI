import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  Brain,
  ChevronLeft,
  ChevronRight,
  Database,
  Gauge,
  GitBranch,
  Globe,
  Info,
  ListChecks,
  Palette,
  Server,
  User,
  Users,
} from 'lucide-react'
import { PageTitle } from '../../components/PageTitle'

const SETTINGS_NAV_COLLAPSED_KEY = 'aria-settings-nav-collapsed'

export function SettingsLayout() {
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [navCollapsed, setNavCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SETTINGS_NAV_COLLAPSED_KEY) === 'true'
  })

  const settingNavItems = [
    { path: '', icon: User, label: t('settings.profile') },
    { path: 'appearance', icon: Palette, label: t('settings.appearance') },
    { path: 'ai', icon: Brain, label: t('settings.aiModel') },
    { path: 'memory', icon: Database, label: isZh ? '项目记忆' : 'Project Memory' },
    { path: 'client-memory', icon: Users, label: isZh ? '客户记忆' : 'Client Memory' },
    { path: 'memory-ops', icon: ListChecks, label: isZh ? '记忆任务中心' : 'Memory Operations' },
    { path: 'api-limits', icon: Gauge, label: isZh ? 'API 限流' : 'API Limits' },
    { path: 'migrations', icon: GitBranch, label: isZh ? '迁移状态' : 'Migrations' },
    { path: 'messages', icon: Bell, label: isZh ? '消息管理' : 'Message Manager' },
    { path: 'server', icon: Server, label: t('settings.server.title') },
    { path: 'language', icon: Globe, label: t('settings.language') },
    { path: 'users', icon: Users, label: t('settings.users') },
    { path: 'about', icon: Info, label: t('settings.about') },
  ]

  const toggleNavCollapsed = () => {
    setNavCollapsed((current) => {
      const next = !current
      window.localStorage.setItem(SETTINGS_NAV_COLLAPSED_KEY, String(next))
      return next
    })
  }

  return (
    <>
      <PageTitle title={t('settings.title')} />
      <div
        className="settings-ui theme-codex min-h-full"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
        }}
      >
        <div className="w-full px-4 py-5 sm:px-6 lg:px-8">
          <div
            className="mb-5 flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderBottom: '1px solid var(--color-codex-line)' }}
          >
            <div className="min-w-0">
              <h1
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 500,
                  color: 'var(--color-codex-ink)',
                  letterSpacing: '-0.015em',
                }}
              >
                {t('settings.title')}
              </h1>
              <p
                className="mt-1 hidden max-w-3xl truncate lg:block"
                style={{
                  margin: '6px 0 0',
                  fontSize: 13,
                  color: 'var(--color-codex-ink-mute)',
                  lineHeight: 1.6,
                }}
              >
                {t('settings.description')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="font-mono hidden w-fit items-center sm:inline-flex"
                style={{
                  padding: '2px 8px',
                  fontSize: 10.5,
                  background: 'var(--color-codex-bg-tint)',
                  color: 'var(--color-codex-ink-soft)',
                  borderRadius: 'var(--codex-r-pill, 999px)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {isZh ? '系统配置' : 'System settings'}
              </span>
              <span
                className="lg:hidden"
                style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
              >
                {t('settings.description')}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-5 lg:flex-row lg:items-start">
            <aside
              className={`w-full flex-shrink-0 transition-[width] duration-200 lg:sticky lg:top-6 ${
                navCollapsed ? 'lg:w-[72px]' : 'lg:w-64'
              }`}
            >
              <nav
                style={{
                  padding: 8,
                  background: 'var(--color-codex-bg-elev)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-md, 6px)',
                }}
              >
                <div
                  className={`mb-2 hidden items-center gap-2 p-2 lg:flex ${
                    navCollapsed ? 'justify-center' : 'justify-between'
                  }`}
                  style={{
                    background: 'var(--color-codex-bg-tint)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <div className={`min-w-0 ${navCollapsed ? 'hidden' : ''}`}>
                    <div
                      className="font-mono"
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: 'var(--color-codex-ink-soft)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {isZh ? '设置导航' : 'Settings nav'}
                    </div>
                    <div
                      className="truncate"
                      style={{
                        marginTop: 2,
                        fontSize: 11,
                        color: 'var(--color-codex-ink-mute)',
                      }}
                    >
                      {isZh ? '可随时收起左栏' : 'Collapse when you need space'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleNavCollapsed}
                    className="grid h-7 w-7 flex-shrink-0 place-items-center transition-colors"
                    style={{
                      background: 'var(--color-codex-bg-elev)',
                      color: 'var(--color-codex-ink-soft)',
                      border: '1px solid var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                    aria-label={navCollapsed ? (isZh ? '展开设置菜单' : 'Expand settings menu') : isZh ? '收起设置菜单' : 'Collapse settings menu'}
                  >
                    {navCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                  </button>
                </div>

                <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5 lg:overflow-visible">
                  {settingNavItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === ''}
                      title={navCollapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `row-hov relative flex shrink-0 items-center gap-3 lg:w-full ${
                          navCollapsed ? 'lg:justify-center' : ''
                        } ${isActive ? 'cx-setting-nav-active' : 'cx-setting-nav'}`
                      }
                      style={({ isActive }) => ({
                        padding: navCollapsed ? '7px 8px' : '7px 10px',
                        fontSize: 13,
                        fontWeight: isActive ? 500 : 400,
                        background: isActive
                          ? 'var(--color-codex-bg-tint)'
                          : 'transparent',
                        color: isActive
                          ? 'var(--color-codex-ink)'
                          : 'var(--color-codex-ink-soft)',
                        borderRadius: 'var(--codex-r-sm, 3px)',
                      })}
                    >
                      {({ isActive }) => (
                        <>
                          {/* 2px accent stripe down the left edge for active
                              item (see ``direction-codex-part2.jsx:259``). */}
                          {isActive && (
                            <span
                              aria-hidden="true"
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 8,
                                bottom: 8,
                                width: 2,
                                background: 'var(--color-codex-accent)',
                                borderRadius: 999,
                              }}
                            />
                          )}
                          <item.icon
                            className="h-3.5 w-3.5 flex-shrink-0"
                            style={{
                              color: isActive
                                ? 'var(--color-codex-ink)'
                                : 'var(--color-codex-ink-faint)',
                            }}
                          />
                          <span className={`${navCollapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </nav>
            </aside>

            <div className="min-w-0 flex-1 overflow-hidden" style={{ padding: '8px 16px' }}>
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
