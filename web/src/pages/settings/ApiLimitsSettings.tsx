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
import { CxPagination } from '../../components/codex'
import { formatDateTime, getResolvedAppTimeZone } from '../../utils/timezone'
import type {
  ClientMemoryJob,
  MemoryOperationsSummaryResponse,
  ProjectMemoryJob,
} from '../../types/api'

type BudgetInfo = {
  used: number
  limit: number
  remaining: number
}

type CombinedJob = ({ scope: 'project' } & ProjectMemoryJob) | ({ scope: 'client' } & ClientMemoryJob)

const API_FAILURE_PAGE_SIZE = 10

function normalizeSummaryResponse(summary?: Partial<MemoryOperationsSummaryResponse>): MemoryOperationsSummaryResponse {
  return {
    counts: {
      jobs: summary?.counts?.jobs ?? 0,
      rebuild_jobs: summary?.counts?.rebuild_jobs ?? 0,
      summary_warm_jobs: summary?.counts?.summary_warm_jobs ?? 0,
      retrying_jobs: summary?.counts?.retrying_jobs ?? 0,
      recent_failures: summary?.counts?.recent_failures ?? 0,
      recent_successes: summary?.counts?.recent_successes ?? 0,
      manual_attention: summary?.counts?.manual_attention ?? 0,
    },
    failure_summary: {
      category_counts: summary?.failure_summary?.category_counts ?? {},
      scope_counts: {
        project: summary?.failure_summary?.scope_counts?.project ?? 0,
        client: summary?.failure_summary?.scope_counts?.client ?? 0,
      },
      top_category: summary?.failure_summary?.top_category ?? 'unknown',
      top_category_count: summary?.failure_summary?.top_category_count ?? 0,
      manual_attention_categories: summary?.failure_summary?.manual_attention_categories ?? [],
    },
    budget: {
      project: summary?.budget?.project,
      client: summary?.budget?.client,
      project_low: summary?.budget?.project_low ?? false,
      client_low: summary?.budget?.client_low ?? false,
    },
    recent_failures: summary?.recent_failures ?? [],
    recent_successes: summary?.recent_successes ?? [],
    pages: {
      jobs: {
        items: summary?.pages?.jobs?.items ?? [],
        total: summary?.pages?.jobs?.total ?? 0,
        limit: summary?.pages?.jobs?.limit ?? 0,
        offset: summary?.pages?.jobs?.offset ?? 0,
      },
      failures: {
        items: summary?.pages?.failures?.items ?? [],
        total: summary?.pages?.failures?.total ?? 0,
        limit: summary?.pages?.failures?.limit ?? 0,
        offset: summary?.pages?.failures?.offset ?? 0,
      },
      successes: {
        items: summary?.pages?.successes?.items ?? [],
        total: summary?.pages?.successes?.total ?? 0,
        limit: summary?.pages?.successes?.limit ?? 0,
        offset: summary?.pages?.successes?.offset ?? 0,
      },
    },
  }
}

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

type Tone = 'default' | 'warning' | 'danger' | 'success'

const TONE_ICON_BG: Record<Tone, string> = {
  default: 'var(--color-codex-bg-tint)',
  warning: 'color-mix(in oklch, var(--color-codex-warn) 14%, transparent)',
  danger: 'color-mix(in oklch, var(--color-codex-bad) 12%, transparent)',
  success: 'var(--color-codex-accent-bg)',
}

