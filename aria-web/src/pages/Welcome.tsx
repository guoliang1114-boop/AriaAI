import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Zap,
  Loader2,
  AlertCircle,
  RefreshCw,
  FolderKanban,
  MessageSquare,
  Sparkles,
  Clock,
  TrendingUp,
  DollarSign,
  Target,
  ChevronRight,
  ListTodo,
  Circle,
} from 'lucide-react'
import { api } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import type { Project, Skill, Conversation, User, MyProjectTodo } from '../types/api'

// ── Chart primitives ──────────────────────────────────────────────────────

interface DonutSegment { value: number; color: string; label: string }

function DonutChart({ segments, size = 80, sw = 10 }: {
  segments: DonutSegment[]; size?: number; sw?: number
}) {
  const total = segments.reduce((s, g) => s + g.value, 0)
  if (total === 0) return null
  const r = (size - sw) / 2
  const cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={sw} />
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ
        const offset = -(acc / total) * circ
        acc += seg.value
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={seg.color} strokeWidth={sw}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={offset} strokeLinecap="round" />
        )
      })}
    </svg>
  )
}

function ActivityBars({ data, color = '#6366f1' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-[3px] h-full w-full">
      {data.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm"
          style={{
            height: `${v > 0 ? Math.max((v / max) * 100, 10) : 0}%`,
            minHeight: v === 0 ? '3px' : undefined,
            backgroundColor: v > 0 ? color : '#e5e7eb',
            opacity: v > 0 ? 0.5 + (i / data.length) * 0.5 : 1,
          }} />
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatCurrency(n: number) {
  if (!n) return '—'
  if (n >= 1_000_000) return `¥${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `¥${(n / 10_000).toFixed(0)}万`
  return `¥${n.toLocaleString()}`
}

function formatRelative(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (diff < 1) return '刚刚'
  if (diff < 60) return `${diff}分钟前`
  if (diff < 1440) return `${Math.floor(diff / 60)}小时前`
  if (diff < 2880) return '昨天'
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const STAGE_GROUPS = [
  { label: '线索发现', key: 'lead',      statuses: ['lead', 'lead_discovery'],                                          color: '#94a3b8' },
  { label: '提案谈判', key: 'proposal',  statuses: ['opportunity_qualified', 'proposal', 'negotiation', 'contracting'], color: '#6366f1' },
  { label: '执行交付', key: 'execution', statuses: ['kickoff', 'execution', 'delivery', 'active'],                      color: '#3b82f6' },
  { label: '支持收尾', key: 'support',   statuses: ['support'],                                                          color: '#8b5cf6' },
  { label: '已完成',   key: 'completed', statuses: ['completed'],                                                         color: '#10b981' },
]

const STAGE_COLOR: Record<string, string> = {
  lead: '#94a3b8', lead_discovery: '#94a3b8',
  opportunity_qualified: '#6366f1', proposal: '#6366f1', negotiation: '#6366f1', contracting: '#6366f1',
  kickoff: '#3b82f6', execution: '#3b82f6', delivery: '#3b82f6', active: '#3b82f6',
  support: '#8b5cf6',
  completed: '#10b981',
  archived: '#d1d5db',
}

// ── Component ─────────────────────────────────────────────────────────────

export function Welcome() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [user, setUser]                   = useState<User | null>(null)
  const [projects, setProjects]           = useState<Project[]>([])
  const [skills, setSkills]               = useState<Skill[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [myTodos, setMyTodos]             = useState<MyProjectTodo[]>([])

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [u, p, s, c, t] = await Promise.all([
        api.get<User>('/auth/me'),
        api.get<Project[]>('/projects'),
        api.get<Skill[]>('/skills'),
        api.get<Conversation[]>('/chat/conversations'),
        api.get<MyProjectTodo[]>('/projects/todos/my'),
      ])
      setUser(u); setProjects(p); setSkills(s); setConversations(c); setMyTodos(t)
    } catch (err: any) {
      if (err.response?.status === 401) throw err
      setError(!err.response
        ? '无法连接到服务器，请确认后端服务正在运行。'
        : `加载失败：${err.response?.data?.detail || err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const nonArchived = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects])

  const stageGroups = useMemo(() =>
    STAGE_GROUPS.map(g => ({
      ...g,
      count: projects.filter(p => g.statuses.includes(p.status)).length,
    })), [projects])

  const donutSegments = useMemo(() =>
    stageGroups.filter(g => g.count > 0).map(g => ({ value: g.count, color: g.color, label: g.label })),
    [stageGroups])

  const totalPipeline = useMemo(() =>
    nonArchived.reduce((s, p) => s + (p.contract_amount || 0), 0), [nonArchived])

  const topProjects = useMemo(() =>
    [...nonArchived]
      .filter(p => (p.contract_amount || 0) > 0)
      .sort((a, b) => (b.contract_amount || 0) - (a.contract_amount || 0))
      .slice(0, 6),
    [nonArchived])
  const maxContract = topProjects[0]?.contract_amount || 1

  const recentProjects = useMemo(() =>
    [...projects]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 6),
    [projects])

  const activityData = useMemo(() => {
    const counts = Array(14).fill(0)
    const now = Date.now()
    conversations.forEach(c => {
      const diff = Math.floor((now - new Date(c.updated_at).getTime()) / 86400000)
      if (diff < 14) counts[13 - diff]++
    })
    return counts
  }, [conversations])

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return t('dashboard.greeting.morning')
    if (h < 17) return t('dashboard.greeting.afternoon')
    return t('dashboard.greeting.evening')
  }

  // ── States ────────────────────────────────────────────────────────────────
  if (loading) return (
    <>
      <PageTitle title={t('dashboard.title')} />
      <div className="h-full bg-[#f5f6f8] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    </>
  )

  if (error) return (
    <>
      <PageTitle title="Dashboard" />
      <div className="h-full bg-[#f5f6f8] flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-4" />
          <p className="text-gray-700 mb-4">{error}</p>
          <button onClick={loadData}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
            <RefreshCw className="w-4 h-4" />重试
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      <PageTitle title="Dashboard" />
      <div className="h-full overflow-auto bg-[#f5f6f8]">
        <div className="px-8 py-8 space-y-6">

          {/* ── Hero ── */}
          <div className="rounded-2xl bg-gradient-to-br from-primary via-indigo-600 to-indigo-700 p-7 relative overflow-hidden">
            <div className="absolute -top-16 right-24 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-1/3 w-48 h-48 bg-indigo-400/10 rounded-full blur-2xl pointer-events-none" />
            <div className="relative z-10 flex items-center gap-10">

              {/* Greeting */}
              <div className="min-w-0">
                <p className="text-white/80 text-sm mb-0.5">{greeting()},</p>
                <h1 className="text-[22px] font-bold text-white mb-5 tracking-tight">
                  {user?.display_name || '欢迎回来'}
                </h1>
                <div className="flex items-center gap-2.5">
                  <button onClick={() => navigate('/chat')}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-primary rounded-xl text-sm font-semibold hover:bg-white/92 active:scale-[0.98] transition-all shadow-sm">
                    <Sparkles className="w-4 h-4" />新对话
                  </button>
                  <button onClick={() => navigate('/projects/new')}
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 text-white rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/15">
                    <FolderKanban className="w-4 h-4" />新建项目
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="w-px h-16 bg-white/15 flex-shrink-0" />

              {/* Inline KPIs — 4 in a row */}
              <div className="flex-1 grid grid-cols-4 gap-4">
                {[
                  { label: '活跃项目', value: nonArchived.length, icon: FolderKanban, sub: `共 ${projects.length} 个` },
                  { label: '合同总价值', value: formatCurrency(totalPipeline), icon: DollarSign, sub: `${topProjects.length} 个已报价` },
                  { label: 'AI 对话', value: conversations.length, icon: MessageSquare, sub: `近14天 ${activityData.reduce((s,v)=>s+v,0)} 次` },
                  { label: '技能库', value: skills.length, icon: Zap, sub: `${new Set(skills.map(s => s.category)).size} 个分类` },
                ].map(kpi => (
                  <div key={kpi.label} className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm border border-white/10">
                    <div className="flex items-center gap-2 mb-1.5">
                      <kpi.icon className="w-3.5 h-3.5 text-white/75" />
                      <span className="text-xs text-white/80 font-medium">{kpi.label}</span>
                    </div>
                    <p className="text-[22px] font-bold text-white leading-none mb-0.5">{kpi.value}</p>
                    <p className="text-xs text-white/70">{kpi.sub}</p>
                  </div>
                ))}
              </div>

              {/* Divider */}
              <div className="w-px h-16 bg-white/15 flex-shrink-0" />

              {/* Donut + legend */}
              {projects.length > 0 && (
                <div className="flex items-center gap-6 flex-shrink-0">
                  <div className="relative w-[84px] h-[84px]">
                    <DonutChart segments={donutSegments} size={84} sw={9} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[20px] font-bold text-white leading-none">{projects.length}</span>
                      <span className="text-white/70 text-xs mt-0.5">项目</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {stageGroups.filter(g => g.count > 0).map(g => (
                      <div key={g.key} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                        <span className="text-white/85 text-xs flex-1 whitespace-nowrap">{g.label}</span>
                        <span className="text-white font-semibold text-xs pl-2">{g.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── 3-column grid ── */}
          <div className="grid grid-cols-12 gap-6 items-start">

            {/* ── COL 1: My Todos + Pipeline ── */}
            <div className="col-span-4 space-y-6">

              {/* My Todos */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100/80">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <ListTodo className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-semibold text-gray-700">我的待办</h2>
                  </div>
                  <span className="text-xs font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-full">
                    {myTodos.length} 待办
                  </span>
                </div>
                {myTodos.length === 0 ? (
                  <div className="text-center py-6">
                    <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
                      <Circle className="w-5 h-5 text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-500">暂无跨项目待办</p>
                    <p className="text-xs text-gray-400 mt-1">在项目页指派待办给自己，会在这里提醒</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {myTodos.slice(0, 6).map(todo => (
                      <button
                        key={todo.id}
                        onClick={() => navigate(`/projects/${todo.project_id}/todos`)}
                        className="w-full flex items-start gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 transition-colors text-left group"
                      >
                        <Circle className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0 group-hover:text-primary transition-colors" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 truncate group-hover:text-primary transition-colors">{todo.content}</p>
                          <p className="text-xs text-gray-500 truncate">{todo.project_name}</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mt-0.5" />
                      </button>
                    ))}
                    {myTodos.length > 6 && (
                      <button
                        onClick={() => navigate('/projects')}
                        className="w-full text-center text-xs text-primary hover:underline pt-1"
                      >
                        查看全部 {myTodos.length} 条待办
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Stage pipeline */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100/80">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-semibold text-gray-700">项目阶段分布</h2>
                  </div>
                  <button onClick={() => navigate('/projects')}
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    全部项目 <ArrowRight className="w-3 h-3" />
                  </button>
                </div>

                {projects.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">
                    暂无项目 —{' '}
                    <button onClick={() => navigate('/projects/new')} className="text-primary hover:underline">立即新建</button>
                  </p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {stageGroups.map(g => {
                        const maxCount = Math.max(...stageGroups.map(x => x.count), 1)
                        const pct = (g.count / maxCount) * 100
                        return (
                          <div key={g.key} className="flex items-center gap-3">
                            <span className="text-sm text-gray-600 w-[4.5rem] flex-shrink-0 text-right">{g.label}</span>
                            <div className="flex-1 bg-gray-50 rounded-full h-6 overflow-hidden relative">
                              {g.count > 0 ? (
                                <div className="h-full rounded-full flex items-center justify-end pr-2.5 transition-all duration-700"
                                  style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: g.color }}>
                                  <span className="text-xs font-semibold text-white">{g.count}</span>
                                </div>
                              ) : (
                                <div className="absolute left-1 top-1/2 -translate-y-1/2 w-4 h-1.5 rounded-full bg-gray-200" />
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Summary row */}
                    <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-100">
                      {[
                        { label: '全部', value: projects.length, color: 'text-gray-700' },
                        { label: '进行中', value: nonArchived.filter(p => ['execution','delivery','kickoff','active'].includes(p.status)).length, color: 'text-blue-600' },
                        { label: '已交付', value: projects.filter(p => p.status === 'delivering' || p.status === 'won').length, color: 'text-emerald-600' },
                        { label: '已归档', value: projects.filter(p => p.status === 'archived').length, color: 'text-gray-500' },
                      ].map(s => (
                        <div key={s.label} className="flex-1 text-center">
                          <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                          <p className="text-xs text-gray-600 mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

            </div>

            {/* ── COL 2: Contract ranking + Recent projects ── */}
            <div className="col-span-5 space-y-6">

              {/* Contract ranking */}
              {topProjects.length > 0 ? (
                <div className="bg-white rounded-2xl p-6 border border-gray-100/80">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" />
                      <h2 className="text-sm font-semibold text-gray-700">合同金额排名</h2>
                    </div>
                    <span className="text-xs text-gray-500">总计 {formatCurrency(totalPipeline)}</span>
                  </div>
                  <div className="space-y-3">
                    {topProjects.map((p, i) => {
                      const pct = ((p.contract_amount || 0) / maxContract) * 100
                      const color = STAGE_COLOR[p.status] || '#3b82f6'
                      return (
                        <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                          className="w-full flex items-center gap-3 group">
                          <span className="text-xs font-medium text-gray-500 w-4 flex-shrink-0 text-right">{i + 1}</span>
                          <div className="w-32 flex-shrink-0 text-left min-w-0">
                            <p className="text-sm font-medium text-gray-700 truncate group-hover:text-primary transition-colors">{p.name}</p>
                            <p className="text-xs text-gray-500 truncate">{p.client}</p>
                          </div>
                          <div className="flex-1 bg-gray-50 rounded-full h-5 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: color, opacity: 0.75 }} />
                          </div>
                          <span className="text-sm font-semibold text-gray-600 w-16 text-right flex-shrink-0">
                            {formatCurrency(p.contract_amount || 0)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-6 border border-gray-100/80">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-semibold text-gray-700">合同金额</h2>
                  </div>
                  <p className="text-sm text-gray-500 text-center py-6">暂无合同金额数据</p>
                </div>
              )}

              {/* Recently updated projects */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100/80">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-semibold text-gray-700">最近更新的项目</h2>
                  </div>
                  <button onClick={() => navigate('/projects')}
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    全部 <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                {recentProjects.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">
                    暂无项目 —{' '}
                    <button onClick={() => navigate('/projects/new')} className="text-primary hover:underline">立即新建</button>
                  </p>
                ) : (
                  <div className="space-y-1">
                    {recentProjects.map(p => (
                      <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                        className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group text-left">
                        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: STAGE_COLOR[p.status] || '#94a3b8' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate group-hover:text-primary transition-colors">{p.name}</p>
                          <p className="text-xs text-gray-500 truncate">{p.client || '—'}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-gray-500">{formatRelative(p.updated_at)}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-all" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* ── COL 3: Activity + Conversations ── */}
            <div className="col-span-3 space-y-6">

              {/* 14-day activity */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100/80">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <h2 className="text-sm font-semibold text-gray-700">对话活跃度</h2>
                    </div>
                    <p className="text-xs text-gray-500 ml-6">近 14 天</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[22px] font-bold text-gray-900 leading-none">{conversations.length}</p>
                    <p className="text-xs text-gray-500 mt-0.5">累计对话</p>
                  </div>
                </div>
                <div className="h-14 w-full">
                  <ActivityBars data={activityData} color="#6366f1" />
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-xs text-gray-500">14天前</span>
                  <span className="text-xs text-gray-500">今天</span>
                </div>
              </div>

              {/* Recent conversations */}
              <div className="bg-white rounded-2xl p-6 border border-gray-100/80">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-700">最近对话</h2>
                  <button onClick={() => navigate('/chat')}
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    全部 <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                {conversations.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-sm text-gray-500 mb-2">暂无对话记录</p>
                    <button onClick={() => navigate('/chat')}
                      className="text-xs text-primary hover:underline">开始第一次对话</button>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {conversations.slice(0, 6).map(c => (
                      <button key={c.id} onClick={() => navigate(`/chat?conversation=${c.id}`)}
                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-gray-50 transition-colors text-left group">
                        <div className="w-6 h-6 rounded-md bg-primary/8 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/15 transition-colors">
                          <MessageSquare className="w-3 h-3 text-primary" />
                        </div>
                        <p className="flex-1 text-sm text-gray-700 truncate">{c.title || '新对话'}</p>
                        <span className="text-xs text-gray-500 flex-shrink-0">{formatRelative(c.updated_at)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>
      </div>
    </>
  )
}
