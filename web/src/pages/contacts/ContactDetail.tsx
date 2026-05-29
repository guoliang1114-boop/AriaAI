import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Edit2,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'

import { api } from '../../api/client'
import { CxSkeleton, CxStatus, CxTopProgress, type CxStatusTone } from '../../components/codex'
import { PageTitle } from '../../components/PageTitle'
import type { ClientStakeholder } from '../../types/api'
import { formatDateOnly, parseAppDateTime } from '../../utils/timezone'

interface ClientListItem {
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

interface ClientProjectSummary {
  id: number
  name: string
  status: string
  contract_amount?: number
  memory_version?: number
  memory_stale?: boolean
}

interface StakeholderHistoryEntry {
  id: number
  field_name: string
  old_value: string
  new_value: string
  trigger: string
  changed_at: string | null
}

interface ContactRecord {
  client: ClientListItem
  stakeholder: ClientStakeholder
}

type ContactDetailTab = 'overview' | 'history' | 'projects' | 'notes'
type ContactLevel = 'decision' | 'influence' | 'execution'

const TABS: Array<{ key: ContactDetailTab; zh: string; en: string }> = [
  { key: 'overview', zh: '概览', en: 'Overview' },
  { key: 'history', zh: '接触历史', en: 'Touchpoints' },
  { key: 'projects', zh: '相关项目', en: 'Projects' },
  { key: 'notes', zh: '备注', en: 'Notes' },
]

const TOUCHPOINT_LIMIT = 6

export function ContactDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const contactId = Number(id)

  const [record, setRecord] = useState<ContactRecord | null>(null)
  const [clientContacts, setClientContacts] = useState<ClientStakeholder[]>([])
  const [projects, setProjects] = useState<ClientProjectSummary[]>([])
  const [history, setHistory] = useState<StakeholderHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ContactDetailTab>('overview')
  const [editing, setEditing] = useState(false)
  const [touchpointOpen, setTouchpointOpen] = useState(false)
  const [editDraft, setEditDraft] = useState<ContactEditDraft | null>(null)
  const [touchpointDraft, setTouchpointDraft] = useState({ title: '', summary: '' })

  const loadContact = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const clients = await api.get<ClientListItem[]>('/clients')
      const clientList = Array.isArray(clients) ? clients : []

      for (const client of clientList) {
        const stakeholdersResponse = await api.get<ClientStakeholder[]>(`/clients/${client.id}/stakeholders`)
        const stakeholders = Array.isArray(stakeholdersResponse) ? stakeholdersResponse : []
        const found = stakeholders.find((stakeholder) => stakeholder.id === contactId)

        if (found) {
          const [clientProjects, stakeholderHistory] = await Promise.all([
            api.get<ClientProjectSummary[]>(`/clients/${client.id}/projects`).catch(() => []),
            api.get<StakeholderHistoryEntry[]>(`/clients/${client.id}/stakeholders/${found.id}/history`).catch(() => []),
          ])

          setRecord({ client, stakeholder: found })
          setClientContacts(stakeholders)
          setProjects(Array.isArray(clientProjects) ? clientProjects : [])
          setHistory(Array.isArray(stakeholderHistory) ? stakeholderHistory : [])
          setEditDraft(buildEditDraft(found))
          setLoading(false)
          return
        }
      }

