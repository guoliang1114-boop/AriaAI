import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  Edit2,
  ExternalLink,
  FileText,
  FolderKanban,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react'

import { api } from '../../api/client'
import { CxConfirmDialog, CxPanel, CxStatus, type CxStatusTone } from '../../components/codex'
import { PageTitle } from '../../components/PageTitle'
import type {
  ClientMemoryResponse,
  ClientMemoryStatusResponse,
  ClientMemorySummaryType,
  ClientStakeholder,
  MemoryFactListResponse,
  MemorySlotListResponse,
} from '../../types/api'
import { formatDateOnly, formatDateTime, getResolvedAppTimeZone } from '../../utils/timezone'
import { formatMemoryRebuildSummary } from '../../utils/memoryRebuild'
import { useClientMemorySummary } from './useClientMemorySummary'

interface Client {
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
}

interface Project {
  id: number
  name: string
  status: string
  contract_amount: number | null
}

interface DisplayContact {
  contact: string
  influence: string
  lastAction: string
  level: string
  name: string
  note: string
  recorded: boolean
  relationship: string
  role: string
}

type ClientDetailTab = 'overview' | 'memory' | 'contacts' | 'projects' | 'history'

export function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const numericClientId = Number(id)
  const validClientId = Number.isFinite(numericClientId) && numericClientId > 0

  const [client, setClient] = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [stakeholders, setStakeholders] = useState<ClientStakeholder[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Client>>({})
  const [memoryStatus, setMemoryStatus] = useState<ClientMemoryStatusResponse | null>(null)
  const [memorySlots, setMemorySlots] = useState<MemorySlotListResponse | null>(null)
  const [memoryFacts, setMemoryFacts] = useState<MemoryFactListResponse | null>(null)
  const [rebuildingMemory, setRebuildingMemory] = useState(false)
  const [loadedClientId, setLoadedClientId] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  // Honor ``?tab=memory`` etc. on first mount so deep links from
  // MemoryOperationsSettings ("打开客户记忆") land directly on the
  // memory tab instead of overview.
  const [searchParams] = useSearchParams()
  const initialTab = ((): ClientDetailTab => {
    const raw = searchParams.get('tab')
    return raw === 'memory' || raw === 'contacts' || raw === 'projects' || raw === 'history' ? raw : 'overview'
  })()
  const [activeTab, setActiveTab] = useState<ClientDetailTab>(initialTab)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // AI summary state — used to live on the standalone /clients/:id/memory
  // page. Folded into the memory tab so "Open memory" stays inside the
  // client detail flow instead of jumping to a separate route.
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
    enabled: Boolean(validClientId && loadedClientId === id && memoryStatus?.has_memory && activeTab === 'memory'),
    errorMessage: isZh ? '加载客户摘要失败' : 'Failed to load client summary',
  })

  const fetchClient = useCallback(() => {
    const requestId = ++requestIdRef.current
    if (!validClientId) return Promise.resolve()
    return Promise.all([
        api.get<Client>(`/clients/${id}`),
        api.get<ClientMemoryStatusResponse>(`/clients/${id}/memory/status`),
        api.get<MemorySlotListResponse>(`/clients/${id}/memory/slots`),
        api.get<MemoryFactListResponse>(`/clients/${id}/memory/facts`),
        api.get<Project[]>(`/clients/${id}/projects`),
        api.get<ClientStakeholder[]>(`/clients/${id}/stakeholders`),
      ])
      .then(([clientData, memoryData, slotData, factData, projectsData, stakeholderData]) => {
        if (requestId !== requestIdRef.current) return
        setClient(clientData)
        setEditForm(clientData || {})
        setMemoryStatus(memoryData)
        setMemorySlots(slotData)
        setMemoryFacts(factData)
        setProjects(projectsData)
        setStakeholders(stakeholderData)
        setLoadedClientId(id || null)
      })
      .catch((error: unknown) => {
        if (requestId !== requestIdRef.current) return
        console.error('Failed to fetch client:', error)
        setClient(null)
        setEditForm({})
        setMemoryStatus(null)
        setMemorySlots(null)
        setMemoryFacts(null)
        setProjects([])
        setStakeholders([])
        setLoadedClientId(id || null)
      })
  }, [id, validClientId])

  useEffect(() => {
    void fetchClient()
  }, [fetchClient])

  const handleUpdate = async () => {
    if (!client) return
    try {
      const updated = await api.put<Client>(`/clients/${client.id}`, editForm)
      setClient(updated)
      setEditForm(updated)
      setIsEditing(false)
      setMemoryStatus((current) =>
        current
          ? {
              ...current,
              memory_stale: true,
            }
          : current,
      )
    } catch (error) {
      console.error('Failed to update client:', error)
    }
  }

  const handleDelete = () => {
    if (!client) return
    setDeleteConfirmOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!client) return
    setDeleting(true)
    try {
      await api.delete(`/clients/${client.id}`)
      navigate('/clients')
    } catch (error) {
      console.error('Failed to delete client:', error)
    } finally {
      setDeleting(false)
      setDeleteConfirmOpen(false)
    }
  }

  const handleRebuildMemory = async () => {
    if (!client) return
    try {
      setRebuildingMemory(true)
      const response = await api.post<ClientMemoryResponse>(`/clients/${client.id}/memory/rebuild`, {}, { timeout: 120000 })
      setMemoryStatus({
        client_id: client.id,
        has_memory: true,
        memory_version: response.memory_version,
        memory_stale: response.memory_stale,
        memory_updated_at: response.memory_updated_at,
      })
      const [slotData, factData] = await Promise.all([
        api.get<MemorySlotListResponse>(`/clients/${client.id}/memory/slots`),
        api.get<MemoryFactListResponse>(`/clients/${client.id}/memory/facts`),
      ])
      setMemorySlots(slotData)
      setMemoryFacts(factData)
    } catch (error) {
      console.error('Failed to rebuild client memory:', error)
    } finally {
      setRebuildingMemory(false)
    }
  }

  const handleStartClientSkill = (intent: 'strategy' | 'opportunity' | 'retrospective') => {
    if (!client) return
    const prompt = buildClientSkillPromptV2({
      client,
      intent,
      isZh,
      memoryStatus,
      projects,
    })
    const params = new URLSearchParams({
      client: String(client.id),
      clientName: client.name,
      q: prompt,
    })
    if (projects[0]?.id) {
      params.set('clientProject', String(projects[0].id))
    }
    navigate(`/skills?${params.toString()}`)
  }

  const memorySummary = useMemo(() => {
    if (!memoryStatus?.has_memory) {
      return isZh ? '当前还没有客户记忆，建议先生成一次用于后续跨项目复用。' : 'No client memory yet. Generate one to reuse client context across projects.'
    }
    if (memoryStatus.memory_stale) {
      return isZh ? '客户记忆已存在，但建议刷新后再继续分析或沉淀。' : 'Client memory exists, but it should be refreshed before further analysis or reuse.'
    }
    return isZh ? '客户记忆已同步，可直接用于跨项目洞察与复用。' : 'Client memory is up to date and ready for cross-project insights and reuse.'
  }, [isZh, memoryStatus])

  const memoryState = useMemo(() => getMemoryState(memoryStatus, isZh), [isZh, memoryStatus])
  const keyContacts = useMemo(() => getKeyContacts(client, stakeholders, isZh), [client, isZh, stakeholders])
  const stats = useMemo(() => getClientStats(projects, client, stakeholders, keyContacts, isZh), [client, isZh, keyContacts, projects, stakeholders])

  if (validClientId && loadedClientId !== id) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div className="theme-codex flex min-h-full items-center justify-center" style={{ background: 'var(--color-codex-bg)' }}>
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-codex-accent)' }} />
        </div>
      </>
    )
  }

  if (!validClientId || !client) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div
          className="theme-codex flex min-h-full items-center justify-center"
          style={{ background: 'var(--color-codex-bg)', color: 'var(--color-codex-ink)' }}
        >
          <div className="text-center">
            <p style={{ color: 'var(--color-codex-ink-mute)' }}>{isZh ? '未找到该客户' : 'Client not found'}</p>
            <button
              type="button"
              onClick={() => navigate('/clients')}
              style={{ marginTop: 16, color: 'var(--color-codex-accent)' }}
            >
              {isZh ? '返回客户列表' : 'Back to clients'}
            </button>
          </div>
        </div>
      </>
    )
  }

  const tabs: Array<{ key: ClientDetailTab; label: string }> = [
    { key: 'overview', label: isZh ? '概览' : 'Overview' },
    { key: 'memory', label: isZh ? '客户记忆' : 'Memory' },
    { key: 'contacts', label: isZh ? '联系人' : 'Contacts' },
    { key: 'projects', label: isZh ? '项目' : 'Projects' },
    { key: 'history', label: isZh ? '互动历史' : 'History' },
  ]

  return (
    <>
      <PageTitle title={client.name} />
      <main
        className="theme-codex min-h-full"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <div className="flex min-h-full flex-col overflow-hidden">
          <section style={{ padding: '22px clamp(24px, 4vw, 40px) 0', flexShrink: 0 }}>
            <div className="mb-2.5 flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
              <button
                type="button"
                onClick={() => navigate('/clients')}
                className="cx-no-hover inline-flex items-center gap-1"
                style={{ color: 'var(--color-codex-ink-faint)' }}
              >
                <ArrowLeft size={12} strokeWidth={1.5} aria-hidden="true" />
                {isZh ? '返回客户列表' : 'Back to clients'}
              </button>
              <span style={{ color: 'var(--color-codex-ink-faint)' }}>/</span>
              <span className="truncate">{getClientShortName(client.name)}</span>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 gap-4">
                <span
                  className="inline-flex shrink-0 items-center justify-center"
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 'var(--codex-r-md, 6px)',
                    background: 'var(--color-codex-accent-bg)',
                    color: 'var(--color-codex-accent-ink)',
                    fontSize: 22,
                    fontWeight: 500,
                  }}
                  aria-hidden="true"
                >
                  {getClientInitial(client.name)}
                </span>
                <div className="min-w-0">
                  <h1
                    className="truncate"
                    style={{
                      margin: 0,
                      fontSize: 24,
                      fontWeight: 500,
                      color: 'var(--color-codex-ink)',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {client.name}
                  </h1>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2.5" style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
                    <span>{client.industry || (isZh ? '未填写行业' : 'No industry')}</span>
                    <MetaDot />
                    <span>{inferRegion(client, isZh)}</span>
                    <MetaDot />
                    <span>{isZh ? `${client.document_count} 份文档` : `${client.document_count} docs`}</span>
                    <MetaDot />
                    <CxStatus tone={stats.healthTone}>{stats.healthLabel}</CxStatus>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <HeaderActionButton
                  onClick={() => setIsEditing((current) => !current)}
                  icon={isEditing ? <X size={13} strokeWidth={1.5} /> : <Edit2 size={13} strokeWidth={1.5} />}
                >
                  {isEditing ? (isZh ? '取消编辑' : 'Cancel') : isZh ? '编辑档案' : 'Edit profile'}
                </HeaderActionButton>
                <HeaderActionButton onClick={() => navigate('/projects/new')} icon={<Plus size={13} strokeWidth={1.5} />} primary>
                  {isZh ? '新建项目' : 'New project'}
                </HeaderActionButton>
                <HeaderActionButton onClick={handleDelete} icon={<Trash2 size={14} strokeWidth={1.5} />} danger iconOnly ariaLabel={isZh ? '删除客户' : 'Delete client'}>
                  {isZh ? '删除' : 'Delete'}
                </HeaderActionButton>
              </div>
            </div>
          </section>

          <nav
            className="flex overflow-x-auto"
            style={{
              padding: '0 clamp(24px, 4vw, 40px)',
              marginTop: 16,
              borderBottom: '1px solid var(--color-codex-line)',
              flexShrink: 0,
            }}
            aria-label={isZh ? '客户详情标签' : 'Client detail tabs'}
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    padding: '10px 12px',
                    fontSize: 13,
                    color: active ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-mute)',
                    fontWeight: active ? 500 : 400,
                    borderBottom: active ? '2px solid var(--color-codex-accent)' : '2px solid transparent',
                    marginBottom: -1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>

          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '22px clamp(24px, 4vw, 40px) 32px',
              minWidth: 0,
            }}
          >
            {isEditing ? (
              <EditClientPanel
                editForm={editForm}
                isZh={isZh}
                onCancel={() => {
                  setEditForm(client)
                  setIsEditing(false)
                }}
                onChange={setEditForm}
                onSave={handleUpdate}
              />
            ) : null}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-4">
                {activeTab === 'overview' ? (
                  <>
                    <StatsStrip stats={stats.items} />
                    <ClientMemorySummaryPanel
                      client={client}
                      isZh={isZh}
                      memoryState={memoryState}
                      memorySummary={memorySummary}
                      projects={projects}
                      onOpenMemory={() => setActiveTab('memory')}
                    />
                    <ProjectsPanel isZh={isZh} projects={projects} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} />
                  </>
                ) : null}

                {activeTab === 'memory' ? (
                  <ClientMemoryPanel
                    isZh={isZh}
                    memoryState={memoryState}
                    memoryStatus={memoryStatus}
                    memorySlots={memorySlots}
                    memoryFacts={memoryFacts}
                    memorySummary={memorySummary}
                    rebuildingMemory={rebuildingMemory}
                    onRefresh={handleRebuildMemory}
                    activeSummary={activeSummary}
                    summaryContent={summaryContent}
                    summaryError={summaryError}
                    summaryLoading={summaryLoading}
                    onChangeSummary={setActiveSummary}
                    onRefreshSummary={() => void refreshSummary(true)}
                  />
                ) : null}

                {activeTab === 'contacts' ? <ContactsReadOnlyPanel contacts={keyContacts} isZh={isZh} /> : null}

                {activeTab === 'projects' ? (
                  <ProjectsPanel isZh={isZh} projects={projects} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} expanded />
                ) : null}

                {activeTab === 'history' ? <RecentHistoryPanel client={client} isZh={isZh} projects={projects} /> : null}
              </div>

              <aside className="space-y-4">
                <KeyContactsPanel contacts={keyContacts} isZh={isZh} />
                <ClientSkillPanel isZh={isZh} onStart={handleStartClientSkill} />
                <RecentHistoryPanel client={client} compact isZh={isZh} projects={projects} />
              </aside>
            </div>
          </div>
        </div>
      </main>
      <CxConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => {
          if (!deleting) setDeleteConfirmOpen(false)
        }}
        onConfirm={() => void handleConfirmDelete()}
        tone="danger"
        title={isZh ? '删除该客户？' : 'Delete this client?'}
        description={
          isZh
            ? `${client?.name ?? ''} 的档案、关联记忆和对话指针都会一并清除。该操作不可撤销。`
            : `${client?.name ?? ''}'s profile, memory, and conversation references will be removed. This cannot be undone.`
        }
        confirmLabel={isZh ? '删除' : 'Delete'}
        cancelLabel={isZh ? '取消' : 'Cancel'}
        busy={deleting}
      />
    </>
  )
}

