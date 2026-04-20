import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, Brain, Database, Gauge, GitBranch, Globe, Info, ListChecks, Server, User, Users } from 'lucide-react'
import { PageTitle } from '../../components/PageTitle'

export function SettingsLayout() {
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

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

  return (
    <>
      <PageTitle title={t('settings.title')} />
      <div className="min-h-full bg-surface">
        <div className="w-full px-6 py-8">
          <h1 className="mb-2 text-headline-md text-on-surface">{t('settings.title')}</h1>
          <p className="mb-8 text-body-md text-on-surface-muted">{t('settings.description')}</p>

          <div className="flex w-full gap-6">
            <aside className="w-64 flex-shrink-0">
              <nav className="space-y-1 rounded-xl bg-surface-container-low p-2">
                {settingNavItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === ''}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-secondary-container/50 text-primary'
                          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </aside>

            <div className="card min-w-0 flex-1">
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
