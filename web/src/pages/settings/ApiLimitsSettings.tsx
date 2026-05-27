import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock3,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { api } from '../../api/client'
import { formatDateTime, getResolvedAppTimeZone } from '../../utils/timezone'
import type {
  ClientMemoryJob,
  ClientMemoryJobsResponse,
  ProjectMemoryJob,
  ProjectMemoryJobsResponse,
} from '../../types/api'

type BudgetInfo = {
  used: number
  limit: number
  remaining: number
}

type CombinedJob = ({ scope: 'project' } & ProjectMemoryJob) | ({ scope: 'client' } & ClientMemoryJob)

type FailureItem =
  | {
      scope: 'project'
      project_id: number
      project_name: string
      client?: string
      category?: string
      stage: string
      message: string
      retry_count?: number
      failed_at: string
    }
  | {
      scope: 'client'
      client_id: number
      client_name: string
      category?: string
      stage: string
      message: string
      retry_count?: number
      failed_at: string
    }

function formatDate(value?: string | null, isZh = true) {
  if (!value) return isZh ? '等待调度' : 'Waiting'
  return formatDateTime(value, isZh ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }, getResolvedAppTimeZone())
}

function getFailureText(failure: FailureItem) {
  return `${failure.category ?? ''} ${failure.stage} ${failure.message}`.toLowerCase()
}

function isRateLimitFailure(failure: FailureItem) {
  const text = getFailureText(failure)
  return (
    failure.category === 'rate_limit' ||
    text.includes('429') ||
    text.includes('rate limit') ||
    text.includes('too many requests') ||
    text.includes('engine_overloaded')
  )
}

function isModelPressureFailure(failure: FailureItem) {
  const text = getFailureText(failure)
  return (
    isRateLimitFailure(failure) ||
    failure.category === 'timeout' ||
    failure.category === 'llm' ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('model') ||
    text.includes('llm') ||
    text.includes('kimi') ||
    text.includes('deepseek') ||
    text.includes('claude')
  )
}

function getFailureName(failure: FailureItem) {
  return failure.scope === 'project' ? failure.project_name : failure.client_name
}

function getFailureLink(failure: FailureItem) {
  return failure.scope === 'project' ? `/projects/${failure.project_id}` : `/clients/${failure.client_id}`
}

function getBudgetPercent(budget: BudgetInfo | null) {
  if (!budget || budget.limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((budget.used / budget.limit) * 100)))
}

function isBudgetTight(budget: BudgetInfo | null) {
  if (!budget || budget.limit <= 0) return false
  return budget.remaining <= Math.max(5, Math.floor(budget.limit * 0.15))
}

