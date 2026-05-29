import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, Loader2, Mail, Phone, Plus, RefreshCw, Search, UserRound, X } from 'lucide-react'

import { api } from '../../api/client'
import { CxSkeleton, CxStatus, CxTopProgress, type CxStatusTone } from '../../components/codex'
import { PageTitle } from '../../components/PageTitle'
import type { ClientStakeholder } from '../../types/api'

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

interface ContactRecord {
  client: ClientListItem
  stakeholder: ClientStakeholder
}

type ContactLevel = 'decision' | 'influence' | 'execution'
type FilterKey = 'all' | ContactLevel | 'recent' | 'unreached'

const CONTACT_GRID = 'minmax(220px,1fr) minmax(170px,.8fr) minmax(90px,.55fr) minmax(82px,.45fr) minmax(82px,.45fr) minmax(118px,.6fr) 16px'
const CONTACT_TABLE_MIN_WIDTH = 860

function safeText(value: string | null | undefined) {
  return value?.trim() ?? ''
}

function getContactInitial(name: string) {
  const clean = safeText(name)
  if (!clean) return '-'
  return Array.from(clean)[0]?.toUpperCase() || '-'
}

function hasPhone(value: string | null | undefined) {
  const text = safeText(value)
  return /(?:\+?\d[\d\s\-()]{5,}\d)|(?:1[3-9]\d{9})/.test(text)
}

function hasEmail(value: string | null | undefined) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(safeText(value))
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

  if (/(决策|拍板|decision|decision maker|approver|ceo|cto|coo|cfo|vp|总裁|总经理|董事|负责人|总监)/i.test(text)) {
    return 'decision'
  }
  if (/(影响|influence|influencer|champion|财务|采购|法务|业务|安全|it|信息化|数据|运营)/i.test(text)) {
    return 'influence'
  }
  return 'execution'
}

function levelMeta(level: ContactLevel, isZh: boolean): { label: string; tone: CxStatusTone } {
  if (level === 'decision') return { label: isZh ? '决策' : 'Decision', tone: 'accent' }
  if (level === 'influence') return { label: isZh ? '影响' : 'Influence', tone: 'neutral' }
  return { label: isZh ? '执行' : 'Execution', tone: 'mute' }
}

function getActivityDate(stakeholder: ClientStakeholder) {
  const value = stakeholder.updated_at || stakeholder.created_at
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function hasDirectContact(stakeholder: ClientStakeholder) {
  return Boolean(safeText(stakeholder.last_action))
}

function formatLastContact(stakeholder: ClientStakeholder, isZh: boolean) {
  if (!hasDirectContact(stakeholder)) return isZh ? '未直接接触' : 'No direct contact'

  const date = getActivityDate(stakeholder)
  if (!date) return isZh ? '已记录' : 'Recorded'

  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60))
  if (Number.isFinite(diffHours)) {
    if (diffHours < 24) return isZh ? '今天' : 'Today'
    if (diffHours < 48) return isZh ? '昨天' : 'Yesterday'
    if (diffHours < 24 * 7) return isZh ? `${Math.max(1, Math.floor(diffHours / 24))} 天前` : `${Math.max(1, Math.floor(diffHours / 24))}d ago`
    if (diffHours < 24 * 21) return isZh ? `${Math.max(1, Math.floor(diffHours / (24 * 7)))} 周前` : `${Math.max(1, Math.floor(diffHours / (24 * 7)))}w ago`
  }

  return date.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function isRecentContact(stakeholder: ClientStakeholder) {
  if (!hasDirectContact(stakeholder)) return false
  const date = getActivityDate(stakeholder)
  if (!date) return false
  return Date.now() - date.getTime() <= 1000 * 60 * 60 * 24 * 7
}

function matchesContact(record: ContactRecord, search: string) {
  const keyword = search.trim().toLowerCase()
  if (!keyword) return true
  return [
    record.stakeholder.name,
    record.stakeholder.role,
    record.stakeholder.contact,
    record.stakeholder.organization_level,
    record.stakeholder.influence_type,
    record.stakeholder.communication_preference,
    record.stakeholder.note,
    record.stakeholder.last_action,
    record.client.name,
    record.client.industry,
    ...(record.client.project_names || []),
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(keyword))
}

function sortContacts(left: ContactRecord, right: ContactRecord) {
  const levelRank: Record<ContactLevel, number> = { decision: 3, influence: 2, execution: 1 }
  const levelDiff = levelRank[getContactLevel(right.stakeholder)] - levelRank[getContactLevel(left.stakeholder)]
  if (levelDiff !== 0) return levelDiff

  const leftDate = getActivityDate(left.stakeholder)?.getTime() || 0
  const rightDate = getActivityDate(right.stakeholder)?.getTime() || 0
  if (rightDate !== leftDate) return rightDate - leftDate

  return left.stakeholder.name.localeCompare(right.stakeholder.name)
}

