import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Database, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'

interface MigrationGovernance {
  mode: 'bootstrap' | 'lightweight' | 'alembic' | string
  current_revision?: string | null
  latest_revision?: string | null
  known_revisions?: string[]
  pending_revisions?: string[]
  pending_count?: number
  up_to_date?: boolean | null
  idempotent_bootstrap?: boolean
  notes?: Record<string, string>
}

function getModeTone(governance: MigrationGovernance | null) {
  if (!governance) return 'neutral'
  if (governance.mode === 'alembic' && governance.pending_count === 0) return 'ok'
  if (governance.mode === 'lightweight') return 'warning'
  if ((governance.pending_count ?? 0) > 0) return 'warning'
  return 'neutral'
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'ok' | 'warning'
}) {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
      : tone === 'warning'
        ? 'border-amber-100 bg-amber-50 text-amber-950'
        : 'border-outline bg-surface-container-low text-on-surface'

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="mt-2 break-all text-xl font-semibold">{value || '-'}</div>
    </div>
  )
}

export function MigrationSettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [loading, setLoading] = useState(true)
  const [governance, setGovernance] = useState<MigrationGovernance | null>(null)
  const [error, setError] = useState('')

  const loadGovernance = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await api.get<MigrationGovernance>('/health/db/migrations')
      setGovernance(data)
    } catch (err: any) {
      console.error('Failed to load migration governance:', err)
      setError(err?.response?.data?.detail || (isZh ? '加载迁移状态失败' : 'Failed to load migration status'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGovernance()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const tone = getModeTone(governance)
  const healthy = tone === 'ok'

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-on-surface">{isZh ? '数据库迁移状态' : 'Database Migrations'}</h2>
          <p className="mt-1 text-sm text-on-surface-muted">
            {isZh
              ? '只读查看当前数据库迁移治理状态，用于部署后校验和数据库类失败排查。'
              : 'Read-only migration governance status for deployment checks and database failure triage.'}
          </p>
        </div>
        <button
          onClick={() => void loadGovernance()}
          className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-low"
        >
          <RefreshCw className="h-4 w-4" />
          {isZh ? '刷新状态' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-error/20 bg-error/10 p-4 text-sm text-error">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div
        className={`rounded-3xl border p-5 ${
          healthy ? 'border-emerald-100 bg-emerald-50/70' : 'border-amber-100 bg-amber-50/70'
        }`}
      >
        <div className="flex items-start gap-4">
          <div className={`rounded-2xl p-3 ${healthy ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {healthy ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
          </div>
          <div>
            <div className="text-lg font-semibold text-on-surface">
              {healthy ? (isZh ? '迁移状态正常' : 'Migrations are healthy') : isZh ? '需要关注迁移状态' : 'Migration state needs attention'}
            </div>
            <p className="mt-1 text-sm leading-6 text-on-surface-muted">
              {healthy
                ? isZh
                  ? '当前数据库由 Alembic 管理，且没有待执行迁移。'
                  : 'The database is Alembic-managed and has no pending revisions.'
                : isZh
                  ? '如果这是线上环境，请先查看部署日志中的 migration_governance 输出，再决定是否执行 ensure 或 upgrade。'
                  : 'For production, inspect migration_governance deployment logs before deciding whether to run ensure or upgrade.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label={isZh ? '模式' : 'Mode'} value={governance?.mode || '-'} tone={tone === 'ok' ? 'ok' : tone === 'warning' ? 'warning' : 'neutral'} />
        <StatCard label={isZh ? '当前版本' : 'Current revision'} value={governance?.current_revision || '-'} />
        <StatCard label={isZh ? '最新版本' : 'Latest revision'} value={governance?.latest_revision || '-'} />
        <StatCard label={isZh ? '待执行数量' : 'Pending count'} value={governance?.pending_count ?? 0} tone={(governance?.pending_count ?? 0) > 0 ? 'warning' : 'ok'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-outline bg-surface p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-on-surface">
            <GitBranch className="h-4 w-4" />
            {isZh ? '待执行 Revision' : 'Pending revisions'}
          </div>
          {governance?.pending_revisions?.length ? (
            <div className="flex flex-wrap gap-2">
              {governance.pending_revisions.map((revision) => (
                <span key={revision} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                  {revision}
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-surface-container-low p-4 text-sm text-on-surface-muted">
              {isZh ? '没有待执行迁移。' : 'No pending migrations.'}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-outline bg-surface p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-on-surface">
            <Database className="h-4 w-4" />
            {isZh ? '运维命令' : 'Operational commands'}
          </div>
          <div className="space-y-2 text-sm text-on-surface-muted">
            <code className="block rounded-xl bg-surface-container-low p-3">python scripts/migration_governance.py report</code>
            <code className="block rounded-xl bg-surface-container-low p-3">python scripts/migration_governance.py check</code>
            <code className="block rounded-xl bg-surface-container-low p-3">python scripts/migration_governance.py ensure</code>
            <code className="block rounded-xl bg-surface-container-low p-3">python scripts/migration_governance.py upgrade</code>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-outline bg-surface p-4">
        <div className="mb-3 text-sm font-semibold text-on-surface">{isZh ? '已知 Revision' : 'Known revisions'}</div>
        <div className="flex flex-wrap gap-2">
          {(governance?.known_revisions || []).map((revision) => (
            <span key={revision} className="rounded-full bg-surface-container-low px-3 py-1 text-xs text-on-surface-muted">
              {revision}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
