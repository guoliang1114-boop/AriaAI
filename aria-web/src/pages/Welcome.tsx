import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  ArrowRight, 
  BarChart3, 
  Zap,
  History,
  Loader2,
  AlertCircle,
  RefreshCw
} from 'lucide-react'
import { api } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import type { Project, Skill, Conversation } from '../types/api'

interface DashboardStats {
  activeSkills: number
  newToday: number
}

export function Welcome() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [, setStats] = useState<DashboardStats>({ activeSkills: 0, newToday: 0 })

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      setError(null)
      // Fetch projects, skills, and conversations in parallel
      const [projectsData, skillsData, conversationsData] = await Promise.all([
        api.get<Project[]>('/projects'),
        api.get<Skill[]>('/skills'),
        api.get<Conversation[]>('/chat/conversations')
      ])
      
      setProjects(projectsData.slice(0, 4)) // Get first 4 projects
      setSkills(skillsData)
      setConversations(conversationsData.slice(0, 3)) // Get first 3 conversations
      
      // Calculate stats
      const today = new Date().toISOString().split('T')[0]
      const newToday = skillsData.filter(s => 
        s.created_at && s.created_at.startsWith(today)
      ).length
      
      setStats({
        activeSkills: skillsData.length,
        newToday
      })
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err)
      // 401 is handled by API client interceptor (will redirect to login)
      // Other errors are handled below
      if (err.response?.status === 401) {
        // Let API client handle the redirect
        throw err
      }
      if (!err.response) {
        setError('Cannot connect to backend server. Please ensure the server is running on http://127.0.0.1:8000')
      } else if (err.response.status !== 401) {
        setError(`Failed to load dashboard data: ${err.response?.data?.detail || err.message}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const activeProjects = projects.filter(p => p.status === 'active').slice(0, 2)
  
  const deepTasks = skills
    .filter(s => s.estimated_time && parseInt(s.estimated_time) > 10)
    .slice(0, 2)
  
  const quickTools = skills
    .filter(s => !s.estimated_time || parseInt(s.estimated_time) <= 10)
    .slice(0, 2)

  if (loading) {
    return (
      <>
        <PageTitle title="Dashboard" />
        <div className="min-h-full bg-surface flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <PageTitle title="Dashboard" />
        <div className="min-h-full bg-surface flex items-center justify-center">
          <div className="text-center max-w-md mx-auto p-8">
            <AlertCircle className="w-12 h-12 text-error mx-auto mb-4" />
            <h2 className="text-headline-sm text-on-surface mb-2">Connection Error</h2>
            <p className="text-body-md text-on-surface-muted mb-6">{error}</p>
            <button 
              onClick={fetchDashboardData}
              className="btn-primary flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title="Dashboard" />
      <div className="min-h-full bg-surface">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Hero Section */}
        <div className="relative rounded-3xl bg-gradient-hero p-10 mb-10 overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-96 h-96 bg-white/20 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/10 rounded-full blur-2xl"></div>
          </div>
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse"></span>
              <span className="text-label-sm text-white/80">CONSULTING ELITE EDITION</span>
            </div>
            
            <h1 className="text-display-lg text-white mb-4">
              Aria AI
            </h1>
            <p className="text-body-lg text-white/70 max-w-xl mb-8">
              Not just chat, handle everything. Your cognitive partner for strategic excellence.
            </p>
            
            <div className="flex items-center gap-4">
              <button 
                onClick={() => navigate('/projects/new')}
                className="btn-primary flex items-center gap-2"
              >
                Start New Project
              </button>
              <button 
                onClick={() => navigate('/skills')}
                className="px-6 py-3 rounded-xl bg-white/10 text-white font-medium text-sm hover:bg-white/20 transition-all backdrop-blur-sm"
              >
                Browse Skills
              </button>
            </div>
          </div>
        </div>

        {/* Deep Tasks & Quick Tools Grid */}
        <div className="grid grid-cols-12 gap-6 mb-10">
          {/* Deep Tasks */}
          <div className="col-span-12 lg:col-span-8">
            <div className="card h-full">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-secondary-container flex items-center justify-center mb-4">
                    <BarChart3 className="w-6 h-6 text-primary" />
                  </div>
                  <h2 className="text-headline-sm text-on-surface mb-2">Deep Tasks</h2>
                  <p className="text-body-md text-on-surface-muted max-w-md">
                    Execute complex, multi-stage workflows including Market Research and Strategic Planning with high-fidelity output.
                  </p>
                </div>
                <button 
                  onClick={() => navigate('/skills')}
                  className="p-2 rounded-xl hover:bg-surface-container-low transition-colors"
                >
                  <ArrowRight className="w-5 h-5 text-on-surface-muted" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {deepTasks.length > 0 ? deepTasks.map((task) => (
                  <div 
                    key={task.id}
                    onClick={() => navigate(`/chat?skill=${task.id}`)}
                    className="p-4 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors cursor-pointer"
                  >
                    <span className="text-label-sm text-on-surface-muted">{task.category.toUpperCase()}</span>
                    <h3 className="text-label-lg text-on-surface mt-1">{task.name}</h3>
                    <p className="text-body-sm text-on-surface-muted mt-1 line-clamp-1">{task.description}</p>
                  </div>
                )) : (
                  <div className="col-span-2 p-4 rounded-xl bg-surface-container-low text-on-surface-muted text-center">
                    No deep tasks available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick Tools */}
          <div className="col-span-12 lg:col-span-4">
            <div className="h-full rounded-3xl bg-gradient-primary p-6 text-white">
              <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-headline-sm text-white mb-2">Quick Tools</h2>
              <p className="text-body-sm text-white/70 mb-6">
                Rapid execution for daily consulting essentials. Turn minutes into moments.
              </p>
              
              <div className="space-y-3">
                {quickTools.length > 0 ? quickTools.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => navigate(`/chat?skill=${tool.id}`)}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-left group"
                  >
                    <span className="font-medium text-sm">{tool.name}</span>
                    <ArrowRight className="w-4 h-4 text-white/60 group-hover:translate-x-1 transition-transform" />
                  </button>
                )) : (
                  <div className="p-4 rounded-xl bg-white/10 text-white/60 text-center text-sm">
                    No quick tools available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Project Space */}
        <div className="mb-10">
          <div className="flex items-end justify-between mb-6">
            <div>
              <h2 className="text-headline-sm text-on-surface mb-2">Project Space</h2>
              <p className="text-body-md text-on-surface-muted">
                Centralize your intelligence. Manage multiple client projects with isolated knowledge bases and dedicated AI context.
              </p>
            </div>
            <button 
              onClick={() => navigate('/projects')}
              className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-container transition-colors"
            >
              View all projects
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {activeProjects.length > 0 ? activeProjects.map((project) => (
              <div 
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="card card-interactive cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-active"></span>
                  <span className="text-label-sm text-active">{project.status.toUpperCase()}</span>
                </div>
                <h3 className="text-label-lg text-on-surface mb-1">{project.name}</h3>
                <p className="text-body-sm text-on-surface-muted">{project.client}</p>
              </div>
            )) : (
              <div className="col-span-2 card text-center py-8 text-on-surface-muted">
                No active projects. <button onClick={() => navigate('/projects/new')} className="text-primary hover:underline">Create one</button>
              </div>
            )}
          </div>
        </div>

        {/* Recent Intelligence */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-headline-sm text-on-surface">Recent Intelligence</h2>
            <button 
              onClick={() => navigate('/chat')}
              className="flex items-center gap-2 text-sm text-on-surface-muted hover:text-on-surface transition-colors"
            >
              <History className="w-4 h-4" />
              History
            </button>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            {conversations.length > 0 ? conversations.map((conv) => (
              <div 
                key={conv.id}
                onClick={() => navigate(`/chat?conversation=${conv.id}`)}
                className="card border-l-4 border-primary cursor-pointer hover:shadow-lg transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary">
                    @conversation
                  </span>
                  <span className="text-xs text-on-surface-muted">
                    {new Date(conv.updated_at).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="text-label-lg text-on-surface mb-2 line-clamp-1">{conv.title || 'Untitled Conversation'}</h3>
                <p className="text-body-sm text-on-surface-muted line-clamp-2">
                  Click to continue this conversation
                </p>
              </div>
            )) : (
              <div className="col-span-3 card text-center py-8 text-on-surface-muted">
                No recent conversations. <button onClick={() => navigate('/chat')} className="text-primary hover:underline">Start one</button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-outline/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-on-surface-muted">
              <span className="font-manrope font-semibold text-on-surface">Aria AI</span>
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
