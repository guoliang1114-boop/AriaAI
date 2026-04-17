import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Brain, Database, Globe, Info, Server, User, Users } from 'lucide-react'
import { PageTitle } from '../../components/PageTitle'

export function SettingsLayout() {
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const settingNavItems = [
    { path: '', icon: User, label: t('settings.profile') },
    { path: 'ai', icon: Brain, label: t('settings.aiModel') },
    { path: 'memory', icon: Database, label: isZh ? '记忆管理' : 'Memory Manager' },
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
          <h1 className="text-headline-md text-on-surface mb-2">{t('settings.title')}</h1>
          <p className="text-body-md text-on-surface-muted mb-8">{t('settings.description')}</p>

          <div className="flex w-full gap-6">
            <aside className="w-64 flex-shrink-0">
              <nav className="space-y-1 bg-surface-container-low rounded-xl p-2">
                {settingNavItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === ''}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-secondary-container/50 text-primary'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                      }`
                    }
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 flex-1 card">
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
