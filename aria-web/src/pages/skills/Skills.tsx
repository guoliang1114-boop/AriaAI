import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  TrendingUp,
  DollarSign,
  Shield,
  FileText,
  Users,
  Cpu,
  Briefcase,
  Target,
  BarChart3,
  Clock,
  ArrowRight,
  Plus,
  Loader2,
  Brain,
  MessageSquare,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { SkillSummary } from '../../types/api'

const getSkillTypes = (t: any) => [
  { id: 'all', label: t('skills.types.all') },
  { id: 'quick', label: t('skills.types.quick') },
  { id: 'deep', label: t('skills.types.deep') },
]

const extractMinutes = (estimatedTime?: string): number => {
  if (!estimatedTime) return 0
  const match = estimatedTime.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

const normalizeCategory = (value: string) => value.replace(/\?/g, '').trim()

const getCategoryKey = (category: string) => {
  const normalized = normalizeCategory(category)

  const knownKeys = [
    { key: 'strategy', values: ['閹存鏆愭稉搴☆杻闂€'] },
    { key: 'market', values: ['鐢倸婧€娑撳骸顓归幋'] },
    { key: 'manda', values: ['楠炴儼鍠樻稉搴濇唉閺'] },
    { key: 'finance', values: ['鐠愩垹濮熼崪銊嚄'] },
    { key: 'digital', values: ['閺佹澘鐡ч崠鏍︾瑢閹垛偓閺'] },
    { key: 'org', values: ['缂佸嫮绮愭稉搴濇眽閹'] },
    { key: 'operations', values: ['鏉╂劘鎯€娑撳孩鏅ラ懗'] },
    { key: 'risk', values: ['妞嬪酣娅撴稉搴℃値鐟'] },
    { key: 'proposals', values: ['閹绘劖顢嶆稉搴ㄣ€嶉惄顔绘唉娴'] },
  ]

  const matched = knownKeys.find((item) => item.values.some((value) => normalized === value))
  return matched?.key ?? normalized
}

const getCategoryLabel = (category: string, t: any) => {
  switch (getCategoryKey(category)) {
    case 'strategy':
      return t('skills.categories.strategy')
    case 'market':
      return t('skills.categories.market')
    case 'manda':
      return t('skills.categories.manda')
    case 'finance':
      return t('skills.categories.finance')
    case 'digital':
      return t('skills.categories.digital')
    case 'org':
      return t('skills.categories.org')
    case 'operations':
      return t('skills.categories.operations')
    case 'risk':
      return t('skills.categories.risk')
    case 'proposals':
      return t('skills.categories.proposals')
    default:
      return category
  }
}

const getSkillIcon = (category: string) => {
  switch (getCategoryKey(category)) {
    case 'strategy':
      return TrendingUp
    case 'market':
      return Target
    case 'manda':
      return DollarSign
    case 'finance':
      return BarChart3
    case 'digital':
      return Cpu
    case 'org':
      return Users
    case 'operations':
      return Briefcase
    case 'risk':
      return Shield
    case 'proposals':
      return FileText
    default:
      return Brain
  }
}

const getCategoryColor = (category: string) => {
  switch (getCategoryKey(category)) {
    case 'strategy':
      return 'bg-primary/10 text-primary'
    case 'market':
      return 'bg-tertiary/10 text-tertiary'
    case 'manda':
      return 'bg-error/10 text-error'
    case 'finance':
      return 'bg-green-500/10 text-green-600'
    case 'digital':
      return 'bg-blue-500/10 text-blue-600'
    case 'org':
      return 'bg-purple-500/10 text-purple-600'
    case 'operations':
      return 'bg-active/10 text-active'
    case 'risk':
      return 'bg-orange-500/10 text-orange-600'
    case 'proposals':
      return 'bg-secondary-container text-on-secondary-container'
    default:
      return 'bg-surface-container-high text-on-surface-muted'
  }
}

export function Skills() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const skillTypes = getSkillTypes(t)
  const [loading, setLoading] = useState(true)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeType, setActiveType] = useState('all')

  const handleUseSkill = (skillId: number) => {
    const projectId = searchParams.get('project')
    const nextParams = new URLSearchParams({ skill: String(skillId) })
    if (projectId) {
      nextParams.set('project', projectId)
    }
    navigate(`/chat?${nextParams.toString()}`)
  }

  useEffect(() => {
    void fetchSkills()
  }, [])

  const fetchSkills = async () => {
    try {
      setLoading(true)
      const data = await api.get<SkillSummary[]>('/skills/meta/summary')
      setSkills(data)
    } catch (error) {
      console.error('Failed to fetch skills:', error)
    } finally {
      setLoading(false)
    }
  }

  const categories = useMemo(
    () => [
      { id: 'all', label: t('skills.categories.all') },
      ...Array.from(new Map(skills.map((skill) => [normalizeCategory(skill.category), skill.category])).values()).map((category) => ({
        id: category,
        label: getCategoryLabel(category, t),
      })),
    ],
    [skills, t],
  )

  const filteredSkills = useMemo(
    () =>
      skills.filter((skill) => {
        const categoryMatch =
          activeCategory === 'all' || normalizeCategory(skill.category) === normalizeCategory(activeCategory)
        const estimatedMinutes = extractMinutes(skill.estimated_time)
        const isQuick = estimatedMinutes <= 10
        const typeMatch =
          activeType === 'all' ||
          (activeType === 'quick' && isQuick) ||
          (activeType === 'deep' && !isQuick)
        return categoryMatch && typeMatch
      }),
    [activeCategory, activeType, skills],
  )

  const featuredSkill = useMemo(
    () => filteredSkills.find((s) => s.name.includes('Market') || s.name.includes('Strategic')) || filteredSkills[0],
    [filteredSkills],
  )

  const regularSkills = useMemo(
    () => filteredSkills.filter((s) => s.id !== featuredSkill?.id),
    [featuredSkill?.id, filteredSkills],
  )

  const newTodayCount = useMemo(
    () => skills.filter((s) => s.created_at && new Date(s.created_at).toDateString() === new Date().toDateString()).length,
    [skills],
  )

  if (loading) {
    return (
      <>
        <PageTitle title="Skills" />
        <div className="min-h-full bg-surface flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title="Skills" />
      <div className="min-h-full bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="relative rounded-3xl bg-gradient-primary p-10 mb-8 overflow-hidden shadow-2xl shadow-primary/20">
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-0 right-0 w-96 h-96 bg-white/30 rounded-full blur-3xl"></div>
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-400/20 rounded-full blur-3xl"></div>
            </div>

            <div className="relative z-10 flex items-start justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 backdrop-blur-md mb-6 border border-white/10">
                  <span className="text-label-sm text-white/90 font-semibold tracking-wider">{t('skills.eliteEdition')}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                </div>

                <h1 className="text-headline-lg text-white mb-4 leading-tight">
                  The Intelligent Stratum
                  <br />
                  <span className="text-gradient bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">{t('skills.title')}</span>
                </h1>
                <p className="text-body-lg text-white/80 max-w-xl leading-relaxed">{t('skills.subtitle')}</p>
              </div>

              <div className="hidden lg:flex gap-6">
                <div className="text-center px-6 py-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10">
                  <div className="text-4xl font-manrope font-bold text-white mb-1">{skills.length}</div>
                  <div className="text-sm text-white/70 font-medium tracking-wide">{t('skills.activeSkills')}</div>
                </div>
                <div className="text-center px-6 py-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10">
                  <div className="text-4xl font-manrope font-bold text-white mb-1">{newTodayCount}</div>
                  <div className="text-sm text-white/70 font-medium tracking-wide">{t('skills.newToday')}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-8">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  normalizeCategory(activeCategory) === normalizeCategory(cat.id)
                    ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-105'
                    : 'bg-white text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface border border-outline/20 hover:border-outline/40'
                }`}
              >
                {cat.label}
              </button>
            ))}
            <div className="flex-1"></div>
            <div className="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl">
              {skillTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setActiveType(type.id)}
                  className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    activeType === type.id ? 'bg-white text-on-surface shadow-sm' : 'text-on-surface-muted hover:text-on-surface'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {filteredSkills.length === 0 ? (
            <div className="card-premium text-center py-20">
              <div className="w-20 h-20 rounded-2xl bg-surface-container-low flex items-center justify-center mx-auto mb-6">
                <Brain className="w-10 h-10 text-on-surface-muted" />
              </div>
              <h3 className="text-headline-sm text-on-surface mb-3">{t('skills.noSkills')}</h3>
              <p className="text-body-md text-on-surface-muted max-w-md mx-auto">{t('skills.createFirst')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-6 mb-10">
              {featuredSkill && (
                <div className="col-span-12 lg:col-span-6">
                  <div className="card-premium h-full flex flex-col group cursor-pointer" onClick={() => handleUseSkill(featuredSkill.id)}>
                    <div className="flex items-start justify-between mb-6">
                      <div
                        className={`w-16 h-16 rounded-2xl ${getCategoryColor(featuredSkill.category)} flex items-center justify-center transition-transform group-hover:scale-110`}
                      >
                        {(() => {
                          const Icon = getSkillIcon(featuredSkill.category)
                          return <Icon className="w-8 h-8" />
                        })()}
                      </div>
                      <span className="px-4 py-1.5 rounded-full bg-surface-container-low text-label-sm text-on-surface-muted font-medium border border-outline/10">
                        {getCategoryLabel(featuredSkill.category, t)}
                      </span>
                    </div>

                    <h3 className="text-headline-sm text-on-surface mb-3 group-hover:text-primary transition-colors">{featuredSkill.name}</h3>
                    <p className="text-body-md text-on-surface-muted mb-6 flex-1 leading-relaxed">{featuredSkill.description}</p>

                    <div className="flex items-center gap-4 mb-6">
                      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-low border border-outline/10">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            extractMinutes(featuredSkill.estimated_time) > 10 ? 'bg-primary' : 'bg-emerald-500'
                          }`}
                        ></span>
                        <span className="text-sm font-medium text-on-surface">
                          {extractMinutes(featuredSkill.estimated_time) > 10 ? t('skills.types.deep') : t('skills.types.quick')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-on-surface-muted font-medium">
                        <Clock className="w-4 h-4" />
                        {featuredSkill.estimated_time || '~30 mins'}
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-5 rounded-xl bg-surface-container-low border border-outline/10">
                      <div className="flex-1 min-w-0 mr-4">
                        <p className="text-label-sm text-on-surface-muted mb-1 font-semibold">{t('skills.estimatedTime')}</p>
                        <p className="text-sm text-on-surface">{featuredSkill.estimated_time || '~30 mins'}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleUseSkill(featuredSkill.id)
                        }}
                        className="w-12 h-12 rounded-xl bg-gradient-primary flex items-center justify-center text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all flex-shrink-0 group-hover:scale-105"
                        title={t('skills.useSkill')}
                      >
                        <MessageSquare className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {regularSkills.map((skill) => {
                const SkillIcon = getSkillIcon(skill.category)
                const isQuick = extractMinutes(skill.estimated_time) <= 10
                return (
                  <div key={skill.id} className="col-span-12 md:col-span-6 lg:col-span-3">
                    <div className="card-premium hover-lift h-full flex flex-col group cursor-pointer" onClick={() => handleUseSkill(skill.id)}>
                      <div className="flex items-start justify-between mb-4">
                        <div
                          className={`w-12 h-12 rounded-xl ${getCategoryColor(skill.category)} flex items-center justify-center transition-transform group-hover:scale-110`}
                        >
                          <SkillIcon className="w-5 h-5" />
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-surface-container-low text-label-sm text-on-surface-muted font-medium border border-outline/10">
                          {getCategoryLabel(skill.category, t)}
                        </span>
                      </div>

                      <h4 className="text-label-lg text-on-surface mb-2 group-hover:text-primary transition-colors">{skill.name}</h4>
                      <p className="text-body-sm text-on-surface-muted mb-4 flex-1 line-clamp-2 leading-relaxed">{skill.description}</p>

                      <div className="space-y-3 pt-4 border-t border-outline/10">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-on-surface-muted font-medium">{t('skills.type')}</span>
                          <span className={`font-semibold ${isQuick ? 'text-emerald-600' : 'text-primary'}`}>
                            {isQuick ? t('skills.types.quick') : t('skills.types.deep')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-on-surface-muted font-medium">{t('skills.estimatedTime')}</span>
                          <span className="font-semibold text-on-surface">{skill.estimated_time || '~30 mins'}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleUseSkill(skill.id)
                          }}
                          className="w-full mt-3 py-2.5 rounded-xl bg-primary/5 hover:bg-primary/10 border border-primary/20 text-primary text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                          <MessageSquare className="w-4 h-4" />
                          {t('skills.useSkill')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="card-premium border-l-4 border-tertiary hover-lift">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-tertiary/20 to-tertiary/5 flex items-center justify-center shadow-inner">
                  <Plus className="w-7 h-7 text-tertiary" />
                </div>
                <div>
                  <h3 className="text-label-lg text-on-surface mb-1 font-semibold">{t('skills.customWorkflowTitle')}</h3>
                  <p className="text-body-sm text-on-surface-muted leading-relaxed">{t('skills.customWorkflowDesc')}</p>
                </div>
              </div>
              <button className="btn-premium flex items-center gap-2 whitespace-nowrap">
                {t('skills.requestWorkflow')}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <footer className="mt-16 pt-8 border-t border-outline/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-on-surface-muted">
                <span>{t('skills.footer')}</span>
              </div>
              <div className="flex items-center gap-6 text-sm text-on-surface-muted">
                <a href="#" className="hover:text-on-surface transition-colors">
                  {t('skills.resources')}
                </a>
                <a href="#" className="hover:text-on-surface transition-colors">
                  {t('skills.legal')}
                </a>
                <a href="#" className="hover:text-on-surface transition-colors">
                  {t('skills.support')}
                </a>
                <a href="#" className="hover:text-on-surface transition-colors">
                  {t('skills.language')}
                </a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  )
}
