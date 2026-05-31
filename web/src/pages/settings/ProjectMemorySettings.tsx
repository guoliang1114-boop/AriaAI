import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Brain,
  Clock3,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { CxPagination } from '../../components/codex'
import { useToast } from '../../contexts/ToastContext'
import type {
  Project,
  ProjectMemoryBatchRebuildResponse,
  ProjectMemoryBatchWarmSummariesResponse,
  ProjectMemoryJob,
  ProjectMemoryJobsResponse,
  ProjectMemoryListResponse,
  ProjectMemoryResponse,
} from '../../types/api'
import { dispatchProjectMemoryStateUpdated } from '../projects/useProjectDetailData'
import { formatProjectMemoryUpdatedAt } from '../projects/projectMemoryTime'

type MemoryFilter = 'all' | 'ready' | 'stale' | 'missing'

function getMemoryStatus(project: Project): MemoryFilter {
  if ((project.memory_version || 0) === 0) return 'missing'
  if (project.memory_stale) return 'stale'
  return 'ready'
}

function getRebuildStatusText(status: string | undefined, isZh: boolean): string {
  switch (status) {
    case 'queued':
      return isZh ? '排队中' : 'Queued'
    case 'rebuilding':
      return isZh ? '重建中' : 'Rebuilding'
    case 'failed':
      return isZh ? '重建失败' : 'Failed'
    default:
      return isZh ? '空闲' : 'Idle'
  }
}

function getJobTypeText(jobType: ProjectMemoryJob['job_type'], isZh: boolean): string {
  if (jobType === 'summary_warm') {
    return isZh ? '摘要预热' : 'Summary Warm'
  }
  return isZh ? '记忆重建' : 'Memory Rebuild'
}

function getJobSourceText(job: ProjectMemoryJob, isZh: boolean): string {
  if (job.status_source === 'project_status') {
    return isZh
      ? '项目状态显示仍在排队，但当前调度器里没有对应任务。可以点击立即执行来校准。'
      : 'Project status still says queued, but no scheduler job exists. Run now to reconcile it.'
  }
  return isZh ? '来自后台调度器队列' : 'From scheduler queue'
}

function RebuildStatusIcon({ status }: { status?: string }) {
  if (status === 'rebuilding') return <Loader2 className="h-3 w-3 animate-spin" />
  if (status === 'queued') return <Clock3 className="h-3 w-3" />
  if (status === 'failed') return <XCircle className="h-3 w-3" />
  return <RefreshCw className="h-3 w-3" />
}

