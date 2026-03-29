import { Info, Package, Heart, Sparkles } from 'lucide-react'

export function AboutSettings() {
  const version = '1.0.0'
  const buildDate = '2024-03-26'

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">关于 AriaAI</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">版本信息和技术详情</p>

      <div className="space-y-6">
        {/* App Info */}
        <div className="flex items-center gap-4 p-6 bg-[var(--color-accent-50)] rounded-2xl border border-[var(--color-accent-100)]">
          <div className="w-16 h-16 bg-[var(--color-accent-600)] rounded-2xl flex items-center justify-center shadow-lg shadow-[var(--color-accent-500)]/30">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[var(--color-text-primary)]">AriaAI</h3>
            <p className="text-sm text-[var(--color-text-muted)]">智能咨询助手</p>
          </div>
        </div>

        {/* Version Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-default)]">
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-1">
              <Package className="w-4 h-4" />
              <span className="text-sm">版本</span>
            </div>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">{version}</p>
          </div>
          <div className="p-4 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-default)]">
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-1">
              <Info className="w-4 h-4" />
              <span className="text-sm">构建日期</span>
            </div>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">{buildDate}</p>
          </div>
        </div>

        {/* Tech Stack */}
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">技术栈</h4>
          <div className="flex flex-wrap gap-2">
            {['React', 'TypeScript', 'Vite', 'Tailwind CSS', 'FastAPI', 'PostgreSQL'].map(tech => (
              <span
                key={tech}
                className="px-3 py-1.5 bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] text-sm rounded-xl font-medium border border-[var(--color-border-default)]"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* Links */}
        <div className="pt-4 border-t border-[var(--color-border-default)]">
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent-600)] transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              <span className="text-sm">GitHub</span>
            </a>
            <span className="text-[var(--color-border-default)]">|</span>
            <span className="flex items-center gap-1 text-sm text-[var(--color-text-muted)]">
              Made with <Heart className="w-3 h-3 text-[var(--color-error-500)]" /> by AriaAI Team
            </span>
          </div>
        </div>

        {/* Copyright */}
        <p className="text-xs text-[var(--color-text-muted)]">
          © 2024 AriaAI. All rights reserved.
        </p>
      </div>
    </div>
  )
}