function StatsStrip({ stats }: { stats: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4"
      style={{
        padding: '16px 0',
        borderTop: '1px solid var(--color-codex-line)',
        borderBottom: '1px solid var(--color-codex-line)',
      }}
    >
      {stats.map((item, index) => (
        <div
          key={item.label}
          style={{
            padding: '0 20px',
            borderLeft: index > 0 ? '1px solid var(--color-codex-line-soft)' : 'none',
          }}
        >
          <div style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)', marginBottom: 5 }}>{item.label}</div>
          <span className="codex-mono codex-num" style={{ fontSize: 22, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function ClientMemorySummaryPanel({
  client,
  isZh,
  memoryState,
  memorySummary,
  onOpenMemory,
  projects,
}: {
  client: Client
  isZh: boolean
  memoryState: { label: string; tone: CxStatusTone; versionLabel: string }
  memorySummary: string
  onOpenMemory: () => void
  projects: Project[]
}) {
  const rows = [
    [isZh ? '客户背景' : 'Background', client.notes || (isZh ? '暂无备注，可补充客户背景、合作目标和关键风险。' : 'No notes yet. Add background, goals, and key risks.')],
    [isZh ? '行业与联系人' : 'Industry & contact', [client.industry || (isZh ? '未填写行业' : 'No industry'), client.contact || (isZh ? '未填写联系人' : 'No contact')].join(' · ')],
    [isZh ? '合作历史' : 'Project history', projects.length ? projects.slice(0, 3).map((project) => project.name).join(' · ') : isZh ? '暂无关联项目' : 'No related projects'],
    [isZh ? '记忆状态' : 'Memory state', memorySummary],
    [isZh ? '关注议题' : 'Focus topics', getFocusTopics(client, projects, isZh)],
  ]

  return (
    <CxPanel
      title={isZh ? '客户记忆摘要' : 'Client memory summary'}
      subtitle={memoryState.versionLabel}
      action={
        <button type="button" onClick={onOpenMemory} style={{ fontSize: 11.5, color: 'var(--color-codex-accent)' }}>
          {isZh ? '查看完整' : 'Open'} →
        </button>
      }
    >
      {rows.map(([label, value], index) => (
        <div
          key={label}
          className="grid gap-5"
          style={{
            gridTemplateColumns: '90px 1fr',
            padding: '10px 0',
            borderBottom: index === rows.length - 1 ? 'none' : '1px solid var(--color-codex-line-soft)',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>{label}</div>
          <div style={{ fontSize: 13.5, color: 'var(--color-codex-ink)', lineHeight: 1.65 }}>{value}</div>
        </div>
      ))}
    </CxPanel>
  )
}

function ProjectsPanel({
  expanded = false,
  isZh,
  onOpenProject,
  projects,
}: {
  expanded?: boolean
  isZh: boolean
  onOpenProject: (projectId: number) => void
  projects: Project[]
}) {
  const shownProjects = expanded ? projects : projects.slice(0, 5)

  return (
    <CxPanel
      title={isZh ? '进行中项目' : 'Related projects'}
      action={<span style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>{projects.length}</span>}
    >
      {shownProjects.length === 0 ? (
        <EmptyBlock icon={<FolderKanban size={22} />} title={isZh ? '暂无关联项目' : 'No projects yet'} />
      ) : (
        shownProjects.map((project, index) => {
          const status = getProjectStatus(project.status, isZh)
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpenProject(project.id)}
              className="row-hov cx-no-hover grid w-full text-left"
              style={{
                gridTemplateColumns: 'minmax(0,1fr) 90px 100px 14px',
                gap: 14,
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: index === shownProjects.length - 1 ? 'none' : '1px solid var(--color-codex-line-soft)',
              }}
            >
              <div className="truncate" style={{ fontSize: 13.5, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
                {project.name}
              </div>
              <CxStatus tone={status.tone}>{status.label}</CxStatus>
              <span className="codex-mono codex-num" style={{ fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>
                {project.contract_amount != null ? formatCurrency(project.contract_amount) : '—'}
              </span>
              <ArrowRight size={12} strokeWidth={1.5} style={{ color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" />
            </button>
          )
        })
      )}
    </CxPanel>
  )
}

function KeyContactsPanel({
  contacts,
  isZh,
}: {
  contacts: DisplayContact[]
  isZh: boolean
}) {
  return (
    <CxPanel title={isZh ? '关键联系人' : 'Key contacts'}>
      {contacts.length === 0 ? (
        <EmptyBlock icon={<User size={20} />} title={isZh ? '暂无联系人' : 'No contacts'} compact />
      ) : (
        contacts.slice(0, 5).map((contact, index) => (
          <div
            key={`${contact.name}-${index}`}
            className="flex items-center gap-2.5"
            style={{
              padding: '8px 0',
              borderBottom: index === Math.min(contacts.length, 5) - 1 ? 'none' : '1px solid var(--color-codex-line-soft)',
            }}
          >
            <span
              className="inline-flex shrink-0 items-center justify-center"
              style={{
                width: 26,
                height: 26,
                borderRadius: 'var(--codex-r-pill, 999px)',
                background: 'var(--color-codex-bg-tint)',
                color: 'var(--color-codex-ink-soft)',
                fontSize: 11.5,
                fontWeight: 500,
              }}
              aria-hidden="true"
            >
              {getClientInitial(contact.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate" style={{ fontSize: 12.5, color: 'var(--color-codex-ink)' }}>{contact.name}</div>
              <div className="truncate" style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}>{contact.role || contact.note}</div>
            </div>
            <span style={{ fontSize: 10.5, color: contact.recorded ? 'var(--color-codex-good)' : 'var(--color-codex-ink-faint)' }}>
              {contact.recorded ? (isZh ? '已记录' : 'Saved') : isZh ? '待补充' : 'Missing'}
            </span>
          </div>
        ))
      )}
    </CxPanel>
  )
}

function ContactsReadOnlyPanel({
  contacts,
  isZh,
}: {
  contacts: DisplayContact[]
  isZh: boolean
}) {
  return (
    <CxPanel
      title={isZh ? '联系人' : 'Contacts'}
      subtitle={isZh ? '只读展示客户侧关键联系人和沟通线索。' : 'Read-only view of client-side contacts and communication signals.'}
      action={<span style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>{isZh ? `${contacts.length} 人` : `${contacts.length} contacts`}</span>}
    >
      {contacts.length === 0 ? (
        <EmptyBlock icon={<User size={20} />} title={isZh ? '暂无联系人' : 'No contacts'} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div
            className="grid"
            style={{
              minWidth: 820,
              gridTemplateColumns: 'minmax(190px,1.4fr) minmax(120px,.9fr) minmax(100px,.75fr) minmax(100px,.75fr) minmax(120px,.85fr) minmax(150px,1fr)',
              gap: 14,
              padding: '8px 0 10px',
              fontSize: 11.5,
              color: 'var(--color-codex-ink-faint)',
              borderBottom: '1px solid var(--color-codex-line-soft)',
            }}
          >
            <span>{isZh ? '姓名 / 角色' : 'Name / role'}</span>
            <span>{isZh ? '组织层级' : 'Level'}</span>
            <span>{isZh ? '影响类型' : 'Influence'}</span>
            <span>{isZh ? '关系状态' : 'Relationship'}</span>
            <span>{isZh ? '联系方式' : 'Contact'}</span>
            <span>{isZh ? '最近动作' : 'Last action'}</span>
          </div>

          {contacts.map((contact, index) => (
            <div
              key={`${contact.name}-${index}`}
              className="grid"
              style={{
                minWidth: 820,
                gridTemplateColumns: 'minmax(190px,1.4fr) minmax(120px,.9fr) minmax(100px,.75fr) minmax(100px,.75fr) minmax(120px,.85fr) minmax(150px,1fr)',
                gap: 14,
                alignItems: 'center',
                padding: '13px 0',
                borderBottom: index === contacts.length - 1 ? 'none' : '1px solid var(--color-codex-line-soft)',
              }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="inline-flex shrink-0 items-center justify-center"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 'var(--codex-r-pill, 999px)',
                    background: 'var(--color-codex-accent-bg)',
                    color: 'var(--color-codex-accent-ink)',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                  aria-hidden="true"
                >
                  {getClientInitial(contact.name)}
                </span>
                <div className="min-w-0">
                  <div className="truncate" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-codex-ink)' }}>
                    {contact.name}
                  </div>
                  <div className="truncate" style={{ marginTop: 2, fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
                    {contact.role || contact.note}
                  </div>
                </div>
              </div>
              <CellText>{contact.level}</CellText>
              <CellText>{contact.influence}</CellText>
              <CellText>{contact.relationship}</CellText>
              <CellText muted={!contact.recorded}>{contact.contact}</CellText>
              <CellText>{contact.lastAction}</CellText>
            </div>
          ))}
        </div>
      )}
    </CxPanel>
  )
}

function CellText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className="truncate" style={{ fontSize: 12.5, color: muted ? 'var(--color-codex-ink-faint)' : 'var(--color-codex-ink-soft)' }}>
      {children}
    </div>
  )
}

function ClientSkillPanel({
  isZh,
  onStart,
}: {
  isZh: boolean
  onStart: (intent: 'strategy' | 'opportunity' | 'retrospective') => void
}) {
  const items: Array<{
    description: string
    icon: ReactNode
    intent: 'strategy' | 'opportunity' | 'retrospective'
    title: string
  }> = [
    {
      intent: 'strategy',
      icon: <MessageSquare size={15} strokeWidth={1.6} />,
      title: isZh ? '关系策略' : 'Relationship strategy',
      description: isZh ? '整理关键干系人、沟通节奏和下一次拜访重点。' : 'Map stakeholders, cadence, and the next meeting focus.',
    },
    {
      intent: 'opportunity',
      icon: <Sparkles size={15} strokeWidth={1.6} />,
      title: isZh ? '机会分析' : 'Opportunity analysis',
      description: isZh ? '基于客户背景和历史项目找潜在增购机会。' : 'Surface expansion opportunities from client history.',
    },
    {
      intent: 'retrospective',
      icon: <FileText size={15} strokeWidth={1.6} />,
      title: isZh ? '项目复盘' : 'Project retrospective',
      description: isZh ? '把项目经验整理成可复用的客户洞察。' : 'Turn project experience into reusable client insight.',
    },
  ]

  return (
    <CxPanel title={isZh ? '客户 Skill 工作流' : 'Client Skill workflows'}>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.intent}
            type="button"
            onClick={() => onStart(item.intent)}
            className="row-hov cx-no-hover flex w-full items-start gap-2.5 text-left"
            style={{
              padding: '10px 0',
              borderBottom: item.intent === 'retrospective' ? 'none' : '1px solid var(--color-codex-line-soft)',
            }}
          >
            <CodexIconTile className="mt-0.5">{item.icon}</CodexIconTile>
            <span className="min-w-0 flex-1">
              <span className="block" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-codex-ink)' }}>
                {item.title}
              </span>
              <span className="mt-0.5 block" style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-codex-ink-mute)' }}>
                {item.description}
              </span>
            </span>
            <ExternalLink size={12} strokeWidth={1.5} style={{ color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" />
          </button>
        ))}
      </div>
    </CxPanel>
  )
}

// Summary type labels for the AI summary tab switcher. Folded into the
// client detail memory tab; previously lived on the standalone
// /clients/:id/memory page.
const CLIENT_SUMMARY_TABS: Array<{ key: ClientMemorySummaryType; zh: string; en: string; descZh: string; descEn: string }> = [
  { key: 'overview', zh: 'AI 客户摘要', en: 'AI client summary', descZh: '快速理解这个客户是谁、合作方式如何。', descEn: 'Understand who this client is and how they work.' },
  { key: 'stakeholder', zh: 'AI 干系人摘要', en: 'AI stakeholder view', descZh: '聚焦联系人、决策方式和关系信号。', descEn: 'Focus on contacts, decision style, and relationship signals.' },
  { key: 'lessons', zh: 'AI 经验摘要', en: 'AI lessons learned', descZh: '沉淀未来项目最值得复用的经验。', descEn: 'Capture the lessons most worth reusing on future projects.' },
  { key: 'client-facing', zh: 'AI 客户沟通摘要', en: 'AI client-facing summary', descZh: '适合面向客户团队的表达方式。', descEn: 'Safer language for client-facing teams.' },
  { key: 'risk', zh: 'AI 客户风险摘要', en: 'AI client risk summary', descZh: '聚焦关系风险、决策摩擦和需要谨慎处理的话题。', descEn: 'Focus on relationship risks and decision friction.' },
  { key: 'opportunity', zh: 'AI 机会摘要', en: 'AI opportunity summary', descZh: '提炼扩展合作、追加项目和信任加深的机会。', descEn: 'Highlight growth opportunities and expansion signals.' },
  { key: 'relationship', zh: 'AI 关系摘要', en: 'AI relationship summary', descZh: '聚焦信任程度、沟通节奏和关键关系信号。', descEn: 'Focus on trust level, communication rhythm, and relationship signals.' },
  { key: 'delivery', zh: 'AI 交付准备摘要', en: 'AI delivery readiness', descZh: '提炼客户的交付偏好、执行摩擦和启动前准备重点。', descEn: 'Highlight delivery preferences, execution friction, and readiness signals.' },
]

const CLIENT_MEMORY_SLOT_LABELS: Record<string, { zh: string; en: string }> = {
  client_profile: { zh: '客户画像', en: 'Client profile' },
  decision_patterns: { zh: '决策模式', en: 'Decision patterns' },
  key_contacts: { zh: '关键联系人', en: 'Key contacts' },
  structured_stakeholders: { zh: '结构化干系人', en: 'Structured stakeholders' },
  lessons_learned: { zh: '经验沉淀', en: 'Lessons learned' },
  project_history: { zh: '项目历史', en: 'Project history' },
  sensitive_topics: { zh: '敏感话题', en: 'Sensitive topics' },
  relationship_signals: { zh: '关系信号', en: 'Relationship signals' },
}

function getClientMemorySlotLabel(slotKey: string, isZh: boolean) {
  const label = CLIENT_MEMORY_SLOT_LABELS[slotKey]
  return label ? (isZh ? label.zh : label.en) : slotKey
}

function ClientMemoryPanel({
  isZh,
  memoryState,
  memoryStatus,
  memorySlots,
  memoryFacts,
  memorySummary,
  onRefresh,
  rebuildingMemory,
  activeSummary,
  summaryContent,
  summaryError,
  summaryLoading,
  onChangeSummary,
  onRefreshSummary,
}: {
  isZh: boolean
  memoryState: { label: string; tone: CxStatusTone; versionLabel: string }
  memoryStatus: ClientMemoryStatusResponse | null
  memorySlots: MemorySlotListResponse | null
  memoryFacts: MemoryFactListResponse | null
  memorySummary: string
  onRefresh: () => void
  rebuildingMemory: boolean
  activeSummary: ClientMemorySummaryType
  summaryContent: string | null
  summaryError: string | null
  summaryLoading: boolean
  onChangeSummary: (next: ClientMemorySummaryType) => void
  onRefreshSummary: () => void
}) {
  const activeTab = CLIENT_SUMMARY_TABS.find((item) => item.key === activeSummary) ?? CLIENT_SUMMARY_TABS[0]
  const factsBySlot = new Map<string, MemoryFactListResponse['facts']>()
  for (const fact of memoryFacts?.facts ?? []) {
    const facts = factsBySlot.get(fact.slot_key) ?? []
    facts.push(fact)
    factsBySlot.set(fact.slot_key, facts)
  }
  return (
    <>
      <CxPanel
        title={isZh ? '客户记忆' : 'Client memory'}
        subtitle={memorySummary}
        action={<CxStatus tone={memoryState.tone}>{memoryState.label}</CxStatus>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCell label={isZh ? '状态' : 'Status'} value={memoryState.label} />
          <MetricCell label={isZh ? '版本' : 'Version'} value={memoryStatus?.memory_version != null ? `v${memoryStatus.memory_version}` : '—'} />
          <MetricCell
            label={isZh ? '最近同步' : 'Last sync'}
            value={
              memoryStatus?.memory_updated_at
                ? formatDateTime(memoryStatus.memory_updated_at, isZh ? 'zh-CN' : 'en-US', undefined, getResolvedAppTimeZone())
                : isZh
                  ? '暂无记录'
                  : 'Not yet'
            }
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLike onClick={onRefresh} icon={rebuildingMemory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw size={13} />}>
            {isZh ? '刷新记忆' : 'Refresh'}
          </ButtonLike>
        </div>
        {memorySlots?.slots.length ? (
          <div className="mt-4 space-y-2 border-t pt-4" style={{ borderColor: 'var(--color-codex-line-soft)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--color-codex-ink-mute)' }}>
              <span>{isZh ? '事实级记忆与真实来源' : 'Fact-level memory and real sources'}</span>
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                <span>
                  {isZh
                    ? `${memorySlots.slot_count - memorySlots.stale_slot_count} 槽位可用 · ${memorySlots.stale_slot_count} 待刷新`
                    : `${memorySlots.slot_count - memorySlots.stale_slot_count} slots ready · ${memorySlots.stale_slot_count} stale`}
                </span>
                {formatMemoryRebuildSummary(memorySlots, isZh) ? (
                  <span>{formatMemoryRebuildSummary(memorySlots, isZh)}</span>
                ) : null}
                {memorySlots.read_authority ? (
                  <span>
                    {isZh ? '读取权威：槽位账本' : 'Read authority: slot ledger'}
                    {memorySlots.read_authority.missing_slot_count +
                      memorySlots.read_authority.corrupt_slot_count >
                    0
                      ? (isZh
                          ? ` · ${memorySlots.read_authority.missing_slot_count + memorySlots.read_authority.corrupt_slot_count} 个账本异常`
                          : ` · ${memorySlots.read_authority.missing_slot_count + memorySlots.read_authority.corrupt_slot_count} ledger issues`)
                      : ''}
                    {memorySlots.read_authority.aggregate_business_slot_count > 0
                      ? (isZh
                          ? ` · ${memorySlots.read_authority.aggregate_business_slot_count} 个旧副本待清理`
                          : ` · ${memorySlots.read_authority.aggregate_business_slot_count} legacy copies pending cleanup`)
                      : ''}
                    {memorySlots.read_authority.divergent_slot_count > 0
                      ? (isZh
                          ? ` · ${memorySlots.read_authority.divergent_slot_count} 个旧副本差异`
                          : ` · ${memorySlots.read_authority.divergent_slot_count} legacy-copy differences`)
                      : ''}
                  </span>
                ) : null}
                {memoryFacts ? (
                  <span>
                    {isZh
                      ? `${memoryFacts.direct_fact_count ?? 0} 直连 · ${memoryFacts.matched_fact_count} 匹配 · ${memoryFacts.scoped_fact_count} 范围 · ${memoryFacts.unresolved_fact_count} 待补证`
                      : `${memoryFacts.direct_fact_count ?? 0} direct · ${memoryFacts.matched_fact_count} matched · ${memoryFacts.scoped_fact_count} scoped · ${memoryFacts.unresolved_fact_count} unresolved`}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {memorySlots.slots.map((slot) => (
                <div
                  key={slot.slot_key}
                  className="rounded-md border px-3 py-2"
                  style={{ borderColor: 'var(--color-codex-line-soft)', background: 'var(--color-codex-bg-tint)' }}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span style={{ color: 'var(--color-codex-ink)' }}>{getClientMemorySlotLabel(slot.slot_key, isZh)}</span>
                    <span style={{ color: slot.status === 'ready' ? 'var(--color-codex-good)' : 'var(--color-codex-warn)' }}>
                      v{slot.slot_version} · {slot.status === 'ready' ? (isZh ? '已验证' : 'verified') : slot.status === 'corrupt' ? (isZh ? '校验失败' : 'corrupt') : (isZh ? '待刷新' : 'stale')}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-5" style={{ color: 'var(--color-codex-ink-mute)' }}>
                    {slot.evidence_refs.length
                      ? slot.evidence_refs.slice(0, 3).map((source) => source.source_label).join(' · ')
                      : isZh ? '尚无可定位来源' : 'No locatable source yet'}
                    {slot.evidence_count > 3 ? ` +${slot.evidence_count - 3}` : ''}
                  </div>
                  {(factsBySlot.get(slot.slot_key) ?? []).slice(0, 3).map((fact) => (
                    <div
                      key={fact.fact_key}
                      className="mt-2 rounded border px-2 py-1.5 text-[11px]"
                      style={{ borderColor: 'var(--color-codex-line-soft)', background: 'var(--color-codex-bg)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-words" style={{ color: 'var(--color-codex-ink)' }}>
                          {fact.value_preview || (isZh ? '内容校验失败' : 'Content integrity check failed')}
                        </span>
                        <span
                          className="shrink-0"
                          style={{ color: fact.provenance_status === 'direct' || fact.provenance_status === 'matched' ? 'var(--color-codex-good)' : 'var(--color-codex-warn)' }}
                        >
                          {fact.provenance_status === 'direct'
                            ? (isZh ? '来源直连' : 'direct')
                            : fact.provenance_status === 'matched'
                            ? (isZh ? '来源匹配' : 'matched')
                            : fact.provenance_status === 'scoped'
                              ? (isZh ? '范围来源' : 'scoped')
                              : fact.provenance_status === 'legacy'
                                ? (isZh ? '历史聚合' : 'legacy')
                                : (isZh ? '待补证' : 'unresolved')}
                        </span>
                      </div>
                      {fact.evidence_refs.length ? (
                        <div className="mt-1" style={{ color: 'var(--color-codex-ink-mute)' }}>
                          {fact.evidence_refs.slice(0, 2).map((source) => (
                            source.relation === 'direct_source_id'
                              ? `${source.source_label} · #${source.source_id}`
                              : source.source_label
                          )).join(' · ')}
                          {fact.evidence_count > 2 ? ` +${fact.evidence_count - 2}` : ''}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {(factsBySlot.get(slot.slot_key)?.length ?? 0) > 3 ? (
                    <div className="mt-1 text-[11px]" style={{ color: 'var(--color-codex-ink-mute)' }}>
                      {isZh
                        ? `另有 ${(factsBySlot.get(slot.slot_key)?.length ?? 0) - 3} 条事实`
                        : `${(factsBySlot.get(slot.slot_key)?.length ?? 0) - 3} more facts`}
                    </div>
                  ) : null}
                  {slot.stale_reason ? (
                    <div className="mt-1 text-[11px]" style={{ color: 'var(--color-codex-warn)' }}>{slot.stale_reason}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CxPanel>

      <CxPanel
        title={isZh ? activeTab.zh : activeTab.en}
        subtitle={isZh ? activeTab.descZh : activeTab.descEn}
        action={
          <ButtonLike
            onClick={onRefreshSummary}
            icon={summaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw size={12} />}
          >
            {summaryContent ? (isZh ? '重新生成' : 'Regenerate') : isZh ? '生成摘要' : 'Generate'}
          </ButtonLike>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CLIENT_SUMMARY_TABS.map((tab) => {
            const isActive = tab.key === activeSummary
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onChangeSummary(tab.key)}
                className="transition-colors"
                style={{
                  padding: '5px 11px',
                  fontSize: 12,
                  color: isActive ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-ink-soft)',
                  background: isActive ? 'var(--color-codex-accent-bg)' : 'var(--color-codex-bg)',
                  border: `1px solid ${isActive ? 'var(--color-codex-accent)' : 'var(--color-codex-line)'}`,
                  borderRadius: 'var(--codex-r-pill, 999px)',
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {isZh ? tab.zh : tab.en}
              </button>
            )
          })}
        </div>
        <div
          style={{
            minHeight: 140,
            padding: '14px 16px',
            background: 'var(--color-codex-bg-tint)',
            border: '1px solid var(--color-codex-line-soft)',
            borderRadius: 'var(--codex-r-sm, 6px)',
            fontSize: 13.5,
            lineHeight: 1.75,
            color: 'var(--color-codex-ink)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {summaryLoading ? (
            <span className="inline-flex items-center gap-2" style={{ color: 'var(--color-codex-ink-mute)' }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {isZh ? '正在整理客户记忆摘要…' : 'Preparing client memory summary…'}
            </span>
          ) : summaryError ? (
            <span style={{ color: 'var(--color-codex-bad)' }}>{summaryError}</span>
          ) : summaryContent ? (
            summaryContent
          ) : (
            <span style={{ color: 'var(--color-codex-ink-mute)' }}>
              {memoryStatus?.has_memory
                ? isZh ? '点击「生成摘要」让 AI 输出该维度的总结。' : 'Click "Generate" to have the model produce this summary.'
                : isZh ? '先刷新一次客户记忆，再生成摘要。' : 'Refresh the client memory first, then generate a summary.'}
            </span>
          )}
        </div>
      </CxPanel>
    </>
  )
}

function RecentHistoryPanel({
  client,
  compact = false,
  isZh,
  projects,
}: {
  client: Client
  compact?: boolean
  isZh: boolean
  projects: Project[]
}) {
  const events = buildHistoryEvents(client, projects, isZh)
  return (
    <CxPanel title={isZh ? '最近互动' : 'Recent activity'}>
      <div style={{ fontSize: 12, color: 'var(--color-codex-ink-soft)', lineHeight: 1.85 }}>
        {events.slice(0, compact ? 4 : events.length).map((event, index) => (
          <div key={`${event.time}-${index}`} className="truncate">
            <span style={{ color: 'var(--color-codex-ink-mute)', marginRight: 6 }}>{event.time}</span>
            {event.label}
          </div>
        ))}
      </div>
    </CxPanel>
  )
}

function EditClientPanel({
  editForm,
  isZh,
  onCancel,
  onChange,
  onSave,
}: {
  editForm: Partial<Client>
  isZh: boolean
  onCancel: () => void
  onChange: (value: Partial<Client>) => void
  onSave: () => void
}) {
  return (
    <CxPanel
      title={isZh ? '编辑客户档案' : 'Edit client profile'}
      action={
        <div className="flex gap-1.5">
          <ButtonLike onClick={onCancel} icon={<X size={13} />}>
            {isZh ? '取消' : 'Cancel'}
          </ButtonLike>
          <ButtonLike onClick={onSave} icon={<Save size={13} />} primary>
            {isZh ? '保存' : 'Save'}
          </ButtonLike>
        </div>
      }
      className="mb-4"
    >
      <div className="grid gap-4">
        <FormField label={isZh ? '客户名称' : 'Client name'}>
          <CodexInput value={editForm.name || ''} onChange={(value) => onChange({ ...editForm, name: value })} />
        </FormField>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label={isZh ? '行业' : 'Industry'}>
            <CodexInput value={editForm.industry || ''} onChange={(value) => onChange({ ...editForm, industry: value })} />
          </FormField>
          <FormField label={isZh ? '联系人' : 'Contact'}>
            <CodexInput value={editForm.contact || ''} onChange={(value) => onChange({ ...editForm, contact: value })} />
          </FormField>
        </div>
        <FormField label={isZh ? '备注' : 'Notes'}>
          <textarea
            value={editForm.notes || ''}
            onChange={(event) => onChange({ ...editForm, notes: event.target.value })}
            rows={5}
            className="codex-input w-full resize-none"
            style={inputStyle}
          />
        </FormField>
      </div>
    </CxPanel>
  )
}

function MetricCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ padding: 12, border: '1px solid var(--color-codex-line-soft)', borderRadius: 'var(--codex-r-sm, 3px)' }}>
      <div style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--color-codex-ink)' }}>{value}</div>
    </div>
  )
}

function EmptyBlock({
  compact = false,
  icon,
  title,
}: {
  compact?: boolean
  icon: ReactNode
  title: string
}) {
  return (
    <div className="text-center" style={{ padding: compact ? '18px 8px' : '36px 16px', color: 'var(--color-codex-ink-mute)' }}>
      <div className="mb-2 flex justify-center">
        <CodexIconTile size={compact ? 32 : 40}>{icon}</CodexIconTile>
      </div>
      <div style={{ fontSize: 13 }}>{title}</div>
    </div>
  )
}

function CodexIconTile({
  children,
  className,
  size = 36,
}: {
  children: ReactNode
  className?: string
  size?: number
}) {
  return (
    <span
      className={['inline-flex shrink-0 items-center justify-center', className ?? ''].join(' ').trim()}
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--codex-r-sm, 3px)',
        background: 'var(--color-codex-accent-bg)',
        color: 'var(--color-codex-accent-ink)',
        border: '1px solid color-mix(in oklab, var(--color-codex-accent) 10%, transparent)',
      }}
      aria-hidden="true"
    >
      {children}
    </span>
  )
}

function FormField({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <label className="block">
      <div style={{ marginBottom: 6, fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>{label}</div>
      {children}
    </label>
  )
}

function CodexInput({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  return <input className="codex-input w-full" style={inputStyle} type="text" value={value} onChange={(event) => onChange(event.target.value)} />
}

function HeaderActionButton({
  ariaLabel,
  children,
  danger = false,
  icon,
  iconOnly = false,
  onClick,
  primary = false,
}: {
  ariaLabel?: string
  children: ReactNode
  danger?: boolean
  icon?: ReactNode
  iconOnly?: boolean
  onClick: () => void
  primary?: boolean
}) {
  const style = primary
    ? {
        background: 'var(--color-codex-ink)',
        color: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-ink)',
        fontWeight: 500,
      }
    : danger
      ? {
          background: 'transparent',
          color: 'color-mix(in oklab, var(--color-codex-bad) 78%, var(--color-codex-ink-soft))',
          border: '1px solid var(--color-codex-line)',
          fontWeight: 400,
        }
      : {
          background: 'transparent',
          color: 'var(--color-codex-ink-soft)',
          border: '1px solid var(--color-codex-line)',
          fontWeight: 400,
        }

  const height = 32

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5"
      aria-label={iconOnly ? ariaLabel : undefined}
      title={iconOnly && typeof children === 'string' ? children : undefined}
      style={{
        ...style,
        width: iconOnly ? height : undefined,
        height,
        padding: iconOnly ? 0 : primary ? '0 14px' : '0 12px',
        borderRadius: 'var(--codex-r-sm, 3px)',
        fontSize: 12.5,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
      }}
    >
      {icon ? (
        <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true" style={{ width: iconOnly ? 14 : 16 }}>
          {icon}
        </span>
      ) : null}
      {iconOnly ? <span className="sr-only">{children}</span> : <span>{children}</span>}
    </button>
  )
}

function ButtonLike({
  children,
  danger = false,
  icon,
  onClick,
  primary = false,
}: {
  children: ReactNode
  danger?: boolean
  icon?: ReactNode
  onClick: () => void
  primary?: boolean
}) {
  const style = primary
    ? {
        background: 'var(--color-codex-ink)',
        color: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-ink)',
      }
    : danger
      ? {
          background: 'var(--color-codex-bg-elev)',
          color: 'var(--color-codex-bad)',
          border: '1px solid color-mix(in oklab, var(--color-codex-bad) 24%, var(--color-codex-line))',
        }
      : {
          background: 'var(--color-codex-bg-elev)',
          color: 'var(--color-codex-ink-soft)',
          border: '1px solid var(--color-codex-line)',
        }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5"
      style={{
        ...style,
        padding: '7px 12px',
        borderRadius: 'var(--codex-r-sm, 3px)',
        fontSize: 12.5,
        whiteSpace: 'nowrap',
      }}
    >
      {icon ? <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  )
}

function MetaDot() {
  return <span style={{ color: 'var(--color-codex-ink-faint)' }}>·</span>
}

const inputStyle = {
  padding: '8px 10px',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  background: 'var(--color-codex-bg-elev)',
  color: 'var(--color-codex-ink)',
  fontSize: 13,
} as const

function buildClientSkillPromptV2({
  client,
  intent,
  isZh,
  memoryStatus,
  projects,
}: {
  client: Client
  intent: 'strategy' | 'opportunity' | 'retrospective'
  isZh: boolean
  memoryStatus: ClientMemoryStatusResponse | null
  projects: Project[]
}) {
  const projectLines = projects.length
    ? projects.slice(0, 8).map((project) => `- ${project.name} (${project.status || 'unknown'})`).join('\n')
    : isZh
      ? '- 暂无关联项目'
      : '- No related projects yet'
  const memoryState = !memoryStatus?.has_memory
    ? isZh
      ? '尚未生成客户记忆'
      : 'Client memory has not been generated'
    : memoryStatus.memory_stale
      ? isZh
        ? `客户记忆需要刷新，当前版本 ${memoryStatus.memory_version ?? 'N/A'}`
        : `Client memory needs refresh, current version ${memoryStatus.memory_version ?? 'N/A'}`
      : isZh
        ? `客户记忆可用，当前版本 ${memoryStatus.memory_version ?? 'N/A'}`
        : `Client memory is ready, current version ${memoryStatus.memory_version ?? 'N/A'}`

  const intentInstruction = {
    strategy: isZh
      ? '请基于该客户档案，为我生成一份客户关系策略，包含关键关系判断、下一次沟通目标、风险提醒和 3 条可执行跟进动作。'
      : 'Please generate a client relationship strategy with relationship judgment, next communication goals, risks, and 3 concrete follow-up actions.',
    opportunity: isZh
      ? '请基于该客户档案和关联项目，分析潜在增购、交叉销售或新项目机会，并按优先级给出推进建议。'
      : 'Please analyze expansion, cross-sell, or new-project opportunities from this client profile and project history, then prioritize next moves.',
    retrospective: isZh
      ? '请基于该客户的关联项目，提炼可复用经验、客户偏好、交付注意事项，以及后续项目的启动建议。'
      : 'Please extract reusable lessons, client preferences, delivery caveats, and start recommendations for future projects from this client history.',
  }[intent]

  if (!isZh) {
    return `${intentInstruction}

Client context:
- Name: ${client.name}
- Industry: ${client.industry || 'Not provided'}
- Contact: ${client.contact || 'Not provided'}
- Notes: ${client.notes || 'Not provided'}
- Memory status: ${memoryState}

Related projects:
${projectLines}

Please use the client context first. If information is missing, state assumptions clearly and suggest what to capture next.`
  }

  return `${intentInstruction}

客户上下文：
- 客户名称：${client.name}
- 行业：${client.industry || '未填写'}
- 联系人：${client.contact || '未填写'}
- 备注：${client.notes || '未填写'}
- 记忆状态：${memoryState}

关联项目：
${projectLines}

请优先使用客户上下文。如果信息不足，请明确你的假设，并指出下一步应该补充哪些客户信息。`
}

function getClientStats(projects: Project[], client: Client | null, stakeholders: ClientStakeholder[], keyContacts: Array<{ name: string }>, isZh: boolean) {
  const signedProjectCount = projects.filter((project) => isSignedProject(project.status)).length
  const totalAmount = projects.reduce((sum, project) => sum + (project.contract_amount ?? 0), 0)
  const hasActiveProjects = projects.some((project) => getProjectStatus(project.status, isZh).tone === 'good')
  const healthTone: CxStatusTone = hasActiveProjects ? 'good' : projects.length ? 'warn' : 'mute'
  const healthLabel = hasActiveProjects
    ? isZh
      ? '活跃'
      : 'Active'
    : projects.length
      ? isZh
        ? '关注'
        : 'Watch'
      : isZh
        ? '沉睡'
        : 'Dormant'

  return {
    healthLabel,
    healthTone,
    items: [
      { label: isZh ? '进行中项目' : 'Active projects', value: projects.length },
      { label: isZh ? '签约项目' : 'Signed projects', value: signedProjectCount },
      { label: isZh ? '累计金额' : 'Total value', value: totalAmount ? formatCurrency(totalAmount) : '—' },
      { label: isZh ? '关联联系人' : 'Contacts', value: Math.max(stakeholders.length, keyContacts.length, client?.contact ? 1 : 0) },
    ],
  }
}

function getMemoryState(memoryStatus: ClientMemoryStatusResponse | null, isZh: boolean) {
  if (!memoryStatus?.has_memory) {
    return {
      label: isZh ? '尚未生成' : 'Not prepared',
      tone: 'mute' as CxStatusTone,
      versionLabel: isZh ? '尚未生成客户记忆' : 'No client memory yet',
    }
  }
  if (memoryStatus.memory_stale) {
    return {
      label: isZh ? '建议刷新' : 'Needs refresh',
      tone: 'warn' as CxStatusTone,
      versionLabel: `v${memoryStatus.memory_version ?? '—'} · ${isZh ? '建议刷新' : 'Needs refresh'}`,
    }
  }
  return {
    label: isZh ? '可直接使用' : 'Ready',
    tone: 'good' as CxStatusTone,
    versionLabel: `v${memoryStatus.memory_version ?? '—'} · ${isZh ? '已同步' : 'Synced'}`,
  }
}

function getProjectStatus(status: string, isZh: boolean): { label: string; tone: CxStatusTone } {
  const normalized = status.toLowerCase()
  if (['active', 'in_progress', 'delivery', 'ongoing'].includes(normalized)) {
    return { label: isZh ? '推进中' : 'Active', tone: 'good' }
  }
  if (['lead', 'lead_discovery', 'opportunity', 'proposal'].includes(normalized)) {
    return { label: isZh ? '机会期' : 'Lead', tone: 'warn' }
  }
  if (isSignedProject(status)) {
    return { label: isZh ? '已签约' : 'Signed', tone: 'accent' }
  }
  if (['cancelled', 'lost', 'archived'].includes(normalized)) {
    return { label: isZh ? '已归档' : 'Archived', tone: 'mute' }
  }
  return { label: status || (isZh ? '未标记' : 'Unknown'), tone: 'neutral' }
}

function isSignedProject(status: string) {
  return ['signed', 'won', 'completed', 'delivered', 'closed'].includes(status.toLowerCase())
}

function getKeyContacts(client: Client | null, stakeholders: ClientStakeholder[], isZh: boolean): DisplayContact[] {
  if (stakeholders.length > 0) {
    return stakeholders.map((stakeholder) => ({
      contact: stakeholder.contact || (isZh ? '未记录' : 'Not recorded'),
      influence: stakeholder.influence_type || (isZh ? '未记录' : 'Unknown'),
      lastAction: stakeholder.last_action || stakeholder.note || (isZh ? '暂无记录' : 'No record'),
      level: stakeholder.organization_level || (isZh ? '未记录' : 'Unknown'),
      name: stakeholder.name || (isZh ? '未命名联系人' : 'Unnamed contact'),
      note: stakeholder.contact || stakeholder.last_action || stakeholder.note || '',
      recorded: Boolean(stakeholder.contact || stakeholder.note),
      relationship: stakeholder.relationship_status || (isZh ? '未记录' : 'Unknown'),
      role: stakeholder.role || stakeholder.organization_level || (isZh ? '未记录角色' : 'Unknown role'),
    }))
  }
  if (client?.contact) {
    return [
      {
        contact: client.contact,
        influence: isZh ? '未记录' : 'Unknown',
        lastAction: isZh ? '来自客户基础档案' : 'From client profile',
        level: isZh ? '未记录' : 'Unknown',
        name: client.contact.split(/[、,，/]/)[0]?.trim() || client.contact,
        note: client.contact,
        recorded: true,
        relationship: isZh ? '未记录' : 'Unknown',
        role: isZh ? '主要联系人' : 'Primary contact',
      },
    ]
  }
  return []
}

function getFocusTopics(client: Client, projects: Project[], isZh: boolean) {
  const projectNames = projects.map((project) => project.name).filter(Boolean)
  if (projectNames.length > 0) return projectNames.slice(0, 4).join(' · ')
  if (client.notes) return client.notes.slice(0, 80)
  return isZh ? '待补充客户关注议题' : 'Focus topics to be captured'
}

function buildHistoryEvents(client: Client, projects: Project[], isZh: boolean) {
  const events = []
  if (client.client_memory_updated_at) {
    events.push({
      time: formatDateOnly(client.client_memory_updated_at, { month: 'short', day: 'numeric' }, getResolvedAppTimeZone()),
      label: isZh ? '客户记忆刷新' : 'Client memory refreshed',
    })
  }
  projects.slice(0, 3).forEach((project) => {
    events.push({
      time: getProjectStatus(project.status, isZh).label,
      label: project.name,
    })
  })
  events.push({
    time: formatDateOnly(client.created_at, { month: 'short', day: 'numeric' }, getResolvedAppTimeZone()),
    label: isZh ? '创建客户档案' : 'Client record created',
  })
  return events
}

function inferRegion(client: Client, isZh: boolean) {
  const text = `${client.name} ${client.notes}`.toLowerCase()
  const regionHints: Array<[RegExp, string, string]> = [
    [/北京|beijing/, '北京', 'Beijing'],
    [/上海|shanghai/, '上海', 'Shanghai'],
    [/广州|guangzhou/, '广州', 'Guangzhou'],
    [/深圳|shenzhen/, '深圳', 'Shenzhen'],
    [/杭州|hangzhou/, '杭州', 'Hangzhou'],
    [/成都|chengdu/, '成都', 'Chengdu'],
    [/香港|hong kong|hk/, '香港', 'Hong Kong'],
  ]
  const match = regionHints.find(([pattern]) => pattern.test(text))
  if (match) return isZh ? match[1] : match[2]
  return isZh ? '未记录' : 'Unknown'
}

function getClientShortName(name: string) {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) return '-'
  const firstPart = clean.split(/[·|｜\-—]/)[0]?.trim() || clean
  if (/[\u4e00-\u9fff]/.test(firstPart)) return Array.from(firstPart).slice(0, 6).join('')
  return firstPart.split(' ').slice(0, 2).join(' ')
}

function getClientInitial(name: string) {
  const short = getClientShortName(name)
  const length = /[\u4e00-\u9fff]/.test(short) ? 1 : 2
  return Array.from(short).slice(0, length).join('').toUpperCase()
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    currency: 'CNY',
    currencyDisplay: 'code',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value)
}