export function ProjectMemorySettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const toast = useToast()
  const autoGenerateMissingTriggeredRef = useRef(false)
  const autoWarmSummariesTriggeredRef = useRef(false)

  const [projects, setProjects] = useState<Project[]>([])
  const [jobs, setJobs] = useState<ProjectMemoryJob[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<MemoryFilter>('all')
  const [projectPage, setProjectPage] = useState(1)
  const [projectPageSize, setProjectPageSize] = useState(10)
  const [projectTotal, setProjectTotal] = useState(0)
  const [counts, setCounts] = useState<Record<MemoryFilter, number>>({
    all: 0,
    ready: 0,
    stale: 0,
    missing: 0,
  })
  const [isRefreshingStale, setIsRefreshingStale] = useState(false)
  const [isGeneratingMissing, setIsGeneratingMissing] = useState(false)
  const [isWarmingSummaries, setIsWarmingSummaries] = useState(false)
  const [refreshingProjectId, setRefreshingProjectId] = useState<number | null>(null)
  const [jobActionProjectId, setJobActionProjectId] = useState<number | null>(null)

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const data = await api.get<ProjectMemoryListResponse>('/projects/memory/list', {
        params: {
          search: searchQuery.trim() || undefined,
          status: filter,
          limit: projectPageSize,
          offset: (projectPage - 1) * projectPageSize,
        },
      })
      setProjects(data.items || [])
      setProjectTotal(data.total || 0)
      setCounts({
        all: data.counts?.all ?? 0,
        ready: data.counts?.ready ?? 0,
        stale: data.counts?.stale ?? 0,
        missing: data.counts?.missing ?? 0,
      })
    } catch (error) {
      console.error('Failed to load projects for memory settings:', error)
      toast.error(isZh ? '加载项目记忆列表失败' : 'Failed to load project memories')
    } finally {
      setLoading(false)
    }
  }

  const fetchJobs = async (silent = false) => {
    try {
      if (!silent) setLoadingJobs(true)
      const data = await api.get<ProjectMemoryJobsResponse>('/projects/memory/jobs')
      setJobs(data.jobs || [])
    } catch (error) {
      console.error('Failed to load memory jobs:', error)
      if (!silent) {
        toast.error(isZh ? '加载后台任务列表失败' : 'Failed to load memory jobs')
      }
    } finally {
      if (!silent) setLoadingJobs(false)
    }
  }

  useEffect(() => {
    void fetchProjects()
  }, [filter, projectPage, projectPageSize, searchQuery])

  useEffect(() => {
    void fetchJobs()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchJobs(true)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(projectTotal / projectPageSize))
    if (projectPage > totalPages) {
      setProjectPage(totalPages)
    }
  }, [projectPage, projectPageSize, projectTotal])

  const readyProjectIds = useMemo(
    () =>
      projects
        .filter((project) => getMemoryStatus(project) === 'ready')
        .map((project) => project.id),
    [projects],
  )

  const applyProjectMemoryUpdate = (
    projectId: number,
    update: {
      memory_stale: boolean
      memory_updated_at?: string | null
      memory_version: number
      project_brief?: string
      memory_rebuild_status?: string
      memory_rebuild_failed_at?: string | null
    },
  ) => {
    dispatchProjectMemoryStateUpdated({
      projectId,
      memory_stale: update.memory_stale,
      memory_updated_at: update.memory_updated_at,
      memory_version: update.memory_version,
      memory_rebuild_status: update.memory_rebuild_status ?? 'idle',
      memory_rebuild_failed_at: update.memory_rebuild_failed_at ?? null,
      project_brief: update.project_brief,
    })
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              memory_stale: update.memory_stale,
              memory_updated_at: update.memory_updated_at ?? project.memory_updated_at,
              memory_version: update.memory_version,
              memory_rebuild_status: update.memory_rebuild_status ?? 'idle',
              memory_rebuild_failed_at: update.memory_rebuild_failed_at ?? null,
              context_summary: update.project_brief?.trim() || project.context_summary,
            }
          : project,
      ),
    )
  }

  const warmSummaries = async (
    projectIds: number[],
    options?: {
      silent?: boolean
      forceRefresh?: boolean
    },
  ) => {
    if (projectIds.length === 0) return

    try {
      setIsWarmingSummaries(true)
      const result = await api.post<ProjectMemoryBatchWarmSummariesResponse>(
        '/projects/memory/warm-summaries-batch',
        {
          project_ids: projectIds,
          summary_types: ['overview', 'risk', 'stakeholder'],
          language: i18n.language,
          force_refresh: options?.forceRefresh ?? false,
        },
        { timeout: 120000 },
      )

      void fetchJobs(true)

      if (!options?.silent) {
        if ((result.queued_count || 0) > 0) {
          toast.success(
            isZh
              ? `已将 ${result.queued_count} 个项目的常用 AI 摘要加入后台队列`
              : `Queued common AI summaries for ${result.queued_count} projects`,
          )
        } else {
          toast.success(
            isZh
              ? `已为 ${result.processed_count} 个项目预生成常用 AI 摘要`
              : `Warmed common AI summaries for ${result.processed_count} projects`,
          )
        }
      }
    } catch (error) {
      console.error('Failed to warm project memory summaries:', error)
      toast.error(isZh ? '批量预生成项目 AI 摘要失败' : 'Failed to warm project AI summaries')
    } finally {
      setIsWarmingSummaries(false)
    }
  }

  const rebuildSingleProject = async (project: Project) => {
    try {
      setRefreshingProjectId(project.id)
      const data = await api.post<ProjectMemoryResponse>(`/projects/${project.id}/memory/rebuild`, {}, { timeout: 120000 })
      applyProjectMemoryUpdate(project.id, {
        memory_stale: data.memory_stale,
        memory_updated_at: data.memory_updated_at,
        memory_version: data.memory_version,
        project_brief: data.memory.project_brief,
        memory_rebuild_status: data.memory_rebuild_status,
        memory_rebuild_failed_at: data.memory_rebuild_failed_at,
      })
      void fetchJobs(true)
      toast.success(isZh ? `已更新 ${project.name} 的项目记忆` : `Refreshed memory for ${project.name}`)
    } catch (error) {
      console.error('Failed to rebuild project memory:', error)
      toast.error(isZh ? `更新 ${project.name} 的项目记忆失败` : `Failed to refresh memory for ${project.name}`)
    } finally {
      setRefreshingProjectId(null)
    }
  }

  const runBatch = async (
    mode: 'stale' | 'missing',
    options?: {
      silent?: boolean
    },
  ) => {
    if (counts[mode] === 0) return

    if (mode === 'stale') setIsRefreshingStale(true)
    else setIsGeneratingMissing(true)

    try {
      const result = await api.post<ProjectMemoryBatchRebuildResponse>(
        '/projects/memory/rebuild-batch',
        {
          stale_only: mode === 'stale',
          missing_only: mode === 'missing',
        },
        { timeout: 120000 },
      )

      result.rebuilt.forEach((item) => {
        applyProjectMemoryUpdate(item.project_id, {
          memory_stale: item.memory_stale,
          memory_updated_at: item.memory_updated_at,
          memory_version: item.memory_version,
          project_brief: item.memory.project_brief,
          memory_rebuild_status: 'idle',
          memory_rebuild_failed_at: null,
        })
      })

      if (!options?.silent) {
        toast.success(
          isZh
            ? mode === 'stale'
              ? `已更新 ${result.rebuilt_count} 个待刷新的项目记忆`
              : `已补齐 ${result.rebuilt_count} 个项目记忆`
            : mode === 'stale'
              ? `Refreshed ${result.rebuilt_count} stale project memories`
              : `Generated ${result.rebuilt_count} missing project memories`,
        )
      }

      if (result.rebuilt.length > 0) {
        await warmSummaries(
          result.rebuilt.map((item) => item.project_id),
          { silent: true },
        )
      }
    } catch (error) {
      console.error('Failed to batch rebuild project memories:', error)
      toast.error(
        isZh
          ? mode === 'stale'
            ? '批量更新待刷新记忆失败'
            : '批量补齐项目记忆失败'
          : mode === 'stale'
            ? 'Failed to refresh stale memories'
            : 'Failed to generate missing memories',
      )
    } finally {
      if (mode === 'stale') setIsRefreshingStale(false)
      else setIsGeneratingMissing(false)
      void Promise.all([fetchProjects(), fetchJobs(true)])
    }
  }

  const cancelJob = async (projectId: number) => {
    try {
      setJobActionProjectId(projectId)
      await api.post(`/projects/memory/jobs/${projectId}/cancel`, {})
      const project = projects.find((item) => item.id === projectId)
      if (project) {
        dispatchProjectMemoryStateUpdated({
          projectId,
          memory_stale: project.memory_stale ?? false,
          memory_updated_at: project.memory_updated_at,
          memory_version: project.memory_version ?? 0,
          memory_rebuild_status: 'idle',
          memory_rebuild_failed_at: null,
        })
      }
      setProjects((current) =>
        current.map((item) =>
          item.id === projectId
            ? { ...item, memory_rebuild_status: 'idle', memory_rebuild_failed_at: null }
            : item,
        ),
      )
      setJobs((current) => current.filter((job) => job.project_id !== projectId))
      toast.success(isZh ? '已取消该项目的排队任务' : 'Cancelled queued jobs for this project')
    } catch (error) {
      console.error('Failed to cancel memory jobs:', error)
      toast.error(isZh ? '取消后台任务失败' : 'Failed to cancel memory jobs')
    } finally {
      setJobActionProjectId(null)
    }
  }

  const runJobNow = async (projectId: number) => {
    try {
      setJobActionProjectId(projectId)
      const result = await api.post<{ ok: boolean; action: string }>(`/projects/memory/jobs/${projectId}/run-now`, {})
      void Promise.all([fetchProjects(), fetchJobs(true)])
      toast.success(
        isZh
          ? result.action === 'rebuild'
            ? '已立刻执行记忆重建'
            : '已立刻执行摘要预热'
          : result.action === 'rebuild'
            ? 'Started memory rebuild now'
            : 'Started summary warming now',
      )
    } catch (error) {
      console.error('Failed to run memory job now:', error)
      toast.error(isZh ? '立即执行后台任务失败' : 'Failed to run memory job now')
    } finally {
      setJobActionProjectId(null)
    }
  }

  useEffect(() => {
    if (loading || isGeneratingMissing || autoGenerateMissingTriggeredRef.current || counts.missing === 0) {
      return
    }

    autoGenerateMissingTriggeredRef.current = true
    toast.info(
      isZh
        ? `系统正在自动补齐 ${counts.missing} 个尚未整理的项目记忆`
        : `Automatically preparing ${counts.missing} missing project memories`,
    )
    void runBatch('missing', { silent: true })
  }, [counts.missing, isGeneratingMissing, isZh, loading])

  useEffect(() => {
    if (
      loading ||
      isGeneratingMissing ||
      isWarmingSummaries ||
      autoWarmSummariesTriggeredRef.current ||
      readyProjectIds.length === 0
    ) {
      return
    }

    autoWarmSummariesTriggeredRef.current = true
    void warmSummaries(readyProjectIds, { silent: true })
  }, [isGeneratingMissing, isWarmingSummaries, loading, readyProjectIds])

  const filterOptions: Array<{ key: MemoryFilter; label: string; count: number }> = [
    { key: 'all', label: isZh ? '全部项目' : 'All', count: counts.all },
    { key: 'ready', label: isZh ? '可直接使用' : 'Ready', count: counts.ready },
    { key: 'stale', label: isZh ? '建议更新' : 'Needs refresh', count: counts.stale },
    { key: 'missing', label: isZh ? '尚未整理' : 'Not prepared', count: counts.missing },
  ]

  const ghostButtonStyle: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 13,
    background: 'var(--color-codex-bg)',
    color: 'var(--color-codex-ink-soft)',
    border: '1px solid var(--color-codex-line)',
    borderRadius: 'var(--codex-r-sm, 3px)',
  }
  const smallGhostStyle: React.CSSProperties = {
    padding: '5px 9px',
    fontSize: 11,
    background: 'var(--color-codex-bg)',
    color: 'var(--color-codex-ink-soft)',
    border: '1px solid var(--color-codex-line)',
    borderRadius: 'var(--codex-r-sm, 3px)',
  }
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-codex-bg-elev)',
    border: '1px solid var(--color-codex-line)',
    borderRadius: 'var(--codex-r-md, 6px)',
  }

  if (loading) {
    return (
      <div
        className="theme-codex flex min-h-[320px] items-center justify-center"
        style={{ background: 'var(--color-codex-bg)' }}
      >
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--color-codex-accent)' }} />
      </div>
    )
  }

  const statusToneBg = (s: MemoryFilter) =>
    s === 'missing'
      ? 'color-mix(in oklch, var(--color-codex-warn) 14%, transparent)'
      : s === 'stale'
        ? 'color-mix(in oklch, var(--color-codex-warn) 10%, transparent)'
        : 'var(--color-codex-accent-bg)'
  const statusToneInk = (s: MemoryFilter) =>
    s === 'ready' ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-warn)'

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
        <div className="min-w-0 flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center"
            style={{
              background: 'var(--color-codex-accent-bg)',
              color: 'var(--color-codex-accent)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <Brain className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 500,
                color: 'var(--color-codex-ink)',
                letterSpacing: '-0.015em',
              }}
            >
              {isZh ? '项目记忆管理' : 'Project Memory Manager'}
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
                ? '集中查看项目记忆状态、后台队列和常用 AI 摘要预热进度。'
                : 'Track project memory health, queued jobs, and common AI summary warming in one place.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runBatch('stale')}
            disabled={isRefreshingStale || counts.stale === 0}
            className="inline-flex items-center gap-2 disabled:opacity-50"
            style={ghostButtonStyle}
          >
            {isRefreshingStale ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {isZh ? '刷新待更新' : 'Refresh Stale'}
          </button>
          <button
            type="button"
            onClick={() => void runBatch('missing')}
            disabled={isGeneratingMissing || counts.missing === 0}
            className="inline-flex items-center gap-2 disabled:opacity-50"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              background: 'var(--color-codex-accent)',
              color: 'var(--color-codex-bg-elev)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            {isGeneratingMissing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isZh ? '补齐缺失记忆' : 'Generate Missing'}
          </button>
        </div>
      </header>

      {isGeneratingMissing && autoGenerateMissingTriggeredRef.current ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'var(--color-codex-bg-tint)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-ink-soft)',
            fontSize: 12.5,
          }}
        >
          {isZh
            ? '系统正在自动补齐尚未整理的项目记忆。你可以先浏览页面，结果会自动更新。'
            : 'Missing project memories are being prepared automatically. The list will update as results come back.'}
        </div>
      ) : null}

      {isWarmingSummaries ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'var(--color-codex-bg-tint)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-ink-soft)',
            fontSize: 12.5,
          }}
        >
          {isZh
            ? '系统正在后台预热常用 AI 摘要，并按队列、预算和间隔节奏控制，避免集中触发限流。'
            : 'Common AI summaries are being warmed in the background with queue, budget, and pacing controls to avoid rate-limit spikes.'}
        </div>
      ) : null}

      {/* Queue card */}
      <div style={{ ...cardStyle, padding: 18, marginBottom: 16 }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
              {isZh ? '后台任务队列' : 'Background Queue'}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
              {isZh
                ? '查看当前排队中的记忆重建和摘要预热任务。'
                : 'See queued memory rebuild and summary warm jobs.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchJobs()}
            className="inline-flex items-center gap-2"
            style={ghostButtonStyle}
          >
            {loadingJobs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {isZh ? '刷新队列' : 'Refresh queue'}
          </button>
        </div>

        {jobs.length === 0 ? (
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--color-codex-bg-tint)',
              border: '1px dashed var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
              fontSize: 13,
              color: 'var(--color-codex-ink-mute)',
            }}
          >
            {isZh ? '当前没有排队中的项目记忆任务。' : 'No queued project memory jobs right now.'}
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.job_id}
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-codex-ink)' }}
                      >
                        {job.project_name}
                      </span>
                      <span
                        className="font-mono"
                        style={{
                          padding: '1px 6px',
                          fontSize: 10.5,
                          background: 'var(--color-codex-bg-tint)',
                          color: 'var(--color-codex-ink-soft)',
                          borderRadius: 'var(--codex-r-pill, 999px)',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {getJobTypeText(job.job_type, isZh)}
                      </span>
                      {job.language ? (
                        <span
                          className="font-mono"
                          style={{
                            padding: '1px 6px',
                            fontSize: 10.5,
                            background: 'var(--color-codex-accent-bg)',
                            color: 'var(--color-codex-accent-ink)',
                            borderRadius: 'var(--codex-r-pill, 999px)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {job.language}
                        </span>
                      ) : null}
                      {job.status_source === 'project_status' ? (
                        <span
                          className="font-mono"
                          style={{
                            padding: '1px 6px',
                            fontSize: 10.5,
                            background: 'color-mix(in oklch, var(--color-codex-warn) 12%, transparent)',
                            color: 'var(--color-codex-warn)',
                            borderRadius: 'var(--codex-r-pill, 999px)',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {isZh ? '待校准' : 'Reconcile'}
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: 'var(--color-codex-ink-mute)',
                      }}
                    >
                      {job.client}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        padding: '6px 10px',
                        fontSize: 11.5,
                        background:
                          job.status_source === 'project_status'
                            ? 'color-mix(in oklch, var(--color-codex-warn) 8%, transparent)'
                            : 'var(--color-codex-bg-tint)',
                        color:
                          job.status_source === 'project_status'
                            ? 'var(--color-codex-warn)'
                            : 'var(--color-codex-ink-soft)',
                        borderRadius: 'var(--codex-r-sm, 3px)',
                        lineHeight: 1.55,
                      }}
                    >
                      {getJobSourceText(job, isZh)}
                    </div>
                    <div
                      className="mt-2 grid gap-2 font-mono sm:grid-cols-3"
                      style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                    >
                      <div>
                        {isZh ? '计划 ' : 'Scheduled '}
                        {formatProjectMemoryUpdatedAt(job.next_run_at ?? null, isZh)}
                      </div>
                      <div>v{job.memory_version}</div>
                      <div>
                        {job.memory_stale ? (isZh ? '待刷新' : 'Stale') : isZh ? '可用' : 'Ready'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => void runJobNow(job.project_id)}
                      disabled={jobActionProjectId === job.project_id}
                      className="inline-flex items-center gap-1 disabled:opacity-50"
                      style={smallGhostStyle}
                    >
                      {jobActionProjectId === job.project_id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {isZh ? '立即' : 'Run'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelJob(job.project_id)}
                      disabled={jobActionProjectId === job.project_id}
                      className="inline-flex items-center gap-1 disabled:opacity-50"
                      style={smallGhostStyle}
                    >
                      <XCircle className="h-3 w-3" />
                      {isZh ? '取消' : 'Cancel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${job.project_id}/memory`)}
                      className="inline-flex items-center gap-1"
                      style={smallGhostStyle}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {isZh ? '查看' : 'Open'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 16 }}>
        {filterOptions.map((option) => {
          const isActive = filter === option.key
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setFilter(option.key)
                setProjectPage(1)
              }}
              className="px-4 py-3 text-left transition-colors"
              style={{
                background: isActive
                  ? 'var(--color-codex-accent-bg)'
                  : 'var(--color-codex-bg-elev)',
                border: isActive
                  ? '1px solid color-mix(in oklch, var(--color-codex-accent) 35%, transparent)'
                  : '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  color: isActive ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-ink-mute)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {option.label}
              </div>
              <div
                className="font-mono"
                style={{
                  marginTop: 4,
                  fontSize: 22,
                  fontWeight: 500,
                  color: isActive ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-ink)',
                }}
              >
                {option.count}
              </div>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative" style={{ marginBottom: 16 }}>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
          style={{ color: 'var(--color-codex-ink-faint)' }}
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value)
            setProjectPage(1)
          }}
          placeholder={isZh ? '搜索项目名称、客户或摘要...' : 'Search by project, client, or summary...'}
          className="w-full outline-none"
          style={{
            padding: '10px 12px 10px 34px',
            fontSize: 13.5,
            background: 'var(--color-codex-bg-elev)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-md, 6px)',
            color: 'var(--color-codex-ink)',
          }}
        />
      </div>

      {/* Project list */}
      <div className="space-y-2">
        {projects.length === 0 ? (
          <div
            style={{
              padding: '18px 16px',
              background: 'var(--color-codex-bg-elev)',
              border: '1px dashed var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
              color: 'var(--color-codex-ink-mute)',
              fontSize: 13,
            }}
          >
            {isZh ? '没有符合条件的项目记忆。' : 'No project memories match these filters.'}
          </div>
        ) : null}

        {projects.map((project) => {
          const status = getMemoryStatus(project)
          const statusText =
            status === 'ready'
              ? isZh
                ? '可直接使用'
                : 'Ready'
              : status === 'stale'
                ? isZh
                  ? '建议更新'
                  : 'Needs refresh'
                : isZh
                  ? '尚未整理'
                  : 'Not prepared'

          return (
            <div
              key={project.id}
              style={{
                padding: 16,
                background: 'var(--color-codex-bg-elev)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className="font-mono"
                      style={{
                        padding: '2px 8px',
                        fontSize: 10.5,
                        background: statusToneBg(status),
                        color: statusToneInk(status),
                        borderRadius: 'var(--codex-r-pill, 999px)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {statusText}
                    </span>
                    <span
                      className="font-mono"
                      style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                    >
                      {project.client}
                    </span>
                    <span
                      className="font-mono inline-flex items-center gap-1"
                      style={{
                        padding: '2px 8px',
                        fontSize: 10.5,
                        background: 'var(--color-codex-bg-tint)',
                        color: 'var(--color-codex-ink-soft)',
                        borderRadius: 'var(--codex-r-pill, 999px)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <RebuildStatusIcon status={project.memory_rebuild_status} />
                      {getRebuildStatusText(project.memory_rebuild_status, isZh)}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: 14.5,
                      fontWeight: 600,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {project.name}
                  </div>
                  <div
                    className="mt-1 font-mono"
                    style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                  >
                    {isZh ? '最近同步 ' : 'Last sync '}
                    {formatProjectMemoryUpdatedAt(project.memory_updated_at, isZh)}
                  </div>

                  {project.memory_rebuild_failed_at ? (
                    <div
                      className="mt-1 flex items-center gap-1.5 font-mono"
                      style={{ fontSize: 11, color: 'var(--color-codex-bad)' }}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      <span>
                        {isZh ? '最近失败 ' : 'Last failed '}
                        {formatProjectMemoryUpdatedAt(project.memory_rebuild_failed_at, isZh)}
                      </span>
                    </div>
                  ) : null}

                  <div
                    className="mt-3"
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      color: 'var(--color-codex-ink-soft)',
                    }}
                  >
                    {project.context_summary?.trim()
                      ? project.context_summary
                          .replace(/\*\*(.*?)\*\*/g, '$1')
                          .split(/\r?\n+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(' ')
                      : isZh
                        ? '当前还没有项目记忆摘要。'
                        : 'No project memory summary yet.'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => void rebuildSingleProject(project)}
                    disabled={refreshingProjectId === project.id}
                    className="inline-flex items-center gap-1 disabled:opacity-50"
                    style={smallGhostStyle}
                  >
                    {refreshingProjectId === project.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {isZh ? '更新' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${project.id}/memory`)}
                    className="inline-flex items-center gap-1"
                    style={smallGhostStyle}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {isZh ? '查看' : 'Open'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <CxPagination
        page={projectPage}
        pageSize={projectPageSize}
        totalItems={projectTotal}
        onPageChange={setProjectPage}
        onPageSizeChange={(nextPageSize) => {
          setProjectPageSize(nextPageSize)
          setProjectPage(1)
        }}
        pageSizeOptions={[10, 20, 50]}
        variant="full"
        isZh={isZh}
        style={{ marginTop: 16 }}
      />
    </div>
  )
}
