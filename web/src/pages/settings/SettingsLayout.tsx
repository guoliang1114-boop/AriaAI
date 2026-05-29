/**
 * Settings shell — Codex layout per
 * ``design_handoff_aria_codex_redesign/direction-codex-settings.jsx:20``.
 *
 * Visible differences vs. the previous V0.0.5 / early-Codex shell:
 * - Sidebar is **inline** with a hairline right border, not a separate
 *   bg-elev card panel.
 * - Nav items are grouped under three section labels (个人 / AI 与
 *   记忆 / 管理员) with mono uppercase headers, instead of a single
 *   flat list.
 * - No icons in the nav, no collapse button, no global "设置" page
 *   header in the top bar — each inner page brings its own ``<h1>``.
 *
 * Active state is the same quiet bg-tint + ink + 500 weight + 2px
 * accent stripe on the left that's used across the top nav and the
 * design's sidebar mock.
 */
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageTitle } from '../../components/PageTitle'

type SettingsGroupKey = 'personal' | 'ai' | 'admin' | 'system'

interface SettingsNavItem {
  path: string
  label: string
  group: SettingsGroupKey
}

export function SettingsLayout() {
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const groupLabels: Record<SettingsGroupKey, string> = {
    personal: isZh ? '个人' : 'Personal',
    ai: isZh ? 'AI 与记忆' : 'AI & Memory',
    admin: isZh ? '管理员' : 'Admin',
    system: isZh ? '系统' : 'System',
  }

  const settingNavItems: SettingsNavItem[] = [
    { path: '', label: t('settings.profile'), group: 'personal' },
    { path: 'preferences', label: t('settings.preferences'), group: 'personal' },
    { path: 'appearance', label: t('settings.appearance'), group: 'personal' },
    { path: 'language', label: t('settings.language'), group: 'personal' },
    { path: 'ai', label: t('settings.aiModel'), group: 'ai' },
    { path: 'memory', label: isZh ? '项目记忆' : 'Project Memory', group: 'ai' },
    { path: 'client-memory', label: isZh ? '客户记忆' : 'Client Memory', group: 'ai' },
    { path: 'memory-ops', label: isZh ? '记忆任务中心' : 'Memory Operations', group: 'ai' },
    { path: 'api-limits', label: isZh ? 'API 限流' : 'API Limits', group: 'admin' },
    { path: 'migrations', label: isZh ? '迁移状态' : 'Migrations', group: 'admin' },
    { path: 'messages', label: isZh ? '消息管理' : 'Message Manager', group: 'admin' },
    { path: 'server', label: t('settings.server.title'), group: 'admin' },
    { path: 'users', label: t('settings.users'), group: 'admin' },
    // 关于 ships its own one-item 系统 group — it was previously
    // tucked under 个人 and read as oddly out-of-place ("关于" isn't
    // a personal choice the user makes, it's a system info pane).
    { path: 'about', label: t('settings.about'), group: 'system' },
  ]

  const orderedGroups: SettingsGroupKey[] = ['personal', 'ai', 'admin', 'system']
  const itemsByGroup = orderedGroups.map((group) => ({
    group,
    label: groupLabels[group],
    items: settingNavItems.filter((item) => item.group === group),
  }))

  return (
    <>
      <PageTitle title={t('settings.title')} />
      <div
        className="settings-ui theme-codex flex min-h-full"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
        }}
      >
        {/* Sidebar — 240px fixed on desktop, full-width stacked on mobile.
            Right hairline border replaces the previous bg-elev card. */}
        <aside
          className="hidden flex-shrink-0 lg:block"
          style={{
            width: 240,
            padding: '24px 16px 24px 40px',
            borderRight: '1px solid var(--color-codex-line)',
          }}
        >
          <h2
            style={{
              margin: '0 0 18px',
              fontSize: 18,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.015em',
            }}
          >
            {t('settings.title')}
          </h2>
          {itemsByGroup.map(({ group, label, items }) => (
            <div key={group} style={{ marginBottom: 16 }}>
              <div
                className="font-mono"
                style={{
                  padding: '4px 10px 6px',
                  fontSize: 10.5,
                  color: 'var(--color-codex-ink-faint)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {label}
              </div>
              {items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === ''}
                  className={({ isActive }) =>
                    `row-hov relative block ${isActive ? 'cx-setting-nav-active' : 'cx-setting-nav'}`
                  }
                  style={({ isActive }) => ({
                    padding: '7px 10px',
                    marginBottom: 1,
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-soft)',
                    background: isActive ? 'var(--color-codex-bg-tint)' : 'transparent',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  })}
                >
                  {({ isActive }) =>
                    isActive ? (
                      <>
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
                        {item.label}
                      </>
                    ) : (
                      <>{item.label}</>
                    )
                  }
                </NavLink>
              ))}
            </div>
          ))}
        </aside>

        {/* Mobile/tablet nav — horizontal pill row above the content slot.
            Same color tokens, no group labels (would crowd the row). */}
        <nav
          className="flex gap-1 overflow-x-auto px-4 py-3 lg:hidden"
          style={{ borderBottom: '1px solid var(--color-codex-line)' }}
        >
          {settingNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === ''}
              className="row-hov flex-shrink-0"
              style={({ isActive }) => ({
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-soft)',
                background: isActive ? 'var(--color-codex-bg-tint)' : 'transparent',
                borderRadius: 'var(--codex-r-sm, 3px)',
                whiteSpace: 'nowrap',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Right column. Each settings page brings its own ``<h1>``,
            so the shell just provides the padding scaffold. */}
        <div
          className="min-w-0 flex-1 overflow-hidden"
          style={{ padding: '32px 48px 40px' }}
        >
          <Outlet />
        </div>
      </div>
    </>
  )
}
