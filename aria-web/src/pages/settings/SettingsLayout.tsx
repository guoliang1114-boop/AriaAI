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
  Server,
  SlidersHorizontal,
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
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.08),transparent_34%),linear-gradient(180deg,var(--color-surface),var(--color-surface-container-low))]">
        <div className="w-full px-3 py-4 sm:px-5 lg:px-6">
          <div className="mb-4 rounded-3xl border border-outline/70 bg-surface/85 px-4 py-3 shadow-sm backdrop-blur sm:px-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <SlidersHorizontal className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="text-lg font-semibold text-on-surface">{t('settings.title')}</h1>
                  <p className="text-sm text-on-surface-muted">{t('settings.description')}</p>
                </div>
              </div>
              <div className="hidden rounded-full bg-surface-container-low px-3 py-1 text-xs font-medium text-on-surface-muted sm:block">
                {isZh ? '配置、治理与运维入口' : 'Configuration, governance, and operations'}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col gap-5 lg:flex-row lg:items-start">
            <aside
              className={`w-full flex-shrink-0 transition-[width] duration-200 lg:sticky lg:top-6 ${
                navCollapsed ? 'lg:w-[76px]' : 'lg:w-64'
              }`}
            >
              <nav
                className={`rounded-3xl border border-outline/70 bg-surface/90 p-2 shadow-sm backdrop-blur ${
                  navCollapsed ? 'lg:px-2' : ''
                }`}
              >
                <div
                  className={`mb-2 hidden items-center gap-2 rounded-2xl bg-surface-container-low p-2 lg:flex ${
                    navCollapsed ? 'justify-center' : 'justify-between'
                  }`}
                >
                  <div className={`min-w-0 ${navCollapsed ? 'hidden' : ''}`}>
                    <div className="text-sm font-semibold text-on-surface">{isZh ? '设置导航' : 'Settings nav'}</div>
                    <div className="truncate text-xs text-on-surface-muted">{isZh ? '点击图标切换模块' : 'Jump between modules'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleNavCollapsed}
                    className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border border-outline bg-surface text-on-surface-muted transition hover:bg-surface-container-high hover:text-on-surface"
                    aria-label={navCollapsed ? (isZh ? '展开设置菜单' : 'Expand settings menu') : isZh ? '收起设置菜单' : 'Collapse settings menu'}
                  >
                    {navCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  </button>
                </div>

                <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-1 lg:overflow-visible">
                  {settingNavItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === ''}
                      title={navCollapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `group flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all lg:w-full ${
                          navCollapsed ? 'lg:justify-center lg:px-3' : ''
                        } ${
                          isActive
                            ? 'bg-primary text-on-primary shadow-sm'
                            : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                        }`
                      }
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      <span className={`${navCollapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </nav>
            </aside>

            <div className="min-w-0 flex-1 overflow-hidden rounded-3xl border border-outline/70 bg-surface shadow-sm">
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
