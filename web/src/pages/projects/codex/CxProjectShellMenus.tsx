import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../../api/client'
import { useAuth } from '../../../contexts/AuthContext'
import type { Project } from '../../../types/api'
import { CxIcon } from './CxIcons'
import { firstGlyph, useProjectsList } from './useProjectsApi'

/** Floating menus used in the project-detail top bar:
 *  - Project switcher (chevron next to the project name)
 *  - Notification bell with unread badge
 *  - User avatar dropdown (profile / preferences / logout)
 *
 * All three close on outside click + Escape.
 */

interface ProjectSwitcherProps {
  projectId: number
  triggerStyle: React.CSSProperties
  triggerContent: React.ReactNode
}

export function CxProjectSwitcher({ projectId, triggerStyle, triggerContent }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { data, loading } = useProjectsList()

  useClickAway(wrapRef, () => setOpen(false), open)

  const filtered = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    const list = data.filter((p) => p.status !== 'archived')
    if (!term) return list
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(term) || (p.client || '').toLowerCase().includes(term),
    )
  }, [data, search])

  const grouped = useMemo(() => groupByStatus(filtered), [filtered])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="row-hov"
        style={triggerStyle}
      >
        {triggerContent}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 320,
            maxWidth: 380,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            boxShadow: '0 12px 28px -10px color-mix(in oklch, var(--ink) 20%, transparent)',
            zIndex: 40,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 480,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
            }}
          >
            <CxIcon name="search" size={11} style={{ color: 'var(--ink-faint)' }} />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="切换项目"
              className="codex-input"
              style={{
                flex: 1,
                fontSize: 12.5,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--ink)',
              }}
            />
          </div>
          <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '12px 8px' }}>
                加载中…
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '12px 8px' }}>
                没有匹配的项目。
              </div>
            ) : (
              grouped.map((g) => (
                <span key={g.label} style={{ display: 'contents' }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: 'var(--ink-faint)',
                      padding: '8px 8px 4px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {g.label} · {g.items.length}
                  </div>
                  {g.items.map((p) => {
                    const active = p.id === projectId
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          navigate(`/projects/${p.id}/overview`)
                          setOpen(false)
                        }}
                        className="row-hov"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 8px',
                          borderRadius: 'var(--r-sm)',
                          background: active ? 'var(--bg-tint)' : 'transparent',
                          textAlign: 'left',
                          width: '100%',
                          position: 'relative',
                        }}
                      >
                        {active && (
                          <span
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 5,
                              bottom: 5,
                              width: 2,
                              background: 'var(--accent)',
                              borderRadius: 99,
                            }}
                          />
                        )}
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 'var(--r-sm)',
                            background: 'var(--accent-bg)',
                            color: 'var(--accent-ink)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            fontWeight: 500,
                            flexShrink: 0,
                          }}
                        >
                          {firstGlyph(p.client || p.name)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            className="ui"
                            style={{
                              display: 'block',
                              fontSize: 12.5,
                              color: 'var(--ink)',
                              fontWeight: active ? 500 : 400,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {p.name}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 10.5,
                              color: 'var(--ink-mute)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {p.client || '—'}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </span>
              ))
            )}
          </div>
          <div
            style={{
              padding: '8px 4px 2px',
              borderTop: '1px solid var(--line-soft)',
              display: 'flex',
              gap: 4,
            }}
          >
            <Link
              to="/projects"
              onClick={() => setOpen(false)}
              className="row-hov"
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: 12,
                color: 'var(--ink-soft)',
                borderRadius: 'var(--r-sm)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <CxIcon name="grid" size={11} /> 查看全部项目
            </Link>
            <Link
              to="/projects/new"
              onClick={() => setOpen(false)}
              className="row-hov"
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: 12,
                color: 'var(--accent)',
                borderRadius: 'var(--r-sm)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <CxIcon name="plus" size={11} stroke={1.6} /> 新建项目
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function groupByStatus(projects: Project[]) {
  const out: Array<{ label: string; items: Project[] }> = []
  const presale = projects.filter((p) => p.status === 'lead' || p.status === 'opportunity' || p.status === 'won')
  const delivering = projects.filter((p) => p.status === 'delivering')
  if (presale.length) out.push({ label: '商务阶段', items: presale })
  if (delivering.length) out.push({ label: '交付中', items: delivering })
  return out
}

