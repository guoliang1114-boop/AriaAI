import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Project, User } from '../../../types/api'
import { CxIcon } from './CxIcons'
import { CxStatus } from './CxPrimitives'
import { PROJECT_TAB_ORDER, type CxProjectTabKey } from './mockData'
import { STATUS_LABEL, STATUS_TONE, firstGlyph, formatUpdatedRelative } from './useProjectsApi'
import {
  CxAvatarMenu,
  CxNotificationBell,
  CxProjectSwitcher,
} from './CxProjectShellMenus'

/**
 * Single unified top bar for the project-detail screens.
 *
 * The CxProjectDetail wrapper fetches the project once and threads
 * the `project` prop in; we keep the shell stateless so swapping a
 * tab doesn't re-fetch.
 */
interface CxProjectShellProps {
  activeTab: CxProjectTabKey
  projectId: number | string
  project: Project | null
  children: ReactNode
}

export function CxProjectShell({ activeTab, projectId, project, children }: CxProjectShellProps) {
  const navigate = useNavigate()
  const name = project?.name ?? '加载中…'
  const status = project?.status ?? null
  const memoryV = project?.memory_version ?? null
  const memoryStale = !!project?.memory_stale
  const memoryUpdated = formatUpdatedRelative(project?.memory_updated_at ?? null)

  const avatarInitials = useMemo(() => {
    const user = readStoredUser()
    return computeInitials(user)
  }, [])
  const projectIdNum =
    typeof projectId === 'number' ? projectId : Number(projectId) || project?.id || 0
  return (
    <div
      className="theme-codex frame-codex"
      style={{
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-ui)',
        fontSize: 13.5,
        lineHeight: 1.6,
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '0 28px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'stretch',
          height: 56,
          flexShrink: 0,
        }}
      >
        {/* Left — back chip + project name + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="row-hov"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12.5,
              color: 'var(--ink-mute)',
              padding: '4px 8px',
              marginLeft: -8,
              borderRadius: 'var(--r-sm)',
            }}
          >
            <CxIcon name="chevron-right" size={11} style={{ transform: 'rotate(180deg)' }} /> 项目
          </button>
          <div style={{ width: 1, height: 22, background: 'var(--line)' }} />
          <CxProjectSwitcher
            projectId={projectIdNum}
            triggerStyle={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 8px',
              borderRadius: 'var(--r-sm)',
            }}
            triggerContent={
              <>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--accent-bg)',
                    color: 'var(--accent-ink)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11.5,
                    fontWeight: 500,
                  }}
                >
                  {firstGlyph(project?.client || project?.name)}
                </span>
                <span style={{ textAlign: 'left', lineHeight: 1.2 }}>
                  <span
                    className="ui"
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: 'var(--ink)',
                      fontWeight: 500,
                      letterSpacing: '-0.005em',
                      maxWidth: 360,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {name}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      fontSize: 10.5,
                      color: 'var(--ink-mute)',
                      marginTop: 1,
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {status && (
                      <CxStatus
                        tone={STATUS_TONE[status]}
                        pulse={status === 'opportunity' || status === 'delivering'}
                      >
                        {STATUS_LABEL[status]}
                      </CxStatus>
                    )}
                    {memoryV != null && (
                      <>
                        <span style={{ color: 'var(--ink-faint)' }}>·</span>
                        <span style={{ color: memoryStale ? 'var(--warn)' : undefined }}>
                          记忆 v{memoryV} · {memoryUpdated}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <CxIcon
                  name="chevron-down"
                  size={10}
                  style={{ color: 'var(--ink-faint)', marginLeft: 4 }}
                />
              </>
            }
          />
        </div>

        {/* Center — tabs */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'stretch',
            marginLeft: 28,
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
          }}
        >
          {PROJECT_TAB_ORDER.map((t) => {
            const active = t.k === activeTab
            return (
              <Link
                key={t.k}
                to={`/projects/${projectId}/${t.k}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px',
                  fontSize: 13,
                  color: active ? 'var(--ink)' : 'var(--ink-mute)',
                  fontWeight: active ? 500 : 400,
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                }}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>

        {/* Right — utilities */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <CxNotificationBell />
          <CxAvatarMenu initials={avatarInitials} />
        </div>
      </header>

      {/* Tab body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function computeInitials(user: User | null): string {
  if (!user) return '—'
  const name = user.display_name?.trim() || user.email || ''
  if (!name) return '—'
  // CJK: first glyph. Latin: first letter of each of up to 2 words.
  if (/[一-鿿]/.test(name)) {
    return Array.from(name)[0] ?? '—'
  }
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
