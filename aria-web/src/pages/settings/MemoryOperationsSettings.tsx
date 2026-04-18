import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Clock3,
  ExternalLink,
  Filter,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Wallet,
  XCircle,
} from 'lucide-react'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import type {
  ClientMemoryJob,
  ClientMemoryJobsResponse,
  ProjectMemoryJob,
  ProjectMemoryJobsResponse,
} from '../../types/api'

type CombinedJob = ({ scope: 'project' } & ProjectMemoryJob) | ({ scope: 'client' } & ClientMemoryJob)
type JobScopeFilter = 'all' | 'project' | 'client'
type JobTypeFilter = 'all' | 'rebuild' | 'summary_warm'
type RetryFilter = 'all' | 'retrying' | 'clean'

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
      stage: string
      message: string
      retry_count?: number
      failed_at: string
    }
  | {
      scope: 'client'
      client_id: number
      client_name: string
      stage: string
      message: string
      retry_count?: number
      failed_at: string
    }

function formatDate(value?: string | null, isZh = true) {
  if (!value) return isZh ? '等待调度' : 'Waiting'
  return new Date(value).toLocaleString(isZh ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  return (
    <div
      className={`rounded-2xl p-4 ${
        tone === 'warning' ? 'bg-amber-50 text-amber-950' : 'bg-surface-container-low text-on-surface'
      }`}
    >
      <div className={`text-sm ${tone === 'warning' ? 'text-amber-800' : 'text-on-surface-muted'}`}>{title}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className={`mt-1 text-xs ${tone === 'warning' ? 'text-amber-700' : 'text-on-surface-muted'}`}>
        {description}
      </div>
    </div>
  )
}

function getBudgetTone(budget: BudgetInfo | null): 'default' | 'warning' {
  if (!budget || budget.limit <= 0) return 'default'
  return budget.remaining <= Math.max(5, Math.floor(budget.limit * 0.15)) ? 'warning' : 'default'
}

export function MemoryOperationsSettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [actionKey, setActionKey] = useState('')
  const [jobs, setJobs] = useState<CombinedJob[]>([])
  const [projectBudget, setProjectBudget] = useState<BudgetInfo | null>(null)
  const [clientBudget, setClientBudget] = useState<BudgetInfo | null>(null)
  const [recentFailures, setRecentFailures] = useState<FailureItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<JobScopeFilter>('all')
  const [jobTypeFilter, setJobTypeFilter] = useState<JobTypeFilter>('all')
  const [retryFilter, setRetryFilter] = useState<RetryFilter>('all')
  const [showFailuresOnly, setShowFailuresOnly] = useState(false)

  const loadJobs = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
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
    } catch (error) {
      console.error('Failed to load memory operations:', error)
      toast.error(isZh ? '加载记忆任务中心失败' : 'Failed to load memory operations')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void loadJobs()
    const timer = window.setInterval(() => {
      void loadJobs(true)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  const grouped = useMemo(
    () => ({
      rebuilding: jobs.filter((job) => job.job_type === 'rebuild'),
      warming: jobs.filter((job) => job.job_type === 'summary_warm'),
      retrying: jobs.filter((job) => (job.retry_count ?? 0) > 0),
    }),
    [jobs],
  )

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
      if (!query) return true
      const fields =
        failure.scope === 'project'
          ? [failure.project_name, failure.client, failure.stage, failure.message]
          : [failure.client_name, failure.stage, failure.message]
      return fields.some((item) => String(item || '').toLowerCase().includes(query))
    })
  }, [recentFailures, scopeFilter, searchQuery])

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
      await loadJobs(true)
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
      await loadJobs(true)
    } catch (error) {
      console.error('Failed to retry memory job:', error)
      toast.error(isZh ? '重试任务失败' : 'Failed to retry job')
    } finally {
      setActionKey('')
    }
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

  const openEntity = (job: CombinedJob | FailureItem) => {
    if (job.scope === 'project') {
      navigate(`/projects/${job.project_id}/memory`)
      return
    }
    navigate(`/clients/${job.client_id}/memory`)
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

    return (
      <div key={`${job.scope}-${job.job_id}`} className="rounded-2xl border border-outline bg-surface p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-on-surface">{label}</div>
            <div className="mt-1 text-xs text-on-surface-muted">{subLabel}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-on-surface-muted">
              <span className="rounded-full bg-surface-container-low px-2.5 py-1">{jobLabel}</span>
              {job.language ? (
                <span className="rounded-full bg-surface-container-low px-2.5 py-1">{job.language}</span>
              ) : null}
              <span className="rounded-full bg-surface-container-low px-2.5 py-1">
                {isZh ? '版本' : 'Version'} {job.memory_version}
              </span>
              <span className="rounded-full bg-surface-container-low px-2.5 py-1">
                {isZh ? '重试' : 'Retry'} {job.retry_count ?? 0}/{job.max_retries ?? 0}
              </span>
              {job.trigger ? (
                <span className="rounded-full bg-surface-container-low px-2.5 py-1">
                  {isZh ? '触发' : 'Trigger'}: {job.trigger}
                </span>
              ) : null}
              {job.summary_types?.length ? (
                <span className="rounded-full bg-surface-container-low px-2.5 py-1">{job.summary_types.join(', ')}</span>
              ) : null}
            </div>
          </div>
          <div className="text-right text-xs text-on-surface-muted">
            <div>{isZh ? '计划执行' : 'Scheduled'}</div>
            <div className="mt-1 font-medium text-on-surface">{formatDate(job.next_run_at, isZh)}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => void runNow(job)}
            disabled={busyRun || busyCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-outline px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low disabled:opacity-60"
          >
            {busyRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isZh ? '立即执行' : 'Run now'}
          </button>
          <button
            onClick={() => void cancelJob(job)}
            disabled={busyRun || busyCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-outline px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low disabled:opacity-60"
          >
            {busyCancel ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {isZh ? '取消任务' : 'Cancel'}
          </button>
          <button
            onClick={() => openEntity(job)}
            className="inline-flex items-center gap-2 rounded-xl border border-outline px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low"
          >
            <ExternalLink className="h-4 w-4" />
            {isZh ? '打开详情' : 'Open'}
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-on-surface">{isZh ? '记忆任务中心' : 'Memory Operations'}</h2>
          <p className="mt-1 text-sm text-on-surface-muted">
            {isZh
              ? '统一查看项目与客户记忆的重建、摘要预热、重试和失败情况。'
              : 'Monitor rebuild, summary warming, retries, and failures for project and client memory.'}
          </p>
        </div>
        <button
          onClick={() => void loadJobs()}
          className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-low"
        >
          <RefreshCw className="h-4 w-4" />
          {isZh ? '刷新任务' : 'Refresh jobs'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <SectionCard
          title={isZh ? '总任务数' : 'Total jobs'}
          value={jobs.length}
          description={isZh ? '当前排队中的后台任务' : 'Queued background jobs right now'}
        />
        <SectionCard
          title={isZh ? '记忆重建' : 'Rebuild jobs'}
          value={grouped.rebuilding.length}
          description={isZh ? '项目与客户记忆重建队列' : 'Project and client rebuild queue'}
        />
        <SectionCard
          title={isZh ? '摘要预热' : 'Summary warm jobs'}
          value={grouped.warming.length}
          description={isZh ? '常用摘要缓存预热任务' : 'Common summary cache warm jobs'}
        />
        <SectionCard
          title={isZh ? '重试中的任务' : 'Retrying jobs'}
          value={grouped.retrying.length}
          description={isZh ? '已经至少重试过一次' : 'Jobs that already retried at least once'}
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

      <div className="rounded-2xl border border-outline bg-surface p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-muted" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={isZh ? '搜索项目、客户、触发来源或摘要类型' : 'Search by project, client, trigger, or summary type'}
              className="w-full rounded-xl border border-outline bg-surface px-10 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary"
            />
          </div>

          <select
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value as JobScopeFilter)}
            className="rounded-xl border border-outline bg-surface px-3 py-2.5 text-sm text-on-surface"
          >
            <option value="all">{isZh ? '全部范围' : 'All scopes'}</option>
            <option value="project">{isZh ? '仅项目' : 'Projects only'}</option>
            <option value="client">{isZh ? '仅客户' : 'Clients only'}</option>
          </select>

          <select
            value={jobTypeFilter}
            onChange={(event) => setJobTypeFilter(event.target.value as JobTypeFilter)}
            className="rounded-xl border border-outline bg-surface px-3 py-2.5 text-sm text-on-surface"
          >
            <option value="all">{isZh ? '全部任务类型' : 'All job types'}</option>
            <option value="rebuild">{isZh ? '仅记忆重建' : 'Rebuild only'}</option>
            <option value="summary_warm">{isZh ? '仅摘要预热' : 'Summary warm only'}</option>
          </select>

          <select
            value={retryFilter}
            onChange={(event) => setRetryFilter(event.target.value as RetryFilter)}
            className="rounded-xl border border-outline bg-surface px-3 py-2.5 text-sm text-on-surface"
          >
            <option value="all">{isZh ? '全部重试状态' : 'All retry states'}</option>
            <option value="retrying">{isZh ? '仅重试中的任务' : 'Retrying only'}</option>
            <option value="clean">{isZh ? '仅未重试任务' : 'No-retry only'}</option>
          </select>

          <button
            onClick={() => setShowFailuresOnly((current) => !current)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
              showFailuresOnly
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-outline bg-surface text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <Filter className="h-4 w-4" />
            {showFailuresOnly ? (isZh ? '只看失败记录' : 'Failures only') : isZh ? '显示失败记录' : 'Show failures'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          {!showFailuresOnly && filteredJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-outline p-10 text-center text-sm text-on-surface-muted">
              <Clock3 className="mx-auto mb-3 h-6 w-6" />
              {isZh ? '当前筛选条件下没有匹配的后台任务。' : 'No jobs match the current filters.'}
            </div>
          ) : null}

          {!showFailuresOnly ? <div className="grid gap-4">{filteredJobs.map(renderJobCard)}</div> : null}

          {filteredFailures.length > 0 ? (
            <div className="rounded-2xl border border-outline bg-surface p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-on-surface">
                <AlertTriangle className="h-4 w-4" />
                {isZh ? '最近失败记录' : 'Recent failures'}
              </div>
              <div className="space-y-3">
                {filteredFailures.slice(0, 12).map((failure, index) => {
                  const busyRetry = actionKey === `${failure.scope}-failure-${failure.failed_at}`
                  const title =
                    failure.scope === 'project'
                      ? isZh
                        ? `项目 / ${failure.project_name}`
                        : `Project / ${failure.project_name}`
                      : isZh
                        ? `客户 / ${failure.client_name}`
                        : `Client / ${failure.client_name}`
                  return (
                    <div key={`${failure.scope}-${index}`} className="rounded-xl bg-surface-container-low p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-on-surface">{title}</div>
                          <div className="mt-1 text-xs text-on-surface-muted">
                            {isZh ? '阶段' : 'Stage'}: {failure.stage}
                            {' / '}
                            {isZh ? '重试' : 'Retry'}: {failure.retry_count ?? 0}
                          </div>
                        </div>
                        <div className="text-xs text-on-surface-muted">{formatDate(failure.failed_at, isZh)}</div>
                      </div>
                      <div className="mt-2 text-sm text-on-surface">{failure.message}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => void retryFailure(failure)}
                          disabled={busyRetry}
                          className="inline-flex items-center gap-2 rounded-lg border border-outline px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-white disabled:opacity-60"
                        >
                          {busyRetry ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          {isZh ? '立即重试' : 'Retry now'}
                        </button>
                        <button
                          onClick={() => openEntity(failure)}
                          className="inline-flex items-center gap-2 rounded-lg border border-outline px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-white"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {isZh ? '打开详情' : 'Open'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-outline bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-on-surface">
              <Wallet className="h-4 w-4" />
              {isZh ? '摘要预热预算' : 'Summary warm budgets'}
            </div>
            <div className="space-y-3 text-sm text-on-surface-muted">
              <div className="rounded-xl bg-surface-container-low p-3">
                <div className="font-medium text-on-surface">{isZh ? '项目记忆' : 'Project memory'}</div>
                <div className="mt-1">
                  {isZh
                    ? `今日已使用 ${projectBudget?.used ?? 0} / ${projectBudget?.limit ?? 0}，剩余 ${projectBudget?.remaining ?? 0}`
                    : `${projectBudget?.used ?? 0} / ${projectBudget?.limit ?? 0} used today, ${projectBudget?.remaining ?? 0} left`}
                </div>
              </div>
              <div className="rounded-xl bg-surface-container-low p-3">
                <div className="font-medium text-on-surface">{isZh ? '客户记忆' : 'Client memory'}</div>
                <div className="mt-1">
                  {isZh
                    ? `今日已使用 ${clientBudget?.used ?? 0} / ${clientBudget?.limit ?? 0}，剩余 ${clientBudget?.remaining ?? 0}`
                    : `${clientBudget?.used ?? 0} / ${clientBudget?.limit ?? 0} used today, ${clientBudget?.remaining ?? 0} left`}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-outline bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-on-surface">
              <AlertTriangle className="h-4 w-4" />
              {isZh ? '任务说明' : 'What to watch'}
            </div>
            <div className="space-y-3 text-sm text-on-surface-muted">
              <div className="rounded-xl bg-surface-container-low p-3">
                {isZh
                  ? '默认会先预热核心摘要。扩展摘要只会在显式请求、详情页切换或批量治理动作里进入队列。'
                  : 'Core summaries warm first by default. Extended views are only queued by explicit actions, page requests, or governance flows.'}
              </div>
              <div className="rounded-xl bg-surface-container-low p-3">
                {isZh
                  ? '如果预算接近上限，建议先处理失败记录和重试中的任务，再继续发起批量预热。'
                  : 'When budgets get tight, clear failures and retries first before starting more batch warming.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
