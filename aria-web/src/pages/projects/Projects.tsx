import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  FolderKanban,
  Plus,
  Loader2,
  Search,
  Package,
  Archive,
  ChevronRight,
  Calendar,
  TrendingUp,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import {
  PROJECT_STAGE_CONFIGS,
  PROJECT_STAGE_IDS,
  resolveProjectStage,
  type ProjectPhase,
  type ProjectStage,
  type ProjectStageConfig,
} from '../../types/enums'
import type { Project } from '../../types/api'
import { User } from 'lucide-react'

// Format number with thousand separators
const formatAmountInTenThousand = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return '0'
  const tenThousand = amount / 10000
  if (tenThousand < 1) {
    return amount.toLocaleString('zh-CN')
  }
  const hasFraction = tenThousand % 1 !== 0
  return hasFraction ? tenThousand.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : tenThousand.toLocaleString('zh-CN')
}

type PhaseConfig = {
  id: ProjectPhase
  label: string
  labelZh: string
  subtitle: string
  subtitleEn: string
  icon: typeof TrendingUp
  color: string
  bgColor: string
  gradient: string
  stages: ProjectStage[]
}

const PHASES: Record<ProjectPhase, PhaseConfig> = {
  business: {
    id: 'business',
    label: 'Business Development',
    labelZh: '商机阶段',
    subtitle: '从线索发现到合同签订',
    subtitleEn: 'From lead discovery to contract signing',
    icon: TrendingUp,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    gradient: 'from-indigo-500/10 via-purple-500/10 to-blue-500/10',
    stages: ['lead_discovery', 'opportunity_qualified', 'proposal', 'negotiation', 'contracting'],
  },
  delivery: {
    id: 'delivery',
    label: 'Delivery Phase',
    labelZh: '交付阶段',
    subtitle: '从项目启动到运维支持',
    subtitleEn: 'From kickoff to ongoing support',
    icon: Package,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    gradient: 'from-emerald-500/10 via-teal-500/10 to-cyan-500/10',
    stages: ['kickoff', 'execution', 'delivery', 'support'],
  },
  archived: {
    id: 'archived',
    label: 'Archived',
    labelZh: '归档',
    subtitle: '已完成项目的历史归档',
    subtitleEn: 'Historical archive of completed projects',
    icon: Archive,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    gradient: 'from-gray-500/5 to-slate-500/5',
    stages: ['archived'],
  },
}

const STAGES = PROJECT_STAGE_CONFIGS

function getProjectStage(project: Project): ProjectStage {
  const explicit = project.status as ProjectStage
  if (PROJECT_STAGE_IDS.includes(explicit)) return explicit
  return resolveProjectStage(project.status).id
}

