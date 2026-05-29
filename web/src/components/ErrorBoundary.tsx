import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Last-resort React error boundary.
 *
 * Catches render-phase errors thrown by lazy-loaded route bundles.
 * The fallback UI used to be MD3-styled (`bg-surface`, `text-on-surface`)
 * which looked out of place once the rest of the app moved to the
 * Codex tokens; this version stays inside ``theme-codex`` so a crash
 * inside e.g. the chat shell doesn't suddenly recolor half the
 * screen.
 *
 * For *backend* outages we go a different path: the API client fires
 * ``api:service-down`` on 503 responses and ``App.tsx`` redirects to
 * ``/503``. That's a separate flow because backend failures don't
 * throw inside React's render tree — they reject in async handlers.
 */
interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          className="theme-codex flex h-screen w-screen items-center justify-center"
          style={{
            background: 'var(--color-codex-bg)',
            color: 'var(--color-codex-ink)',
          }}
        >
          <div
            className="mx-4 w-full max-w-md text-center"
            style={{
              padding: '32px 28px',
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <div
              className="mx-auto mb-4 inline-flex items-center justify-center"
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background:
                  'color-mix(in oklab, var(--color-codex-bad) 14%, var(--color-codex-bg-elev))',
                color: 'var(--color-codex-bad)',
              }}
            >
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 500,
                color: 'var(--color-codex-ink)',
                letterSpacing: '-0.01em',
              }}
            >
              Something went wrong
            </h2>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 13,
                color: 'var(--color-codex-ink-mute)',
                lineHeight: 1.6,
              }}
            >
              An unexpected error occurred while rendering this page. You can
              try reloading it.
            </p>
            {this.state.error && (
              <pre
                className="mt-5 max-h-32 overflow-auto text-left font-mono"
                style={{
                  padding: 10,
                  fontSize: 11,
                  color: 'var(--color-codex-ink-mute)',
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-6 inline-flex items-center gap-1.5"
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                background: 'var(--color-codex-ink)',
                color: 'var(--color-codex-bg-elev)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
