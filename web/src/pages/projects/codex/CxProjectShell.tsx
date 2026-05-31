import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CxIcon } from './CxIcons'
import { CxStatus } from './CxPrimitives'
import { DEMO_PROJECT, PROJECT_TAB_ORDER, type CxProjectTabKey } from './mockData'

/**
 * Single unified top bar for the project-detail screens.
 *
 * Mirrors the design's `CxProjectShell` exactly: 56px header with
 * back-chip + project name dropdown + tab nav + bell + avatar. No
 * global side nav; the project detail route hides the app Layout
 * chrome (see Layout.tsx isProjectDetailRoute).
 */
interface CxProjectShellProps {
  activeTab: CxProjectTabKey
  projectId: string
  children: ReactNode
}

export function CxProjectShell({ activeTab, projectId, children }: CxProjectShellProps) {
  const navigate = useNavigate()
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
          <button
            type="button"
            className="row-hov"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 'var(--r-sm)' }}
          >
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
              鼎
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
                }}
              >
                {DEMO_PROJECT.name}
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
                <CxStatus tone="warn" pulse>
                  {DEMO_PROJECT.statusLabel}
                </CxStatus>
                <span style={{ color: 'var(--ink-faint)' }}>·</span>
                <span>
                  记忆 v{DEMO_PROJECT.memoryVersion} · {DEMO_PROJECT.memoryUpdated}
                </span>
              </span>
            </span>
            <CxIcon
              name="chevron-down"
              size={10}
              style={{ color: 'var(--ink-faint)', marginLeft: 4 }}
            />
          </button>
        </div>

        {/* Center — tabs */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'stretch',
            marginLeft: 28,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
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
          <button
            type="button"
            style={{
              width: 30,
              height: 30,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-mute)',
            }}
          >
            <CxIcon name="bell" size={14} />
          </button>
          <span
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
            陈
          </span>
        </div>
      </header>

      {/* Tab body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}