const TONE_ICON_COLOR: Record<Tone, string> = {
  default: 'var(--color-codex-ink-soft)',
  warning: 'var(--color-codex-warn)',
  danger: 'var(--color-codex-bad)',
  success: 'var(--color-codex-accent)',
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
  tone?: Tone
}) {
  return (
    <div
      style={{
        padding: 16,
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center"
          style={{
            background: TONE_ICON_BG[tone],
            color: TONE_ICON_COLOR[tone],
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div
          className="text-right font-mono"
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--color-codex-ink)',
          }}
        >
          {value}
        </div>
      </div>
      <div
        className="mt-3 font-mono"
        style={{
          fontSize: 10.5,
          color: 'var(--color-codex-ink-mute)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--color-codex-ink-mute)', lineHeight: 1.5 }}>
        {description}
      </div>
    </div>
  )
}

function BudgetStrip({ title, budget, isZh }: { title: string; budget: BudgetInfo | null; isZh: boolean }) {
  const percent = getBudgetPercent(budget)
  const tight = isBudgetTight(budget)
  const barColor = tight ? 'var(--color-codex-warn)' : 'var(--color-codex-accent)'

  return (
    <div
      style={{
        padding: 14,
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-sm, 3px)',
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-codex-ink)' }}>{title}</div>
          <div
            className="mt-0.5 font-mono"
            style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
          >
            {budget
              ? isZh
                ? `已用 ${budget.used} / ${budget.limit}，剩余 ${budget.remaining}`
                : `Used ${budget.used} / ${budget.limit}, ${budget.remaining} left`
              : isZh
                ? '暂无预算数据'
                : 'No budget data yet'}
          </div>
        </div>
        {tight && (
          <span
            className="font-mono"
            style={{
              padding: '2px 8px',
              fontSize: 10.5,
              background: 'color-mix(in oklch, var(--color-codex-warn) 14%, transparent)',
              color: 'var(--color-codex-warn)',
              borderRadius: 'var(--codex-r-pill, 999px)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {isZh ? '接近上限' : 'Tight'}
          </span>
        )}
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden"
        style={{
          background: 'var(--color-codex-bg-tint)',
          borderRadius: 'var(--codex-r-pill, 999px)',
        }}
      >
        <div
          className="h-full"
          style={{
            width: `${percent}%`,
            background: barColor,
            borderRadius: 'var(--codex-r-pill, 999px)',
            transition: 'width 0.4s',
          }}
        />
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
  const [retryingJobsTotal, setRetryingJobsTotal] = useState(0)
  const [projectBudget, setProjectBudget] = useState<BudgetInfo | null>(null)
  const [clientBudget, setClientBudget] = useState<BudgetInfo | null>(null)
  const [recentFailures, setRecentFailures] = useState<FailureItem[]>([])
  const [failureTotal, setFailureTotal] = useState(0)
  const [rateLimitTotal, setRateLimitTotal] = useState(0)
  const [failurePage, setFailurePage] = useState(1)
  const [failurePageSize, setFailurePageSize] = useState(API_FAILURE_PAGE_SIZE)

  const loadLimits = async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError('')
      const summary = normalizeSummaryResponse(await api.get<Partial<MemoryOperationsSummaryResponse>>('/memory/operations/summary', {
        params: {
          jobs_limit: 100,
          jobs_offset: 0,
          success_limit: 1,
          success_offset: 0,
          failure_limit: failurePageSize,
          failure_offset: (failurePage - 1) * failurePageSize,
        },
      }))
      setJobs((summary.pages?.jobs?.items ?? []) as unknown as CombinedJob[])
      setRetryingJobsTotal(summary.counts.retrying_jobs)
      setProjectBudget(summary.budget.project ?? null)
      setClientBudget(summary.budget.client ?? null)
      setRecentFailures((summary.pages?.failures?.items ?? []) as FailureItem[])
      setFailureTotal(summary.pages?.failures?.total ?? 0)
      setRateLimitTotal(summary.failure_summary.category_counts.rate_limit ?? 0)
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
  }, [failurePage, failurePageSize])

  const retryingJobs = retryingJobsTotal || jobs.filter((job) => (job.retry_count ?? 0) > 0).length
  const modelPressureFailures = useMemo(() => recentFailures.filter(isModelPressureFailure), [recentFailures])
  const latestFailures = recentFailures
  const failurePageCount = Math.max(1, Math.ceil(failureTotal / failurePageSize))
  const currentFailurePage = Math.min(failurePage, failurePageCount)
  const paginatedFailures = latestFailures
  const hasPressure = rateLimitTotal > 0 || retryingJobs > 0 || isBudgetTight(projectBudget) || isBudgetTight(clientBudget)

  useEffect(() => {
    setFailurePage((current) => Math.min(current, failurePageCount))
  }, [failurePageCount])

  if (loading) {
    return (
      <div
        className="theme-codex flex min-h-[420px] items-center justify-center p-8"
        style={{ background: 'var(--color-codex-bg)' }}
      >
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--color-codex-accent)' }} />
      </div>
    )
  }

  return (
    <div
      className="theme-codex"
      style={{
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
        padding: '8px 4px 32px',
      }}
    >
      <header
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
        style={{ marginBottom: 20 }}
      >
        <div>
          <div
            className="inline-flex items-center gap-1.5"
            style={{
              marginBottom: 6,
              padding: '2px 8px',
              fontSize: 10.5,
              background: 'var(--color-codex-bg-tint)',
              color: 'var(--color-codex-ink-soft)',
              borderRadius: 'var(--codex-r-pill, 999px)',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            <ShieldAlert className="h-3 w-3" />
            {isZh ? 'API 健康观察' : 'API health monitor'}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.015em',
            }}
          >
            {isZh ? 'API 限流提醒' : 'API Rate Limits'}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13,
              color: 'var(--color-codex-ink-mute)',
              lineHeight: 1.6,
              maxWidth: 640,
            }}
          >
            {isZh
              ? '集中展示模型 API 的 429、rate limit、超时和预热预算压力，方便你快速判断是该等待恢复、降低并发，还是检查 API Key 与模型配置。'
              : 'A focused view for 429s, rate limits, timeouts, and warm-up budget pressure so you can decide whether to wait, reduce concurrency, or inspect model settings.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLimits(true)}
          disabled={refreshing}
          className="inline-flex flex-shrink-0 items-center gap-2 px-3 py-2 transition-colors disabled:opacity-60"
          style={{
            fontSize: 12.5,
            background: 'var(--color-codex-bg-elev)',
            color: 'var(--color-codex-ink-soft)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {isZh ? '刷新' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'color-mix(in oklch, var(--color-codex-bad) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-bad)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <StatusCard
          icon={Gauge}
          title={isZh ? '限流告警' : 'Rate-limit alerts'}
          value={rateLimitTotal}
          description={isZh ? '最近失败中识别到的 429 / rate limit' : 'Recent 429 / rate limit failures'}
          tone={rateLimitTotal > 0 ? 'danger' : 'success'}
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

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div
            style={{
              padding: 18,
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    color: 'var(--color-codex-ink)',
                  }}
                >
                  {isZh ? '最近限流提醒' : 'Recent API limit alerts'}
                </h2>
                <p
                  style={{
                    margin: '4px 0 0',
                    fontSize: 12.5,
                    color: 'var(--color-codex-ink-mute)',
                    lineHeight: 1.55,
                  }}
                >
                  {rateLimitTotal > 0
                    ? isZh
                      ? '这些任务已经被归类为 API 限流，建议稍后重试或降低批量预热节奏。'
                      : 'These jobs were classified as API rate limits. Retry later or slow batch warm-ups.'
                    : isZh
                      ? '暂未发现明确限流；下方会展示最近的模型压力事件用于排查。'
                      : 'No explicit rate limit found; recent model-pressure events are shown below for diagnosis.'}
                </p>
              </div>
              <span
                className="font-mono flex-shrink-0"
                style={{
                  padding: '2px 8px',
                  fontSize: 10.5,
                  background: hasPressure
                    ? 'color-mix(in oklch, var(--color-codex-warn) 14%, transparent)'
                    : 'var(--color-codex-accent-bg)',
                  color: hasPressure
                    ? 'var(--color-codex-warn)'
                    : 'var(--color-codex-accent-ink)',
                  borderRadius: 'var(--codex-r-pill, 999px)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {hasPressure
                  ? isZh
                    ? '需要关注'
                    : 'Attention'
                  : isZh
                    ? '运行平稳'
                    : 'Healthy'}
              </span>
            </div>
          </div>

          {failureTotal === 0 ? (
            <div
              className="text-center"
              style={{
                padding: '32px 24px',
                background: 'var(--color-codex-bg-elev)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <CheckCircle2
                className="mx-auto h-9 w-9"
                style={{ color: 'var(--color-codex-accent)' }}
              />
              <h3
                style={{
                  margin: '12px 0 0',
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--color-codex-ink)',
                }}
              >
                {isZh ? '目前没有 API 限流提醒' : 'No API limit alerts right now'}
              </h3>
              <p
                style={{
                  margin: '6px auto 0',
                  maxWidth: 420,
                  fontSize: 12.5,
                  color: 'var(--color-codex-ink-mute)',
                  lineHeight: 1.6,
                }}
              >
                {isZh
                  ? '系统没有检测到 429、rate limit 或模型压力失败。页面会每 15 秒自动刷新一次。'
                  : 'No 429, rate limit, or model-pressure failures were detected. This page refreshes every 15 seconds.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedFailures.map((failure) => (
                <button
                  key={`${failure.scope}-${getFailureName(failure)}-${failure.stage}-${failure.failed_at}`}
                  type="button"
                  onClick={() => navigate(getFailureLink(failure))}
                  className="w-full text-left transition-colors"
                  style={{
                    padding: 14,
                    background: 'var(--color-codex-bg-elev)',
                    border: '1px solid var(--color-codex-line)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--color-codex-bg-elev)'
                  }}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-mono"
                          style={{
                            padding: '2px 8px',
                            fontSize: 10.5,
                            background: 'color-mix(in oklch, var(--color-codex-bad) 12%, transparent)',
                            color: 'var(--color-codex-bad)',
                            borderRadius: 'var(--codex-r-pill, 999px)',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {isRateLimitFailure(failure)
                            ? isZh
                              ? 'API 限流'
                              : 'Rate limit'
                            : failure.category || (isZh ? '模型压力' : 'Pressure')}
                        </span>
                        <span
                          className="font-mono"
                          style={{
                            padding: '2px 8px',
                            fontSize: 10.5,
                            background: 'var(--color-codex-bg-tint)',
                            color: 'var(--color-codex-ink-mute)',
                            borderRadius: 'var(--codex-r-pill, 999px)',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {failure.scope === 'project' ? (isZh ? '项目' : 'Project') : isZh ? '客户' : 'Client'}
                        </span>
                        <span
                          className="font-mono"
                          style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                        >
                          {formatDate(failure.failed_at, isZh)}
                        </span>
                      </div>
                      <div
                        className="mt-2"
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: 'var(--color-codex-ink)',
                        }}
                      >
                        {getFailureName(failure)}
                      </div>
                      <div
                        className="mt-1 font-mono"
                        style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                      >
                        {failure.stage}
                      </div>
                      <p
                        className="line-clamp-2"
                        style={{
                          margin: '6px 0 0',
                          fontSize: 12.5,
                          lineHeight: 1.55,
                          color: 'var(--color-codex-ink-soft)',
                        }}
                      >
                        {failure.message}
                      </p>
                    </div>
                    <div
                      className="font-mono flex-shrink-0"
                      style={{
                        padding: '6px 10px',
                        fontSize: 11,
                        background: 'var(--color-codex-bg-tint)',
                        color: 'var(--color-codex-ink-mute)',
                        borderRadius: 'var(--codex-r-sm, 3px)',
                      }}
                    >
                      {isZh ? '重试' : 'Retries'}: {failure.retry_count ?? 0}
                    </div>
                  </div>
                </button>
              ))}
              <CxPagination
                page={currentFailurePage}
                pageSize={failurePageSize}
                totalItems={failureTotal}
                onPageChange={setFailurePage}
                onPageSizeChange={(nextPageSize) => {
                  setFailurePageSize(nextPageSize)
                  setFailurePage(1)
                }}
                pageSizeOptions={[10, 20, 50]}
                isZh={isZh}
              />
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div
            style={{
              padding: 18,
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--color-codex-ink)',
              }}
            >
              {isZh ? '处理建议' : 'Recommended actions'}
            </h2>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => navigate('/settings/memory-ops')}
                className="flex w-full items-start gap-3 text-left transition-colors"
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--color-codex-bg)'
                }}
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  style={{ color: 'var(--color-codex-warn)' }}
                />
                <span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {isZh ? '先暂停批量预热' : 'Pause batch warm-ups first'}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 2,
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      color: 'var(--color-codex-ink-mute)',
                    }}
                  >
                    {isZh
                      ? '限流出现时优先减少并发和重试风暴，再手动处理高优先级任务。'
                      : 'When rate limits appear, reduce concurrency and avoid retry storms before handling priority jobs.'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/settings/ai')}
                className="flex w-full items-start gap-3 text-left transition-colors"
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--color-codex-bg)'
                }}
              >
                <Brain
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  style={{ color: 'var(--color-codex-accent)' }}
                />
                <span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {isZh ? '检查模型与 API Key' : 'Check model and API key'}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 2,
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      color: 'var(--color-codex-ink-mute)',
                    }}
                  >
                    {isZh
                      ? '如果限流持续，检查供应商额度、模型可用性和当前 API Key 状态。'
                      : 'If pressure continues, inspect provider quota, model availability, and API key status.'}
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <BudgetStrip title={isZh ? '项目记忆预热预算' : 'Project memory warm budget'} budget={projectBudget} isZh={isZh} />
            <BudgetStrip title={isZh ? '客户记忆预热预算' : 'Client memory warm budget'} budget={clientBudget} isZh={isZh} />
          </div>
        </aside>
      </div>
    </div>
  )
}
