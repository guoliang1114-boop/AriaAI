import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowRightLeft,
  Brain,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FolderKanban,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { ClientStakeholder } from '../../types/api'
import { ClientStakeholdersStructuredCard } from '../projects/ClientStakeholdersStructuredCard'

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

type ContactStatus = 'current' | 'changed' | 'left' | 'unknown'
type FilterKey = 'all' | ContactStatus

interface ContactRecord {
  client: ClientListItem
  stakeholder: ClientStakeholder
}

function getContactStatus(stakeholder: ClientStakeholder): ContactStatus {
  const text = [
    stakeholder.relationship_status,
    stakeholder.role,
    stakeholder.note,
    stakeholder.concerns,
    stakeholder.sensitivities,
    stakeholder.last_action,
  ]
    .join(' ')
    .toLowerCase()

  if (/(departed|left|resigned|离职|已离开|离开)/i.test(text)) return 'left'
  if (/(changed_company|company_changed|new company|换公司|跳槽|转到|已换)/i.test(text)) return 'changed'
  if (/(unknown|unclear|待确认|未确认|失联|待核实)/i.test(text)) return 'unknown'
  return 'current'
}

function statusMeta(status: ContactStatus, isZh: boolean) {
  if (status === 'left') {
    return {
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      label: isZh ? '已离职' : 'Left company',
      className: 'border-rose-100 bg-rose-50 text-rose-700',
    }
  }
  if (status === 'changed') {
    return {
      icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
      label: isZh ? '换公司待确认' : 'Company changed',
      className: 'border-amber-100 bg-amber-50 text-amber-700',
    }
  }
  if (status === 'unknown') {
    return {
      icon: <CircleDashed className="h-3.5 w-3.5" />,
      label: isZh ? '状态待确认' : 'Needs verification',
      className: 'border-slate-200 bg-slate-100 text-slate-600',
    }
  }
  return {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: isZh ? '当前在职' : 'Current',
    className: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  }
}