// Project Card Component
function ProjectCard({
  project,
  stage,
  onClick,
}: {
  project: Project
  stage: ProjectStageConfig
  onClick: () => void
}) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  return (
    <div
      onClick={onClick}
      className="group relative bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden"
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${stage.lightColor}`} />
      
      <div className="pl-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {project.client}
              </span>
            </div>
            <h4 className="font-semibold text-sm text-gray-900 leading-snug line-clamp-2">
              {project.name}
            </h4>
          </div>
        </div>

        {/* Description */}
        {project.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-3 leading-relaxed">
            {project.description}
          </p>
        )}

        {/* Stage badge */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${stage.bgColor} ${stage.color}`}>
            <stage.icon className="w-3 h-3" />
            {isZh ? stage.labelZh : stage.label}
          </span>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-50">
          <div className="flex items-center gap-2">
            {project.contract_amount ? (
              <span className="text-xs font-bold text-gray-800">
                ¥{formatAmountInTenThousand(project.contract_amount)}万
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                {isZh ? '待报价' : 'Quote Pending'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <Calendar className="w-3 h-3" />
            <span>{new Date(project.updated_at).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', { 
              month: 'short', 
              day: 'numeric' 
            })}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Stage Column Component
function StageColumn({
  stage,
  projects,
  onProjectClick,
}: {
  stage: ProjectStageConfig
  projects: Project[]
  onProjectClick: (id: number) => void
}) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const Icon = stage.icon
  const totalValue = projects.reduce((sum, p) => sum + (p.contract_amount || 0), 0)

  return (
    <div className="flex flex-col h-full min-w-0 w-full">
      {/* Stage Header */}
      <div className={`p-3 rounded-xl border ${stage.borderColor} ${stage.bgColor} mb-3`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/80 flex items-center justify-center shadow-sm">
              <Icon className={`w-3.5 h-3.5 ${stage.color}`} />
            </div>
            <span className={`font-semibold text-sm ${stage.color}`}>
              {isZh ? stage.labelZh : stage.label}
            </span>
          </div>
          <span className="text-xs font-bold bg-white/80 px-2 py-0.5 rounded-full shadow-sm min-w-[24px] text-center">
            {projects.length}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 truncate">{isZh ? stage.description : stage.description}</p>
          {totalValue > 0 && (
            <span className="text-xs font-medium text-gray-600">
              ¥{(totalValue / 10000).toFixed(0)}万
            </span>
          )}
        </div>
      </div>

      {/* Projects List */}
      <div className="flex-1 space-y-3 min-h-[100px]">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            stage={stage}
            onClick={() => onProjectClick(project.id)}
          />
        ))}
      </div>
    </div>
  )
}