function StatusCard({
  icon: Icon,
  title,
  value,
  description,
  tone = 'default',
}: {
  icon: typeof Gauge
  title: string
  value: string | number
  description: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
}) {
  const toneClass = {
    default: 'bg-surface-container-low text-on-surface',
    warning: 'bg-amber-50 text-amber-950',
    danger: 'bg-red-50 text-red-950',
    success: 'bg-emerald-50 text-emerald-950',
  }[tone]

  const iconClass = {
    default: 'bg-primary/10 text-primary',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    success: 'bg-emerald-100 text-emerald-700',
  }[tone]

  return (
    <div className={`rounded-2xl p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`rounded-xl p-2 ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-right text-2xl font-semibold">{value}</div>
      </div>
      <div className="mt-4 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs opacity-75">{description}</div>
    </div>
  )
}

function BudgetStrip({ title, budget, isZh }: { title: string; budget: BudgetInfo | null; isZh: boolean }) {
  const percent = getBudgetPercent(budget)
  const tight = isBudgetTight(budget)

  return (
    <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-on-surface">{title}</div>
          <div className="mt-1 text-xs text-on-surface-muted">
            {budget
              ? isZh
                ? `已用 ${budget.used} / ${budget.limit}，剩余 ${budget.remaining}`
                : `Used ${budget.used} / ${budget.limit}, ${budget.remaining} left`
              : isZh
                ? '暂无预算数据'
                : 'No budget data yet'}
          </div>
        </div>
        {tight && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">{isZh ? '接近上限' : 'Tight'}</span>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-high">
        <div className={`h-full rounded-full ${tight ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function ApiLimitsSettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState<CombinedJob[]>([])
  const [projectBudget, setProjectBudget] = useState<BudgetInfo | null>(null)
  const [clientBudget, setClientBudget] = useState<BudgetInfo | null>(null)
  const [recentFailures, setRecentFailures] = useState<FailureItem[]>([])

  const loadLimits = async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError('')
      const [projectData, clientData] = await Promise.all([
        api.get<ProjectMemoryJobsResponse>('/projects/memory/jobs'),
        api.get<ClientMemoryJobsResponse>('/clients/memory/jobs'),
      ])
      setJobs([
        ...(projectData.jobs || []).map((job) => ({ ...job, scope: 'project' as const })),
        ...(clientData.jobs || []).map((job) => ({ ...job, scope: 'client' as const })),
      ])
      setProjectBudget(projectData.budget ?? null)
      setClientBudget(clientData.budget ?? null)
      setRecentFailures(
        [
          ...((projectData.recent_failures as FailureItem[] | undefined) ?? []),
          ...((clientData.recent_failures as FailureItem[] | undefined) ?? []),
        ].sort((a, b) => (b.failed_at || '').localeCompare(a.failed_at || '')),
      )
    } catch (err) {
      console.error('Failed to load API limit signals:', err)
      setError(isZh ? '加载 API 限流提醒失败，请稍后重试。' : 'Failed to load API limit signals. Please retry later.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadLimits()
    const timer = window.setInterval(() => {
      void loadLimits(true)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [])

  const retryingJobs = useMemo(() => jobs.filter((job) => (job.retry_count ?? 0) > 0).length, [jobs])
  const rateLimitFailures = useMemo(() => recentFailures.filter(isRateLimitFailure), [recentFailures])
  const modelPressureFailures = useMemo(() => recentFailures.filter(isModelPressureFailure), [recentFailures])
  const latestFailures = rateLimitFailures.length > 0 ? rateLimitFailures : modelPressureFailures.slice(0, 6)
  const hasPressure = rateLimitFailures.length > 0 || retryingJobs > 0 || isBudgetTight(projectBudget) || isBudgetTight(clientBudget)

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-teal-900 to-slate-950 p-6 text-white shadow-sm">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-emerald-50">
              <ShieldAlert className="h-4 w-4" />
              {isZh ? 'API 健康观察' : 'API health monitor'}
            </div>
            <h2 className="mt-4 text-2xl font-semibold">{isZh ? 'API 限流提醒' : 'API Rate Limits'}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50/80">
              {isZh
                ? '集中展示模型 API 的 429、rate limit、超时和预热预算压力，方便你快速判断是该等待恢复、降低并发，还是检查 API Key 与模型配置。'
                : 'A focused view for 429s, rate limits, timeouts, and warm-up budget pressure so you can decide whether to wait, reduce concurrency, or inspect model settings.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadLimits(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-emerald-950 transition hover:bg-emerald-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {isZh ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatusCard
          icon={Gauge}
          title={isZh ? '限流告警' : 'Rate-limit alerts'}
          value={rateLimitFailures.length}
          description={isZh ? '最近失败中识别到的 429 / rate limit' : 'Recent 429 / rate limit failures'}
          tone={rateLimitFailures.length > 0 ? 'danger' : 'success'}
        />
        <StatusCard
          icon={Clock3}
          title={isZh ? '重试中任务' : 'Retrying jobs'}
          value={retryingJobs}
          description={isZh ? '正在等待再次执行的记忆任务' : 'Memory jobs waiting for another run'}
          tone={retryingJobs > 0 ? 'warning' : 'success'}
        />
        <StatusCard
          icon={Wallet}
          title={isZh ? '项目预热预算' : 'Project warm budget'}
          value={projectBudget ? `${projectBudget.remaining}/${projectBudget.limit}` : '-'}
          description={isZh ? '剩余额度 / 每日额度' : 'Remaining / daily limit'}
          tone={isBudgetTight(projectBudget) ? 'warning' : 'default'}
        />
        <StatusCard
          icon={Brain}
          title={isZh ? '模型压力事件' : 'Model pressure events'}
          value={modelPressureFailures.length}
          description={isZh ? '限流、超时与 LLM 类失败合计' : 'Rate limits, timeouts, and LLM failures'}
          tone={modelPressureFailures.length > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-on-surface">{isZh ? '最近限流提醒' : 'Recent API limit alerts'}</h3>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {rateLimitFailures.length > 0
                    ? isZh
                      ? '这些任务已经被归类为 API 限流，建议稍后重试或降低批量预热节奏。'
                      : 'These jobs were classified as API rate limits. Retry later or slow batch warm-ups.'
                    : isZh
                      ? '暂未发现明确限流；下方会展示最近的模型压力事件用于排查。'
                      : 'No explicit rate limit found; recent model-pressure events are shown below for diagnosis.'}
                </p>
              </div>
              {hasPressure ? (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                  {isZh ? '需要关注' : 'Needs attention'}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                  {isZh ? '运行平稳' : 'Healthy'}
                </span>
              )}
            </div>
          </div>

          {latestFailures.length === 0 ? (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center text-emerald-950">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <h3 className="mt-4 text-lg font-semibold">{isZh ? '目前没有 API 限流提醒' : 'No API limit alerts right now'}</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm text-emerald-800">
                {isZh
                  ? '系统没有检测到 429、rate limit 或模型压力失败。页面会每 15 秒自动刷新一次。'
                  : 'No 429, rate limit, or model-pressure failures were detected. This page refreshes every 15 seconds.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {latestFailures.map((failure) => (
                <button
                  key={`${failure.scope}-${getFailureName(failure)}-${failure.stage}-${failure.failed_at}`}
                  type="button"
                  onClick={() => navigate(getFailureLink(failure))}
                  className="w-full rounded-2xl border border-outline-variant/60 bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
                          {isRateLimitFailure(failure) ? (isZh ? 'API 限流' : 'Rate limit') : failure.category || (isZh ? '模型压力' : 'Model pressure')}
                        </span>
                        <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs text-on-surface-muted">
                          {failure.scope === 'project' ? (isZh ? '项目' : 'Project') : isZh ? '客户' : 'Client'}
                        </span>
                        <span className="text-xs text-on-surface-muted">{formatDate(failure.failed_at, isZh)}</span>
                      </div>
                      <div className="mt-3 text-base font-semibold text-on-surface">{getFailureName(failure)}</div>
                      <div className="mt-1 text-xs text-on-surface-muted">{failure.stage}</div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-on-surface-muted">{failure.message}</p>
                    </div>
                    <div className="shrink-0 rounded-xl bg-surface-container-low px-3 py-2 text-xs text-on-surface-muted">
                      {isZh ? '重试次数' : 'Retries'}: {failure.retry_count ?? 0}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5">
            <h3 className="text-base font-semibold text-on-surface">{isZh ? '处理建议' : 'Recommended actions'}</h3>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => navigate('/settings/memory-ops')}
                className="flex w-full items-start gap-3 rounded-xl bg-surface px-4 py-3 text-left transition hover:bg-surface-container-high"
              >
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <span>
                  <span className="block text-sm font-medium text-on-surface">{isZh ? '先暂停批量预热' : 'Pause batch warm-ups first'}</span>
                  <span className="mt-1 block text-xs leading-5 text-on-surface-muted">
                    {isZh ? '限流出现时优先减少并发和重试风暴，再手动处理高优先级任务。' : 'When rate limits appear, reduce concurrency and avoid retry storms before handling priority jobs.'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/settings/ai')}
                className="flex w-full items-start gap-3 rounded-xl bg-surface px-4 py-3 text-left transition hover:bg-surface-container-high"
              >
                <Brain className="mt-0.5 h-5 w-5 text-primary" />
                <span>
                  <span className="block text-sm font-medium text-on-surface">{isZh ? '检查模型与 API Key' : 'Check model and API key'}</span>
                  <span className="mt-1 block text-xs leading-5 text-on-surface-muted">
                    {isZh ? '如果限流持续，检查供应商额度、模型可用性和当前 API Key 状态。' : 'If pressure continues, inspect provider quota, model availability, and API key status.'}
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <BudgetStrip title={isZh ? '项目记忆预热预算' : 'Project memory warm budget'} budget={projectBudget} isZh={isZh} />
            <BudgetStrip title={isZh ? '客户记忆预热预算' : 'Client memory warm budget'} budget={clientBudget} isZh={isZh} />
          </div>
        </aside>
      </div>
    </div>
  )
}
