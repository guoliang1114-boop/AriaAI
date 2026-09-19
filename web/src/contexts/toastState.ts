import { createContext, useContext } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

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

export type ToastInput = string | ToastPayload

export interface Toast {
  id: number
  type: ToastType
  title: string
  description?: string
  meta?: string
  duration: number
}

export interface ToastContextValue {
  success: (input: ToastInput) => void
  error: (input: ToastInput) => void
  warning: (input: ToastInput) => void
  info: (input: ToastInput) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

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
