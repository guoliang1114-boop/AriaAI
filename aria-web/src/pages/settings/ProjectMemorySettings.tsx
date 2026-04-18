import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Brain,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import type {
  Project,
  ProjectMemoryBatchRebuildResponse,
  ProjectMemoryBatchWarmSummariesResponse,
  ProjectMemoryResponse,
} from '../../types/api'
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
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<MemoryFilter>('all')
  const [isRefreshingStale, setIsRefreshingStale] = useState(false)
  const [isGeneratingMissing, setIsGeneratingMissing] = useState(false)
  const [isWarmingSummaries, setIsWarmingSummaries] = useState(false)
  const [refreshingProjectId, setRefreshingProjectId] = useState<number | null>(null)

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const data = await api.get<Project[]>('/projects')
      setProjects(data)
    } catch (error) {
      console.error('Failed to load projects for memory settings:', error)
      toast.error(isZh ? '加载项目记忆列表失败' : 'Failed to load project memories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchProjects()
  }, [])

  const counts = useMemo(
    () => ({
      all: projects.length,
      ready: projects.filter((project) => getMemoryStatus(project) === 'ready').length,
      stale: projects.filter((project) => getMemoryStatus(project) === 'stale').length,
      missing: projects.filter((project) => getMemoryStatus(project) === 'missing').length,
    }),
    [projects],
  )

  const readyProjectIds = useMemo(
    () =>
      projects
        .filter((project) => getMemoryStatus(project) === 'ready')
        .map((project) => project.id),
    [projects],
  )

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return projects.filter((project) => {
      const matchesFilter = filter === 'all' || getMemoryStatus(project) === filter
      const matchesQuery =
        !query ||
        project.name.toLowerCase().includes(query) ||
        project.client.toLowerCase().includes(query) ||
        (project.context_summary && project.context_summary.toLowerCase().includes(query))
      return matchesFilter && matchesQuery
    })
  }, [filter, projects, searchQuery])

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
    const targetProjects = projects.filter((project) =>
      mode === 'stale' ? getMemoryStatus(project) === 'stale' : getMemoryStatus(project) === 'missing',
    )
    if (targetProjects.length === 0) return

    if (mode === 'stale') setIsRefreshingStale(true)
    else setIsGeneratingMissing(true)

    try {
      const result = await api.post<ProjectMemoryBatchRebuildResponse>(
        '/projects/memory/rebuild-batch',
        {
          project_ids: targetProjects.map((project) => project.id),
          stale_only: mode === 'stale',
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

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-on-surface">
                {isZh ? '项目记忆管理' : 'Project Memory Manager'}
              </h2>
              <p className="mt-1 text-sm text-on-surface-muted">
                {isZh
                  ? '集中查看所有项目记忆状态，系统会自动补齐缺失记忆并后台预生成常用 AI 摘要。'
                  : 'Track project memory health. Missing memories and common AI summaries are prepared automatically in the background.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void runBatch('stale')
            }}
            disabled={isRefreshingStale || counts.stale === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isRefreshingStale ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isZh ? '批量更新待刷新记忆' : 'Refresh Stale Memories'}
          </button>
          <button
            type="button"
            onClick={() => {
              void runBatch('missing')
            }}
            disabled={isGeneratingMissing || counts.missing === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            {isGeneratingMissing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isZh ? '补齐未整理记忆' : 'Generate Missing Memories'}
          </button>
        </div>
      </div>

      {isGeneratingMissing && autoGenerateMissingTriggeredRef.current ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {isZh
            ? '系统正在自动补齐尚未整理的项目记忆。你可以先浏览页面，结果会自动更新。'
            : 'Missing project memories are being prepared automatically. The list will update as results come back.'}
        </div>
      ) : null}

      {isWarmingSummaries ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          {isZh
            ? '系统正在后台预生成常用 AI 摘要，并按队列和预算控制节奏，避免集中触发限流。'
            : 'Common AI summaries are being warmed in the background with queueing and budget controls to avoid rate-limit spikes.'}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
              filter === option.key
                ? 'border-primary/30 bg-primary/5'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{option.label}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{option.count}</div>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={isZh ? '搜索项目名称、客户或摘要...' : 'Search by project, client, or summary...'}
          className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="space-y-3">
        {filteredProjects.map((project) => {
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
            <div key={project.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        status === 'ready'
                          ? 'bg-emerald-100 text-emerald-700'
                          : status === 'stale'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {statusText}
                    </span>
                    <span className="text-xs uppercase tracking-wider text-gray-400">{project.client}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      <RebuildStatusIcon status={project.memory_rebuild_status} />
                      {getRebuildStatusText(project.memory_rebuild_status, isZh)}
                    </span>
                  </div>

                  <div className="text-base font-semibold text-gray-900">{project.name}</div>
                  <div className="mt-1 text-sm text-gray-500">
                    {isZh ? '最近同步：' : 'Last sync: '}
                    {formatProjectMemoryUpdatedAt(project.memory_updated_at, isZh)}
                  </div>

                  {project.memory_rebuild_failed_at ? (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-red-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>
                        {isZh ? '最近失败：' : 'Last failed: '}
                        {formatProjectMemoryUpdatedAt(project.memory_rebuild_failed_at, isZh)}
                      </span>
                    </div>
                  ) : null}

                  <div className="mt-3 text-sm leading-relaxed text-gray-600">
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

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      void rebuildSingleProject(project)
                    }}
                    disabled={refreshingProjectId === project.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
                  >
                    {refreshingProjectId === project.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {isZh ? '更新记忆' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${project.id}/memory`)}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {isZh ? '查看详情' : 'Open'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