export function Contacts() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [clients, setClients] = useState<ClientListItem[]>([])
  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [loading, setLoading] = useState(true)
  const [savingStatus, setSavingStatus] = useState<ContactStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedContact = contacts.find((record) => record.stakeholder.id === selectedContactId) || contacts[0]
  const selectedClientContacts = useMemo(
    () => contacts.filter((record) => selectedContact && record.client.id === selectedContact.client.id).map((record) => record.stakeholder),
    [contacts, selectedContact],
  )

  const loadDirectory = async () => {
    setLoading(true)
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
      const records = stakeholderLists.flat().sort((left, right) => {
        const statusDiff = statusRank(getContactStatus(left.stakeholder)) - statusRank(getContactStatus(right.stakeholder))
        if (statusDiff !== 0) return statusDiff
        return left.stakeholder.name.localeCompare(right.stakeholder.name)
      })
      setClients(clientList)
      setContacts(records)
      setSelectedContactId((current) => current ?? records[0]?.stakeholder.id ?? null)
    } catch {
      setError(isZh ? '联系人目录加载失败' : 'Failed to load contact directory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDirectory()
  }, [])

  const filteredContacts = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return contacts.filter((record) => {
      const status = getContactStatus(record.stakeholder)
      if (activeFilter !== 'all' && status !== activeFilter) return false
      if (!keyword) return true
      return [
        record.stakeholder.name,
        record.stakeholder.role,
        record.stakeholder.contact,
        record.stakeholder.organization_level,
        record.stakeholder.influence_type,
        record.stakeholder.communication_preference,
        record.stakeholder.note,
        record.client.name,
        record.client.industry,
        ...(record.client.project_names || []),
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword))
    })
  }, [activeFilter, contacts, search])

  const counts = useMemo(
    () => ({
      all: contacts.length,
      current: contacts.filter((record) => getContactStatus(record.stakeholder) === 'current').length,
      changed: contacts.filter((record) => getContactStatus(record.stakeholder) === 'changed').length,
      left: contacts.filter((record) => getContactStatus(record.stakeholder) === 'left').length,
      unknown: contacts.filter((record) => getContactStatus(record.stakeholder) === 'unknown').length,
      insights: contacts.filter(
        (record) =>
          record.stakeholder.personality_profile ||
          record.stakeholder.decision_style ||
          record.stakeholder.communication_strategy ||
          record.stakeholder.trust_signals,
      ).length,
    }),
    [contacts],
  )

  const filterOptions: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: isZh ? '全部联系人' : 'All contacts', count: counts.all },
    { key: 'current', label: isZh ? '当前在职' : 'Current', count: counts.current },
    { key: 'changed', label: isZh ? '换公司' : 'Changed', count: counts.changed },
    { key: 'left', label: isZh ? '已离职' : 'Left', count: counts.left },
    { key: 'unknown', label: isZh ? '待确认' : 'Verify', count: counts.unknown },
  ]

  const updateContactStatus = async (status: ContactStatus) => {
    if (!selectedContact) return
    setSavingStatus(status)
    const label = statusMeta(status, isZh).label
    const existingNote = selectedContact.stakeholder.note?.trim()
    const note = existingNote ? existingNote : isZh ? `联系人状态：${label}` : `Contact status: ${label}`
    try {
      const updated = await api.put<ClientStakeholder>(
        `/clients/${selectedContact.client.id}/stakeholders/${selectedContact.stakeholder.id}`,
        {
          relationship_status: status,
          note,
        },
      )
      setContacts((current) =>
        current.map((record) =>
          record.stakeholder.id === updated.id ? { ...record, stakeholder: updated } : record,
        ),
      )
    } finally {
      setSavingStatus(null)
    }
  }

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '联系人' : 'Contacts'} />
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={isZh ? '联系人' : 'Contacts'} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f6f9fc_0%,#eef4fb_36%,#ffffff_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <section className="relative overflow-hidden rounded-[2rem] border border-sky-100 bg-[radial-gradient(circle_at_top_right,#dff3ff_0%,#f0f8ff_42%,#ffffff_100%)] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.08)]">
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-sky-200/35 blur-3xl" />
            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-sky-700 shadow-sm backdrop-blur">
                  <UserRound className="h-3.5 w-3.5" />
                  <span>{isZh ? '联系人视角' : 'People-first workspace'}</span>
                </div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  {isZh ? '先看人，再看 TA 当前服务哪家公司' : 'Start with the person, then track where they work now'}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  {isZh
                    ? '联系人可能离职、跳槽或更换负责范围。这里按人建立目录，同时保留当前关联客户，方便持续沉淀性格、沟通方式和关系历史。'
                    : 'Contacts can leave, move companies, or change ownership. This directory follows the person while preserving their current client affiliation.'}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <SignalPill label={isZh ? '联系人' : 'Contacts'} value={counts.all} />
                  <SignalPill label={isZh ? '客户' : 'Clients'} value={clients.length} />
                  <SignalPill label={isZh ? '换公司/离职' : 'Moved or left'} value={counts.changed + counts.left} tone="amber" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void loadDirectory()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:bg-primary"
              >
                <RefreshCw className="h-4 w-4" />
                {isZh ? '刷新目录' : 'Refresh Directory'}
              </button>
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label={isZh ? '联系人总数' : 'Total Contacts'} tone="sky" value={counts.all} sub={isZh ? '跨客户联系人目录' : 'People across all clients'} />
            <SummaryCard label={isZh ? '当前在职' : 'Current'} tone="emerald" value={counts.current} sub={isZh ? '仍在原客户侧推进' : 'Still active at the linked client'} />
            <SummaryCard label={isZh ? '关系变动' : 'Changed'} tone="amber" value={counts.changed + counts.left} sub={isZh ? '离职或换公司待跟进' : 'Left or moved company'} />
            <SummaryCard label={isZh ? '沟通洞察' : 'With Insights'} tone="slate" value={counts.insights} sub={isZh ? '已沉淀画像或策略' : 'Profiles or strategies captured'} />
          </section>

          {error ? (
            <div className="mt-6 rounded-[1.25rem] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_430px]">
            <div className="space-y-6">
              <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="relative w-full min-w-0 flex-1 xl:max-w-2xl">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={isZh ? '搜索联系人、公司、角色、项目、沟通偏好' : 'Search people, company, role, project, or communication style'}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                      />
                      {search ? (
                        <button
                          type="button"
                          onClick={() => setSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      {isZh ? `结果 ${filteredContacts.length}` : `${filteredContacts.length} results`}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {filterOptions.map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setActiveFilter(filter.key)}
                        className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition ${
                          activeFilter === filter.key
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                        }`}
                      >
                        <span>{filter.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${activeFilter === filter.key ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{isZh ? '联系人目录' : 'Contact Directory'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isZh ? '以人为主视角，客户只是当前任职或当前合作关系。' : 'People are primary; client affiliation is the current working context.'}
                    </p>
                  </div>
                </div>

                {filteredContacts.length === 0 ? (
                  <div className="py-20 text-center text-slate-500">
                    <Users className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                    <h3 className="text-lg font-semibold text-slate-700">{isZh ? '没有匹配的联系人' : 'No matching contacts'}</h3>
                    <p className="mt-2 text-sm">
                      {isZh ? '可以切换状态筛选、清空搜索，或先在右侧客户联系人维护区新增。' : 'Try another status, clear search, or add contacts from the client panel.'}
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {filteredContacts.map((record) => (
                      <ContactCard
                        key={record.stakeholder.id}
                        active={record.stakeholder.id === selectedContact?.stakeholder.id}
                        isZh={isZh}
                        record={record}
                        onSelect={() => navigate(`/contacts/${record.stakeholder.id}`)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside className="space-y-6">
              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                {selectedContact ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-500">{isZh ? '当前联系人' : 'Selected Contact'}</p>
                        <h2 className="mt-1 truncate text-xl font-semibold text-slate-900">{selectedContact.stakeholder.name}</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {[selectedContact.stakeholder.role, selectedContact.client.name].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <StatusBadge status={getContactStatus(selectedContact.stakeholder)} isZh={isZh} />
                    </div>

                    <div className="mt-5 grid gap-3">
                      <DetailRow icon={<Building2 className="h-4 w-4" />} label={isZh ? '当前关联客户' : 'Current client'} value={selectedContact.client.name} />
                      <DetailRow icon={<BriefcaseBusiness className="h-4 w-4" />} label={isZh ? '角色/组织层级' : 'Role / level'} value={[selectedContact.stakeholder.role, selectedContact.stakeholder.organization_level].filter(Boolean).join(' / ')} />
                      <DetailRow icon={<Sparkles className="h-4 w-4" />} label={isZh ? '沟通偏好' : 'Communication'} value={selectedContact.stakeholder.communication_preference} />
                      <DetailRow icon={<Brain className="h-4 w-4" />} label={isZh ? '沟通策略' : 'Strategy'} value={selectedContact.stakeholder.communication_strategy || selectedContact.stakeholder.personality_profile} />
                    </div>

                    <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                      <div className="text-sm font-semibold text-slate-900">{isZh ? '联系人状态' : 'Contact status'}</div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {isZh ? '如果 TA 离职或换公司，先标记状态；后续可在新客户下重新建立关联，保留沟通画像。' : 'If this person leaves or moves company, mark the status first; create a new affiliation under the new client when confirmed.'}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {(['current', 'changed', 'left', 'unknown'] as ContactStatus[]).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => void updateContactStatus(status)}
                            disabled={savingStatus !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-sky-200 hover:text-sky-700 disabled:opacity-50"
                          >
                            {savingStatus === status ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : statusMeta(status, isZh).icon}
                            {statusMeta(status, isZh).label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/clients/${selectedContact.client.id}`)}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary"
                      >
                        <Building2 className="h-4 w-4" />
                        {isZh ? '打开客户' : 'Open client'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveFilter('changed')}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        {isZh ? '查看换公司' : 'Moved contacts'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center text-sm text-slate-500">
                    {isZh ? '请选择一个联系人' : 'Select a contact'}
                  </div>
                )}
              </section>

              {selectedContact ? (
                <ClientStakeholdersStructuredCard
                  clientId={selectedContact.client.id}
                  isZh={isZh}
                  onChanged={(stakeholders) => {
                    setContacts((current) => {
                      const otherClients = current.filter((record) => record.client.id !== selectedContact.client.id)
                      const nextRecords = stakeholders.map((stakeholder) => ({ client: selectedContact.client, stakeholder }))
                      return [...otherClients, ...nextRecords]
                    })
                  }}
                  stakeholders={selectedClientContacts}
                />
              ) : null}
            </aside>
          </div>
        </div>
      </div>
    </>
  )
}