export function Contacts() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [clients, setClients] = useState<ClientListItem[]>([])
  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    clientId: '',
    name: '',
    role: '',
    organizationLevel: '',
    contact: '',
    note: '',
  })

  const loadDirectory = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const clientList = await api.get<ClientListItem[]>('/clients')
      const stakeholderLists = await Promise.all(
        clientList.map(async (client) => {
          try {
            const stakeholders = await api.get<ClientStakeholder[]>(`/clients/${client.id}/stakeholders`)
            return stakeholders.map((stakeholder) => ({ client, stakeholder }))
          } catch {
            return []
          }
        }),
      )
      const records = stakeholderLists.flat().sort(sortContacts)
      setClients(clientList)
      setContacts(records)
      setDraft((current) => ({
        ...current,
        clientId: current.clientId || String(clientList[0]?.id ?? ''),
      }))
    } catch {
      setError(isZh ? '联系人目录加载失败' : 'Failed to load contact directory')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadDirectory()
  }, [])

  const counts = useMemo(() => {
    const decision = contacts.filter((record) => getContactLevel(record.stakeholder) === 'decision').length
    const influence = contacts.filter((record) => getContactLevel(record.stakeholder) === 'influence').length
    const execution = contacts.filter((record) => getContactLevel(record.stakeholder) === 'execution').length
    const recent = contacts.filter((record) => isRecentContact(record.stakeholder)).length
    const unreached = contacts.filter((record) => !hasDirectContact(record.stakeholder)).length
    return { all: contacts.length, decision, influence, execution, recent, unreached }
  }, [contacts])

  const filterOptions: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: isZh ? '全部' : 'All', count: counts.all },
    { key: 'decision', label: isZh ? '决策' : 'Decision', count: counts.decision },
    { key: 'influence', label: isZh ? '影响' : 'Influence', count: counts.influence },
    { key: 'execution', label: isZh ? '执行' : 'Execution', count: counts.execution },
    { key: 'recent', label: isZh ? '本周联系' : 'This week', count: counts.recent },
    { key: 'unreached', label: isZh ? '未直接接触' : 'No direct contact', count: counts.unreached },
  ]

  const filteredContacts = useMemo(
    () =>
      contacts.filter((record) => {
        if (!matchesContact(record, search)) return false
        if (activeFilter === 'all') return true
        if (activeFilter === 'recent') return isRecentContact(record.stakeholder)
        if (activeFilter === 'unreached') return !hasDirectContact(record.stakeholder)
        return getContactLevel(record.stakeholder) === activeFilter
      }),
    [activeFilter, contacts, search],
  )

  const resetCreateForm = () => {
    setDraft({
      clientId: String(clients[0]?.id ?? ''),
      name: '',
      role: '',
      organizationLevel: '',
      contact: '',
      note: '',
    })
    setCreateError(null)
  }

  const createContact = async () => {
    const clientId = Number(draft.clientId)
    const client = clients.find((item) => item.id === clientId)
    if (!client || !draft.name.trim()) {
      setCreateError(isZh ? '请选择客户并填写联系人姓名。' : 'Choose a client and enter a contact name.')
      return
    }

    setCreating(true)
    setCreateError(null)
    try {
      const stakeholder = await api.post<ClientStakeholder>(`/clients/${client.id}/stakeholders`, {
        name: draft.name.trim(),
        role: draft.role.trim(),
        organization_level: draft.organizationLevel.trim(),
        contact: draft.contact.trim(),
        note: draft.note.trim(),
        influence_type: getContactLevel({
          organization_level: draft.organizationLevel,
          influence_type: '',
          role: draft.role,
          decision_style: '',
          note: '',
        } as ClientStakeholder),
      })
      setContacts((current) => [{ client, stakeholder }, ...current].sort(sortContacts))
      setShowCreateModal(false)
      resetCreateForm()
    } catch {
      setCreateError(isZh ? '联系人创建失败，请稍后重试。' : 'Failed to create contact. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return <ContactsLoading isZh={isZh} />
  }

  return (
    <>
      <PageTitle title={isZh ? '联系人' : 'Contacts'} />
      <main
        className="theme-codex min-h-full"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <div style={{ padding: '32px clamp(24px, 4vw, 56px) 40px', minWidth: 0 }}>
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between" style={{ marginBottom: 24 }}>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 28,
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                  color: 'var(--color-codex-ink)',
                }}
              >
                {isZh ? '联系人' : 'Contacts'}
              </h1>
              <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--color-codex-ink-mute)' }}>
                {isZh ? `跨客户的联系人通讯录 · ${contacts.length} 人` : `Cross-client contact directory · ${contacts.length} people`}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div
                className="flex items-center gap-2"
                style={{
                  width: 'min(100%, 260px)',
                  padding: '7px 12px',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  background: 'var(--color-codex-bg-elev)',
                  color: 'var(--color-codex-ink-mute)',
                }}
              >
                <Search size={13} strokeWidth={1.5} aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={isZh ? '搜索姓名 / 客户' : 'Search name / client'}
                  className="codex-input min-w-0 flex-1 bg-transparent outline-none"
                  style={{ color: 'var(--color-codex-ink)', fontSize: 13 }}
                  aria-label={isZh ? '搜索联系人' : 'Search contacts'}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="cx-no-hover inline-flex items-center"
                    style={{ color: 'var(--color-codex-ink-faint)' }}
                    aria-label={isZh ? '清空搜索' : 'Clear search'}
                  >
                    <X size={13} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void loadDirectory({ silent: true })}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-1.5 cx-no-hover"
                style={{
                  minHeight: 36,
                  padding: '0 12px',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  color: 'var(--color-codex-ink-soft)',
                  background: 'transparent',
                  fontSize: 12.5,
                  whiteSpace: 'nowrap',
                }}
              >
                <RefreshCw size={13} strokeWidth={1.5} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
                {isZh ? '刷新' : 'Refresh'}
              </button>

              <button type="button" onClick={() => setShowCreateModal(true)} className="cx-primary-action cx-no-hover">
                <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
                {isZh ? '新建联系人' : 'New contact'}
              </button>
            </div>
          </header>

          <div className="flex flex-wrap gap-1.5" style={{ marginBottom: 18 }}>
            {filterOptions.map((filter) => (
              <FilterPill
                key={filter.key}
                active={activeFilter === filter.key}
                count={filter.count}
                label={filter.label}
                onClick={() => setActiveFilter(filter.key)}
              />
            ))}
          </div>

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

          <section aria-label={isZh ? '联系人目录' : 'Contact directory'}>
            <div className="overflow-x-auto">
              <div style={{ minWidth: CONTACT_TABLE_MIN_WIDTH }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: CONTACT_GRID,
                    padding: '10px 8px',
                    gap: 14,
                    fontSize: 11.5,
                    color: 'var(--color-codex-ink-faint)',
                  }}
                >
                  <span>{isZh ? '姓名 · 角色' : 'Name · Role'}</span>
                  <span>{isZh ? '客户' : 'Client'}</span>
                  <span>{isZh ? '层级' : 'Level'}</span>
                  <span>{isZh ? '电话' : 'Phone'}</span>
                  <span>{isZh ? '邮箱' : 'Email'}</span>
                  <span>{isZh ? '最近联系' : 'Last contact'}</span>
                  <span />
                </div>

                {filteredContacts.length === 0 ? (
                  <ContactsEmptyState hasSearch={Boolean(search.trim())} isZh={isZh} onClear={() => setSearch('')} />
                ) : (
                  filteredContacts.map((record) => (
                    <ContactRow
                      key={`${record.client.id}-${record.stakeholder.id}`}
                      isZh={isZh}
                      record={record}
                      onClick={() => navigate(`/contacts/${record.stakeholder.id}`)}
                    />
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      {showCreateModal ? (
        <CreateContactModal
          clients={clients}
          creating={creating}
          draft={draft}
          error={createError}
          isZh={isZh}
          onClose={() => {
            setShowCreateModal(false)
            resetCreateForm()
          }}
          onDraftChange={setDraft}
          onSubmit={createContact}
        />
      ) : null}
    </>
  )
}

function FilterPill({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cx-no-hover inline-flex items-center gap-1.5"
      style={{
        padding: '5px 12px',
        borderRadius: 'var(--codex-r-sm, 3px)',
        background: active ? 'var(--color-codex-ink)' : 'transparent',
        color: active ? 'var(--color-codex-bg-elev)' : 'var(--color-codex-ink-soft)',
        border: active ? '1px solid var(--color-codex-ink)' : '1px solid var(--color-codex-line)',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{label}</span>
      <span className="codex-mono" style={{ opacity: active ? 0.72 : 0.6 }}>
        {count}
      </span>
    </button>
  )
}

function ContactRow({
  isZh,
  onClick,
  record,
}: {
  isZh: boolean
  onClick: () => void
  record: ContactRecord
}) {
  const level = getContactLevel(record.stakeholder)
  const levelInfo = levelMeta(level, isZh)
  const phoneRecorded = hasPhone(record.stakeholder.contact)
  const emailRecorded = hasEmail(record.stakeholder.contact)

  return (
    <button
      type="button"
      onClick={onClick}
      className="row-hov w-full text-left"
      style={{
        display: 'grid',
        gridTemplateColumns: CONTACT_GRID,
        padding: '13px 8px',
        gap: 14,
        alignItems: 'center',
        borderTop: '1px solid var(--color-codex-line-soft)',
        color: 'inherit',
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: 'var(--color-codex-accent-bg)',
            color: 'var(--color-codex-accent-ink)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11.5,
            fontWeight: 500,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {getContactInitial(record.stakeholder.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 13, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
            {record.stakeholder.name || (isZh ? '未命名联系人' : 'Unnamed contact')}
          </div>
          <div className="truncate" style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}>
            {record.stakeholder.role || (isZh ? '未填写角色' : 'No role')}
          </div>
        </div>
      </div>

      <div className="truncate" style={{ fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>
        {record.client.name}
      </div>
      <CxStatus tone={levelInfo.tone}>{levelInfo.label}</CxStatus>
      <RecordedIndicator recorded={phoneRecorded} label={isZh ? '已记录' : 'Recorded'} missingLabel={isZh ? '未记录' : 'Missing'} type="phone" />
      <RecordedIndicator recorded={emailRecorded} label={isZh ? '已记录' : 'Recorded'} missingLabel={isZh ? '未记录' : 'Missing'} type="email" />
      <span style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>{formatLastContact(record.stakeholder, isZh)}</span>
      <ArrowRight size={12} strokeWidth={1.5} style={{ color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" />
    </button>
  )
}

function RecordedIndicator({
  label,
  missingLabel,
  recorded,
  type,
}: {
  label: string
  missingLabel: string
  recorded: boolean
  type: 'phone' | 'email'
}) {
  const Icon = type === 'phone' ? Phone : Mail
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 11.5,
        color: recorded ? 'var(--color-codex-good)' : 'var(--color-codex-ink-faint)',
      }}
    >
      {recorded ? <Check size={12} strokeWidth={1.7} aria-hidden="true" /> : <Icon size={12} strokeWidth={1.5} aria-hidden="true" />}
      {recorded ? label : missingLabel}
    </span>
  )
}

function ContactsEmptyState({
  hasSearch,
  isZh,
  onClear,
}: {
  hasSearch: boolean
  isZh: boolean
  onClear: () => void
}) {
  return (
    <div
      className="text-center"
      style={{
        padding: '72px 16px',
        borderTop: '1px solid var(--color-codex-line-soft)',
        color: 'var(--color-codex-ink-mute)',
      }}
    >
      <UserRound size={30} strokeWidth={1.4} style={{ margin: '0 auto 14px', color: 'var(--color-codex-ink-faint)' }} />
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: 'var(--color-codex-ink)' }}>
        {hasSearch ? (isZh ? '没有匹配的联系人' : 'No matching contacts') : isZh ? '还没有联系人' : 'No contacts yet'}
      </h2>
      <p style={{ margin: '6px auto 0', maxWidth: 420, fontSize: 13 }}>
        {hasSearch
          ? isZh
            ? '试试换一个关键词，或清空搜索后重新查看通讯录。'
            : 'Try another keyword, or clear search to review the full directory.'
          : isZh
            ? '新建联系人后，可以在客户、项目和对话中持续复用关系信息。'
            : 'Create contacts to reuse relationship context across clients, projects, and conversations.'}
      </p>
      {hasSearch ? (
        <button
          type="button"
          onClick={onClear}
          style={{
            marginTop: 16,
            padding: '7px 12px',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-ink-soft)',
          }}
        >
          {isZh ? '清空搜索' : 'Clear search'}
        </button>
      ) : null}
    </div>
  )
}

function ContactsLoading({ isZh }: { isZh: boolean }) {
  return (
    <>
      <PageTitle title={isZh ? '联系人' : 'Contacts'} />
      <main
        className="theme-codex min-h-full"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
        }}
      >
        <CxTopProgress />
        <div style={{ padding: '32px clamp(24px, 4vw, 56px) 40px' }}>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <CxSkeleton w={96} h={30} />
              <CxSkeleton w={220} h={14} style={{ marginTop: 12 }} />
            </div>
            <CxSkeleton w={360} h={38} />
          </div>
          <div className="mb-4 flex gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <CxSkeleton key={index} w={index === 5 ? 112 : 72} h={30} />
            ))}
          </div>
          <div>
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="grid items-center gap-4" style={{ gridTemplateColumns: CONTACT_GRID, padding: '13px 8px', borderTop: '1px solid var(--color-codex-line-soft)' }}>
                <CxSkeleton h={28} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton w={12} h={12} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}

function CreateContactModal({
  clients,
  creating,
  draft,
  error,
  isZh,
  onClose,
  onDraftChange,
  onSubmit,
}: {
  clients: ClientListItem[]
  creating: boolean
  draft: {
    clientId: string
    name: string
    role: string
    organizationLevel: string
    contact: string
    note: string
  }
  error: string | null
  isZh: boolean
  onClose: () => void
  onDraftChange: (value: {
    clientId: string
    name: string
    role: string
    organizationLevel: string
    contact: string
    note: string
  }) => void
  onSubmit: () => void
}) {
  return (
    <div className="theme-codex fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(16,14,11,.46)' }}>
      <div
        className="w-full max-w-lg"
        style={{
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
          boxShadow: '0 18px 50px -18px rgba(0,0,0,0.45), 0 0 0 1px var(--color-codex-line)',
        }}
      >
        <div className="flex items-start justify-between gap-4" style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-codex-line-soft)' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--color-codex-ink)' }}>
              {isZh ? '新建联系人' : 'New contact'}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
              {isZh ? '联系人需要先关联到一个客户，后续可在联系人详情继续补全画像。' : 'Contacts are linked to a client first, then enriched from the detail page.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cx-no-hover inline-flex items-center justify-center"
            style={{ width: 28, height: 28, color: 'var(--color-codex-ink-mute)', borderRadius: 'var(--codex-r-sm, 3px)' }}
            aria-label={isZh ? '关闭' : 'Close'}
          >
            <X size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3" style={{ padding: 20 }}>
          <label className="block">
            <span style={{ marginBottom: 6, display: 'block', fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>{isZh ? '关联客户' : 'Client'}</span>
            <select
              value={draft.clientId}
              onChange={(event) => onDraftChange({ ...draft, clientId: event.target.value })}
              className="codex-input w-full"
              style={fieldStyle}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={isZh ? '姓名' : 'Name'} value={draft.name} onChange={(name) => onDraftChange({ ...draft, name })} placeholder={isZh ? '例如：王浩' : 'e.g. Alex Wang'} />
            <TextField label={isZh ? '角色' : 'Role'} value={draft.role} onChange={(role) => onDraftChange({ ...draft, role })} placeholder={isZh ? 'CTO / 采购负责人' : 'CTO / Procurement lead'} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={isZh ? '层级' : 'Level'} value={draft.organizationLevel} onChange={(organizationLevel) => onDraftChange({ ...draft, organizationLevel })} placeholder={isZh ? '决策 / 影响 / 执行' : 'Decision / Influence / Execution'} />
            <TextField label={isZh ? '联系方式' : 'Contact'} value={draft.contact} onChange={(contact) => onDraftChange({ ...draft, contact })} placeholder={isZh ? '电话 / 邮箱 / 微信' : 'Phone / email / WeChat'} />
          </div>

          <label className="block">
            <span style={{ marginBottom: 6, display: 'block', fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>{isZh ? '备注' : 'Note'}</span>
            <textarea
              value={draft.note}
              onChange={(event) => onDraftChange({ ...draft, note: event.target.value })}
              rows={3}
              className="codex-input w-full resize-none"
              style={fieldStyle}
              placeholder={isZh ? '补充沟通偏好、影响点或下一步动作。' : 'Add communication style, influence, or next action.'}
            />
          </label>

          {error ? <p style={{ margin: 0, fontSize: 12, color: 'var(--color-codex-bad)' }}>{error}</p> : null}
        </div>

        <div
          className="flex justify-end gap-2"
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--color-codex-line-soft)',
            background: 'color-mix(in oklab, var(--color-codex-bg-elev) 82%, var(--color-codex-bg-tint))',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            style={{
              padding: '7px 12px',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
              color: 'var(--color-codex-ink-soft)',
              background: 'var(--color-codex-bg-elev)',
              fontSize: 12.5,
            }}
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button type="button" onClick={onSubmit} disabled={creating} className="cx-primary-action cx-no-hover">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isZh ? '确认创建' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

const fieldStyle = {
  padding: '8px 10px',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  background: 'var(--color-codex-bg-elev)',
  color: 'var(--color-codex-ink)',
  fontSize: 13,
}

function TextField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="block">
      <span style={{ marginBottom: 6, display: 'block', fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="codex-input w-full"
        style={fieldStyle}
      />
    </label>
  )
}
