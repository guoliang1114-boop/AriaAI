import { ShieldAlert, ArrowLeft, Home, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function Forbidden() {
  const navigate = useNavigate()

  return (
    <div className="min-h-full bg-gradient-to-br from-surface via-surface-container-low to-surface-container">
      <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl items-center px-6 py-12">
        <div className="grid w-full gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-outline/20 bg-surface-container-lowest/90 p-8 shadow-[0_20px_60px_rgba(0,63,177,0.08)] backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full bg-tertiary-container/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
              403
            </div>
            <h1 className="mt-6 font-manrope text-4xl font-bold tracking-tight text-on-surface">
              You don&apos;t have access to this area
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-on-surface-muted">
              This page is available only to users with higher permissions. If you believe you should
              have access, contact your administrator or return to a workspace you can use right now.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
              >
                <ArrowLeft className="h-4 w-4" />
                Go back
              </button>
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2.5 text-sm font-medium text-on-surface transition hover:bg-surface-container-low"
              >
                <Home className="h-4 w-4" />
                Back to dashboard
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-tertiary-container text-tertiary">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-on-surface">What you can do next</h2>
              <div className="mt-4 space-y-3 text-sm text-on-surface-muted">
                <p>Return to your recent project or conversation and continue from there.</p>
                <p>Ask an admin to grant access if this page is required for your role.</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-on-surface-muted">
                Quick links
              </h3>
              <div className="mt-4 grid gap-3">
                <button
                  onClick={() => navigate('/projects')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="text-sm font-medium text-on-surface">Projects</div>
                  <div className="mt-1 text-xs text-on-surface-muted">Jump back into active delivery work.</div>
                </button>
                <button
                  onClick={() => navigate('/chat')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="text-sm font-medium text-on-surface">Chat</div>
                  <div className="mt-1 text-xs text-on-surface-muted">Continue where you left off in a conversation.</div>
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <Settings className="h-4 w-4" />
                    Profile settings
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">You can still update your own profile and preferences.</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