function statusRank(status: ContactStatus) {
  if (status === 'changed') return 0
  if (status === 'unknown') return 1
  if (status === 'left') return 2
  return 3
}

function ContactCard({
  active,
  isZh,
  onSelect,
  record,
}: {
  active: boolean
  isZh: boolean
  onSelect: () => void
  record: ContactRecord
}) {
  const status = getContactStatus(record.stakeholder)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex h-full flex-col rounded-[1.5rem] border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_20px_50px_rgba(15,23,42,0.08)] ${
        active ? 'border-sky-200 bg-sky-50/80' : 'border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-lg font-bold text-sky-700">
            {record.stakeholder.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-900">{record.stakeholder.name}</h3>
            <p className="mt-1 truncate text-sm text-slate-500">
              {record.stakeholder.role || (isZh ? '未填写角色' : 'No role yet')}
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-300 transition group-hover:text-slate-500" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge status={status} isZh={isZh} />
        <MiniBadge icon={<Building2 className="h-3.5 w-3.5" />} label={record.client.name} />
        {record.client.project_names.length > 0 ? (
          <MiniBadge icon={<FolderKanban className="h-3.5 w-3.5" />} label={isZh ? `${record.client.project_names.length} 个项目` : `${record.client.project_names.length} projects`} tone="slate" />
        ) : null}
      </div>

      <p className="mt-4 line-clamp-3 flex-1 text-sm leading-6 text-slate-600">
        {record.stakeholder.communication_strategy ||
          record.stakeholder.personality_profile ||
          record.stakeholder.note ||
          record.stakeholder.concerns ||
          (isZh ? '还没有沟通画像。' : 'No communication profile yet.')}
      </p>

      <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
        {record.stakeholder.contact || record.stakeholder.communication_preference || (isZh ? '未填写联系方式' : 'No contact detail')}
      </div>
    </button>
  )
}

