import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Clock3, ExternalLink, Loader2, Play, RefreshCw, XCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import type {
  ClientMemoryJob,
  ClientMemoryJobsResponse,
  ProjectMemoryJob,
  ProjectMemoryJobsResponse,
} from '../../types/api'

type CombinedJob = (
  | ({ scope: 'project' } & ProjectMemoryJob)
  | ({ scope: 'client' } & ClientMemoryJob)
)

function formatDate(value?: string | null, isZh = true) {
  if (!value) return isZh ? '等待调度' : 'Waiting'
  return new Date(value).toLocaleString(isZh ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function MemoryOperationsSettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [actionKey, setActionKey] = useState('')
  const [jobs, setJobs] = useState<CombinedJob[]>([])

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
    } catch (error) {
      console.error('Failed to load memory operations:', error)
      toast.error(isZh ? '加载记忆任务面板失败' : 'Failed to load memory operations')
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
    }),
    [jobs],
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
      await loadJobs(true)
    } catch (error) {
      console.error('Failed to run memory job now:', error)
      toast.error(isZh ? '立即执行任务失败' : 'Failed to run job now')
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

  const openEntity = (job: CombinedJob) => {
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
          ? `项目 · ${job.project_name}`
          : `Project · ${job.project_name}`
        : isZh
          ? `客户 · ${job.client_name}`
          : `Client · ${job.client_name}`
    const subLabel =
      job.scope === 'project'
        ? (job.client || (isZh ? '未填写客户' : 'No client'))
        : (job.industry || (isZh ? '未填写行业' : 'No industry'))
    const jobLabel =
      job.job_type === 'summary_warm'
        ? isZh
          ? '摘要预热'
          : 'Summary warm'
        : isZh
          ? '记忆重建'
          : 'Memory rebuild'
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
            {isZh ? '查看详情' : 'Open'}
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
          <h2 className="text-xl font-semibold text-on-surface">
            {isZh ? '记忆任务中心' : 'Memory Operations'}
          </h2>
          <p className="mt-1 text-sm text-on-surface-muted">
            {isZh
              ? '统一查看项目记忆和客户记忆的重建、预热与排队任务。'
              : 'Monitor project and client memory rebuild and summary warming jobs in one place.'}
          </p>
        </div>
        <button
          onClick={() => void loadJobs()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-low"
        >
          <RefreshCw className="h-4 w-4" />
          {isZh ? '刷新任务' : 'Refresh jobs'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-surface-container-low p-4">
          <div className="text-sm text-on-surface-muted">{isZh ? '总任务数' : 'Total jobs'}</div>
          <div className="mt-2 text-2xl font-semibold text-on-surface">{jobs.length}</div>
        </div>
        <div className="rounded-2xl bg-surface-container-low p-4">
          <div className="text-sm text-on-surface-muted">{isZh ? '记忆重建' : 'Rebuild jobs'}</div>
          <div className="mt-2 text-2xl font-semibold text-on-surface">{grouped.rebuilding.length}</div>
        </div>
        <div className="rounded-2xl bg-surface-container-low p-4">
          <div className="text-sm text-on-surface-muted">{isZh ? '摘要预热' : 'Summary warm jobs'}</div>
          <div className="mt-2 text-2xl font-semibold text-on-surface">{grouped.warming.length}</div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline p-10 text-center text-sm text-on-surface-muted">
          <Clock3 className="mx-auto mb-3 h-6 w-6" />
          {isZh ? '当前没有排队中的记忆后台任务。' : 'No queued memory background jobs right now.'}
        </div>
      ) : (
        <div className="grid gap-4">{jobs.map(renderJobCard)}</div>
      )}
    </div>
  )
}
