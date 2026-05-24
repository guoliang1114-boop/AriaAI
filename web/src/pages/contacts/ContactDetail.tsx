import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Brain,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  FileText,
  FolderKanban,
  Link as LinkIcon,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'
import { api } from '../../api/client'
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

type ContactDetailTab = 'basic' | 'analysis' | 'onepager'

export function ContactDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const contactId = Number(id)
  const [record, setRecord] = useState<ContactRecord | null>(null)
  const [clientContacts, setClientContacts] = useState<ClientStakeholder[]>([])
  const [linkedinInfo, setLinkedinInfo] = useState('')
  const [focus, setFocus] = useState('')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ContactDetailTab>('basic')

  const loadContact = async () => {
    setLoading(true)
    setError(null)
    try {
      const clients = await api.get<ClientListItem[]>('/clients')
      for (const client of clients) {
        const stakeholders = await api.get<ClientStakeholder[]>(`/clients/${client.id}/stakeholders`)
        const found = stakeholders.find((stakeholder) => stakeholder.id === contactId)
        if (found) {
          setRecord({ client, stakeholder: found })
          setClientContacts(stakeholders)
          setLinkedinInfo((current) => current || found.note || '')
          setLoading(false)
          return
        }
      }
      setError(isZh ? '没有找到这个联系人' : 'Contact not found')
    } catch {
      setError(isZh ? '联系人详情加载失败' : 'Failed to load contact detail')
    } finally {
      setLoading(false)
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

  const analyze = async () => {
    if (!record) return
    setAnalyzing(true)
    setError(null)
    try {
      const updated = await api.post<ClientStakeholder>(
        `/clients/${record.client.id}/stakeholders/${record.stakeholder.id}/analyze`,
        {
          linkedin_info: linkedinInfo,
          focus,
        },
      )
      setRecord({ ...record, stakeholder: updated })
      setClientContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch {
      setError(isZh ? 'AI 分析失败，请稍后重试' : 'AI analysis failed. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '联系人详情' : 'Contact Detail'} />
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    )
  }

  if (!record) {
    return (
      <>
        <PageTitle title={isZh ? '联系人详情' : 'Contact Detail'} />
        <div className="min-h-full bg-slate-50 px-6 py-8">
          <button
            type="button"
            onClick={() => navigate('/contacts')}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            {isZh ? '返回联系人' : 'Back to contacts'}
          </button>
          <div className="mt-6 rounded-[1.5rem] border border-rose-100 bg-rose-50 p-6 text-rose-700">
            {error || (isZh ? '联系人不存在' : 'Contact does not exist')}
          </div>
        </div>
      </>
    )
  }

  const { client, stakeholder } = record

  return (
    <>
      <PageTitle title={`${stakeholder.name} · ${isZh ? '联系人详情' : 'Contact Detail'}`} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f6f9fc_0%,#eef4fb_36%,#ffffff_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <RouterLink
              to="/contacts"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              {isZh ? '联系人目录' : 'Contact directory'}
            </RouterLink>
            <button
              type="button"
              onClick={() => void loadContact()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              {isZh ? '刷新' : 'Refresh'}
            </button>
          </div>

          <section className="relative overflow-hidden rounded-[2rem] border border-sky-100 bg-[radial-gradient(circle_at_top_right,#dff3ff_0%,#f0f8ff_42%,#ffffff_100%)] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.08)]">
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-sky-200/35 blur-3xl" />
            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-sky-700 shadow-sm backdrop-blur">
                  <UserRound className="h-3.5 w-3.5" />
                  <span>{isZh ? '联系人详情' : 'Contact detail'}</span>
                </div>
                <h1 className="text-2xl font-semibold text-slate-900">{stakeholder.name}</h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  {[stakeholder.role, stakeholder.organization_level, client.name].filter(Boolean).join(' · ') ||
                    (isZh ? '补充 TA 的角色、公司与沟通背景，形成可复用的人际关系洞察。' : 'Add role, company, and communication context to build reusable relationship insight.')}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <SignalPill label={isZh ? '当前客户' : 'Client'} value={client.name} />
                  <SignalPill label={isZh ? '关系状态' : 'Status'} value={stakeholder.relationship_status || 'unknown'} tone="emerald" />
                  <SignalPill label={isZh ? '项目数' : 'Projects'} value={String(client.project_names.length)} tone="amber" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/clients/${client.id}`)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:bg-primary"
              >
                <Building2 className="h-4 w-4" />
                {isZh ? '打开客户' : 'Open client'}
              </button>
            </div>
          </section>

          {error ? (
            <div className="mt-6 rounded-[1.25rem] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white/90 p-2 shadow-sm">
            <div className="grid gap-2 md:grid-cols-3">
              <TabButton
                active={activeTab === 'basic'}
                icon={<UserRound className="h-4 w-4" />}
                label={isZh ? '基本信息' : 'Basic info'}
                onClick={() => setActiveTab('basic')}
              />
              <TabButton
                active={activeTab === 'analysis'}
                icon={<Brain className="h-4 w-4" />}
                label={isZh ? '深度分析' : 'Deep analysis'}
                onClick={() => setActiveTab('analysis')}
              />
              <TabButton
                active={activeTab === 'onepager'}
                icon={<CheckCircle2 className="h-4 w-4" />}
                label={isZh ? '合伙人一页纸' : 'Partner one-pager'}
                onClick={() => setActiveTab('onepager')}
              />
            </div>
          </div>

          {activeTab === 'analysis' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-6">
              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  <h2 className="text-lg font-semibold text-slate-900">{isZh ? 'LinkedIn / 公开资料分析' : 'LinkedIn / public profile analysis'}</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {isZh
                    ? '把你掌握的 LinkedIn 简介、经历、动态、教育背景或你对 TA 的观察粘贴进来，AI 会结合客户记忆和项目上下文做完整分析。'
                    : 'Paste profile text, career history, posts, education, or your own observations. AI will combine it with client memory and project context.'}
                </p>
                <textarea
                  value={linkedinInfo}
                  onChange={(event) => setLinkedinInfo(event.target.value)}
                  rows={8}
                  placeholder={isZh ? '粘贴 LinkedIn 信息、个人简介、职业经历、近期动态、你观察到的沟通风格...' : 'Paste LinkedIn info, summary, work history, recent posts, observed communication style...'}
                  className="mt-4 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                />
                <input
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                  placeholder={isZh ? '可选：这次重点分析什么？例如如何推进合同、如何建立信任、TA 是否可能换公司' : 'Optional focus: e.g. trust building, contract push, company-change risk'}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                />
                <button
                  type="button"
                  onClick={() => void analyze()}
                  disabled={analyzing}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.12)] transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                  {isZh ? 'AI 全面分析并写回联系人' : 'Analyze and update contact'}
                </button>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <InsightCard icon={<Brain className="h-4 w-4" />} title={isZh ? '性格画像' : 'Personality'} value={stakeholder.personality_profile} />
                <InsightCard icon={<BriefcaseBusiness className="h-4 w-4" />} title={isZh ? '决策风格' : 'Decision style'} value={stakeholder.decision_style} />
                <InsightCard icon={<MessageSquareText className="h-4 w-4" />} title={isZh ? '沟通策略' : 'Communication strategy'} value={stakeholder.communication_strategy} />
                <InsightCard icon={<ShieldAlert className="h-4 w-4" />} title={isZh ? '信任/风险信号' : 'Trust / risk signals'} value={stakeholder.trust_signals} />
              </section>

              <div className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
                <ContactAnalysisCanvas isZh={isZh} stakeholder={stakeholder} />
                <FiveDimensionAnalysis isZh={isZh} stakeholder={stakeholder} />
              </div>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">{isZh ? '基础资料' : 'Profile fields'}</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <DetailRow icon={<BriefcaseBusiness className="h-4 w-4" />} label={isZh ? '角色' : 'Role'} value={stakeholder.role} />
                  <DetailRow icon={<Users className="h-4 w-4" />} label={isZh ? '影响类型' : 'Influence type'} value={stakeholder.influence_type} />
                  <DetailRow icon={<LinkIcon className="h-4 w-4" />} label={isZh ? '联系方式' : 'Contact'} value={stakeholder.contact} />
                  <DetailRow icon={<MessageSquareText className="h-4 w-4" />} label={isZh ? '沟通偏好' : 'Communication preference'} value={stakeholder.communication_preference} />
                  <DetailRow icon={<ShieldAlert className="h-4 w-4" />} label={isZh ? '关注点' : 'Concerns'} value={stakeholder.concerns} />
                  <DetailRow icon={<FileText className="h-4 w-4" />} label={isZh ? '备注' : 'Notes'} value={stakeholder.note} />
                </div>
              </section>
            </div>

            <aside className="space-y-6">
              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">{isZh ? '当前关联' : 'Current affiliation'}</h2>
                <div className="mt-4 space-y-3">
                  <DetailRow icon={<Building2 className="h-4 w-4" />} label={isZh ? '客户' : 'Client'} value={client.name} />
                  <DetailRow icon={<FolderKanban className="h-4 w-4" />} label={isZh ? '项目' : 'Projects'} value={client.project_names.join('\n')} />
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">{isZh ? '同客户其他联系人' : 'Other contacts at this client'}</h2>
                <div className="mt-4 space-y-3">
                  {relatedContacts.length ? (
                    relatedContacts.map((contact) => (
                      <RouterLink
                        key={contact.id}
                        to={`/contacts/${contact.id}`}
                        className="block rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-sky-200 hover:bg-white"
                      >
                        <div className="font-medium text-slate-900">{contact.name}</div>
                        <div className="mt-1 text-sm text-slate-500">{contact.role || (isZh ? '未填写角色' : 'No role')}</div>
                      </RouterLink>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      {isZh ? '暂无其他联系人' : 'No other contacts yet'}
                    </div>
                  )}
                </div>
              </section>
            </aside>
          </div>
          ) : null}

          {activeTab === 'basic' ? (
            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">{isZh ? '基础信息' : 'Basic information'}</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <DetailRow icon={<BriefcaseBusiness className="h-4 w-4" />} label={isZh ? '角色' : 'Role'} value={stakeholder.role} />
                  <DetailRow icon={<Users className="h-4 w-4" />} label={isZh ? '影响类型' : 'Influence type'} value={stakeholder.influence_type} />
                  <DetailRow icon={<LinkIcon className="h-4 w-4" />} label={isZh ? '联系方式' : 'Contact'} value={stakeholder.contact} />
                  <DetailRow icon={<MessageSquareText className="h-4 w-4" />} label={isZh ? '沟通偏好' : 'Communication preference'} value={stakeholder.communication_preference} />
                  <DetailRow icon={<ShieldAlert className="h-4 w-4" />} label={isZh ? '关注点' : 'Concerns'} value={stakeholder.concerns} />
                  <DetailRow icon={<FileText className="h-4 w-4" />} label={isZh ? '备注' : 'Notes'} value={stakeholder.note} />
                </div>
              </section>

              <aside className="space-y-6">
                <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-slate-900">{isZh ? '当前关联' : 'Current affiliation'}</h2>
                  <div className="mt-4 space-y-3">
                    <DetailRow icon={<Building2 className="h-4 w-4" />} label={isZh ? '客户' : 'Client'} value={client.name} />
                    <DetailRow icon={<FolderKanban className="h-4 w-4" />} label={isZh ? '项目' : 'Projects'} value={client.project_names.join('\n')} />
                  </div>
                </section>

                <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-slate-900">{isZh ? '同客户其他联系人' : 'Other contacts at this client'}</h2>
                  <div className="mt-4 space-y-3">
                    {relatedContacts.length ? (
                      relatedContacts.map((contact) => (
                        <RouterLink
                          key={contact.id}
                          to={`/contacts/${contact.id}`}
                          className="block rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-sky-200 hover:bg-white"
                        >
                          <div className="font-medium text-slate-900">{contact.name}</div>
                          <div className="mt-1 text-sm text-slate-500">{contact.role || (isZh ? '未填写角色' : 'No role')}</div>
                        </RouterLink>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        {isZh ? '暂无其他联系人' : 'No other contacts yet'}
                      </div>
                    )}
                  </div>
                </section>
              </aside>
            </div>
          ) : null}

          {activeTab === 'onepager' ? (
            <div className="mt-6">
              <PartnerOnePager client={client} isZh={isZh} stakeholder={stakeholder} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-[1.1rem] px-4 py-3 text-sm font-semibold transition ${
        active
          ? 'bg-slate-900 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function getDimensionData(stakeholder: ClientStakeholder, isZh: boolean) {
  const dimensions = [
    {
      key: 'power',
      label: isZh ? '权力与影响力' : 'Power mapping',
      score: scoreDimension([stakeholder.influence_type, stakeholder.decision_style, stakeholder.relationship_status]),
      summary: stakeholder.decision_style || stakeholder.influence_type,
      evidence: [stakeholder.influence_type, stakeholder.relationship_status].filter(Boolean).join(' / '),
    },
    {
      key: 'profile',
      label: isZh ? '个人动机与风格' : 'Personal profile',
      score: scoreDimension([stakeholder.personality_profile, stakeholder.communication_preference, stakeholder.sensitivities]),
      summary: stakeholder.personality_profile,
      evidence: stakeholder.communication_preference,
    },
    {
      key: 'relationship',
      label: isZh ? '关系网络' : 'Relationship web',
      score: scoreDimension([stakeholder.trust_signals, stakeholder.note, stakeholder.concerns]),
      summary: stakeholder.trust_signals,
      evidence: stakeholder.note,
    },
    {
      key: 'context',
      label: isZh ? '项目情境与 stakes' : 'Context and stakes',
      score: scoreDimension([stakeholder.concerns, stakeholder.sensitivities, stakeholder.last_action]),
      summary: stakeholder.concerns,
      evidence: stakeholder.sensitivities,
    },
    {
      key: 'tracking',
      label: isZh ? '动态追踪' : 'Ongoing intelligence',
      score: scoreDimension([stakeholder.last_action, stakeholder.note, stakeholder.relationship_status]),
      summary: stakeholder.last_action,
      evidence: stakeholder.relationship_status,
    },
  ]
  return dimensions
}

function scoreDimension(values: Array<string | undefined>) {
  const text = values.filter(Boolean).join(' ')
  if (!text.trim()) return 1
  if (text.length > 700) return 5
  if (text.length > 360) return 4
  if (text.length > 160) return 3
  return 2
}

function ContactAnalysisCanvas({ isZh, stakeholder }: { isZh: boolean; stakeholder: ClientStakeholder }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dimensions = useMemo(() => getDimensionData(stakeholder, isZh), [isZh, stakeholder])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const cx = rect.width / 2
    const cy = rect.height / 2 + 8
    const radius = Math.min(rect.width, rect.height) * 0.31
    const count = dimensions.length

    ctx.lineWidth = 1
    for (let level = 1; level <= 5; level += 1) {
      ctx.beginPath()
      for (let index = 0; index < count; index += 1) {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / count
        const r = (radius * level) / 5
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = level === 5 ? '#bae6fd' : '#e2e8f0'
      ctx.stroke()
    }

    dimensions.forEach((dimension, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
      ctx.strokeStyle = '#e2e8f0'
      ctx.stroke()
      const labelRadius = radius + 34
      const lx = cx + Math.cos(angle) * labelRadius
      const ly = cy + Math.sin(angle) * labelRadius
      ctx.fillStyle = '#334155'
      ctx.font = '12px sans-serif'
      ctx.textAlign = lx < cx - 4 ? 'right' : lx > cx + 4 ? 'left' : 'center'
      ctx.fillText(dimension.label, lx, ly)
    })

    ctx.beginPath()
    dimensions.forEach((dimension, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count
      const r = (radius * dimension.score) / 5
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(14, 165, 233, 0.18)'
    ctx.strokeStyle = '#0284c7'
    ctx.lineWidth = 2
    ctx.fill()
    ctx.stroke()

    dimensions.forEach((dimension, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count
      const r = (radius * dimension.score) / 5
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#0369a1'
      ctx.fill()
    })
  }, [dimensions])

  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-sky-600" />
        <h2 className="text-lg font-semibold text-slate-900">{isZh ? '五维分析雷达图' : 'Five-dimension radar'}</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {isZh ? '分数代表当前档案在该维度的信息充分度，不等于好坏判断。' : 'Scores reflect evidence completeness in each dimension, not a positive or negative judgment.'}
      </p>
      <canvas ref={canvasRef} className="mt-4 h-[320px] w-full rounded-2xl bg-slate-50" />
    </section>
  )
}

function FiveDimensionAnalysis({ isZh, stakeholder }: { isZh: boolean; stakeholder: ClientStakeholder }) {
  const dimensions = useMemo(() => getDimensionData(stakeholder, isZh), [isZh, stakeholder])
  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-sky-600" />
        <h2 className="text-lg font-semibold text-slate-900">{isZh ? '深度分析五维度' : 'Deep analysis dimensions'}</h2>
      </div>
      <div className="mt-4 grid gap-3">
        {dimensions.map((dimension) => (
          <div key={dimension.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">{dimension.label}</h3>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-sky-700">
                {dimension.score}/5
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {dimension.summary?.trim() || (isZh ? '暂无足够证据，需要继续补充情报。' : 'Not enough evidence yet. Add more intelligence.')}
            </p>
            {dimension.evidence ? (
              <p className="mt-2 border-t border-slate-200 pt-2 text-xs leading-5 text-slate-500">{dimension.evidence}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function SignalPill({
  label,
  tone = 'sky',
  value,
}: {
  label: string
  tone?: 'sky' | 'emerald' | 'amber'
  value: string
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-white/80 bg-white/75 text-slate-600'
  return (
    <div className={`rounded-full border px-3 py-1.5 text-xs shadow-sm ${toneClass}`}>
      {label}: <span className="font-semibold text-slate-900">{value}</span>
    </div>
  )
}

function InsightCard({ icon, title, value }: { icon: ReactNode; title: string; value?: string }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="text-sky-600">{icon}</span>
        {title}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{value?.trim() || '—'}</p>
    </div>
  )
}

function PartnerOnePager({
  client,
  isZh,
  stakeholder,
}: {
  client: ClientListItem
  isZh: boolean
  stakeholder: ClientStakeholder
}) {
  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {isZh ? '合伙人一页纸' : 'Partner one-pager'}
          </div>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">
            {isZh ? '五维动态画像' : 'Five-dimensional dynamic profile'}
          </h2>
        </div>
        <p className="max-w-xl text-sm leading-6 text-slate-500">
          {isZh
            ? '用于判断权力、动机、关系网络、项目 stakes 和下一步情报动作。'
            : 'Use this to judge power, motivation, relationship web, project stakes, and next intelligence moves.'}
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <OnePagerBlock
          title={isZh ? '基本信息' : 'Basic info'}
          items={[
            [isZh ? '姓名/职位' : 'Name / title', [stakeholder.name, stakeholder.role].filter(Boolean).join(' / ')],
            [isZh ? '汇报线/层级' : 'Reporting line / level', stakeholder.organization_level],
            [isZh ? '当前公司' : 'Current company', client.name],
          ]}
        />
        <OnePagerBlock
          title={isZh ? '权力评估' : 'Power mapping'}
          items={[
            [isZh ? '正式权力' : 'Formal authority', stakeholder.influence_type],
            [isZh ? '实际影响力' : 'Informal influence', stakeholder.decision_style],
            [isZh ? '可控预算/流程' : 'Budget / process control', stakeholder.relationship_status],
          ]}
        />
        <OnePagerBlock
          title={isZh ? '动机与风格' : 'Motivation and style'}
          items={[
            [isZh ? '动机标签' : 'Motivation tag', stakeholder.personality_profile],
            [isZh ? '沟通偏好' : 'Communication preference', stakeholder.communication_preference],
            [isZh ? '风险容忍度' : 'Risk tolerance', stakeholder.sensitivities],
          ]}
        />
        <OnePagerBlock
          title={isZh ? '关系状态' : 'Relationship state'}
          items={[
            [isZh ? '与我们的信任度' : 'Trust with us', stakeholder.trust_signals],
            [isZh ? '信息开放度' : 'Information openness', stakeholder.concerns],
            [isZh ? '内部盟友/对手' : 'Internal allies / blockers', stakeholder.note],
          ]}
        />
        <OnePagerBlock
          title={isZh ? '当前项目 stakes' : 'Current project stakes'}
          items={[
            [isZh ? '个人影响' : 'Personal impact', stakeholder.concerns],
            [isZh ? '时间压力' : 'Time pressure', stakeholder.last_action],
            [isZh ? '政治敏感度' : 'Political sensitivity', stakeholder.sensitivities],
          ]}
        />
        <OnePagerBlock
          title={isZh ? '下一步行动' : 'Next actions'}
          items={[
            [isZh ? '需强化关系' : 'Relationship to strengthen', stakeholder.communication_strategy],
            [isZh ? '需获取信息' : 'Intelligence to collect', stakeholder.trust_signals],
            [isZh ? '需防范风险' : 'Risks to watch', stakeholder.sensitivities || stakeholder.concerns],
          ]}
        />
      </div>
    </section>
  )
}

function OnePagerBlock({ items, title }: { items: Array<[string, string | undefined]>; title: string }) {
  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-3">
        {items.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs font-semibold text-slate-500">{label}</div>
            <div className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {value?.trim() || '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
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