function StatusBadge({ isZh, status }: { isZh: boolean; status: ContactStatus }) {
  const meta = statusMeta(status, isZh)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${meta.className}`}>
      {meta.icon}
      {meta.label}
    </span>
  )
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value?.trim() || '—'}</p>
    </div>
  )
}

function SignalPill({
  label,
  tone = 'sky',
  value,
}: {
  label: string
  tone?: 'sky' | 'amber'
  value: number
}) {
  return (
    <div className={`rounded-full border px-3 py-1.5 text-xs shadow-sm ${tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-white/80 bg-white/75 text-slate-600'}`}>
      {label}: <span className="font-semibold text-slate-900">{value}</span>
    </div>
  )
}

function SummaryCard({
  label,
  tone,
  value,
  sub,
}: {
  label: string
  tone: 'sky' | 'emerald' | 'amber' | 'slate'
  value: number | string
  sub: string
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-100 bg-emerald-50/80 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-100 bg-amber-50/80 text-amber-700'
        : tone === 'slate'
          ? 'border-slate-200 bg-slate-50/80 text-slate-700'
          : 'border-sky-100 bg-sky-50/80 text-sky-700'

  return (
    <div className={`rounded-[1.5rem] border p-5 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 truncate text-sm text-slate-500">{sub}</p>
    </div>
  )
}

function MiniBadge({
  icon,
  label,
  tone = 'sky',
}: {
  icon: ReactNode
  label: string
  tone?: 'sky' | 'slate'
}) {
  const toneClass = tone === 'slate' ? 'border-slate-200 bg-slate-100 text-slate-600' : 'border-sky-100 bg-sky-50 text-sky-700'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${toneClass}`}>
      {icon}
      {label}
    </span>
  )
}
