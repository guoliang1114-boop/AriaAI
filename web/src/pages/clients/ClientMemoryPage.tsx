import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Brain,
  Building2,
  Clock3,
  ExternalLink,
  GitCompare,
  Loader2,
  RefreshCw,
  Users,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import { formatDateTime as formatWithTimeZone, getResolvedAppTimeZone } from '../../utils/timezone'
import type {
  ClientMemory,
  ClientMemoryResponse,
  ClientMemorySnapshot,
  ClientMemoryStatusResponse,
  ClientMemorySummaryType,
  MemorySnapshotDiffResponse,
} from '../../types/api'
import { useClientMemorySummary } from './useClientMemorySummary'

interface ClientDetailRecord {
  id: number
  name: string
  industry: string
  contact: string
  notes: string
  created_at: string
  document_count: number
  project_names: string[]
  client_memory_version?: number
  client_memory_stale?: boolean
  client_memory_updated_at?: string | null
  client_memory_rebuild_status?: string
  client_memory_rebuild_failed_at?: string | null
}

interface RelatedProject {
  id: number
  name: string
  status: string
  contract_amount: number | null
  memory_version?: number
  memory_stale?: boolean
}

function formatDateTime(value?: string | null, isZh = true) {
  if (!value) return isZh ? '暂无记录' : 'No record yet'
  return formatWithTimeZone(value, isZh ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }, getResolvedAppTimeZone())
}

function formatDiffValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '空'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function getAsyncStatusLabel(status: string | undefined, isZh: boolean) {
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

export function ClientMemoryPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [client, setClient] = useState<ClientDetailRecord | null>(null)
  const [projects, setProjects] = useState<RelatedProject[]>([])
  const [memoryStatus, setMemoryStatus] = useState<ClientMemoryStatusResponse | null>(null)
  const [memory, setMemory] = useState<ClientMemory | null>(null)
  const [snapshots, setSnapshots] = useState<ClientMemorySnapshot[]>([])
  const [rollingBackSnapshotId, setRollingBackSnapshotId] = useState<number | null>(null)
  const [rollbackConfirmSnapshot, setRollbackConfirmSnapshot] = useState<ClientMemorySnapshot | null>(null)
  const [snapshotDiff, setSnapshotDiff] = useState<MemorySnapshotDiffResponse | null>(null)
  const [diffLoadingSnapshotId, setDiffLoadingSnapshotId] = useState<number | null>(null)

  useEffect(() => {
    if (id) {
      void loadClientMemoryPage()
    }
  }, [id])

  // Depending on the whole ``memoryStatus`` object meant the 10s interval
  // tore down + restarted on every successful poll (each setMemoryStatus
  // re-ran the effect). Gate on a derived boolean so the timer only
  // restarts when polling actually transitions on/off.
  const isMemoryRebuilding = ['queued', 'rebuilding'].includes(
    memoryStatus?.memory_rebuild_status || '',
  )
  useEffect(() => {
    if (!id || !isMemoryRebuilding) return

    const timer = window.setInterval(() => {
      void api
        .get<ClientMemoryStatusResponse>(`/clients/${id}/memory/status`)
        .then((statusData) => setMemoryStatus(statusData))
        .catch((error) => console.error('Failed to refresh client memory status:', error))
    }, 10000)

    return () => window.clearInterval(timer)
  }, [id, isMemoryRebuilding])

  const loadClientMemoryPage = async () => {
    try {
      setLoading(true)
      const [clientData, statusData, memoryData, projectsData] = await Promise.all([
        api.get<ClientDetailRecord>(`/clients/${id}`),
        api.get<ClientMemoryStatusResponse>(`/clients/${id}/memory/status`),
        api.get<ClientMemoryResponse>(`/clients/${id}/memory`),
        api.get<RelatedProject[]>(`/clients/${id}/projects`),
        refreshSnapshots(),
      ])
      setClient(clientData)
      setMemoryStatus(statusData)
      setMemory(memoryData.memory)
      setProjects(projectsData)
    } catch (error) {
      console.error('Failed to load client memory page:', error)
    } finally {
      setLoading(false)
    }
  }

  const refreshSnapshots = async () => {
    if (!id) return []
    try {
      const data = await api.get<ClientMemorySnapshot[]>(`/clients/${id}/memory/snapshots`)
      setSnapshots(data)
      return data
    } catch (error) {
      console.error('Failed to load client memory snapshots:', error)
      setSnapshots([])
      return []
    }
  }

  const refreshMemory = async () => {
    if (!id) return
    try {
      setRebuilding(true)
      const response = await api.post<ClientMemoryResponse>(`/clients/${id}/memory/rebuild`, {}, { timeout: 120000 })
      setMemory(response.memory)
      setMemoryStatus({
        client_id: response.client_id,
        has_memory: true,
        memory_version: response.memory_version,
        memory_stale: response.memory_stale,
        memory_updated_at: response.memory_updated_at,
        memory_rebuild_status: response.memory_rebuild_status,
        memory_rebuild_failed_at: response.memory_rebuild_failed_at,
      })
      await refreshSnapshots()
    } catch (error) {
      console.error('Failed to rebuild client memory:', error)
    } finally {
      setRebuilding(false)
    }
  }

  const rollbackSnapshot = async (snapshot: ClientMemorySnapshot) => {
    if (!id) return
    try {
      setRollingBackSnapshotId(snapshot.id)
      const response = await api.post<ClientMemoryResponse>(
        `/clients/${id}/memory/snapshots/${snapshot.id}/rollback`,
        {},
        { timeout: 60000 },
      )
      setMemory(response.memory)
      setMemoryStatus({
        client_id: response.client_id,
        has_memory: true,
        memory_version: response.memory_version,
        memory_stale: response.memory_stale,
        memory_updated_at: response.memory_updated_at,
        memory_rebuild_status: response.memory_rebuild_status,
        memory_rebuild_failed_at: response.memory_rebuild_failed_at,
      })
      await refreshSnapshots()
    } catch (error) {
      console.error('Failed to rollback client memory snapshot:', error)
    } finally {
      setRollingBackSnapshotId(null)
      setRollbackConfirmSnapshot(null)
    }
  }

  const loadSnapshotDiff = async (snapshot: ClientMemorySnapshot) => {
    if (!id) return
    try {
      setDiffLoadingSnapshotId(snapshot.id)
      const response = await api.get<MemorySnapshotDiffResponse>(`/clients/${id}/memory/snapshots/${snapshot.id}/diff`)
      setSnapshotDiff(response)
    } catch (error) {
      console.error('Failed to load client memory snapshot diff:', error)
    } finally {
      setDiffLoadingSnapshotId(null)
    }
  }

  const summaryTabs: Array<{ key: ClientMemorySummaryType; label: string; desc: string }> = useMemo(
    () => [
      {
        key: 'overview',
        label: isZh ? 'AI 客户摘要' : 'AI client summary',
        desc: isZh ? '快速理解这个客户是谁、合作方式如何。' : 'Understand who this client is and how they work.',
      },
      {
        key: 'stakeholder',
        label: isZh ? 'AI 干系人摘要' : 'AI stakeholder view',
        desc: isZh ? '聚焦联系人、决策方式和关系信号。' : 'Focus on contacts, decision style, and relationship signals.',
      },
      {
        key: 'lessons',
        label: isZh ? 'AI 经验摘要' : 'AI lessons learned',
        desc: isZh ? '沉淀未来项目最值得复用的经验。' : 'Capture the lessons most worth reusing on future projects.',
      },
      {
        key: 'client-facing',
        label: isZh ? 'AI 客户沟通摘要' : 'AI client-facing summary',
        desc: isZh ? '适合面向客户团队的表达方式。' : 'Safer language for client-facing teams.',
      },
      {
        key: 'risk',
        label: isZh ? 'AI 客户风险摘要' : 'AI client risk summary',
        desc: isZh ? '聚焦关系风险、决策摩擦和需要谨慎处理的话题。' : 'Focus on relationship risks and decision friction.',
      },
      {
        key: 'opportunity',
        label: isZh ? 'AI 机会摘要' : 'AI opportunity summary',
        desc: isZh ? '提炼扩展合作、追加项目和信任加深的机会。' : 'Highlight growth opportunities and expansion signals.',
      },
      {
        key: 'relationship',
        label: isZh ? 'AI 关系摘要' : 'AI relationship summary',
        desc: isZh ? '聚焦信任程度、沟通节奏和关键关系信号。' : 'Focus on trust level, communication rhythm, and relationship signals.',
      },
      {
        key: 'delivery',
        label: isZh ? 'AI 交付准备摘要' : 'AI delivery readiness',
        desc: isZh ? '提炼客户的交付偏好、执行摩擦和启动前准备重点。' : 'Highlight delivery preferences, execution friction, and readiness signals.',
      },
    ],
    [isZh],
  )
  const [activeSummary, setActiveSummary] = useState<ClientMemorySummaryType>('overview')

  const {
    content: summaryContent,
    error: summaryError,
    loading: summaryLoading,
    refresh: refreshSummary,
  } = useClientMemorySummary({
    clientId: id || '',
    summaryType: activeSummary,
    language: i18n.language,
    memoryVersion: memoryStatus?.memory_version,
    enabled: Boolean(id && memoryStatus?.has_memory),
    errorMessage: isZh ? '加载客户摘要失败' : 'Failed to load client summary',
  })

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '客户记忆' : 'Client Memory'} />
        <div className="theme-codex flex min-h-full items-center justify-center bg-codex-bg">
          <Loader2 className="h-8 w-8 animate-spin text-codex-accent" />
        </div>
      </>
    )
  }

  if (!client) {
    return (
      <>
        <PageTitle title={isZh ? '客户记忆' : 'Client Memory'} />
        <div className="theme-codex flex min-h-full items-center justify-center bg-codex-bg">
          <div className="text-center text-sm text-codex-ink-mute">
            {isZh ? '客户不存在或已被删除。' : 'The client could not be found.'}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={`${client.name} / ${isZh ? '客户记忆' : 'Client Memory'}`} />
      <div className="theme-codex min-h-full bg-codex-bg">
        <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <button
                onClick={() => navigate(`/clients/${client.id}`)}
                className="mb-3 inline-flex items-center gap-2 text-sm text-codex-ink-mute hover:text-codex-ink"
              >
                <ArrowLeft className="h-4 w-4" />
                {isZh ? '返回客户详情' : 'Back to client'}
              </button>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-codex-accent-bg text-codex-accent">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-codex-ink">{client.name}</h1>
                  <p className="mt-1 text-sm text-codex-ink-mute">
                    {client.industry || (isZh ? '未填写行业' : 'No industry')} / {projects.length}{' '}
                    {isZh ? '个相关项目' : 'related projects'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/settings/client-memory')}
                className="inline-flex items-center gap-2 rounded border border-codex-line px-4 py-2 text-sm font-medium text-codex-ink hover:bg-codex-bg-tint"
              >
                <Users className="h-4 w-4" />
                {isZh ? '进入客户记忆管理' : 'Open memory manager'}
              </button>
              <button
                onClick={() => void refreshMemory()}
                disabled={rebuilding}
                className="inline-flex items-center gap-2 rounded bg-codex-accent px-4 py-2 text-sm font-medium text-codex-bg-elev hover:bg-codex-accent disabled:opacity-60"
              >
                {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {isZh ? '更新客户记忆' : 'Update client memory'}
              </button>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-codex-accent" />
                    <h2 className="text-lg font-semibold text-codex-ink">
                      {summaryTabs.find((item) => item.key === activeSummary)?.label}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-codex-ink-mute">
                    {summaryTabs.find((item) => item.key === activeSummary)?.desc}
                  </p>
                </div>
                <button
                  onClick={() => void refreshSummary(true)}
                  disabled={summaryLoading}
                  className="inline-flex items-center gap-2 rounded border border-codex-line px-3 py-2 text-sm font-medium text-codex-ink hover:bg-codex-bg-tint disabled:opacity-60"
                >
                  {summaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {summaryContent ? (isZh ? '重新生成' : 'Regenerate') : isZh ? '生成摘要' : 'Generate'}
                </button>
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                {summaryTabs.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setActiveSummary(item.key)}
                    className={`rounded-full px-3 py-1.5 text-sm transition ${
                      activeSummary === item.key
                        ? 'bg-codex-accent text-codex-bg-elev'
                        : 'bg-codex-bg-tint text-codex-ink-mute hover:text-codex-ink'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="min-h-[160px] rounded-md bg-codex-bg-tint px-4 py-4">
                {summaryLoading ? (
                  <div className="flex items-center gap-2 text-sm text-codex-ink-mute">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isZh ? '正在整理客户记忆摘要...' : 'Preparing client memory summary...'}
                  </div>
                ) : summaryError ? (
                  <div className="text-sm text-codex-bad">{summaryError}</div>
                ) : summaryContent ? (
                  <div className="whitespace-pre-wrap text-sm leading-7 text-codex-ink">{summaryContent}</div>
                ) : (
                  <div className="text-sm text-codex-ink-mute">
                    {isZh
                      ? '暂无摘要内容，点击生成摘要后再调用 AI。'
                      : 'No summary yet. Click Generate to call AI.'}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
              <h2 className="text-lg font-semibold text-codex-ink">{isZh ? '客户记忆概况' : 'Client memory health'}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-codex-bg-tint px-4 py-4">
                  <div className="text-sm text-codex-ink-mute">{isZh ? '状态' : 'Status'}</div>
                  <div className="mt-2 text-lg font-semibold text-codex-ink">
                    {memoryStatus?.has_memory
                      ? memoryStatus.memory_stale
                        ? isZh
                          ? '建议更新'
                          : 'Needs refresh'
                        : isZh
                          ? '可直接使用'
                          : 'Ready'
                      : isZh
                        ? '尚未整理'
                        : 'Not prepared'}
                  </div>
                </div>
                <div className="rounded-md bg-codex-bg-tint px-4 py-4">
                  <div className="text-sm text-codex-ink-mute">{isZh ? '最近同步' : 'Last sync'}</div>
                  <div className="mt-2 text-sm font-medium text-codex-ink">
                    {formatDateTime(memoryStatus?.memory_updated_at, isZh)}
                  </div>
                </div>
                <div className="rounded-md bg-codex-bg-tint px-4 py-4">
                  <div className="text-sm text-codex-ink-mute">{isZh ? '异步状态' : 'Async status'}</div>
                  <div className="mt-2 text-sm font-medium text-codex-ink">
                    {getAsyncStatusLabel(memoryStatus?.memory_rebuild_status, isZh)}
                  </div>
                  {memoryStatus?.memory_rebuild_failed_at ? (
                    <div className="mt-2 text-xs text-codex-bad">
                      {formatDateTime(memoryStatus.memory_rebuild_failed_at, isZh)}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-md bg-codex-bg-tint px-4 py-4">
                  <div className="text-sm text-codex-ink-mute">{isZh ? '来源项目数' : 'Source projects'}</div>
                  <div className="mt-2 text-lg font-semibold text-codex-ink">
                    {memory?.source_project_ids?.length || projects.length}
                  </div>
                </div>
                <div className="rounded-md bg-codex-bg-tint px-4 py-4">
                  <div className="text-sm text-codex-ink-mute">{isZh ? '客户文档数' : 'Documents'}</div>
                  <div className="mt-2 text-lg font-semibold text-codex-ink">{client.document_count}</div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-codex-line bg-codex-bg-elev p-6 ">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-codex-accent-ink" />
                  <h2 className="text-lg font-semibold text-codex-ink">{isZh ? '客户记忆历史版本' : 'Client memory history'}</h2>
                </div>
                <p className="mt-1 text-sm leading-6 text-codex-ink-mute">
                  {isZh
                    ? '客户记忆每次重建、项目经验沉淀或回滚都会保留快照，方便审计长期客户资产的变化。'
                    : 'Every rebuild, project promotion, or rollback keeps a snapshot so long-term client knowledge stays auditable.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshSnapshots()}
                className="inline-flex items-center justify-center gap-2 rounded border border-codex-line bg-codex-bg-elev px-3 py-2 text-sm font-medium text-codex-accent-ink hover:bg-codex-accent-bg"
              >
                <RefreshCw className="h-4 w-4" />
                {isZh ? '刷新历史' : 'Refresh history'}
              </button>
            </div>

            {snapshots.length ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {snapshots.slice(0, 6).map((snapshot) => {
                  const isCurrent = snapshot.memory_version === (memory?.memory_version ?? memoryStatus?.memory_version)
                  const isRollingBack = rollingBackSnapshotId === snapshot.id
                  return (
                    <div key={snapshot.id} className="rounded-md border border-codex-line bg-codex-bg-elev p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-codex-ink">
                            {isZh ? `版本 ${snapshot.memory_version}` : `Version ${snapshot.memory_version}`}
                          </div>
                          <div className="mt-1 text-xs text-codex-ink-mute">{formatDateTime(snapshot.created_at, isZh)}</div>
                        </div>
                        {isCurrent ? (
                          <span className="rounded-full bg-codex-accent-bg px-2 py-1 text-xs text-codex-accent-ink">
                            {isZh ? '当前' : 'Current'}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 rounded bg-codex-accent-bg px-3 py-2 text-xs text-codex-accent-ink">
                        {isZh ? '触发' : 'Trigger'}: {snapshot.trigger || '-'}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => void loadSnapshotDiff(snapshot)}
                          disabled={diffLoadingSnapshotId === snapshot.id}
                          className="inline-flex w-full items-center justify-center gap-2 rounded border border-codex-line bg-codex-bg-elev px-3 py-2 text-sm font-medium text-codex-accent-ink hover:bg-codex-accent-bg disabled:cursor-wait disabled:text-codex-ink-faint"
                        >
                          {diffLoadingSnapshotId === snapshot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
                          {isZh ? '查看变化' : 'View diff'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRollbackConfirmSnapshot(snapshot)}
                          disabled={isCurrent || isRollingBack}
                          className="inline-flex w-full items-center justify-center gap-2 rounded border border-codex-line bg-codex-bg-elev px-3 py-2 text-sm font-medium text-codex-accent-ink hover:bg-codex-accent-bg disabled:cursor-not-allowed disabled:border-codex-line-soft disabled:text-codex-ink-faint"
                        >
                          {isRollingBack ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                          {isZh ? '恢复到这一版' : 'Restore this version'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-codex-line bg-codex-bg-elev p-4 text-sm text-codex-ink-mute">
                {isZh ? '暂无客户记忆历史。下一次更新客户记忆后会自动生成快照。' : 'No client memory history yet. The next update will create a snapshot automatically.'}
              </div>
            )}
            {snapshotDiff ? (
              <div className="mt-4 rounded-md border border-codex-line bg-codex-bg-elev p-4 ">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-codex-ink">
                      {isZh
                        ? `版本 ${snapshotDiff.from_snapshot.memory_version} 与当前版本 ${snapshotDiff.to.memory_version} 的变化`
                        : `Version ${snapshotDiff.from_snapshot.memory_version} vs current ${snapshotDiff.to.memory_version}`}
                    </div>
                    <p className="mt-1 text-xs text-codex-ink-mute">
                      {isZh ? `变化字段 ${snapshotDiff.summary.changed} 个，未变化 ${snapshotDiff.summary.unchanged} 个。` : `${snapshotDiff.summary.changed} changed fields, ${snapshotDiff.summary.unchanged} unchanged.`}
                    </p>
                  </div>
                  <button type="button" onClick={() => setSnapshotDiff(null)} className="text-sm font-medium text-codex-accent-ink hover:text-codex-accent-ink">
                    {isZh ? '收起' : 'Collapse'}
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {snapshotDiff.fields.length ? (
                    snapshotDiff.fields.slice(0, 8).map((field) => (
                      <div key={field.field} className="rounded border border-codex-line bg-codex-bg-muted/40 p-3">
                        <div className="text-xs font-semibold text-codex-ink-mute">{field.label}</div>
                        {field.kind === 'list' ? (
                          <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                            <div className="rounded-lg bg-codex-accent-bg p-2 text-codex-accent-ink">
                              <div className="text-xs font-semibold">{isZh ? '新增' : 'Added'}</div>
                              <div className="mt-1 whitespace-pre-wrap">{(field.added || []).map(formatDiffValue).join('\n') || (isZh ? '无' : 'None')}</div>
                            </div>
                            <div className="rounded-lg bg-codex-bg-tint p-2 text-codex-bad">
                              <div className="text-xs font-semibold">{isZh ? '移除' : 'Removed'}</div>
                              <div className="mt-1 whitespace-pre-wrap">{(field.removed || []).map(formatDiffValue).join('\n') || (isZh ? '无' : 'None')}</div>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                            <div className="rounded-lg bg-codex-bg-tint p-2 text-codex-bad">
                              <div className="text-xs font-semibold">{isZh ? '旧版本' : 'Before'}</div>
                              <div className="mt-1 whitespace-pre-wrap">{formatDiffValue(field.before)}</div>
                            </div>
                            <div className="rounded-lg bg-codex-accent-bg p-2 text-codex-accent-ink">
                              <div className="text-xs font-semibold">{isZh ? '当前版本' : 'Current'}</div>
                              <div className="mt-1 whitespace-pre-wrap">{formatDiffValue(field.after)}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="rounded bg-codex-bg-muted p-3 text-sm text-codex-ink-mute">{isZh ? '这个快照与当前记忆没有可见差异。' : 'No visible differences from current memory.'}</div>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          {rollbackConfirmSnapshot ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md rounded-md bg-codex-bg p-6 shadow-2xl">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-codex-bg-tint p-2 text-codex-warn">
                    <Clock3 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-codex-ink">{isZh ? '确认恢复客户记忆？' : 'Restore client memory?'}</h3>
                    <p className="mt-2 text-sm leading-6 text-codex-ink-mute">
                      {isZh
                        ? `将恢复到版本 ${rollbackConfirmSnapshot.memory_version}，系统会生成一个新的当前版本，历史快照仍会保留。`
                        : `This restores version ${rollbackConfirmSnapshot.memory_version} and creates a new current version. Existing snapshots remain available.`}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRollbackConfirmSnapshot(null)}
                    className="rounded border border-codex-line px-4 py-2 text-sm font-medium text-codex-ink hover:bg-codex-bg-tint"
                  >
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void rollbackSnapshot(rollbackConfirmSnapshot)}
                    disabled={rollingBackSnapshotId === rollbackConfirmSnapshot.id}
                    className="inline-flex items-center gap-2 rounded bg-codex-accent px-4 py-2 text-sm font-medium text-codex-bg-elev hover:bg-codex-accent disabled:cursor-wait disabled:bg-codex-accent-bg"
                  >
                    {rollingBackSnapshotId === rollbackConfirmSnapshot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isZh ? '确认恢复' : 'Restore'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
                <h2 className="text-lg font-semibold text-codex-ink">{isZh ? '客户画像' : 'Client profile'}</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-codex-ink">
                  {memory?.client_profile || client.notes || (isZh ? '当前还没有沉淀出客户画像。' : 'No client profile has been captured yet.')}
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
                  <h3 className="text-base font-semibold text-codex-ink">{isZh ? '决策模式' : 'Decision patterns'}</h3>
                  <ul className="mt-4 space-y-3 text-sm text-codex-ink">
                    {(memory?.decision_patterns || []).map((item) => <li key={item}>• {item}</li>)}
                    {!memory?.decision_patterns?.length ? (
                      <li className="text-codex-ink-mute">{isZh ? '暂未沉淀。' : 'Not captured yet.'}</li>
                    ) : null}
                  </ul>
                </div>
                <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
                  <h3 className="text-base font-semibold text-codex-ink">{isZh ? '敏感议题' : 'Sensitive topics'}</h3>
                  <ul className="mt-4 space-y-3 text-sm text-codex-ink">
                    {(memory?.sensitive_topics || []).map((item) => <li key={item}>• {item}</li>)}
                    {!memory?.sensitive_topics?.length ? (
                      <li className="text-codex-ink-mute">{isZh ? '暂未沉淀。' : 'Not captured yet.'}</li>
                    ) : null}
                  </ul>
                </div>
              </div>

              <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
                <h3 className="text-base font-semibold text-codex-ink">{isZh ? '关键联系人' : 'Key contacts'}</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(memory?.key_contacts || []).map((contact) => (
                    <div key={`${contact.name}-${contact.role}`} className="rounded-md bg-codex-bg-tint px-4 py-4">
                      <div className="text-sm font-medium text-codex-ink">
                        {contact.name || (isZh ? '未命名联系人' : 'Unnamed contact')}
                      </div>
                      <div className="mt-1 text-xs text-codex-ink-mute">
                        {contact.role || (isZh ? '角色待补充' : 'Role missing')}
                      </div>
                      <div className="mt-2 text-sm text-codex-ink">
                        {contact.note || (isZh ? '暂无备注' : 'No note yet')}
                      </div>
                    </div>
                  ))}
                  {!memory?.key_contacts?.length ? (
                    <div className="rounded-md bg-codex-bg-tint px-4 py-6 text-sm text-codex-ink-mute">
                      {isZh ? '当前还没有沉淀关键联系人。' : 'No key contacts have been captured yet.'}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
                <h3 className="text-base font-semibold text-codex-ink">{isZh ? '经验沉淀' : 'Lessons learned'}</h3>
                <ul className="mt-4 space-y-3 text-sm text-codex-ink">
                  {(memory?.lessons_learned || []).map((item) => <li key={item}>• {item}</li>)}
                  {!memory?.lessons_learned?.length ? (
                    <li className="text-codex-ink-mute">
                      {isZh ? '当前还没有沉淀经验。' : 'No lessons learned have been captured yet.'}
                    </li>
                  ) : null}
                </ul>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
                <h3 className="text-base font-semibold text-codex-ink">{isZh ? '项目履历' : 'Project history'}</h3>
                <div className="mt-4 space-y-3">
                  {(memory?.project_history || []).map((item) => (
                    <div key={`${item.project_name}-${item.status}`} className="rounded-md border border-codex-line px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-codex-ink">{item.project_name}</div>
                          <div className="mt-1 text-xs text-codex-ink-mute">{item.status}</div>
                        </div>
                        <button
                          onClick={() => {
                            const target = projects.find((project) => project.name === item.project_name)
                            if (target) navigate(`/projects/${target.id}`)
                          }}
                          className="text-codex-ink-mute hover:text-codex-ink"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 text-sm text-codex-ink">{item.outcome}</div>
                      <div className="mt-2 text-xs text-codex-ink-mute">{item.key_factor}</div>
                    </div>
                  ))}
                  {!memory?.project_history?.length ? (
                    <div className="rounded-md bg-codex-bg-tint px-4 py-6 text-sm text-codex-ink-mute">
                      {isZh ? '当前还没有项目履历沉淀。' : 'No client project history has been captured yet.'}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-md border border-codex-line bg-codex-bg p-6 ">
                <h3 className="text-base font-semibold text-codex-ink">{isZh ? '相关项目' : 'Related projects'}</h3>
                <div className="mt-4 space-y-3">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      className="flex w-full items-center justify-between rounded-md border border-codex-line px-4 py-4 text-left transition hover:bg-codex-bg-tint"
                    >
                      <div>
                        <div className="text-sm font-medium text-codex-ink">{project.name}</div>
                        <div className="mt-1 text-xs text-codex-ink-mute">
                          {project.status} / {project.contract_amount ? `${project.contract_amount}` : isZh ? '未填写金额' : 'No amount'}
                        </div>
                      </div>
                      <ExternalLink className="h-4 w-4 text-codex-ink-mute" />
                    </button>
                  ))}
                  {!projects.length ? (
                    <div className="rounded-md bg-codex-bg-tint px-4 py-6 text-sm text-codex-ink-mute">
                      {isZh ? '当前还没有关联项目。' : 'No related projects yet.'}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