interface BellState {
  count: number
  loaded: boolean
}

/** Notification bell — pulls /messages/unread-count and listens for
 * the global `messages:updated` event so it stays in sync with the
 * rest of the app. */
export function CxNotificationBell() {
  const navigate = useNavigate()
  const [state, setState] = useState<BellState>({ count: 0, loaded: false })

  useEffect(() => {
    let cancelled = false
    const load = () =>
      api
        .get<{ unread_count: number }>('/messages/unread-count')
        .then((res) => {
          if (cancelled) return
          setState({ count: res.unread_count || 0, loaded: true })
        })
        .catch(() => {
          if (cancelled) return
          setState((s) => ({ ...s, loaded: true }))
        })
    load()
    const onUpdated = () => load()
    window.addEventListener('messages:updated', onUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('messages:updated', onUpdated)
    }
  }, [])

  const showBadge = state.loaded && state.count > 0
  const badgeText = state.count > 99 ? '99+' : String(state.count)

  return (
    <button
      type="button"
      onClick={() => navigate('/messages')}
      title="通知"
      style={{
        width: 30,
        height: 30,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-mute)',
        position: 'relative',
      }}
    >
      <CxIcon name="bell" size={14} />
      {showBadge && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            minWidth: 14,
            height: 14,
            padding: '0 4px',
            borderRadius: 99,
            background: 'var(--bad)',
            color: 'var(--bg-elev)',
            fontSize: 9,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          {badgeText}
        </span>
      )}
    </button>
  )
}

interface AvatarMenuProps {
  initials: string
}

/** Top-right avatar dropdown — profile / preferences / theme settings
 * / logout. The logout flow mirrors the global Layout's pattern:
 * clearing the auth token + dispatching the `auth:logout` event so
 * AuthContext flips the boundary and React Router redirects to login. */
export function CxAvatarMenu({ initials }: AvatarMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { logout } = useAuth()

  useClickAway(wrapRef, () => setOpen(false), open)

  const go = (path: string) => {
    navigate(path)
    setOpen(false)
  }
  const handleLogout = () => {
    setOpen(false)
    logout()
    window.dispatchEvent(new Event('auth:logout'))
    navigate('/login', { replace: true })
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="账户"
        style={{
          width: 26,
          height: 26,
          borderRadius: 99,
          background: 'var(--accent-bg)',
          color: 'var(--accent-ink)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11.5,
          fontWeight: 500,
        }}
      >
        {initials || '—'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 180,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            boxShadow: '0 12px 28px -10px color-mix(in oklch, var(--ink) 20%, transparent)',
            zIndex: 40,
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <MenuItem icon="user" label="个人资料" onClick={() => go('/settings')} />
          <MenuItem icon="settings" label="偏好设置" onClick={() => go('/settings/preferences')} />
          <MenuItem icon="sun" label="外观" onClick={() => go('/settings/appearance')} />
          <div
            style={{
              height: 1,
              background: 'var(--line-soft)',
              margin: '4px 6px',
            }}
          />
          <MenuItem icon="logout" label="退出登录" tone="bad" onClick={handleLogout} />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  tone = 'soft',
  onClick,
}: {
  icon: string
  label: string
  tone?: 'soft' | 'bad'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-hov"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 8px',
        fontSize: 12.5,
        color: tone === 'bad' ? 'var(--bad)' : 'var(--ink)',
        borderRadius: 'var(--r-sm)',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <CxIcon
        name={icon}
        size={13}
        style={{ color: tone === 'bad' ? 'var(--bad)' : 'var(--ink-mute)' }}
      />
      {label}
    </button>
  )
}

/** Generic outside-click + Escape close handler. */
function useClickAway(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, onClose, ref])
}