      setRecord(null)
      setError(isZh ? '没有找到这个联系人' : 'Contact not found')
    } catch {
      setError(isZh ? '联系人详情加载失败' : 'Failed to load contact detail')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!Number.isFinite(contactId)) {
      setError(isZh ? '联系人 ID 无效' : 'Invalid contact id')
      setLoading(false)
      return
    }
    void loadContact()
  }, [contactId])

  const relatedContacts = useMemo(
    () => clientContacts.filter((item) => record && item.id !== record.stakeholder.id).slice(0, 5),
    [clientContacts, record],
  )

  const relatedProjects = useMemo(() => normalizeProjects(record?.client, projects), [projects, record?.client])

  const updateStakeholder = async (payload: Partial<ClientStakeholder>) => {
    if (!record) return null
    const updated = await api.put<ClientStakeholder>(`/clients/${record.client.id}/stakeholders/${record.stakeholder.id}`, payload)
    setRecord({ ...record, stakeholder: updated })
    setClientContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    setEditDraft(buildEditDraft(updated))
    return updated
  }

  const analyze = async () => {
    if (!record) return
    setAnalyzing(true)
    setError(null)
    try {
      const updated = await api.post<ClientStakeholder>(
        `/clients/${record.client.id}/stakeholders/${record.stakeholder.id}/analyze`,
        {
          linkedin_info: record.stakeholder.note || record.stakeholder.contact || '',
          focus: isZh ? '请按联系人详情页画像字段重新生成角色影响、沟通偏好、关注重点和敏感点。' : 'Regenerate role influence, communication preference, concerns, and sensitivities for the contact detail page.',
        },
      )
      setRecord({ ...record, stakeholder: updated })
      setClientContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setEditDraft(buildEditDraft(updated))
    } catch {
      setError(isZh ? 'AI 分析失败，请稍后重试' : 'AI analysis failed. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editDraft) return
    setSaving(true)
    setError(null)
    try {
      await updateStakeholder(editDraft)
      setEditing(false)
      await loadContact({ silent: true })
    } catch {
      setError(isZh ? '联系人保存失败' : 'Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  const saveTouchpoint = async (event: FormEvent) => {
    event.preventDefault()
    const summary = touchpointDraft.summary.trim()
    if (!summary) return
    setSaving(true)
    setError(null)
    try {
      const title = touchpointDraft.title.trim()
      const value = title ? `${title}：${summary}` : summary
      await updateStakeholder({ last_action: value })
      setTouchpointOpen(false)
      setTouchpointDraft({ title: '', summary: '' })
      await loadContact({ silent: true })
    } catch {
      setError(isZh ? '接触记录保存失败' : 'Failed to save touchpoint')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <ContactDetailLoading isZh={isZh} />
  }

  if (!record) {
    return <ContactNotFound error={error} isZh={isZh} onBack={() => navigate('/contacts')} />
  }

  const { client, stakeholder } = record
  const level = getContactLevel(stakeholder)
  const levelInfo = levelMeta(level, isZh)
  const methods = parseContactMethods(stakeholder.contact)
  const profileRows = buildProfileRows(stakeholder, isZh, levelInfo.label)
  const activities = buildActivities(stakeholder, history, isZh)

  return (
    <>
      <PageTitle title={`${stakeholder.name} · ${isZh ? '联系人详情' : 'Contact Detail'}`} />
      <main
        className="theme-codex min-h-full"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        {refreshing ? <CxTopProgress /> : null}
        <div style={{ padding: '32px clamp(24px, 4vw, 56px) 40px', minWidth: 0 }}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <RouterLink
              to="/contacts"
              className="cx-no-hover inline-flex items-center gap-1.5"
              style={{ color: 'var(--color-codex-ink-mute)', fontSize: 12.5 }}
            >
              <ArrowLeft size={13} strokeWidth={1.5} aria-hidden="true" />
              {isZh ? '联系人' : 'Contacts'}
              <span style={{ color: 'var(--color-codex-ink-faint)' }}>/</span>
              <span style={{ color: 'var(--color-codex-ink-soft)' }}>{stakeholder.name}</span>
            </RouterLink>
            <button
              type="button"
              onClick={() => void loadContact({ silent: true })}
              disabled={refreshing}
              className="cx-no-hover inline-flex items-center gap-1.5"
              style={{ color: 'var(--color-codex-ink-mute)', fontSize: 12.5 }}
            >
              <RefreshCw size={13} strokeWidth={1.5} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
              {isZh ? '同步' : 'Sync'}
            </button>
          </div>

          <header
            className="flex flex-col gap-6 border-b lg:flex-row lg:items-end lg:justify-between"
            style={{ borderColor: 'var(--color-codex-line)', paddingBottom: 28 }}
          >
            <div className="flex min-w-0 items-start gap-4">
              <Avatar name={stakeholder.name} size={56} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1
                    className="truncate"
                    style={{
                      margin: 0,
                      fontSize: 28,
                      fontWeight: 500,
                      letterSpacing: '-0.02em',
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {stakeholder.name || (isZh ? '未命名联系人' : 'Unnamed contact')}
                  </h1>
                  <CxStatus tone={levelInfo.tone}>{levelInfo.label}</CxStatus>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--color-codex-ink-mute)' }}>
                  {[stakeholder.role, client.name, formatRecentTouch(stakeholder, isZh)].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setEditing(true)} className="cx-no-hover inline-flex items-center gap-1.5" style={ghostButtonStyle}>
                <Edit2 size={13} strokeWidth={1.5} aria-hidden="true" />
                {isZh ? '编辑' : 'Edit'}
              </button>
              <button type="button" onClick={() => setTouchpointOpen(true)} className="cx-primary-action cx-no-hover" style={{ height: 38, padding: '0 14px' }}>
                <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
                {isZh ? '记一次接触' : 'Log touchpoint'}
              </button>
            </div>
          </header>

          <nav className="flex gap-6 border-b" style={{ borderColor: 'var(--color-codex-line)', marginBottom: 24 }}>
            {TABS.map((tab) => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className="cx-no-hover"
                  style={{
                    padding: '16px 0 14px',
                    borderBottom: active ? '1px solid var(--color-codex-accent)' : '1px solid transparent',
                    color: active ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-mute)',
                    fontWeight: active ? 500 : 400,
                    fontSize: 13,
                  }}
                >
                  {isZh ? tab.zh : tab.en}
                </button>
              )
            })}
          </nav>

          {error ? (
            <div
              style={{
                marginBottom: 18,
                padding: '10px 12px',
                border: '1px solid color-mix(in oklab, var(--color-codex-bad) 24%, var(--color-codex-line))',
                borderRadius: 'var(--codex-r-sm, 3px)',
                color: 'var(--color-codex-bad)',
                background: 'color-mix(in oklab, var(--color-codex-bad) 7%, var(--color-codex-bg-elev))',
              }}
            >
              {error}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {activeTab === 'overview' ? (
                <OverviewTab
                  activities={activities}
                  analyzing={analyzing}
                  isZh={isZh}
                  methods={methods}
                  onAnalyze={() => void analyze()}
                  onShowHistory={() => setActiveTab('history')}
                  profileRows={profileRows}
                />
              ) : null}

              {activeTab === 'history' ? <HistoryTab activities={activities} isZh={isZh} /> : null}

              {activeTab === 'projects' ? <ProjectsTab isZh={isZh} projects={relatedProjects} /> : null}

              {activeTab === 'notes' ? <NotesTab isZh={isZh} stakeholder={stakeholder} /> : null}
            </div>

            <ContactSideRail
              client={client}
              isZh={isZh}
              levelInfo={levelInfo}
              onOpenClient={() => navigate(`/clients/${client.id}`)}
              projects={relatedProjects}
              relatedContacts={relatedContacts}
              stakeholder={stakeholder}
            />
          </div>
        </div>
      </main>

      {editing && editDraft ? (
        <EditContactDialog
          draft={editDraft}
          isZh={isZh}
          onChange={setEditDraft}
          onClose={() => setEditing(false)}
          onSubmit={saveEdit}
          saving={saving}
        />
      ) : null}

      {touchpointOpen ? (
        <TouchpointDialog
          draft={touchpointDraft}
          isZh={isZh}
          onChange={setTouchpointDraft}
          onClose={() => setTouchpointOpen(false)}
          onSubmit={saveTouchpoint}
          saving={saving}
        />
      ) : null}
    </>
  )
}

function OverviewTab({
  activities,
  analyzing,
  isZh,
  methods,
  onAnalyze,
  onShowHistory,
  profileRows,
}: {
  activities: ActivityItem[]
  analyzing: boolean
  isZh: boolean
  methods: ContactMethods
  onAnalyze: () => void
  onShowHistory: () => void
  profileRows: Array<{ label: string; value: string }>
}) {
  return (
    <div className="grid gap-5">
      <Panel title={isZh ? '联系方式' : 'Contact methods'}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ContactMethod icon={<Phone size={14} strokeWidth={1.5} />} label={isZh ? '手机' : 'Mobile'} value={methods.mobile} />
          <ContactMethod icon={<Mail size={14} strokeWidth={1.5} />} label={isZh ? '邮箱' : 'Email'} value={methods.email} />
          <ContactMethod icon={<MessageCircle size={14} strokeWidth={1.5} />} label={isZh ? '微信' : 'WeChat'} value={methods.wechat} />
          <ContactMethod icon={<Phone size={14} strokeWidth={1.5} />} label={isZh ? '办公电话' : 'Office'} value={methods.office} />
        </div>
      </Panel>

      <Panel
        title={isZh ? '干系人画像' : 'Stakeholder profile'}
        subtitle={isZh ? '基于客户记忆 + 接触历史自动汇总' : 'Generated from client memory and touchpoints'}
        action={
          <button type="button" onClick={onAnalyze} disabled={analyzing} className="cx-no-hover inline-flex items-center gap-1.5" style={ghostButtonStyle}>
            {analyzing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Sparkles size={13} strokeWidth={1.5} aria-hidden="true" />}
            {isZh ? '重新生成' : 'Regenerate'}
          </button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {profileRows.map((row) => (
            <ProfileBlock key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
      </Panel>

      <Panel
        title={isZh ? '最近接触' : 'Recent touchpoints'}
        action={
          <button type="button" onClick={onShowHistory} className="cx-no-hover inline-flex items-center gap-1.5" style={{ color: 'var(--color-codex-accent)', fontSize: 12.5 }}>
            {isZh ? '全部' : 'All'}
            <ArrowRight size={12} strokeWidth={1.5} aria-hidden="true" />
          </button>
        }
      >
        <ActivityTimeline activities={activities.slice(0, 3)} emptyText={isZh ? '暂无接触记录。先记录一次客户接触。' : 'No touchpoints yet. Log the first one.'} />
      </Panel>
    </div>
  )
}

function HistoryTab({ activities, isZh }: { activities: ActivityItem[]; isZh: boolean }) {
  return (
    <Panel
      title={isZh ? '接触历史' : 'Touchpoint history'}
      subtitle={isZh ? '当前版本先合并展示最近接触与联系人档案变更。' : 'This version combines recent touchpoints with contact profile updates.'}
    >
      <ActivityTimeline activities={activities} emptyText={isZh ? '暂无接触历史。' : 'No touchpoint history yet.'} />
    </Panel>
  )
}

function ProjectsTab({ isZh, projects }: { isZh: boolean; projects: ClientProjectSummary[] }) {
  return (
    <Panel title={isZh ? '相关项目' : 'Related projects'}>
      <div className="grid gap-2">
        {projects.length ? (
          projects.map((project) => <ProjectRow key={project.id} isZh={isZh} project={project} />)
        ) : (
          <EmptyState text={isZh ? '暂无相关项目。' : 'No related projects yet.'} />
        )}
      </div>
    </Panel>
  )
}

function NotesTab({ isZh, stakeholder }: { isZh: boolean; stakeholder: ClientStakeholder }) {
  const notes = [
    { label: isZh ? '备注' : 'Notes', value: stakeholder.note },
    { label: isZh ? '沟通策略' : 'Communication strategy', value: stakeholder.communication_strategy },
    { label: isZh ? '信任 / 风险信号' : 'Trust / risk signals', value: stakeholder.trust_signals },
    { label: isZh ? '下一步动作' : 'Next action', value: stakeholder.last_action },
  ]

  return (
    <Panel title={isZh ? '备注' : 'Notes'}>
      <div className="grid gap-4 lg:grid-cols-2">
        {notes.map((item) => (
          <ProfileBlock key={item.label} label={item.label} value={item.value || (isZh ? '未记录' : 'Not recorded')} />
        ))}
      </div>
    </Panel>
  )
}

function ContactSideRail({
  client,
  isZh,
  levelInfo,
  onOpenClient,
  projects,
  relatedContacts,
  stakeholder,
}: {
  client: ClientListItem
  isZh: boolean
  levelInfo: { label: string; tone: CxStatusTone }
  onOpenClient: () => void
  projects: ClientProjectSummary[]
  relatedContacts: ClientStakeholder[]
  stakeholder: ClientStakeholder
}) {
  const influence = influenceScore(stakeholder)
  return (
    <aside className="grid gap-5 content-start">
      <Panel title={isZh ? '所属客户' : 'Client'}>
        <button type="button" onClick={onOpenClient} className="row-hov w-full text-left" style={{ padding: 0, color: 'inherit' }}>
          <div className="flex items-center gap-3">
            <Avatar name={client.name} size={38} />
            <div className="min-w-0 flex-1">
              <div className="truncate" style={{ fontSize: 13.5, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
                {client.name}
              </div>
              <div className="truncate" style={{ marginTop: 3, fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
                {[client.industry || (isZh ? '行业未记录' : 'Industry missing'), isZh ? '地区未记录' : 'Region missing', `${projects.length || client.project_names?.length || 0} ${isZh ? '个项目' : 'projects'}`].join(' · ')}
              </div>
            </div>
            <ArrowRight size={12} strokeWidth={1.5} style={{ color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" />
          </div>
        </button>
      </Panel>

      <Panel title={isZh ? '相关项目' : 'Related projects'}>
        <div className="grid gap-2">
          {projects.slice(0, 3).map((project) => (
            <ProjectRow key={project.id} compact isZh={isZh} project={project} />
          ))}
          {!projects.length ? <EmptyState text={isZh ? '暂无相关项目。' : 'No related projects yet.'} /> : null}
        </div>
      </Panel>

      <Panel title={isZh ? '决策角色' : 'Decision role'}>
        <div className="grid gap-4">
          <MetricRow label={isZh ? '层级' : 'Level'} value={<CxStatus tone={levelInfo.tone}>{levelInfo.label}</CxStatus>} />
          <MetricRow label={isZh ? '影响力' : 'Influence'} value={`${influence}%`} mono />
          <MetricRow label={isZh ? '关系' : 'Relationship'} value={relationLabel(stakeholder.relationship_status, isZh)} />
        </div>
        <div style={{ marginTop: 10, height: 4, background: 'var(--color-codex-bg-sunken)', borderRadius: 999 }}>
          <div style={{ width: `${influence}%`, height: '100%', background: 'var(--color-codex-accent)', borderRadius: 999 }} />
        </div>
      </Panel>

      <Panel title={isZh ? '同客户联系人' : 'Same-client contacts'}>
        <div className="grid gap-2">
          {relatedContacts.length ? (
            relatedContacts.map((contact) => (
              <RouterLink key={contact.id} to={`/contacts/${contact.id}`} className="row-hov flex items-center gap-3" style={{ padding: '8px 0', color: 'inherit' }}>
                <Avatar name={contact.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: 13, color: 'var(--color-codex-ink)' }}>
                    {contact.name}
                  </div>
                  <div className="truncate" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
                    {contact.role || (isZh ? '角色未记录' : 'Role missing')}
                  </div>
                </div>
              </RouterLink>
            ))
          ) : (
            <EmptyState text={isZh ? '暂无其他联系人。' : 'No other contacts yet.'} />
          )}
        </div>
      </Panel>
    </aside>
  )
}

function ActivityTimeline({ activities, emptyText }: { activities: ActivityItem[]; emptyText: string }) {
  if (!activities.length) return <EmptyState text={emptyText} />
  return (
    <div className="grid gap-0">
      {activities.map((activity, index) => (
        <div
          key={`${activity.title}-${activity.time}-${index}`}
          className="grid gap-4 sm:grid-cols-[86px_minmax(0,1fr)]"
          style={{
            padding: '13px 0',
            borderTop: index === 0 ? 'none' : '1px solid var(--color-codex-line-soft)',
          }}
        >
          <div className="codex-mono" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
            {activity.time}
          </div>
          <div className="min-w-0">
            <div style={{ fontSize: 13.5, color: 'var(--color-codex-ink)', fontWeight: 500 }}>{activity.title}</div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-codex-ink-soft)', lineHeight: 1.7 }}>
              {activity.body}
            </p>
            <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
              {activity.actorLabel}
              <span style={{ marginLeft: 8, color: 'var(--color-codex-ink-soft)' }}>{activity.actor}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ProjectRow({
  compact = false,
  isZh,
  project,
}: {
  compact?: boolean
  isZh: boolean
  project: ClientProjectSummary
}) {
  const status = projectStatus(project.status, isZh)
  return (
    <RouterLink
      to={`/projects/${project.id}`}
      className="row-hov grid items-center gap-3"
      style={{
        gridTemplateColumns: compact ? 'minmax(0,1fr) auto' : 'minmax(0,1fr) auto 14px',
        padding: compact ? '8px 0' : '12px 0',
        borderTop: compact ? 'none' : '1px solid var(--color-codex-line-soft)',
        color: 'inherit',
      }}
    >
      <div className="min-w-0">
        <div className="truncate" style={{ fontSize: 13.5, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
          {project.name}
        </div>
        {!compact && project.contract_amount != null ? (
          <div className="codex-mono" style={{ marginTop: 3, fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
            CNY {Math.round(project.contract_amount).toLocaleString('en-US')}
          </div>
        ) : null}
      </div>
      <CxStatus tone={status.tone}>{status.label}</CxStatus>
      {!compact ? <ArrowRight size={12} strokeWidth={1.5} style={{ color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" /> : null}
    </RouterLink>
  )
}

function Panel({
  action,
  children,
  subtitle,
  title,
}: {
  action?: ReactNode
  children: ReactNode
  subtitle?: string
  title: string
}) {
  return (
    <section
      style={{
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
        background: 'var(--color-codex-bg-elev)',
        padding: 20,
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: 'var(--color-codex-ink)', letterSpacing: '-0.01em' }}>{title}</h2>
          {subtitle ? <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function ContactMethod({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const empty = value === '未记录' || value === 'Not recorded'
  return (
    <div>
      <div className="flex items-center gap-1.5" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate" style={{ fontSize: 13, color: empty ? 'var(--color-codex-ink-faint)' : 'var(--color-codex-ink)', fontWeight: empty ? 400 : 500 }}>
        {value}
      </div>
    </div>
  )
}

function ProfileBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)', marginBottom: 6 }}>{label}</div>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-codex-ink-soft)', fontSize: 13, lineHeight: 1.75 }}>
        {value}
      </p>
    </div>
  )
}

function MetricRow({ label, mono = false, value }: { label: string; mono?: boolean; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>{label}</span>
      <span className={mono ? 'codex-mono' : undefined} style={{ fontSize: 13, color: 'var(--color-codex-ink)', fontWeight: mono ? 500 : 400 }}>
        {value}
      </span>
    </div>
  )
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size > 40 ? 'var(--codex-r-md, 6px)' : 999,
        background: 'var(--color-codex-accent-bg)',
        color: 'var(--color-codex-accent-ink)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size > 40 ? 24 : 12,
        fontWeight: 500,
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {getInitial(name)}
    </span>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '22px 12px',
        border: '1px dashed var(--color-codex-line)',
        borderRadius: 'var(--codex-r-sm, 3px)',
        color: 'var(--color-codex-ink-mute)',
        textAlign: 'center',
        fontSize: 12.5,
      }}
    >
      {text}
    </div>
  )
}

interface ContactEditDraft {
  name: string
  role: string
  organization_level: string
  influence_type: string
  relationship_status: string
  communication_preference: string
  contact: string
  concerns: string
  sensitivities: string
  note: string
}

function EditContactDialog({
  draft,
  isZh,
  onChange,
  onClose,
  onSubmit,
  saving,
}: {
  draft: ContactEditDraft
  isZh: boolean
  onChange: (next: ContactEditDraft) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  saving: boolean
}) {
  return (
    <DialogFrame onClose={onClose} title={isZh ? '编辑联系人' : 'Edit contact'}>
      <form onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2" style={{ padding: 20 }}>
          <TextField label={isZh ? '姓名' : 'Name'} value={draft.name} onChange={(name) => onChange({ ...draft, name })} />
          <TextField label={isZh ? '角色' : 'Role'} value={draft.role} onChange={(role) => onChange({ ...draft, role })} />
          <TextField label={isZh ? '层级' : 'Level'} value={draft.organization_level} onChange={(organization_level) => onChange({ ...draft, organization_level })} />
          <TextField label={isZh ? '影响类型' : 'Influence type'} value={draft.influence_type} onChange={(influence_type) => onChange({ ...draft, influence_type })} />
          <TextField label={isZh ? '关系状态' : 'Relationship'} value={draft.relationship_status} onChange={(relationship_status) => onChange({ ...draft, relationship_status })} />
          <TextField label={isZh ? '联系方式' : 'Contact'} value={draft.contact} onChange={(contact) => onChange({ ...draft, contact })} />
          <TextField label={isZh ? '沟通偏好' : 'Communication preference'} value={draft.communication_preference} onChange={(communication_preference) => onChange({ ...draft, communication_preference })} multiline />
          <TextField label={isZh ? '关注重点' : 'Concerns'} value={draft.concerns} onChange={(concerns) => onChange({ ...draft, concerns })} multiline />
          <TextField label={isZh ? '敏感点' : 'Sensitivities'} value={draft.sensitivities} onChange={(sensitivities) => onChange({ ...draft, sensitivities })} multiline />
          <TextField label={isZh ? '备注' : 'Notes'} value={draft.note} onChange={(note) => onChange({ ...draft, note })} multiline />
        </div>
        <DialogActions isZh={isZh} onClose={onClose} saving={saving} submitLabel={isZh ? '保存' : 'Save'} />
      </form>
    </DialogFrame>
  )
}

function TouchpointDialog({
  draft,
  isZh,
  onChange,
  onClose,
  onSubmit,
  saving,
}: {
  draft: { title: string; summary: string }
  isZh: boolean
  onChange: (next: { title: string; summary: string }) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  saving: boolean
}) {
  return (
    <DialogFrame onClose={onClose} title={isZh ? '记一次接触' : 'Log touchpoint'}>
      <form onSubmit={onSubmit}>
        <div className="grid gap-3" style={{ padding: 20 }}>
          <TextField label={isZh ? '标题' : 'Title'} value={draft.title} onChange={(title) => onChange({ ...draft, title })} placeholder={isZh ? '例如：项目例会' : 'e.g. Project meeting'} />
          <TextField label={isZh ? '接触摘要' : 'Summary'} value={draft.summary} onChange={(summary) => onChange({ ...draft, summary })} placeholder={isZh ? '记录沟通内容、对方态度和下一步动作。' : 'Capture discussion, attitude, and next action.'} multiline required />
        </div>
        <DialogActions isZh={isZh} onClose={onClose} saving={saving} submitLabel={isZh ? '记录' : 'Log'} />
      </form>
    </DialogFrame>
  )
}

function DialogFrame({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="theme-codex fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(16,14,11,.46)' }}>
      <div
        className="w-full"
        style={{
          maxWidth: 620,
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
          boxShadow: '0 18px 50px -18px rgba(0,0,0,0.45), 0 0 0 1px var(--color-codex-line)',
          overflow: 'hidden',
        }}
      >
        <div className="flex items-center justify-between gap-4" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-codex-line-soft)' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: 'var(--color-codex-ink)' }}>{title}</h2>
          <button type="button" onClick={onClose} className="cx-no-hover inline-flex items-center justify-center" style={{ width: 28, height: 28, color: 'var(--color-codex-ink-mute)' }} aria-label="Close">
            <X size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function DialogActions({
  isZh,
  onClose,
  saving,
  submitLabel,
}: {
  isZh: boolean
  onClose: () => void
  saving: boolean
  submitLabel: string
}) {
  return (
    <div className="flex justify-end gap-2" style={{ padding: '14px 20px', borderTop: '1px solid var(--color-codex-line-soft)', background: 'var(--color-codex-bg-tint)' }}>
      <button type="button" onClick={onClose} disabled={saving} style={ghostButtonStyle}>
        {isZh ? '取消' : 'Cancel'}
      </button>
      <button type="submit" disabled={saving} className="cx-primary-action cx-no-hover" style={{ height: 36, padding: '0 14px' }}>
        {saving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} strokeWidth={1.5} aria-hidden="true" />}
        {submitLabel}
      </button>
    </div>
  )
}

function TextField({
  label,
  multiline = false,
  onChange,
  placeholder,
  required = false,
  value,
}: {
  label: string
  multiline?: boolean
  onChange: (next: string) => void
  placeholder?: string
  required?: boolean
  value: string
}) {
  const common = {
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    placeholder,
    required,
    className: 'codex-input w-full',
    style: {
      marginTop: 6,
      padding: '8px 10px',
      border: '1px solid var(--color-codex-line)',
      borderRadius: 'var(--codex-r-sm, 3px)',
      background: 'var(--color-codex-bg-elev)',
      color: 'var(--color-codex-ink)',
      fontSize: 13,
    },
  }

  return (
    <label className={multiline ? 'sm:col-span-2' : undefined}>
      <span style={{ fontSize: 12, color: 'var(--color-codex-ink-soft)' }}>{label}</span>
      {multiline ? <textarea {...common} rows={3} style={{ ...common.style, resize: 'vertical' }} /> : <input {...common} />}
    </label>
  )
}

function ContactDetailLoading({ isZh }: { isZh: boolean }) {
  return (
    <>
      <PageTitle title={isZh ? '联系人详情' : 'Contact Detail'} />
      <main className="theme-codex min-h-full" style={{ background: 'var(--color-codex-bg)', color: 'var(--color-codex-ink)' }}>
        <CxTopProgress />
        <div style={{ padding: '32px clamp(24px, 4vw, 56px) 40px' }}>
          <CxSkeleton w={180} h={14} />
          <div className="mt-6 flex items-end justify-between gap-6 border-b" style={{ borderColor: 'var(--color-codex-line)', paddingBottom: 28 }}>
            <div className="flex items-start gap-4">
              <CxSkeleton w={56} h={56} />
              <div>
                <CxSkeleton w={180} h={32} />
                <CxSkeleton w={360} h={14} style={{ marginTop: 12 }} />
              </div>
            </div>
            <CxSkeleton w={220} h={38} />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-5">
              <CxSkeleton h={118} />
              <CxSkeleton h={230} />
              <CxSkeleton h={180} />
            </div>
            <div className="grid gap-5">
              <CxSkeleton h={112} />
              <CxSkeleton h={160} />
              <CxSkeleton h={140} />
            </div>
          </div>
        </div>
      </main>
    </>
  )
}

function ContactNotFound({ error, isZh, onBack }: { error: string | null; isZh: boolean; onBack: () => void }) {
  return (
    <>
      <PageTitle title={isZh ? '联系人详情' : 'Contact Detail'} />
      <main className="theme-codex min-h-full" style={{ background: 'var(--color-codex-bg)', color: 'var(--color-codex-ink)', padding: '32px clamp(24px, 4vw, 56px)' }}>
        <button type="button" onClick={onBack} className="cx-no-hover inline-flex items-center gap-1.5" style={ghostButtonStyle}>
          <ArrowLeft size={13} strokeWidth={1.5} aria-hidden="true" />
          {isZh ? '返回联系人' : 'Back to contacts'}
        </button>
        <div style={{ marginTop: 20, padding: 18, border: '1px solid var(--color-codex-line)', borderRadius: 'var(--codex-r-md, 6px)', background: 'var(--color-codex-bg-elev)', color: 'var(--color-codex-bad)' }}>
          {error || (isZh ? '联系人不存在' : 'Contact does not exist')}
        </div>
      </main>
    </>
  )
}

function buildEditDraft(stakeholder: ClientStakeholder): ContactEditDraft {
  return {
    name: stakeholder.name || '',
    role: stakeholder.role || '',
    organization_level: stakeholder.organization_level || '',
    influence_type: stakeholder.influence_type || '',
    relationship_status: stakeholder.relationship_status || '',
    communication_preference: stakeholder.communication_preference || '',
    contact: stakeholder.contact || '',
    concerns: stakeholder.concerns || '',
    sensitivities: stakeholder.sensitivities || '',
    note: stakeholder.note || '',
  }
}

function buildProfileRows(stakeholder: ClientStakeholder, isZh: boolean, levelLabel: string) {
  return [
    {
      label: isZh ? '角色影响' : 'Role influence',
      value:
        safeText(stakeholder.decision_style) ||
        safeText(stakeholder.influence_type) ||
        (isZh ? `${levelLabel}角色，影响力需要继续通过接触记录补充。` : `${levelLabel} role. Add touchpoints to refine influence.`),
    },
    {
      label: isZh ? '沟通偏好' : 'Communication preference',
      value: safeText(stakeholder.communication_preference) || (isZh ? '沟通偏好未记录。' : 'No communication preference recorded.'),
    },
    {
      label: isZh ? '关注重点' : 'Concerns',
      value: safeText(stakeholder.concerns) || (isZh ? '关注重点未记录。' : 'No concerns recorded.'),
    },
    {
      label: isZh ? '敏感点' : 'Sensitivities',
      value: safeText(stakeholder.sensitivities) || (isZh ? '敏感点未记录。' : 'No sensitivities recorded.'),
    },
  ]
}

interface ActivityItem {
  actor: string
  actorLabel: string
  body: string
  time: string
  title: string
}

function buildActivities(stakeholder: ClientStakeholder, history: StakeholderHistoryEntry[], isZh: boolean): ActivityItem[] {
  const activities: ActivityItem[] = []
  if (safeText(stakeholder.last_action)) {
    const parsed = splitLastAction(stakeholder.last_action)
    activities.push({
      title: parsed.title || (isZh ? '最近接触' : 'Recent touchpoint'),
      body: parsed.body,
      time: formatRelativeTime(stakeholder.updated_at, isZh),
      actorLabel: isZh ? '记录人' : 'Recorder',
      actor: 'Aria',
    })
  }

  history.slice(0, TOUCHPOINT_LIMIT).forEach((entry) => {
    const label = fieldLabel(entry.field_name, isZh)
    activities.push({
      title: entry.trigger === 'ai_analyze' ? (isZh ? 'AI 画像更新' : 'AI profile update') : `${label}${isZh ? '更新' : ' updated'}`,
      body: safeText(entry.new_value) || (isZh ? '字段被更新。' : 'Field updated.'),
      time: entry.changed_at ? formatRelativeTime(entry.changed_at, isZh) : (isZh ? '刚刚' : 'Just now'),
      actorLabel: isZh ? '记录人' : 'Recorder',
      actor: entry.trigger === 'ai_analyze' ? 'Aria AI' : 'Aria',
    })
  })

  return activities
}

function splitLastAction(value: string) {
  const text = safeText(value)
  const parts = text.split(/[:：]/)
  if (parts.length > 1 && parts[0].length <= 24) {
    return { title: parts[0].trim(), body: parts.slice(1).join('：').trim() || text }
  }
  return { title: '', body: text }
}

interface ContactMethods {
  email: string
  mobile: string
  office: string
  wechat: string
}

function parseContactMethods(value?: string): ContactMethods {
  const text = safeText(value)
  const missing = '未记录'
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  const mobile = text.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/)?.[1]
  const office = text.match(/(?:0\d{2,3}[-\s]?\d{7,8})/)?.[0]
  const wechat = text.match(/(?:微信|wechat|wx)[:：\s]*([A-Za-z0-9_-]{4,})/i)?.[1]
  return {
    email: email || missing,
    mobile: mobile ? maskPhone(mobile) : missing,
    office: office ? maskOfficePhone(office) : missing,
    wechat: wechat ? '已记录' : missing,
  }
}

function maskPhone(value: string) {
  if (value.length < 7) return value
  return `${value.slice(0, 3)}-****-${value.slice(-4)}`
}

function maskOfficePhone(value: string) {
  return value.replace(/\d(?=\d{4})/g, '*')
}

function getContactLevel(stakeholder: ClientStakeholder): ContactLevel {
  const text = [
    stakeholder.organization_level,
    stakeholder.influence_type,
    stakeholder.role,
    stakeholder.decision_style,
    stakeholder.note,
  ]
    .join(' ')
    .toLowerCase()

  if (/(决策|拍板|decision|approver|ceo|cto|coo|cfo|vp|总裁|总经理|董事|负责人|总监)/i.test(text)) return 'decision'
  if (/(影响|influence|champion|财务|采购|法务|业务|安全|it|信息化|数据|运营)/i.test(text)) return 'influence'
  return 'execution'
}

function levelMeta(level: ContactLevel, isZh: boolean): { label: string; tone: CxStatusTone } {
  if (level === 'decision') return { label: isZh ? '决策' : 'Decision', tone: 'accent' }
  if (level === 'influence') return { label: isZh ? '影响' : 'Influence', tone: 'neutral' }
  return { label: isZh ? '执行' : 'Execution', tone: 'mute' }
}

function influenceScore(stakeholder: ClientStakeholder) {
  const explicit = safeText(stakeholder.influence_type).match(/(\d{1,3})\s*%/)
  if (explicit) return Math.min(100, Math.max(0, Number(explicit[1])))
  const level = getContactLevel(stakeholder)
  if (level === 'decision') return 90
  if (level === 'influence') return 65
  return 35
}

function relationLabel(value: string, isZh: boolean) {
  const text = safeText(value).toLowerCase()
  if (!text || text === 'unknown') return isZh ? '未记录' : 'Unknown'
  if (/支持|support|良好|active|champion/.test(text)) return isZh ? '支持' : 'Supportive'
  if (/风险|阻力|block|risk|cold/.test(text)) return isZh ? '风险' : 'Risk'
  return value
}

function projectStatus(status: string, isZh: boolean): { label: string; tone: CxStatusTone } {
  const normalized = safeText(status).toLowerCase()
  const map: Record<string, { zh: string; en: string; tone: CxStatusTone }> = {
    lead: { zh: '线索', en: 'Lead', tone: 'neutral' },
    opportunity: { zh: '机会期', en: 'Opportunity', tone: 'warn' },
    won: { zh: '已签约', en: 'Won', tone: 'good' },
    delivering: { zh: '交付中', en: 'Delivering', tone: 'accent' },
    archived: { zh: '已归档', en: 'Archived', tone: 'mute' },
    evaluating: { zh: '评估中', en: 'Evaluating', tone: 'info' },
  }
  const found = map[normalized] || map.lead
  return { label: isZh ? found.zh : found.en, tone: found.tone }
}

function normalizeProjects(client: ClientListItem | null | undefined, projects: ClientProjectSummary[]) {
  if (projects.length) return projects
  return (client?.project_names || []).map((name, index) => ({
    id: -(index + 1),
    name,
    status: index === 0 ? 'opportunity' : 'lead',
  }))
}

function formatRecentTouch(stakeholder: ClientStakeholder, isZh: boolean) {
  if (!safeText(stakeholder.last_action)) return isZh ? '未直接接触' : 'No direct touchpoint'
  return `${formatRelativeTime(stakeholder.updated_at, isZh)}${isZh ? '接触' : ' touchpoint'}`
}

function formatRelativeTime(value: string, isZh: boolean) {
  const date = parseAppDateTime(value)
  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60))
  if (Number.isFinite(diffHours)) {
    if (diffHours < 1) return isZh ? '刚刚' : 'Just now'
    if (diffHours < 24) return isZh ? '今天' : 'Today'
    if (diffHours < 48) return isZh ? '昨天' : 'Yesterday'
    if (diffHours < 24 * 7) return isZh ? `${Math.max(1, Math.floor(diffHours / 24))} 天前` : `${Math.max(1, Math.floor(diffHours / 24))}d ago`
    if (diffHours < 24 * 35) return isZh ? `${Math.max(1, Math.floor(diffHours / (24 * 7)))} 周前` : `${Math.max(1, Math.floor(diffHours / (24 * 7)))}w ago`
  }
  return formatDateOnly(value, { month: 'short', day: 'numeric' })
}

function fieldLabel(field: string, isZh: boolean) {
  const labels: Record<string, { zh: string; en: string }> = {
    role: { zh: '角色', en: 'Role' },
    organization_level: { zh: '层级', en: 'Level' },
    influence_type: { zh: '影响类型', en: 'Influence type' },
    relationship_status: { zh: '关系状态', en: 'Relationship' },
    concerns: { zh: '关注重点', en: 'Concerns' },
    sensitivities: { zh: '敏感点', en: 'Sensitivities' },
    communication_preference: { zh: '沟通偏好', en: 'Communication preference' },
    contact: { zh: '联系方式', en: 'Contact' },
    last_action: { zh: '最近接触', en: 'Last action' },
    personality_profile: { zh: '性格画像', en: 'Personality' },
    decision_style: { zh: '角色影响', en: 'Decision style' },
    communication_strategy: { zh: '沟通策略', en: 'Communication strategy' },
    trust_signals: { zh: '信任信号', en: 'Trust signals' },
    note: { zh: '备注', en: 'Notes' },
  }
  const found = labels[field]
  return found ? (isZh ? found.zh : found.en) : field
}

function getInitial(name: string) {
  const clean = safeText(name)
  return Array.from(clean)[0]?.toUpperCase() || '-'
}

function safeText(value: string | null | undefined) {
  return value?.trim() ?? ''
}

const ghostButtonStyle = {
  minHeight: 36,
  padding: '0 12px',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  color: 'var(--color-codex-ink-soft)',
  background: 'transparent',
  fontSize: 12.5,
  whiteSpace: 'nowrap',
}
