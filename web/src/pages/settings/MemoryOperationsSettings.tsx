import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Filter,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { api } from '../../api/client'
import { CxConfirmDialog, CxPagination } from '../../components/codex'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime, getResolvedAppTimeZone } from '../../utils/timezone'
import type {
  ClientMemoryJob,
  MemoryOperationsSummaryResponse,
  ProjectMemoryJob,
} from '../../types/api'

type CombinedJob = ({ scope: 'project' } & ProjectMemoryJob) | ({ scope: 'client' } & ClientMemoryJob)
type JobScopeFilter = 'all' | 'project' | 'client'
type JobTypeFilter = 'all' | 'rebuild' | 'summary_warm'
type RetryFilter = 'all' | 'retrying' | 'clean'
type FailureCategory = 'all' | 'budget' | 'rate_limit' | 'timeout' | 'database' | 'data' | 'scheduler' | 'llm' | 'unknown'
type AttentionFilter = 'all' | 'manual'

const MEMORY_JOBS_PAGE_SIZE = 10
const MEMORY_SUCCESSES_PAGE_SIZE = 10
const MEMORY_FAILURES_PAGE_SIZE = 10

type BudgetInfo = {
  used: number
  limit: number
  remaining: number
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

type SuccessItem =
  | {
      scope: 'project'
      project_id: number
      project_name: string
      client?: string
      stage: string
      status?: string
      message: string
      trigger?: string
      version?: number
      completed_at: string
    }
  | {
      scope: 'client'
      client_id: number
      client_name: string
      stage: string
      status?: string
      message: string
      trigger?: string
      version?: number
      completed_at: string
    }

function getFailureKey(failure: FailureItem) {
  const entityId = failure.scope === 'project' ? failure.project_id : failure.client_id
  return `${failure.scope}-${entityId}-${failure.stage}-${failure.failed_at}`
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

function SectionCard({
  title,
  value,
  description,
  tone = 'default',
}: {
  title: string
  value: string | number
  description: string
  tone?: 'default' | 'warning'
}) {
  const isWarn = tone === 'warning'
  return (
    <div
      style={{
        padding: 14,
        background: 'var(--color-codex-bg-elev)',
        border: isWarn
          ? '1px solid color-mix(in oklch, var(--color-codex-warn) 30%, transparent)'
          : '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10.5,
          color: isWarn ? 'var(--color-codex-warn)' : 'var(--color-codex-ink-mute)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      <div
        className="mt-2 font-mono"
        style={{
          fontSize: 20,
          fontWeight: 500,
          color: 'var(--color-codex-ink)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          lineHeight: 1.55,
          color: isWarn ? 'var(--color-codex-warn)' : 'var(--color-codex-ink-mute)',
        }}
      >
        {description}
      </div>
    </div>
  )
}

function getBudgetTone(budget: BudgetInfo | null): 'default' | 'warning' {
  if (!budget || budget.limit <= 0) return 'default'
  return budget.remaining <= Math.max(5, Math.floor(budget.limit * 0.15)) ? 'warning' : 'default'
}

function isBudgetLow(budget: BudgetInfo | null) {
  return getBudgetTone(budget) === 'warning'
}

function inferFailureCategory(failure: FailureItem): Exclude<FailureCategory, 'all'> {
  const explicit = failure.category
  if (
    explicit === 'budget' ||
    explicit === 'rate_limit' ||
    explicit === 'timeout' ||
    explicit === 'database' ||
    explicit === 'data' ||
    explicit === 'scheduler' ||
    explicit === 'llm' ||
    explicit === 'unknown'
  ) {
    return explicit
  }
  const text = `${failure.stage} ${failure.message}`.toLowerCase()
  if (text.includes('budget') || text.includes('daily limit') || text.includes('quota')) return 'budget'
  if (text.includes('429') || text.includes('rate limit') || text.includes('too many requests')) return 'rate_limit'
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout'
  if (text.includes('database') || text.includes('sql') || text.includes('psycopg')) return 'database'
  if (text.includes('not found') || text.includes('empty') || text.includes('no project') || text.includes('no client')) return 'data'
  if (text.includes('scheduler') || text.includes('job') || text.includes('queue')) return 'scheduler'
  if (text.includes('model') || text.includes('llm') || text.includes('claude') || text.includes('kimi') || text.includes('deepseek')) return 'llm'
  return 'unknown'
}

function getFailureCategoryLabel(category: FailureCategory, isZh: boolean) {
  const labels: Record<FailureCategory, { zh: string; en: string }> = {
    all: { zh: '全部失败类型', en: 'All failure types' },
    budget: { zh: '预算不足', en: 'Budget' },
    rate_limit: { zh: '限流', en: 'Rate limit' },
    timeout: { zh: '超时', en: 'Timeout' },
    database: { zh: '数据库', en: 'Database' },
    data: { zh: '数据缺失', en: 'Data' },
    scheduler: { zh: '调度器', en: 'Scheduler' },
    llm: { zh: '模型服务', en: 'LLM' },
    unknown: { zh: '未知', en: 'Unknown' },
  }
  return isZh ? labels[category].zh : labels[category].en
}

function getFailureCategoryAdvice(category: FailureCategory, isZh: boolean) {
  const advice: Record<FailureCategory, { zh: string; en: string }> = {
    all: {
      zh: '优先处理数量最多的失败类型；如果同时有预算告警和重试任务，先停批量预热再处理失败。',
      en: 'Start with the most common failure type. If budgets and retries are both active, pause batch warming before clearing failures.',
    },
    budget: {
      zh: '预算不足时先暂停批量预热，等待每日预算恢复，或只手动重试最高优先级的项目/客户。',
      en: 'Pause batch warming when budgets are low. Wait for daily budget reset or retry only the highest-priority project/client.',
    },
    rate_limit: {
      zh: '限流通常来自模型服务压力。建议减少并发、拉长预热间隔，稍后重试失败任务。',
      en: 'Rate limits usually come from model pressure. Reduce concurrency, increase warm intervals, and retry later.',
    },
    timeout: {
      zh: '超时多与上下文过大或模型响应慢有关。先重试一次；若重复出现，检查文档量和摘要视角范围。',
      en: 'Timeouts often mean large context or slow model response. Retry once; if repeated, inspect document volume and summary scope.',
    },
    database: {
      zh: '数据库类失败不要盲目重试。先检查 /health/db/migrations 和迁移治理脚本输出。',
      en: 'Do not blindly retry database failures. Check /health/db/migrations and migration governance output first.',
    },
    data: {
      zh: '数据缺失通常需要回到项目/客户详情补齐基础信息、文档或记忆源，再重新执行。',
      en: 'Data failures usually need missing project/client basics, documents, or memory sources filled before retrying.',
    },
    scheduler: {
      zh: '调度器异常优先检查后台进程、PM2 日志和任务队列状态，再取消或立即执行任务。',
      en: 'For scheduler issues, check backend process, PM2 logs, and job queue state before cancelling or running jobs.',
    },
    llm: {
      zh: '模型服务失败先检查 AI 设置、API Key、模型可用性和供应商状态，再重试。',
      en: 'For LLM failures, check AI settings, API keys, model availability, and provider status before retrying.',
    },
    unknown: {
      zh: '未知失败先打开详情查看上下文，再结合后端日志定位。重复出现时建议补充后端分类规则。',
      en: 'For unknown failures, open the entity and check backend logs. Add backend classification rules if repeated.',
    },
  }
  return isZh ? advice[category].zh : advice[category].en
}

function getSuggestedActionLabel(category: FailureCategory, isZh: boolean) {
  const labels: Record<FailureCategory, { zh: string; en: string }> = {
    all: { zh: '查看详情', en: 'Open details' },
    budget: { zh: '查看预算', en: 'Review budget' },
    rate_limit: { zh: '稍后重试', en: 'Retry later' },
    timeout: { zh: '立即重试', en: 'Retry now' },
    database: { zh: '查看迁移状态', en: 'Open migrations' },
    data: { zh: '补齐数据', en: 'Fix data' },
    scheduler: { zh: '刷新任务', en: 'Refresh jobs' },
    llm: { zh: '检查 AI 设置', en: 'Check AI settings' },
    unknown: { zh: '打开详情', en: 'Open details' },
  }
  return isZh ? labels[category].zh : labels[category].en
}

export function MemoryOperationsSettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const toast = useToast()
  const loadRequestIdRef = useRef(0)

  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [actionKey, setActionKey] = useState('')
  const [jobs, setJobs] = useState<CombinedJob[]>([])
  const [projectBudget, setProjectBudget] = useState<BudgetInfo | null>(null)
  const [clientBudget, setClientBudget] = useState<BudgetInfo | null>(null)
  const [operationsSummary, setOperationsSummary] = useState<MemoryOperationsSummaryResponse | null>(null)
  const [recentFailures, setRecentFailures] = useState<FailureItem[]>([])
  const [recentSuccesses, setRecentSuccesses] = useState<SuccessItem[]>([])
  const [jobsTotal, setJobsTotal] = useState(0)
  const [successTotal, setSuccessTotal] = useState(0)
  const [failureTotal, setFailureTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [jobsPage, setJobsPage] = useState(1)
  const [jobsPageSize, setJobsPageSize] = useState(MEMORY_JOBS_PAGE_SIZE)
  const [successPage, setSuccessPage] = useState(1)
  const [successPageSize, setSuccessPageSize] = useState(MEMORY_SUCCESSES_PAGE_SIZE)
  const [failurePage, setFailurePage] = useState(1)
  const [failurePageSize, setFailurePageSize] = useState(MEMORY_FAILURES_PAGE_SIZE)
  const [scopeFilter, setScopeFilter] = useState<JobScopeFilter>('all')
  const [jobTypeFilter, setJobTypeFilter] = useState<JobTypeFilter>('all')
  const [retryFilter, setRetryFilter] = useState<RetryFilter>('all')
  const [failureCategoryFilter, setFailureCategoryFilter] = useState<FailureCategory>('all')
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('all')
  const [showFailuresOnly, setShowFailuresOnly] = useState(false)
  const [selectedFailureKey, setSelectedFailureKey] = useState<string | null>(null)
  const [selectedFailureKeys, setSelectedFailureKeys] = useState<Set<string>>(new Set())
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set())
  const [isBatchRetrying, setIsBatchRetrying] = useState(false)
  // Holds the high-risk subset count + carried-over selection so the
  // confirm dialog can show the warning and then resume the original
  // batch with the same items. Replaces the inline window.confirm() —
  // a synchronous prompt looked out of place in the Codex shell and
  // didn't show the count nicely.
  const [highRiskConfirm, setHighRiskConfirm] = useState<{
    highRiskCount: number
    toRetry: FailureItem[]
  } | null>(null)

  const loadJobs = useCallback((reportError = false) => {
    const requestId = ++loadRequestIdRef.current
    return api
      .get<MemoryOperationsSummaryResponse>('/memory/operations/summary', {
        params: {
          search: searchQuery.trim(),
          scope: scopeFilter,
          job_type: jobTypeFilter,
          retry: retryFilter,
          failure_category: failureCategoryFilter,
          attention: attentionFilter,
          jobs_limit: jobsPageSize,
          jobs_offset: (jobsPage - 1) * jobsPageSize,
          success_limit: successPageSize,
          success_offset: (successPage - 1) * successPageSize,
          failure_limit: failurePageSize,
          failure_offset: (failurePage - 1) * failurePageSize,
        },
      })
      .then((summaryData) => {
        if (requestId !== loadRequestIdRef.current) return
        setOperationsSummary(summaryData)
        setJobs((summaryData.pages?.jobs?.items ?? []) as unknown as CombinedJob[])
        setProjectBudget(summaryData.budget.project ?? null)
        setClientBudget(summaryData.budget.client ?? null)
        setRecentFailures((summaryData.pages?.failures?.items ?? []) as FailureItem[])
        setRecentSuccesses((summaryData.pages?.successes?.items ?? []) as SuccessItem[])
        setJobsTotal(summaryData.pages?.jobs?.total ?? 0)
        setFailureTotal(summaryData.pages?.failures?.total ?? 0)
        setSuccessTotal(summaryData.pages?.successes?.total ?? 0)
        const lastJobsPage = Math.max(1, Math.ceil((summaryData.pages?.jobs?.total ?? 0) / jobsPageSize))
        const lastSuccessPage = Math.max(1, Math.ceil((summaryData.pages?.successes?.total ?? 0) / successPageSize))
        const lastFailurePage = Math.max(1, Math.ceil((summaryData.pages?.failures?.total ?? 0) / failurePageSize))
        if (jobsPage > lastJobsPage) setJobsPage(lastJobsPage)
        if (successPage > lastSuccessPage) setSuccessPage(lastSuccessPage)
        if (failurePage > lastFailurePage) setFailurePage(lastFailurePage)
      })
      .catch((error: unknown) => {
        if (requestId !== loadRequestIdRef.current) return
        console.error('Failed to load memory operations:', error)
        if (reportError) {
          toast.error(isZh ? '加载记忆任务中心失败' : 'Failed to load memory operations')
        }
      })
      .finally(() => {
        if (requestId !== loadRequestIdRef.current) return
        setLoading(false)
        setListLoading(false)
      })
  }, [
    attentionFilter,
    failureCategoryFilter,
    failurePage,
    failurePageSize,
    isZh,
    jobTypeFilter,
    jobsPage,
    jobsPageSize,
    retryFilter,
    scopeFilter,
    searchQuery,
    successPage,
    successPageSize,
    toast,
  ])

  const resetPages = useCallback(() => {
    setJobsPage(1)
    setSuccessPage(1)
    setFailurePage(1)
  }, [])

  const beginFilteredUpdate = useCallback(() => {
    setListLoading(true)
    resetPages()
  }, [resetPages])

  useEffect(() => {
    void loadJobs(true)
    const timer = window.setInterval(() => {
      void loadJobs(false)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [loadJobs])

  const grouped = useMemo(
    () => ({
      rebuilding: jobs.filter((job) => job.job_type === 'rebuild'),
      warming: jobs.filter((job) => job.job_type === 'summary_warm'),
      retrying: jobs.filter((job) => (job.retry_count ?? 0) > 0),
    }),
    [jobs],
  )

  const failureGroups = useMemo(() => {
    const groups: Record<Exclude<FailureCategory, 'all'>, number> = {
      budget: 0,
      rate_limit: 0,
      timeout: 0,
      database: 0,
      data: 0,
      scheduler: 0,
      llm: 0,
      unknown: 0,
    }
    if (operationsSummary?.failure_summary.category_counts) {
      Object.entries(operationsSummary.failure_summary.category_counts).forEach(([category, count]) => {
        if (category in groups) {
          groups[category as Exclude<FailureCategory, 'all'>] = count
        }
      })
      return groups
    }
    recentFailures.forEach((failure) => {
      groups[inferFailureCategory(failure)] += 1
    })
    return groups
  }, [operationsSummary, recentFailures])

  const mostCommonFailureCategory = useMemo(() => {
    const entries = Object.entries(failureGroups) as Array<[Exclude<FailureCategory, 'all'>, number]>
    const [category, count] = entries.sort((a, b) => b[1] - a[1])[0] ?? ['unknown', 0]
    return { category, count }
  }, [failureGroups])

  const manualAttentionFailures = useMemo(
    () => recentFailures.filter((failure) => ['database', 'data', 'unknown'].includes(inferFailureCategory(failure))),
    [recentFailures],
  )
  const manualAttentionCount = operationsSummary?.counts.manual_attention ?? manualAttentionFailures.length
  const retryingJobsCount = operationsSummary?.counts.retrying_jobs ?? grouped.retrying.length
  const projectBudgetLow = operationsSummary?.budget.project_low ?? isBudgetLow(projectBudget)
  const clientBudgetLow = operationsSummary?.budget.client_low ?? isBudgetLow(clientBudget)

  const alertSummary = useMemo(() => {
    const alerts: Array<{
      key: string
      severity: 'critical' | 'warning' | 'info'
      title: string
      description: string
      action: string
      onClick: () => void
    }> = []

    if (manualAttentionCount > 0) {
      alerts.push({
        key: 'manual-attention',
        severity: 'critical',
        title: isZh ? '需要人工处理的失败' : 'Manual attention needed',
        description: isZh
          ? `${manualAttentionCount} 条数据库、数据缺失或未知失败，不建议直接盲目重试。`
          : `${manualAttentionCount} database, data, or unknown failures should be inspected before retrying.`,
        action: isZh ? '查看人工处理项' : 'Review manual items',
        onClick: () => {
          resetPages()
          setShowFailuresOnly(true)
          setAttentionFilter('manual')
        },
      })
    }

    if (mostCommonFailureCategory.count > 0) {
      alerts.push({
        key: 'top-failure-category',
        severity: mostCommonFailureCategory.category === 'database' || mostCommonFailureCategory.category === 'unknown' ? 'critical' : 'warning',
        title: isZh
          ? `主要失败类型：${getFailureCategoryLabel(mostCommonFailureCategory.category, isZh)}`
          : `Top failure type: ${getFailureCategoryLabel(mostCommonFailureCategory.category, isZh)}`,
        description: isZh
          ? `最近失败中有 ${mostCommonFailureCategory.count} 条属于这一类，建议优先清理。`
          : `${mostCommonFailureCategory.count} recent failures are in this category.`,
        action: isZh ? '筛选该类型' : 'Filter this type',
        onClick: () => {
          resetPages()
          setShowFailuresOnly(true)
          setFailureCategoryFilter(mostCommonFailureCategory.category)
        },
      })
    }

    if (retryingJobsCount > 0) {
      alerts.push({
        key: 'retrying-jobs',
        severity: 'warning',
        title: isZh ? '存在重试中的任务' : 'Jobs are retrying',
        description: isZh
          ? `${retryingJobsCount} 个任务已经进入重试，建议确认是否被限流、超时或模型服务影响。`
          : `${retryingJobsCount} jobs have already retried. Check rate limit, timeout, or model issues.`,
        action: isZh ? '查看重试任务' : 'View retrying jobs',
        onClick: () => {
          resetPages()
          setShowFailuresOnly(false)
          setRetryFilter('retrying')
        },
      })
    }

    if (projectBudgetLow) {
      alerts.push({
        key: 'project-budget',
        severity: 'warning',
        title: isZh ? '项目摘要预热预算偏低' : 'Project warm budget is low',
        description: isZh
          ? `今日剩余 ${projectBudget?.remaining ?? 0}，建议暂停批量预热，优先处理失败和高价值项目。`
          : `${projectBudget?.remaining ?? 0} project warm budget remains today.`,
        action: isZh ? '查看摘要预热任务' : 'View warm jobs',
        onClick: () => {
          resetPages()
          setShowFailuresOnly(false)
          setScopeFilter('project')
          setJobTypeFilter('summary_warm')
        },
      })
    }

    if (clientBudgetLow) {
      alerts.push({
        key: 'client-budget',
        severity: 'warning',
        title: isZh ? '客户摘要预热预算偏低' : 'Client warm budget is low',
        description: isZh
          ? `今日剩余 ${clientBudget?.remaining ?? 0}，建议先保留给关键客户或手动触发场景。`
          : `${clientBudget?.remaining ?? 0} client warm budget remains today.`,
        action: isZh ? '查看客户预热任务' : 'View client warm jobs',
        onClick: () => {
          resetPages()
          setShowFailuresOnly(false)
          setScopeFilter('client')
          setJobTypeFilter('summary_warm')
        },
      })
    }

    return alerts
  }, [
    clientBudget,
    clientBudgetLow,
    isZh,
    manualAttentionCount,
    mostCommonFailureCategory.category,
    mostCommonFailureCategory.count,
    projectBudget,
    projectBudgetLow,
    retryingJobsCount,
    resetPages,
  ])

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return jobs.filter((job) => {
      if (scopeFilter !== 'all' && job.scope !== scopeFilter) return false
      if (jobTypeFilter !== 'all' && job.job_type !== jobTypeFilter) return false
      if (retryFilter === 'retrying' && (job.retry_count ?? 0) <= 0) return false
      if (retryFilter === 'clean' && (job.retry_count ?? 0) > 0) return false

      if (!query) return true
      const label =
        job.scope === 'project'
          ? [job.project_name, job.client, job.trigger, ...(job.summary_types ?? [])]
          : [job.client_name, job.industry, job.trigger, ...(job.summary_types ?? [])]

      return label.some((item) => String(item || '').toLowerCase().includes(query))
    })
  }, [jobs, jobTypeFilter, retryFilter, scopeFilter, searchQuery])

  const filteredFailures = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return recentFailures.filter((failure) => {
      if (scopeFilter !== 'all' && failure.scope !== scopeFilter) return false
      if (attentionFilter === 'manual' && !['database', 'data', 'unknown'].includes(inferFailureCategory(failure))) return false
      if (failureCategoryFilter !== 'all' && inferFailureCategory(failure) !== failureCategoryFilter) return false
      if (!query) return true
      const fields =
        failure.scope === 'project'
          ? [failure.project_name, failure.client, failure.stage, failure.message, inferFailureCategory(failure)]
          : [failure.client_name, failure.stage, failure.message, inferFailureCategory(failure)]
      return fields.some((item) => String(item || '').toLowerCase().includes(query))
    })
  }, [attentionFilter, failureCategoryFilter, recentFailures, scopeFilter, searchQuery])

  const filteredSuccesses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return recentSuccesses.filter((success) => {
      if (scopeFilter !== 'all' && success.scope !== scopeFilter) return false
      if (!query) return true
      const fields =
        success.scope === 'project'
          ? [success.project_name, success.client, success.stage, success.message, success.trigger]
          : [success.client_name, success.stage, success.message, success.trigger]
      return fields.some((item) => String(item || '').toLowerCase().includes(query))
    })
  }, [recentSuccesses, scopeFilter, searchQuery])

  const visibleFailures = useMemo(
    () => filteredFailures.filter((failure) => !dismissedKeys.has(getFailureKey(failure))),
    [dismissedKeys, filteredFailures],
  )
  const jobsPageCount = Math.max(1, Math.ceil(jobsTotal / jobsPageSize))
  const currentJobsPage = Math.min(jobsPage, jobsPageCount)
  const paginatedJobs = filteredJobs
  const successPageCount = Math.max(1, Math.ceil(successTotal / successPageSize))
  const currentSuccessPage = Math.min(successPage, successPageCount)
  const paginatedSuccesses = filteredSuccesses
  const failurePageCount = Math.max(1, Math.ceil(failureTotal / failurePageSize))
  const currentFailurePage = Math.min(failurePage, failurePageCount)
  const paginatedFailures = visibleFailures

  const selectedFailure = useMemo(
    () => (selectedFailureKey ? recentFailures.find((failure) => getFailureKey(failure) === selectedFailureKey) ?? null : null),
    [recentFailures, selectedFailureKey],
  )

  const runNow = async (job: CombinedJob) => {
    try {
      setActionKey(`${job.scope}-${job.job_id}-run`)
      await api.post(
        job.scope === 'project'
          ? `/projects/memory/jobs/${job.project_id}/run-now`
          : `/clients/memory/jobs/${job.client_id}/run-now`,
        {},
        { timeout: 120000 },
      )
      toast.success(isZh ? '任务已开始执行' : 'Job started')
      await loadJobs(false)
    } catch (error) {
      console.error('Failed to run memory job now:', error)
      toast.error(isZh ? '立即执行任务失败' : 'Failed to run job now')
    } finally {
      setActionKey('')
    }
  }

  const retryFailure = async (failure: FailureItem) => {
    try {
      setActionKey(`${failure.scope}-failure-${failure.failed_at}`)
      await api.post(
        failure.scope === 'project'
          ? `/projects/memory/jobs/${failure.project_id}/run-now`
          : `/clients/memory/jobs/${failure.client_id}/run-now`,
        {},
        { timeout: 120000 },
      )
      toast.success(isZh ? '已重新加入执行队列' : 'Queued retry successfully')
      await loadJobs(false)
    } catch (error) {
      console.error('Failed to retry memory job:', error)
      toast.error(isZh ? '重试任务失败' : 'Failed to retry job')
    } finally {
      setActionKey('')
    }
  }

  const toggleFailureSelection = (key: string) => {
    setSelectedFailureKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    const visibleKeys = paginatedFailures.map(getFailureKey)
    const allSelected = visibleKeys.every((k) => selectedFailureKeys.has(k))
    if (allSelected) {
      setSelectedFailureKeys(new Set())
    } else {
      setSelectedFailureKeys(new Set(visibleKeys))
    }
  }

  // Entry point for the batch-retry button. Splits into "open the
  // dialog" vs. "run directly" depending on whether high-risk
  // categories are present.
  const batchRetryFailures = () => {
    const toRetry = filteredFailures.filter((f) => selectedFailureKeys.has(getFailureKey(f)))
    if (toRetry.length === 0) return
    const highRisk = toRetry.filter((f) =>
      ['database', 'data', 'unknown'].includes(inferFailureCategory(f)),
    )
    if (highRisk.length > 0) {
      setHighRiskConfirm({ highRiskCount: highRisk.length, toRetry })
      return
    }
    void performBatchRetry(toRetry)
  }

  const performBatchRetry = async (toRetry: FailureItem[]) => {
    setIsBatchRetrying(true)
    let successCount = 0
    let failCount = 0
    for (const failure of toRetry) {
      try {
        await api.post(
          failure.scope === 'project'
            ? `/projects/memory/jobs/${failure.project_id}/run-now`
            : `/clients/memory/jobs/${failure.client_id}/run-now`,
          {},
          { timeout: 120000 },
        )
        successCount++
      } catch {
        failCount++
      }
    }
    setIsBatchRetrying(false)
    setSelectedFailureKeys(new Set())
    if (successCount > 0) {
      toast.success(isZh ? `已重试 ${successCount} 条` : `Retried ${successCount} jobs`)
    }
    if (failCount > 0) {
      toast.error(isZh ? `${failCount} 条重试失败` : `${failCount} retries failed`)
    }
    await loadJobs(false)
  }

  const dismissSelectedFailures = () => {
    setDismissedKeys((prev) => {
      const next = new Set(prev)
      for (const key of selectedFailureKeys) next.add(key)
      return next
    })
    setSelectedFailureKeys(new Set())
    toast.success(isZh ? '已忽略选中失败' : 'Dismissed selected failures')
  }

  const cancelJob = async (job: CombinedJob) => {
    try {
      setActionKey(`${job.scope}-${job.job_id}-cancel`)
      await api.post(
        job.scope === 'project'
          ? `/projects/memory/jobs/${job.project_id}/cancel`
          : `/clients/memory/jobs/${job.client_id}/cancel`,
        {},
      )
      setJobs((current) => current.filter((item) => item.job_id !== job.job_id))
      toast.success(isZh ? '任务已取消' : 'Job cancelled')
    } catch (error) {
      console.error('Failed to cancel memory job:', error)
      toast.error(isZh ? '取消任务失败' : 'Failed to cancel job')
    } finally {
      setActionKey('')
    }
  }

  const openEntity = (job: CombinedJob | FailureItem | SuccessItem) => {
    if (job.scope === 'project') {
      navigate(`/projects/${job.project_id}/memory`)
      return
    }
    // ``/clients/:id/memory`` collapsed into the client detail memory tab.
    navigate(`/clients/${job.client_id}?tab=memory`)
  }

  const runSuggestedAction = (failure: FailureItem) => {
    const category = inferFailureCategory(failure)
    if (category === 'database') {
      navigate('/settings/migrations')
      return
    }
    if (category === 'llm') {
      navigate('/settings/ai')
      return
    }
    if (category === 'scheduler' || category === 'budget') {
      setListLoading(true)
      void loadJobs(true)
      return
    }
    if (category === 'rate_limit' || category === 'timeout') {
      void retryFailure(failure)
      return
    }
    openEntity(failure)
  }

  const renderFailureDetailPanel = () => {
    if (!selectedFailure) {
      return (
        <div
          style={{
            padding: 16,
            background: 'var(--color-codex-bg-elev)',
            border: '1px dashed var(--color-codex-line)',
            borderRadius: 'var(--codex-r-md, 6px)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
            {isZh ? '失败明细' : 'Failure details'}
          </div>
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 12.5,
              lineHeight: 1.6,
              color: 'var(--color-codex-ink-mute)',
            }}
          >
            {isZh
              ? '从左侧选择一条失败记录，这里会显示原始错误、分类判断和建议动作。'
              : 'Select a failure on the left to inspect the raw error, classification, and suggested action.'}
          </p>
        </div>
      )
    }

    const category = inferFailureCategory(selectedFailure)
    const title =
      selectedFailure.scope === 'project'
        ? isZh
          ? `项目 / ${selectedFailure.project_name}`
          : `Project / ${selectedFailure.project_name}`
        : isZh
          ? `客户 / ${selectedFailure.client_name}`
          : `Client / ${selectedFailure.client_name}`
    const busyRetry = actionKey === `${selectedFailure.scope}-failure-${selectedFailure.failed_at}`

    const subBox: React.CSSProperties = {
      padding: '10px 12px',
      background: 'var(--color-codex-bg)',
      border: '1px solid var(--color-codex-line-soft)',
      borderRadius: 'var(--codex-r-sm, 3px)',
    }

    return (
      <div
        style={{
          padding: 16,
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid color-mix(in oklch, var(--color-codex-warn) 30%, transparent)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
              {isZh ? '失败明细' : 'Failure details'}
            </div>
            <div
              className="mt-1 truncate"
              style={{ fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}
            >
              {title}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedFailureKey(null)}
            className="rounded p-1 transition-colors"
            style={{ color: 'var(--color-codex-ink-soft)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-codex-bg-tint)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            aria-label={isZh ? '关闭失败明细' : 'Close failure details'}
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-2" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-soft)' }}>
          <div style={subBox}>
            <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {isZh ? '失败分类' : 'Category'}
            </div>
            <div className="mt-1" style={{ color: 'var(--color-codex-ink)' }}>
              {getFailureCategoryLabel(category, isZh)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div style={subBox}>
              <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {isZh ? '阶段' : 'Stage'}
              </div>
              <div className="mt-1 font-mono" style={{ color: 'var(--color-codex-ink)' }}>{selectedFailure.stage}</div>
            </div>
            <div style={subBox}>
              <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {isZh ? '重试次数' : 'Retries'}
              </div>
              <div className="mt-1 font-mono" style={{ color: 'var(--color-codex-ink)' }}>{selectedFailure.retry_count ?? 0}</div>
            </div>
          </div>
          <div style={subBox}>
            <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {isZh ? '失败时间' : 'Failed at'}
            </div>
            <div className="mt-1 font-mono" style={{ color: 'var(--color-codex-ink)' }}>{formatDate(selectedFailure.failed_at, isZh)}</div>
          </div>
          <div style={subBox}>
            <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {isZh ? '原始错误' : 'Raw error'}
            </div>
            <div
              className="mt-2 whitespace-pre-wrap break-words font-mono"
              style={{ lineHeight: 1.55, color: 'var(--color-codex-ink)' }}
            >
              {selectedFailure.message}
            </div>
          </div>
          <div style={subBox}>
            <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {isZh ? '处理建议' : 'Suggested handling'}
            </div>
            <div className="mt-2" style={{ lineHeight: 1.55, color: 'var(--color-codex-ink-soft)' }}>
              {getFailureCategoryAdvice(category, isZh)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void retryFailure(selectedFailure)}
            disabled={busyRetry}
            className="inline-flex items-center gap-2 disabled:opacity-60"
            style={{
              padding: '6px 10px',
              fontSize: 11.5,
              background: 'var(--color-codex-accent)',
              color: 'var(--color-codex-bg-elev)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            {busyRetry ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {isZh ? '立即重试' : 'Retry now'}
          </button>
          <button
            type="button"
            onClick={() => runSuggestedAction(selectedFailure)}
            className="inline-flex items-center gap-2"
            style={{
              padding: '6px 10px',
              fontSize: 11.5,
              background: 'var(--color-codex-bg)',
              color: 'var(--color-codex-ink-soft)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <ExternalLink className="h-3 w-3" />
            {getSuggestedActionLabel(category, isZh)}
          </button>
          <button
            type="button"
            onClick={() => openEntity(selectedFailure)}
            className="inline-flex items-center gap-2"
            style={{
              padding: '6px 10px',
              fontSize: 11.5,
              background: 'var(--color-codex-bg)',
              color: 'var(--color-codex-ink-soft)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <ExternalLink className="h-3 w-3" />
            {isZh ? '打开对象' : 'Open entity'}
          </button>
        </div>
      </div>
    )
  }

  const renderSuccessCard = (success: SuccessItem, index: number) => {
    const title =
      success.scope === 'project'
        ? isZh
          ? `项目 / ${success.project_name}`
          : `Project / ${success.project_name}`
        : isZh
          ? `客户 / ${success.client_name}`
          : `Client / ${success.client_name}`
    const subLabel =
      success.scope === 'project'
        ? success.client || (isZh ? '未填写客户' : 'No client')
        : isZh
          ? '客户记忆'
          : 'Client memory'

    return (
      <div
        key={`${success.scope}-${success.completed_at}-${index}`}
        style={{
          padding: 12,
          background: 'var(--color-codex-accent-bg)',
          border: '1px solid color-mix(in oklch, var(--color-codex-accent) 25%, transparent)',
          borderRadius: 'var(--codex-r-sm, 3px)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="flex items-center gap-2"
              style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-codex-accent-ink)' }}
            >
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{title}</span>
            </div>
            <div
              className="mt-1 font-mono"
              style={{ fontSize: 11, color: 'var(--color-codex-accent-ink)' }}
            >
              {subLabel}
              {' · '}
              {success.stage}
              {' · v'}
              {success.version ?? '-'}
            </div>
          </div>
          <div
            className="font-mono flex-shrink-0"
            style={{ fontSize: 11, color: 'var(--color-codex-accent-ink)' }}
          >
            {formatDate(success.completed_at, isZh)}
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 12.5,
            color: 'var(--color-codex-ink)',
            lineHeight: 1.55,
          }}
        >
          {success.message}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {success.trigger ? (
            <span
              className="font-mono"
              style={{
                padding: '4px 8px',
                fontSize: 10.5,
                background: 'var(--color-codex-bg)',
                color: 'var(--color-codex-accent-ink)',
                border: '1px solid color-mix(in oklch, var(--color-codex-accent) 25%, transparent)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                letterSpacing: '0.04em',
              }}
            >
              {isZh ? '触发 ' : 'Trigger '}
              {success.trigger}
            </span>
          ) : null}
          <button
            onClick={() => openEntity(success)}
            className="inline-flex items-center gap-1.5"
            style={{
              padding: '4px 9px',
              fontSize: 11,
              background: 'var(--color-codex-bg)',
              color: 'var(--color-codex-ink-soft)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <ExternalLink className="h-3 w-3" />
            {isZh ? '打开详情' : 'Open'}
          </button>
        </div>
      </div>
    )
  }

  const renderJobCard = (job: CombinedJob) => {
    const label =
      job.scope === 'project'
        ? isZh
          ? `项目 / ${job.project_name}`
          : `Project / ${job.project_name}`
        : isZh
          ? `客户 / ${job.client_name}`
          : `Client / ${job.client_name}`
    const subLabel =
      job.scope === 'project'
        ? job.client || (isZh ? '未填写客户' : 'No client')
        : job.industry || (isZh ? '未填写行业' : 'No industry')
    const jobLabel = job.job_type === 'summary_warm' ? (isZh ? '摘要预热' : 'Summary warm') : isZh ? '记忆重建' : 'Memory rebuild'
    const busyRun = actionKey === `${job.scope}-${job.job_id}-run`
    const busyCancel = actionKey === `${job.scope}-${job.job_id}-cancel`

    const chipStyle: React.CSSProperties = {
      padding: '2px 8px',
      fontSize: 10.5,
      background: 'var(--color-codex-bg-tint)',
      color: 'var(--color-codex-ink-soft)',
      borderRadius: 'var(--codex-r-pill, 999px)',
      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
      letterSpacing: '0.04em',
    }
    const ghostBtn: React.CSSProperties = {
      padding: '6px 10px',
      fontSize: 12,
      background: 'var(--color-codex-bg)',
      color: 'var(--color-codex-ink-soft)',
      border: '1px solid var(--color-codex-line)',
      borderRadius: 'var(--codex-r-sm, 3px)',
    }
    return (
      <div
        key={`${job.scope}-${job.job_id}`}
        style={{
          padding: 16,
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-codex-ink)' }}>{label}</div>
            <div
              className="mt-1 font-mono"
              style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
            >
              {subLabel}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span style={chipStyle}>{jobLabel}</span>
              {job.language ? <span style={chipStyle}>{job.language}</span> : null}
              <span style={chipStyle}>v{job.memory_version}</span>
              <span style={chipStyle}>
                {isZh ? '重试 ' : 'Retry '}
                {job.retry_count ?? 0}/{job.max_retries ?? 0}
              </span>
              {job.trigger ? (
                <span style={chipStyle}>
                  {isZh ? '触发 ' : 'Trigger '}
                  {job.trigger}
                </span>
              ) : null}
              {job.summary_types?.length ? (
                <span style={chipStyle}>{job.summary_types.join(', ')}</span>
              ) : null}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: 'var(--color-codex-ink-mute)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {isZh ? '计划执行' : 'Scheduled'}
            </div>
            <div
              className="mt-1 font-mono"
              style={{ fontSize: 12, color: 'var(--color-codex-ink) ' }}
            >
              {formatDate(job.next_run_at, isZh)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => void runNow(job)}
            disabled={busyRun || busyCancel}
            className="inline-flex items-center gap-2 disabled:opacity-60"
            style={ghostBtn}
          >
            {busyRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {isZh ? '立即' : 'Run'}
          </button>
          <button
            onClick={() => void cancelJob(job)}
            disabled={busyRun || busyCancel}
            className="inline-flex items-center gap-2 disabled:opacity-60"
            style={ghostBtn}
          >
            {busyCancel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={() => openEntity(job)}
            className="inline-flex items-center gap-2"
            style={ghostBtn}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {isZh ? '打开' : 'Open'}
          </button>
        </div>
      </div>
    )
  }

  if (loading && operationsSummary === null) {
    return (
      <div
        className="theme-codex flex min-h-[320px] items-center justify-center"
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
        className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
        style={{ marginBottom: 20 }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.015em',
            }}
          >
            {isZh ? '记忆任务中心' : 'Memory Operations'}
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
              ? '统一查看项目与客户记忆的重建、摘要预热、重试和失败情况。'
              : 'Monitor rebuild, summary warming, retries, and failures for project and client memory.'}
          </p>
        </div>
        <button
          onClick={() => {
            setListLoading(true)
            void loadJobs(true)
          }}
          className="inline-flex flex-shrink-0 items-center gap-2"
          style={{
            padding: '8px 14px',
            fontSize: 13,
            background: 'var(--color-codex-bg-elev)',
            color: 'var(--color-codex-ink-soft)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <RefreshCw className={listLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          {isZh ? '刷新任务' : 'Refresh jobs'}
        </button>
      </header>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-9">
        <SectionCard
          title={isZh ? '进行中/排队' : 'Active jobs'}
          value={operationsSummary?.counts.jobs ?? jobs.length}
          description={isZh ? '当前排队或进行中的后台任务' : 'Queued or running background jobs'}
        />
        <SectionCard
          title={isZh ? '记忆重建' : 'Rebuild jobs'}
          value={operationsSummary?.counts.rebuild_jobs ?? grouped.rebuilding.length}
          description={isZh ? '项目与客户记忆重建队列' : 'Project and client rebuild queue'}
        />
        <SectionCard
          title={isZh ? '摘要预热' : 'Summary warm jobs'}
          value={operationsSummary?.counts.summary_warm_jobs ?? grouped.warming.length}
          description={isZh ? '常用摘要缓存预热任务' : 'Common summary cache warm jobs'}
        />
        <SectionCard
          title={isZh ? '重试中的任务' : 'Retrying jobs'}
          value={retryingJobsCount}
          description={isZh ? '已经至少重试过一次' : 'Jobs that already retried at least once'}
        />
        <SectionCard
          title={isZh ? '失败告警' : 'Failure alerts'}
          value={operationsSummary?.counts.recent_failures ?? recentFailures.length}
          description={
            mostCommonFailureCategory.count > 0
              ? `${getFailureCategoryLabel(mostCommonFailureCategory.category, isZh)} ${mostCommonFailureCategory.count}`
              : isZh
                ? '暂无失败记录'
                : 'No recent failures'
          }
          tone={(operationsSummary?.counts.recent_failures ?? recentFailures.length) > 0 ? 'warning' : 'default'}
        />
        <SectionCard
          title={isZh ? '最近成功' : 'Recent successes'}
          value={operationsSummary?.counts.recent_successes ?? recentSuccesses.length}
          description={
            recentSuccesses.length > 0
              ? isZh
                ? '最近完成的记忆任务'
                : 'Recently completed memory jobs'
              : isZh
                ? '暂无成功记录'
                : 'No success history yet'
          }
        />
        <SectionCard
          title={isZh ? '需人工处理' : 'Manual attention'}
          value={manualAttentionCount}
          description={isZh ? '数据库、数据缺失或未知失败' : 'Database, data, or unknown failures'}
          tone={manualAttentionCount > 0 ? 'warning' : 'default'}
        />
        <SectionCard
          title={isZh ? '项目预热预算' : 'Project warm budget'}
          value={`${projectBudget?.used ?? 0}/${projectBudget?.limit ?? 0}`}
          description={isZh ? `剩余 ${projectBudget?.remaining ?? 0}` : `${projectBudget?.remaining ?? 0} remaining`}
          tone={getBudgetTone(projectBudget)}
        />
        <SectionCard
          title={isZh ? '客户预热预算' : 'Client warm budget'}
          value={`${clientBudget?.used ?? 0}/${clientBudget?.limit ?? 0}`}
          description={isZh ? `剩余 ${clientBudget?.remaining ?? 0}` : `${clientBudget?.remaining ?? 0} remaining`}
          tone={getBudgetTone(clientBudget)}
        />
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          background: 'var(--color-codex-bg-elev)',
          border:
            alertSummary.length > 0
              ? '1px solid color-mix(in oklch, var(--color-codex-warn) 30%, transparent)'
              : '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div
              className="flex items-center gap-2"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: alertSummary.length > 0 ? 'var(--color-codex-warn)' : 'var(--color-codex-accent-ink)',
              }}
            >
              {alertSummary.length > 0 ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {isZh ? '失败告警汇总' : 'Failure alert summary'}
            </div>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 12.5,
                color: 'var(--color-codex-ink-mute)',
                lineHeight: 1.55,
              }}
            >
              {alertSummary.length > 0
                ? isZh
                  ? '按风险优先级汇总当前需要关注的记忆任务问题。'
                  : 'Current memory operation risks, ordered by operational priority.'
                : isZh
                  ? '当前没有需要优先处理的失败、重试或预算风险。'
                  : 'No priority failures, retries, or budget risks right now.'}
            </p>
          </div>
          {alertSummary.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                resetPages()
                setShowFailuresOnly(true)
                setFailureCategoryFilter('all')
                setAttentionFilter('all')
              }}
              className="inline-flex flex-shrink-0 items-center justify-center gap-2"
              style={{
                padding: '6px 12px',
                fontSize: 12.5,
                background: 'var(--color-codex-bg)',
                color: 'var(--color-codex-warn)',
                border: '1px solid color-mix(in oklch, var(--color-codex-warn) 30%, transparent)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <Filter className="h-3.5 w-3.5" />
              {isZh ? '查看全部失败' : 'View all failures'}
            </button>
          ) : null}
        </div>

        {alertSummary.length > 0 ? (
          <div className="mt-4 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {alertSummary.map((alert) => {
              const sevColor =
                alert.severity === 'critical'
                  ? 'var(--color-codex-bad)'
                  : alert.severity === 'warning'
                    ? 'var(--color-codex-warn)'
                    : 'var(--color-codex-accent-ink)'
              return (
                <div
                  key={alert.key}
                  style={{
                    padding: 12,
                    background: 'var(--color-codex-bg)',
                    border: `1px solid color-mix(in oklch, ${sevColor} 25%, transparent)`,
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: sevColor }}>{alert.title}</div>
                  <div
                    style={{
                      marginTop: 4,
                      minHeight: 36,
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      color: 'var(--color-codex-ink-mute)',
                    }}
                  >
                    {alert.description}
                  </div>
                  <button
                    type="button"
                    onClick={alert.onClick}
                    className="mt-3 inline-flex items-center gap-2"
                    style={{
                      padding: '4px 9px',
                      fontSize: 11,
                      background: 'var(--color-codex-bg-elev)',
                      color: 'var(--color-codex-ink-soft)',
                      border: '1px solid var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {alert.action}
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 14,
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(6,minmax(0,1fr))]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: 'var(--color-codex-ink-faint)' }}
            />
            <input
              value={searchQuery}
              onChange={(event) => {
                beginFilteredUpdate()
                setSearchQuery(event.target.value)
              }}
              placeholder={isZh ? '搜索项目、客户、触发或摘要' : 'Search projects, clients, trigger, summary'}
              className="w-full outline-none"
              style={{
                padding: '8px 12px 8px 34px',
                fontSize: 13,
                background: 'var(--color-codex-bg)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                color: 'var(--color-codex-ink)',
              }}
            />
          </div>

          {[
            {
              value: scopeFilter,
              onChange: (v: string) => {
                beginFilteredUpdate()
                setScopeFilter(v as JobScopeFilter)
              },
              options: [
                { value: 'all', label: isZh ? '全部范围' : 'All scopes' },
                { value: 'project', label: isZh ? '仅项目' : 'Projects' },
                { value: 'client', label: isZh ? '仅客户' : 'Clients' },
              ],
            },
            {
              value: jobTypeFilter,
              onChange: (v: string) => {
                beginFilteredUpdate()
                setJobTypeFilter(v as JobTypeFilter)
              },
              options: [
                { value: 'all', label: isZh ? '全部任务' : 'All jobs' },
                { value: 'rebuild', label: isZh ? '记忆重建' : 'Rebuild' },
                { value: 'summary_warm', label: isZh ? '摘要预热' : 'Summary' },
              ],
            },
            {
              value: retryFilter,
              onChange: (v: string) => {
                beginFilteredUpdate()
                setRetryFilter(v as RetryFilter)
              },
              options: [
                { value: 'all', label: isZh ? '全部重试' : 'All retry' },
                { value: 'retrying', label: isZh ? '仅重试中' : 'Retrying' },
                { value: 'clean', label: isZh ? '仅未重试' : 'Clean' },
              ],
            },
            {
              value: failureCategoryFilter,
              onChange: (v: string) => {
                beginFilteredUpdate()
                setFailureCategoryFilter(v as FailureCategory)
              },
              options: (
                ['all', 'budget', 'rate_limit', 'timeout', 'database', 'data', 'scheduler', 'llm', 'unknown'] as FailureCategory[]
              ).map((category) => ({
                value: category,
                label: getFailureCategoryLabel(category, isZh),
              })),
            },
            {
              value: attentionFilter,
              onChange: (v: string) => {
                beginFilteredUpdate()
                setAttentionFilter(v as AttentionFilter)
              },
              options: [
                { value: 'all', label: isZh ? '全部处理' : 'All handling' },
                { value: 'manual', label: isZh ? '仅人工' : 'Manual' },
              ],
            },
          ].map((select, idx) => (
            <select
              key={idx}
              value={select.value}
              onChange={(event) => select.onChange(event.target.value)}
              style={{
                padding: '8px 10px',
                fontSize: 12.5,
                background: 'var(--color-codex-bg)',
                color: 'var(--color-codex-ink)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              {select.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ))}

          <button
            onClick={() => {
              resetPages()
              setShowFailuresOnly((current) => !current)
            }}
            className="inline-flex items-center justify-center gap-2"
            style={{
              padding: '8px 10px',
              fontSize: 12.5,
              fontWeight: 500,
              background: showFailuresOnly
                ? 'color-mix(in oklch, var(--color-codex-warn) 12%, transparent)'
                : 'var(--color-codex-bg)',
              color: showFailuresOnly ? 'var(--color-codex-warn)' : 'var(--color-codex-ink-soft)',
              border: showFailuresOnly
                ? '1px solid color-mix(in oklch, var(--color-codex-warn) 30%, transparent)'
                : '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <Filter className="h-3.5 w-3.5" />
            {showFailuresOnly ? (isZh ? '仅失败' : 'Failures') : isZh ? '显示失败' : 'Show failures'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="relative">
          <div
            className="space-y-3"
            style={{
              opacity: listLoading ? 0.48 : 1,
              transition: 'opacity 140ms ease',
            }}
          >
          {!showFailuresOnly && filteredJobs.length === 0 ? (
            <div
              className="text-center"
              style={{
                padding: '40px 24px',
                background: 'var(--color-codex-bg-elev)',
                border: '1px dashed var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
                fontSize: 13,
                color: 'var(--color-codex-ink-mute)',
              }}
            >
              <Clock3
                className="mx-auto mb-3 h-6 w-6"
                style={{ color: 'var(--color-codex-ink-faint)' }}
              />
              {isZh ? '当前筛选条件下没有匹配的排队或进行中任务。' : 'No queued or running jobs match the current filters.'}
            </div>
          ) : null}

          {!showFailuresOnly ? (
            <>
              <div className="space-y-3">{paginatedJobs.map(renderJobCard)}</div>
              {jobsTotal > 0 ? (
                <CxPagination
                  page={currentJobsPage}
                  pageSize={jobsPageSize}
                  totalItems={jobsTotal}
                  onPageChange={(nextPage) => {
                    setListLoading(true)
                    setJobsPage(nextPage)
                  }}
                  onPageSizeChange={(nextPageSize) => {
                    setListLoading(true)
                    setJobsPageSize(nextPageSize)
                    setJobsPage(1)
                  }}
                  pageSizeOptions={[10, 20, 50]}
                  isZh={isZh}
                />
              ) : null}
            </>
          ) : null}

          {!showFailuresOnly && successTotal > 0 ? (
            <div
              style={{
                padding: 16,
                background: 'var(--color-codex-bg-elev)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <div
                className="mb-3 flex items-center gap-2"
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-codex-accent-ink)' }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isZh ? '最近成功记录' : 'Recent successes'}
              </div>
              <div className="space-y-2">{paginatedSuccesses.map(renderSuccessCard)}</div>
              <CxPagination
                page={currentSuccessPage}
                pageSize={successPageSize}
                totalItems={successTotal}
                onPageChange={(nextPage) => {
                  setListLoading(true)
                  setSuccessPage(nextPage)
                }}
                onPageSizeChange={(nextPageSize) => {
                  setListLoading(true)
                  setSuccessPageSize(nextPageSize)
                  setSuccessPage(1)
                }}
                pageSizeOptions={[10, 20, 50]}
                isZh={isZh}
                style={{ marginTop: 12 }}
              />
            </div>
          ) : null}

          {failureTotal > 0 ? (
            <div
              style={{
                padding: 16,
                background: 'var(--color-codex-bg-elev)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div
                  className="flex items-center gap-2"
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-codex-ink)' }}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {isZh ? '最近失败记录' : 'Recent failures'}
                  <span
                    className="font-mono"
                    style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-codex-ink-mute)' }}
                  >
                    ({failureTotal})
                  </span>
                </div>
                <button
                  onClick={toggleSelectAllVisible}
                  className="hover:underline"
                  style={{ fontSize: 11.5, color: 'var(--color-codex-accent-ink)' }}
                >
                  {selectedFailureKeys.size > 0
                    ? isZh ? '取消全选' : 'Deselect all'
                    : isZh ? '全选' : 'Select all'}
                </button>
              </div>

              {selectedFailureKeys.size > 0 && (
                <div
                  className="mb-3 flex items-center gap-2"
                  style={{
                    padding: '8px 12px',
                    background: 'var(--color-codex-accent-bg)',
                    border: '1px solid color-mix(in oklch, var(--color-codex-accent) 25%, transparent)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <span
                    className="font-mono"
                    style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-codex-accent-ink)' }}
                  >
                    {isZh ? `已选 ${selectedFailureKeys.size}` : `${selectedFailureKeys.size} selected`}
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => batchRetryFailures()}
                    disabled={isBatchRetrying}
                    className="inline-flex items-center gap-1.5 disabled:opacity-60"
                    style={{
                      padding: '5px 10px',
                      fontSize: 11.5,
                      fontWeight: 500,
                      background: 'var(--color-codex-accent)',
                      color: 'var(--color-codex-bg-elev)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                  >
                    {isBatchRetrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {isZh ? '批量重试' : 'Batch retry'}
                  </button>
                  <button
                    onClick={dismissSelectedFailures}
                    className="inline-flex items-center gap-1.5"
                    style={{
                      padding: '5px 10px',
                      fontSize: 11.5,
                      background: 'var(--color-codex-bg)',
                      color: 'var(--color-codex-ink-soft)',
                      border: '1px solid var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                  >
                    <X className="h-3 w-3" />
                    {isZh ? '忽略' : 'Dismiss'}
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {paginatedFailures.map((failure, index) => {
                  const busyRetry = actionKey === `${failure.scope}-failure-${failure.failed_at}`
                  const failureKey = getFailureKey(failure)
                  const isSelected = selectedFailureKeys.has(failureKey)
                  const category = inferFailureCategory(failure)
                  const isManual = ['database', 'data', 'unknown'].includes(category)
                  const title =
                    failure.scope === 'project'
                      ? isZh
                        ? `项目 / ${failure.project_name}`
                        : `Project / ${failure.project_name}`
                      : isZh
                        ? `客户 / ${failure.client_name}`
                        : `Client / ${failure.client_name}`
                  return (
                    <div
                      key={`${failure.scope}-${index}`}
                      style={{
                        padding: 12,
                        background: 'var(--color-codex-bg)',
                        border: isSelected
                          ? '1px solid color-mix(in oklch, var(--color-codex-accent) 35%, transparent)'
                          : '1px solid var(--color-codex-line-soft)',
                        borderRadius: 'var(--codex-r-sm, 3px)',
                        boxShadow: isSelected
                          ? '0 0 0 2px color-mix(in oklch, var(--color-codex-accent) 18%, transparent)'
                          : 'none',
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleFailureSelection(failureKey)}
                          className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center transition-colors"
                          style={{
                            background: isSelected
                              ? 'var(--color-codex-accent)'
                              : 'var(--color-codex-bg-elev)',
                            color: isSelected ? 'var(--color-codex-bg-elev)' : 'transparent',
                            border: isSelected
                              ? '1px solid var(--color-codex-accent)'
                              : '1px solid var(--color-codex-line)',
                            borderRadius: 2,
                          }}
                        >
                          {isSelected ? <Check className="h-2.5 w-2.5" /> : <Square className="h-2.5 w-2.5" />}
                        </button>
                        <div className="flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div
                                className="truncate"
                                style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-codex-ink)' }}
                              >
                                {title}
                              </div>
                              <div
                                className="mt-1 font-mono"
                                style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                              >
                                {failure.stage}
                                {' · '}
                                {getFailureCategoryLabel(category, isZh)}
                                {' · '}
                                {isZh ? '重试 ' : 'Retry '}
                                {failure.retry_count ?? 0}
                              </div>
                            </div>
                            <div
                              className="font-mono flex-shrink-0"
                              style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                            >
                              {formatDate(failure.failed_at, isZh)}
                            </div>
                          </div>
                          <div
                            className="mt-2"
                            style={{
                              fontSize: 12.5,
                              lineHeight: 1.55,
                              color: 'var(--color-codex-ink)',
                            }}
                          >
                            {failure.message}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => void retryFailure(failure)}
                              disabled={busyRetry}
                              className="inline-flex items-center gap-1.5 disabled:opacity-60"
                              style={{
                                padding: '5px 10px',
                                fontSize: 11.5,
                                background: isManual
                                  ? 'color-mix(in oklch, var(--color-codex-warn) 10%, transparent)'
                                  : 'var(--color-codex-bg-elev)',
                                color: isManual
                                  ? 'var(--color-codex-warn)'
                                  : 'var(--color-codex-ink-soft)',
                                border: isManual
                                  ? '1px solid color-mix(in oklch, var(--color-codex-warn) 30%, transparent)'
                                  : '1px solid var(--color-codex-line)',
                                borderRadius: 'var(--codex-r-sm, 3px)',
                              }}
                            >
                              {busyRetry ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                              {isZh ? '立即重试' : 'Retry now'}
                            </button>
                            <button
                              onClick={() => runSuggestedAction(failure)}
                              className="inline-flex items-center gap-1.5"
                              style={{
                                padding: '5px 10px',
                                fontSize: 11.5,
                                background: 'var(--color-codex-accent-bg)',
                                color: 'var(--color-codex-accent-ink)',
                                border: '1px solid color-mix(in oklch, var(--color-codex-accent) 25%, transparent)',
                                borderRadius: 'var(--codex-r-sm, 3px)',
                              }}
                            >
                              <ExternalLink className="h-3 w-3" />
                              {getSuggestedActionLabel(category, isZh)}
                            </button>
                            <button
                              onClick={() => setSelectedFailureKey(failureKey)}
                              className="inline-flex items-center gap-1.5"
                              style={{
                                padding: '5px 10px',
                                fontSize: 11.5,
                                background: 'var(--color-codex-bg-elev)',
                                color: 'var(--color-codex-ink-soft)',
                                border: '1px solid var(--color-codex-line)',
                                borderRadius: 'var(--codex-r-sm, 3px)',
                              }}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {isZh ? '查看明细' : 'Details'}
                            </button>
                            <button
                              onClick={() => openEntity(failure)}
                              className="inline-flex items-center gap-1.5"
                              style={{
                                padding: '5px 10px',
                                fontSize: 11.5,
                                background: 'var(--color-codex-bg-elev)',
                                color: 'var(--color-codex-ink-soft)',
                                border: '1px solid var(--color-codex-line)',
                                borderRadius: 'var(--codex-r-sm, 3px)',
                              }}
                            >
                              <ExternalLink className="h-3 w-3" />
                              {isZh ? '打开' : 'Open'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <CxPagination
                page={currentFailurePage}
                pageSize={failurePageSize}
                totalItems={failureTotal}
                onPageChange={(nextPage) => {
                  setListLoading(true)
                  setFailurePage(nextPage)
                }}
                onPageSizeChange={(nextPageSize) => {
                  setListLoading(true)
                  setFailurePageSize(nextPageSize)
                  setFailurePage(1)
                }}
                pageSizeOptions={[10, 20, 50]}
                isZh={isZh}
                style={{ marginTop: 12 }}
              />
            </div>
          ) : null}
          </div>
          {listLoading ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-start justify-center"
              style={{
                paddingTop: 28,
                background: 'color-mix(in oklch, var(--color-codex-bg) 50%, transparent)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <div
                className="inline-flex items-center gap-2"
                style={{
                  padding: '8px 12px',
                  background: 'var(--color-codex-bg-elev)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  color: 'var(--color-codex-ink-soft)',
                  fontSize: 12.5,
                  boxShadow: '0 8px 22px color-mix(in oklch, var(--color-codex-ink) 8%, transparent)',
                }}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isZh ? '正在更新列表' : 'Updating list'}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          {renderFailureDetailPanel()}

          <div
            style={{
              padding: 16,
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <div
              className="mb-3 flex items-center gap-2"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-codex-ink)' }}
            >
              <Wallet className="h-3.5 w-3.5" />
              {isZh ? '摘要预热预算' : 'Summary warm budgets'}
            </div>
            <div className="space-y-2">
              {[
                {
                  label: isZh ? '项目记忆' : 'Project memory',
                  budget: projectBudget,
                },
                {
                  label: isZh ? '客户记忆' : 'Client memory',
                  budget: clientBudget,
                },
              ].map((entry) => (
                <div
                  key={entry.label}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--color-codex-bg)',
                    border: '1px solid var(--color-codex-line-soft)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {entry.label}
                  </div>
                  <div
                    className="mt-1 font-mono"
                    style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                  >
                    {isZh
                      ? `${entry.budget?.used ?? 0} / ${entry.budget?.limit ?? 0} · 剩余 ${entry.budget?.remaining ?? 0}`
                      : `${entry.budget?.used ?? 0} / ${entry.budget?.limit ?? 0} · ${entry.budget?.remaining ?? 0} left`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              padding: 16,
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <div
              className="mb-3 flex items-center gap-2"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-codex-ink)' }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {isZh ? '任务说明' : 'What to watch'}
            </div>
            <div className="space-y-2">
              {[
                isZh
                  ? '默认会先预热核心摘要。扩展摘要只会在显式请求、详情页切换或批量治理动作里进入队列。'
                  : 'Core summaries warm first by default. Extended views are only queued by explicit actions, page requests, or governance flows.',
                isZh
                  ? '如果预算接近上限，建议先处理失败记录和重试中的任务，再继续发起批量预热。'
                  : 'When budgets get tight, clear failures and retries first before starting more batch warming.',
              ].map((line) => (
                <div
                  key={line}
                  style={{
                    padding: '10px 12px',
                    fontSize: 12,
                    lineHeight: 1.6,
                    background: 'var(--color-codex-bg)',
                    border: '1px solid var(--color-codex-line-soft)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                    color: 'var(--color-codex-ink-soft)',
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              padding: 16,
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <div
              className="mb-3 flex items-center gap-2"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-codex-ink)' }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {isZh ? '失败处理建议' : 'Failure playbook'}
            </div>
            <div className="space-y-2">
              {(failureCategoryFilter === 'all'
                ? ([mostCommonFailureCategory.category, 'budget', 'rate_limit', 'database'] as FailureCategory[])
                : ([failureCategoryFilter, 'all'] as FailureCategory[])
              )
                .filter((category, index, list) => list.indexOf(category) === index)
                .map((category) => (
                  <div
                    key={category}
                    style={{
                      padding: '10px 12px',
                      background: 'var(--color-codex-bg)',
                      border: '1px solid var(--color-codex-line-soft)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: 'var(--color-codex-ink)',
                      }}
                    >
                      {getFailureCategoryLabel(category, isZh)}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11.5,
                        lineHeight: 1.6,
                        color: 'var(--color-codex-ink-mute)',
                      }}
                    >
                      {getFailureCategoryAdvice(category, isZh)}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
      <CxConfirmDialog
        open={highRiskConfirm != null}
        onClose={() => {
          if (!isBatchRetrying) setHighRiskConfirm(null)
        }}
        onConfirm={() => {
          const pending = highRiskConfirm
          if (!pending) return
          setHighRiskConfirm(null)
          void performBatchRetry(pending.toRetry)
        }}
        tone="warn"
        title={
          isZh ? '包含高风险失败，是否继续重试？' : 'High-risk failures included — continue?'
        }
        description={
          highRiskConfirm
            ? isZh
              ? `本批包含 ${highRiskConfirm.highRiskCount} 条高风险失败（database / data / unknown 类别）。继续重试可能再次失败，建议先在排查页核对原因。`
              : `${highRiskConfirm.highRiskCount} of the selected failures are high-risk (database / data / unknown). Retry may fail again — consider triaging first.`
            : undefined
        }
        confirmLabel={isZh ? '继续重试' : 'Retry anyway'}
        cancelLabel={isZh ? '取消' : 'Cancel'}
        busy={isBatchRetrying}
      />
    </div>
  )
}
