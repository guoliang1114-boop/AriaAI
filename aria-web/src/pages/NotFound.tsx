import { Compass, ArrowLeft, Home, MessageSquare, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function NotFound() {
  const navigate = useNavigate()

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(0,63,177,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(17,130,245,0.12),transparent_28%)] bg-surface">
      <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl items-center px-6 py-12">
        <div className="grid w-full gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border border-outline/20 bg-surface-container-lowest/90 p-8 shadow-[0_20px_60px_rgba(0,63,177,0.08)] backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full bg-secondary-container/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              404
            </div>
            <h1 className="mt-6 font-manrope text-4xl font-bold tracking-tight text-on-surface">
              This page doesn&apos;t exist
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-on-surface-muted">
              The link may be outdated, the page may have moved, or the address may be incomplete. You
              can jump back to your main workspaces below instead of starting over.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
              >
                <Home className="h-4 w-4" />
                Dashboard
              </button>
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2.5 text-sm font-medium text-on-surface transition hover:bg-surface-container-low"
              >
                <ArrowLeft className="h-4 w-4" />
                Go back
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary-container text-primary">
                <Compass className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-on-surface">Keep moving</h2>
              <div className="mt-4 space-y-3 text-sm text-on-surface-muted">
                <p>Use the shortcuts below to get back to a project, chat, or client workspace quickly.</p>
                <p>If this came from a saved link, it may need to be updated.</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-outline/20 bg-surface-container-low p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-on-surface-muted">
                Quick routes
              </h3>
              <div className="mt-4 grid gap-3">
                <button
                  onClick={() => navigate('/projects')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="text-sm font-medium text-on-surface">Projects</div>
                  <div className="mt-1 text-xs text-on-surface-muted">Return to your delivery and pipeline view.</div>
                </button>
                <button
                  onClick={() => navigate('/chat')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <MessageSquare className="h-4 w-4" />
                    Chat
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">Open recent conversations and continue working.</div>
                </button>
                <button
                  onClick={() => navigate('/knowledge')}
                  className="rounded-2xl border border-outline/20 bg-surface px-4 py-4 text-left transition hover:bg-surface-container-lowest"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <Search className="h-4 w-4" />
                    Knowledge
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">Search files, notes, and client context.</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