// Phase Section Component
function PhaseSection({
  phase,
  projects,
  onProjectClick,
  isExpanded,
  onToggle,
}: {
  phase: PhaseConfig
  projects: Project[]
  onProjectClick: (id: number) => void
  isExpanded: boolean
  onToggle: () => void
}) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const Icon = phase.icon

  const phaseStages = STAGES.filter(s => phase.stages.includes(s.id))
  
  const stageProjects = phaseStages.map(stage => ({
    stage,
    projects: projects.filter(p => getProjectStage(p) === stage.id),
  }))

  const totalProjects = stageProjects.reduce((sum, sp) => sum + sp.projects.length, 0)
  const totalValue = projects.reduce((sum, p) => sum + (p.contract_amount || 0), 0)

  return (
    <div className="mb-8">
      {/* Phase Header Card */}
      <div 
        onClick={onToggle}
        className={`relative overflow-hidden rounded-2xl border cursor-pointer transition-all duration-300 ${
          isExpanded 
            ? `bg-gradient-to-r ${phase.gradient} border-gray-200 shadow-sm` 
            : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-md'
        }`}
      >
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-xl ${phase.bgColor} flex items-center justify-center shadow-sm`}>
                <Icon className={`w-7 h-7 ${phase.color}`} />
              </div>
              <div>
                <h2 className={`font-bold text-xl ${phase.color}`}>
                  {isZh ? phase.labelZh : phase.label}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {isZh ? phase.subtitle : phase.subtitleEn}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-8">
              <div className="text-center">
                <p className="text-3xl font-bold text-gray-900">{totalProjects}</p>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-0.5">
                  {isZh ? '项目' : 'Projects'}
                </p>
              </div>
              {totalValue > 0 && (
                <div className="text-center px-8 border-l border-gray-200">
                  <p className="text-xl font-bold text-gray-900">¥{(totalValue / 10000).toFixed(0)}万</p>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-0.5">
                    {isZh ? '金额' : 'Value'}
                  </p>
                </div>
              )}
              <div className={`w-12 h-12 rounded-full ${isExpanded ? phase.bgColor : 'bg-gray-50'} flex items-center justify-center transition-all duration-300`}>
                <ChevronRight className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Phase Content */}
      {isExpanded && (
        <div className="mt-6 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="overflow-x-auto pb-4 -mx-2 px-2">
              <div className="flex gap-5 min-w-max">
                {phaseStages.map((stage) => (
                  <div key={stage.id} className="flex-1 min-w-[220px]">
                    <StageColumn
                      stage={stage}
                      projects={projects.filter(p => getProjectStage(p) === stage.id)}
                      onProjectClick={onProjectClick}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Main Component
export function Projects() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedPhase, setExpandedPhase] = useState<ProjectPhase | null>('business')
  const [users, setUsers] = useState<Array<{ id: number; display_name: string }>>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null)

  useEffect(() => {
    fetchProjects()
  }, [selectedMemberId])

  useEffect(() => {
    let cancelled = false
    setIsLoadingUsers(true)
    api.get<Array<{ id: number; display_name: string }>>("/auth/users/simple")
      .then((data) => {
        if (!cancelled) setUsers(data)
      })
      .catch((err) => console.error("Failed to load users:", err))
      .finally(() => {
        if (!cancelled) setIsLoadingUsers(false)
      })
    return () => { cancelled = true }
  }, [])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const url = selectedMemberId != null
        ? `/projects?member_user_id=${selectedMemberId}`
        : '/projects'
      const data = await api.get<Project[]>(url)
      setProjects(data)
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter projects by search
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const query = searchQuery.toLowerCase()
    return projects.filter(p => 
      p.name.toLowerCase().includes(query) ||
      p.client.toLowerCase().includes(query) ||
      (p.description && p.description.toLowerCase().includes(query))
    )
  }, [projects, searchQuery])

  // Split by phase
  const businessProjects = filteredProjects.filter(p => {
    const stage = getProjectStage(p)
    return STAGES.find(s => s.id === stage)?.phase === 'business'
  })

  const deliveryProjects = filteredProjects.filter(p => {
    const stage = getProjectStage(p)
    return STAGES.find(s => s.id === stage)?.phase === 'delivery'
  })

  const archivedProjects = filteredProjects.filter(p => {
    const stage = getProjectStage(p)
    return STAGES.find(s => s.id === stage)?.phase === 'archived'
  })

  if (loading) {
    return (
      <>
        <PageTitle title={t('projects.title')} />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={t('projects.title')} />
      <div className="min-h-full bg-gradient-to-b from-gray-50 to-white">
        {/* Header */}
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-full mx-auto px-6 py-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <FolderKanban className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                      {isZh ? '项目空间' : 'Project Workspace'}
                    </h1>
                  </div>
                </div>
                <p className="text-sm text-gray-500">
                  {isZh ? '从商机发现到交付运维，全流程可视化管理' : 'Visual management from lead to delivery'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isZh ? '搜索项目...' : 'Search projects...'}
                    className="pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all"
                  />
                </div>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <select
                    value={selectedMemberId ?? ''}
                    onChange={(e) => setSelectedMemberId(e.target.value ? Number(e.target.value) : null)}
                    disabled={isLoadingUsers}
                    className="pl-9 pr-8 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm w-40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all appearance-none cursor-pointer"
                  >
                    <option value="">{isZh ? '全部成员' : 'All members'}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name}</option>
                    ))}
                  </select>
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/projects/new')}
                  className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  {isZh ? '新建项目' : 'New Project'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-full mx-auto px-6 py-8">
          {/* Phase Sections */}
          <PhaseSection
            phase={PHASES.business}
            projects={businessProjects}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            isExpanded={expandedPhase === 'business'}
            onToggle={() => setExpandedPhase(expandedPhase === 'business' ? null : 'business')}
          />

          <PhaseSection
            phase={PHASES.delivery}
            projects={deliveryProjects}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            isExpanded={expandedPhase === 'delivery'}
            onToggle={() => setExpandedPhase(expandedPhase === 'delivery' ? null : 'delivery')}
          />

          <PhaseSection
            phase={PHASES.archived}
            projects={archivedProjects}
            onProjectClick={(id) => navigate(`/projects/${id}`)}
            isExpanded={expandedPhase === 'archived'}
            onToggle={() => setExpandedPhase(expandedPhase === 'archived' ? null : 'archived')}
          />
        </div>
      </div>
    </>
  )
}
