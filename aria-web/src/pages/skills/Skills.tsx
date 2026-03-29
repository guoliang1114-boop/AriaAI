import { useEffect, useState } from 'react'
import { 
  TrendingUp, 
  DollarSign, 
  Shield, 
  Users, 
  Cpu,
  FileText,
  Truck,
  Clock,
  ArrowRight,
  Sparkles,
  Plus,
  Loader2,
  Brain
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { Skill } from '../../types/api'

const categories = [
  { id: 'all', label: 'All Capabilities' },
  { id: '战略与增长', label: 'Strategy & Growth' },
  { id: 'finance', label: 'Finance' },
  { id: 'digital', label: 'Digital & Tech' },
  { id: 'risk', label: 'Risk & Compliance' },
  { id: 'org', label: 'Org & People' },
  { id: '提案与项目交付', label: 'Proposals' },
]

const skillTypes = [
  { id: 'all', label: 'All Types' },
  { id: 'quick', label: 'Quick Tool' },
  { id: 'deep', label: 'Deep Task' },
]

// Map skill categories to icons
const getSkillIcon = (category: string) => {
  switch (category) {
    case '战略与增长': return TrendingUp
    case 'finance': return DollarSign
    case 'risk': return Shield
    case 'org': return Users
    case 'digital': return Cpu
    case '提案与项目交付': return FileText
    case 'operations': return Truck
    default: return Brain
  }
}

const getCategoryColor = (category: string) => {
  switch (category) {
    case '战略与增长': return 'bg-primary/10 text-primary'
    case 'finance': return 'bg-tertiary/10 text-tertiary'
    case 'risk': return 'bg-active/10 text-active'
    case 'org': return 'bg-secondary-container text-on-secondary-container'
    case 'digital': return 'bg-primary/10 text-primary'
    case '提案与项目交付': return 'bg-primary/10 text-primary'
    default: return 'bg-surface-container-high text-on-surface-muted'
  }
}

export function Skills() {
  const [loading, setLoading] = useState(true)
  const [skills, setSkills] = useState<Skill[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeType, setActiveType] = useState('all')

  useEffect(() => {
    fetchSkills()
  }, [])

  const fetchSkills = async () => {
    try {
      setLoading(true)
      const data = await api.get<Skill[]>('/skills')
      setSkills(data)
    } catch (error) {
      console.error('Failed to fetch skills:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredSkills = skills.filter(skill => {
    const categoryMatch = activeCategory === 'all' || skill.category === activeCategory
    const estimatedMinutes = skill.estimated_time ? parseInt(skill.estimated_time) : 0
    const isQuick = estimatedMinutes <= 10
    const typeMatch = activeType === 'all' || 
      (activeType === 'quick' && isQuick) ||
      (activeType === 'deep' && !isQuick)
    return categoryMatch && typeMatch
  })

  const featuredSkill = filteredSkills.find(s => s.name.includes('Market') || s.name.includes('Strategic')) || filteredSkills[0]
  const regularSkills = filteredSkills.filter(s => s.id !== featuredSkill?.id)

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
        {/* Hero Section */}
        <div className="relative rounded-3xl bg-gradient-primary p-10 mb-8 overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-96 h-96 bg-white/20 rounded-full blur-3xl"></div>
          </div>
          
          <div className="relative z-10 flex items-start justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm mb-6">
                <span className="text-label-sm text-white/80">ELITE EDITION</span>
                <span className="w-1 h-1 rounded-full bg-white/60"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
              </div>
              
              <h1 className="text-headline-lg text-white mb-3">
                The Intelligent Stratum<br />Skills Hub
              </h1>
              <p className="text-body-lg text-white/70 max-w-xl">
                Curated AI-driven operational modules designed for senior consultants. Select your domain to initiate deep analytical tasks or rapid strategic outputs.
              </p>
            </div>
            
            <div className="hidden lg:flex gap-4">
              <div className="text-center">
                <div className="text-4xl font-manrope font-bold text-white">{skills.length}</div>
                <div className="text-sm text-white/60">ACTIVE SKILLS</div>
              </div>
              <div className="w-px bg-white/20"></div>
              <div className="text-center">
                <div className="text-4xl font-manrope font-bold text-white">
                  {skills.filter(s => s.created_at && new Date(s.created_at).toDateString() === new Date().toDateString()).length}
                </div>
                <div className="text-sm text-white/60">NEW TODAY</div>
              </div>
            </div>
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeCategory === cat.id
                  ? 'bg-primary text-white'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              {cat.label}
            </button>
          ))}
          <div className="flex-1"></div>
          {skillTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setActiveType(type.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeType === type.id
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-muted hover:text-on-surface'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        {filteredSkills.length === 0 ? (
          <div className="card text-center py-16">
            <Brain className="w-12 h-12 text-on-surface-muted mx-auto mb-4" />
            <h3 className="text-headline-sm text-on-surface mb-2">No skills found</h3>
            <p className="text-body-md text-on-surface-muted">Try adjusting your filters or create a new skill.</p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6 mb-10">
            {/* Featured Skill - Large Card */}
            {featuredSkill && (
              <div className="col-span-12 lg:col-span-6">
                <div className="card h-full flex flex-col">
                  <div className="flex items-start justify-between mb-6">
                    <div className={`w-14 h-14 rounded-2xl ${getCategoryColor(featuredSkill.category)} flex items-center justify-center`}>
                      {(() => {
                        const Icon = getSkillIcon(featuredSkill.category)
                        return <Icon className="w-7 h-7" />
                      })()}
                    </div>
                    <span className="px-3 py-1 rounded-full bg-surface-container-low text-label-sm text-on-surface-muted">
                      {featuredSkill.category}
                    </span>
                  </div>
                  
                  <h3 className="text-headline-sm text-on-surface mb-3">{featuredSkill.name}</h3>
                  <p className="text-body-md text-on-surface-muted mb-6 flex-1">{featuredSkill.description}</p>
                  
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low">
                      <span className={`w-2 h-2 rounded-full ${
                        featuredSkill.estimated_time && parseInt(featuredSkill.estimated_time) > 10 ? 'bg-primary' : 'bg-tertiary'
                      }`}></span>
                      <span className="text-xs font-medium text-on-surface">
                        {featuredSkill.estimated_time && parseInt(featuredSkill.estimated_time) > 10 ? 'Deep Task' : 'Quick Tool'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-on-surface-muted">
                      <Clock className="w-4 h-4" />
                      {featuredSkill.estimated_time || '~30 mins'}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low">
                    <div>
                      <p className="text-label-sm text-on-surface-muted mb-1">SYSTEM PROMPT</p>
                      <p className="text-sm text-on-surface line-clamp-1">{featuredSkill.system_prompt.substring(0, 50)}...</p>
                    </div>
                    <button className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center text-white hover:shadow-lg transition-all">
                      <Sparkles className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Regular Skills */}
            {regularSkills.map((skill) => {
              const SkillIcon = getSkillIcon(skill.category)
              const isQuick = skill.estimated_time ? parseInt(skill.estimated_time) <= 10 : false
              return (
                <div key={skill.id} className="col-span-12 md:col-span-6 lg:col-span-3">
                  <div className="card card-interactive h-full flex flex-col">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-10 h-10 rounded-xl ${getCategoryColor(skill.category)} flex items-center justify-center`}>
                        <SkillIcon className="w-5 h-5" />
                      </div>
                      <span className="px-2 py-1 rounded-md bg-surface-container-low text-label-sm text-on-surface-muted">
                        {skill.category}
                      </span>
                    </div>
                    
                    <h4 className="text-label-lg text-on-surface mb-2">{skill.name}</h4>
                    <p className="text-body-sm text-on-surface-muted mb-4 flex-1 line-clamp-2">{skill.description}</p>
                    
                    <div className="space-y-2 pt-4 border-t border-outline/10">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-on-surface-muted">Type</span>
                        <span className="font-medium text-on-surface">{isQuick ? 'Quick Tool' : 'Deep Task'}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-on-surface-muted">Est. Time</span>
                        <span className="font-medium text-on-surface">{skill.estimated_time || '~30 mins'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Custom Workflow CTA */}
        <div className="card border-l-4 border-tertiary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-tertiary/10 flex items-center justify-center">
                <Plus className="w-6 h-6 text-tertiary" />
              </div>
              <div>
                <h3 className="text-label-lg text-on-surface mb-1">Can't find a specific skill?</h3>
                <p className="text-body-sm text-on-surface-muted">
                  Our concierge AI can build custom workflows based on your project requirements in under 2 hours.
                </p>
              </div>
            </div>
            <button className="btn-secondary flex items-center gap-2 whitespace-nowrap">
              Request Custom Workflow
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-outline/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-on-surface-muted">
              <span>© 2024 Aria AI Consulting Elite</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-on-surface-muted">
              <a href="#" className="hover:text-on-surface transition-colors">Resources</a>
              <a href="#" className="hover:text-on-surface transition-colors">Legal</a>
              <a href="#" className="hover:text-on-surface transition-colors">Support</a>
              <a href="#" className="hover:text-on-surface transition-colors">Language</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </>
  )
}
