import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastPayload {
  /** Bold one-liner shown as the toast headline. */
  title: string
  /** Optional second line — used for context like a record id or affected scope. */
  description?: string
  /** Short label rendered top-right (timestamp, "刚刚", "5 分钟前", etc). */
  meta?: string
  /** Override auto-dismiss in ms. Defaults to 4000. Pass 0 to disable. */
  duration?: number
}

type ToastInput = string | ToastPayload

interface Toast {
  id: number
  type: ToastType
  title: string
  description?: string
  meta?: string
  duration: number
}

interface ToastContextValue {
  success: (input: ToastInput) => void
  error: (input: ToastInput) => void
  warning: (input: ToastInput) => void
  info: (input: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const TONE: Record<ToastType, { color: string; mix: string }> = {
  success: {
    color: 'var(--color-codex-good)',
    mix: 'color-mix(in oklch, var(--color-codex-good) 12%, transparent)',
  },
  error: {
    color: 'var(--color-codex-bad)',
    mix: 'color-mix(in oklch, var(--color-codex-bad) 12%, transparent)',
  },
  warning: {
    color: 'var(--color-codex-warn)',
    mix: 'color-mix(in oklch, var(--color-codex-warn) 14%, transparent)',
  },
  info: {
    color: 'var(--color-codex-accent)',
    mix: 'color-mix(in oklch, var(--color-codex-accent) 14%, transparent)',
  },
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = ICONS[toast.type]
  const tone = TONE[toast.type]
  const showBar = toast.duration > 0

  return (
    <div
      className="theme-codex flex relative overflow-hidden"
      role={toast.type === 'error' ? 'alert' : 'status'}
      style={{
        gap: 12,
        padding: '14px 14px 15px 14px',
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 10px)',
        boxShadow:
          '0 1px 2px rgba(26,24,21,0.05), 0 16px 32px -14px rgba(26,24,21,0.22)',
        animation: 'codex-toast-in 0.34s cubic-bezier(0.2,0.7,0.2,1) both',
        minWidth: 280,
        maxWidth: 400,
      }}
    >
      <span
        aria-hidden="true"
        className="inline-flex flex-shrink-0 items-center justify-center"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: tone.mix,
          color: tone.color,
        }}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.005em',
            }}
          >
            {toast.title}
          </span>
          {toast.meta ? (
            <span
              className="font-mono flex-shrink-0"
              style={{
                fontSize: 10.5,
                color: 'var(--color-codex-ink-faint)',
                letterSpacing: '0.02em',
              }}
            >
              {toast.meta}
            </span>
          ) : null}
        </div>
        {toast.description ? (
          <p
            style={{
              margin: '3px 0 0',
              fontSize: 12,
              color: 'var(--color-codex-ink-mute)',
              lineHeight: 1.5,
            }}
          >
            {toast.description}
          </p>
        ) : null}
      </div>

      <button
        onClick={onClose}
        aria-label="关闭"
        className="inline-flex flex-shrink-0 items-center justify-center transition-colors"
        style={{
          width: 22,
          height: 22,
          alignSelf: 'flex-start',
          background: 'transparent',
          color: 'var(--color-codex-ink-faint)',
          borderRadius: 6,
        }}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {showBar ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            height: 2,
            width: '100%',
            transformOrigin: 'left center',
            background: `color-mix(in oklch, ${tone.color} 55%, transparent)`,
            animation: `codex-toast-bar ${toast.duration}ms linear forwards`,
          }}
        />
      ) : null}
    </div>
  )
}

const DEFAULT_DURATION = 4000

function normalizePayload(input: ToastInput): Omit<Toast, 'id' | 'type'> {
  if (typeof input === 'string') {
    return { title: input, duration: DEFAULT_DURATION }
  }
  return {
    title: input.title,
    description: input.description,
    meta: input.meta,
    duration: typeof input.duration === 'number' ? input.duration : DEFAULT_DURATION,
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const addToast = useCallback((type: ToastType, input: ToastInput) => {
    const id = ++counterRef.current
    const payload = normalizePayload(input)
    setToasts(prev => [...prev, { id, type, ...payload }])
    if (payload.duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, payload.duration)
    }
  }, [])

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const ctx: ToastContextValue = {
    success: (input) => addToast('success', input),
    error: (input) => addToast('error', input),
    warning: (input) => addToast('warning', input),
    info: (input) => addToast('info', input),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Toast container — bottom-right */}
      <div
        className="pointer-events-none fixed z-[9999] flex flex-col items-end"
        style={{ bottom: 24, right: 24, gap: 12 }}
      >
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onClose={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// Safe console-only fallback for environments where ToastProvider
// isn't mounted — primarily test renders that boot a single page
// without the full app shell. In production we always have the
// provider (mounted in main.tsx), so the warning is informational.
function logFallback(level: ToastType, input: ToastInput) {
  const tag = `[toast:${level}]`
  const fn = level === 'error' || level === 'warning' ? console.warn : console.info
  if (typeof input === 'string') fn(tag, input)
  else fn(tag, input.title, input.description ?? '')
}

const NOOP_TOAST: ToastContextValue = {
  success: (input) => logFallback('success', input),
  error: (input) => logFallback('error', input),
  warning: (input) => logFallback('warning', input),
  info: (input) => logFallback('info', input),
}

export function useToast() {
  const ctx = useContext(ToastContext)
  return ctx ?? NOOP_TOAST
}
