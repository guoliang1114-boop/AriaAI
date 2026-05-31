import type { CSSProperties, ReactNode } from 'react'

/* ----------------- CxStatus pill ----------------- */
export type CxTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info' | 'mute'

const TONE_COLOR: Record<CxTone, string> = {
  neutral: 'var(--ink-mute)',
  accent: 'var(--accent)',
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  info: 'var(--info)',
  mute: 'var(--ink-faint)',
}

interface CxStatusProps {
  tone?: CxTone
  pulse?: boolean
  children?: ReactNode
  style?: CSSProperties
}

export function CxStatus({ tone = 'neutral', pulse = false, children, style }: CxStatusProps) {
  const c = TONE_COLOR[tone] ?? TONE_COLOR.neutral
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        color: c,
        fontFamily: 'var(--font-mono)',
        ...style,
      }}
    >
      <span
        className={pulse ? 'dot-pulse' : ''}
        style={{ width: 6, height: 6, borderRadius: 99, background: c, display: 'inline-block' }}
      />
      {children}
    </span>
  )
}

/* ----------------- CxPanel ----------------- */
interface CxPanelProps {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children?: ReactNode
  style?: CSSProperties
}

export function CxPanel({ title, subtitle, action, children, style }: CxPanelProps) {
  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '18px 20px',
        ...style,
      }}
    >
      {(title || action) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 14,
            gap: 12,
          }}
        >
          <div>
            {title ? (
              <h3
                className="ui"
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--ink)',
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p
                style={{
                  margin: '3px 0 0',
                  fontSize: 12,
                  color: 'var(--ink-mute)',
                  lineHeight: 1.5,
                }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/* ----------------- CxHead (section heading) ----------------- */
interface CxHeadProps {
  children?: ReactNode
  action?: ReactNode
  style?: CSSProperties
}

export function CxHead({ children, action, style }: CxHeadProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 14,
        ...style,
      }}
    >
      <h3
        className="ui"
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink-mute)',
          letterSpacing: '0.01em',
        }}
      >
        {children}
      </h3>
      {action}
    </div>
  )
}
