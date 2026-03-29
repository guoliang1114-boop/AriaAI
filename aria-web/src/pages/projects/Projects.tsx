import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  FolderKanban, 
  Plus, 
  Calendar, 
  FileText, 
  Download,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building2,
  Zap,
  Loader2
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { Project } from '../../types/api'

export function Projects() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'completed'>('all')

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const data = await api.get<Project[]>('/projects')
      setProjects(data)
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredProjects = projects.filter(p => {
    if (activeTab === 'all') return true
    if (activeTab === 'active') return p.status === 'active' || p.status === 'lead'
    if (activeTab === 'completed') return p.status === 'completed' || p.status === 'archived'
    return true
  })

  const featuredProject = filteredProjects[0]
  const otherProjects = filteredProjects.slice(1, 4)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-active/10 text-active'
      case 'lead': return 'bg-warning/10 text-warning'
      case 'completed': return 'bg-on-surface-muted/10 text-on-surface-muted'
      case 'archived': return 'bg-outline/20 text-on-surface-muted'
      default: return 'bg-surface-container-high text-on-surface-muted'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <span className="w-1.5 h-1.5 rounded-full bg-active"></span>
      case 'lead': return <Clock className="w-3 h-3" />
      case 'completed': return <CheckCircle2 className="w-3 h-3" />
      default: return null
    }
  }

  if (loading) {
    return (
      <>
        <PageTitle title="Projects" />
        <div className="min-h-full bg-surface flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title="Projects" />
      <div className="min-h-full bg-surface">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-headline-md text-on-surface mb-2">Consulting Portfolio</h1>
            <p className="text-body-md text-on-surface-muted">Strategic project management and delivery hub.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-surface-container-low rounded-xl p-1">
              {(['all', 'active', 'completed'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab
                      ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                      : 'text-on-surface-muted hover:text-on-surface'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div className="card text-center py-16">
            <FolderKanban className="w-12 h-12 text-on-surface-muted mx-auto mb-4" />
            <h3 className="text-headline-sm text-on-surface mb-2">No projects found</h3>
            <p className="text-body-md text-on-surface-muted mb-6">Get started by creating your first consulting project.</p>
            <button className="btn-primary">Create Project</button>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Left Column - Projects */}
            <div className="col-span-12 lg:col-span-8 space-y-6">
              {/* Featured Project */}
              {featuredProject && (
                <div className="card bg-surface-container-low">
                  <div className="flex gap-6">
                    <div className="w-48 h-32 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center relative overflow-hidden flex-shrink-0">
                      <div className="absolute inset-0 opacity-20">
                        <div className="absolute top-2 left-2 text-white/30 text-xs font-mono">PROJECT</div>
                        <div className="absolute top-8 left-2 text-white/30 text-xs font-mono">CONTEXT</div>
                        <div className="absolute bottom-8 left-2 text-white/30 text-xs font-mono">WORK</div>
                      </div>
                      <FolderKanban className="w-12 h-12 text-white/40" />
                      <span className="absolute bottom-3 left-3 px-2 py-1 bg-primary rounded text-xs font-medium text-white">
                        PRIORITY 01
                      </span>
                    </div>
                    <div className="flex-1 py-1">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-label-sm text-on-surface-muted">{featuredProject.client}</span>
                        <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(featuredProject.status)}`}>
                          {getStatusIcon(featuredProject.status)}
                          {featuredProject.status.toUpperCase()}
                        </span>
                      </div>
                      <h3 className="text-headline-sm text-on-surface mb-2">{featuredProject.name}</h3>
                      <p className="text-body-sm text-on-surface-muted mb-4">
                        {featuredProject.description || 'No description available'}
                      </p>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-on-surface-muted">Overall Progress</span>
                          <span className="text-sm font-medium text-on-surface">
                            {featuredProject.status === 'completed' ? '100' : '74'}%
                          </span>
                        </div>
                        <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-primary rounded-full transition-all duration-500"
                            style={{ width: featuredProject.status === 'completed' ? '100%' : '74%' }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Project Grid */}
              <div className="grid grid-cols-2 gap-4">
                {otherProjects.map((project) => (
                  <div 
                    key={project.id} 
                    onClick={() => navigate(`/projects/${project.id}`)}
                    className="card card-interactive cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center`}>
                        <Building2 className="w-5 h-5 text-primary" />
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                        {project.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-label-sm text-on-surface-muted mb-1">{project.client}</p>
                    <h4 className="text-label-lg text-on-surface mb-3">{project.name}</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-on-surface-muted">
                          {new Date(project.updated_at).toLocaleDateString()}
                        </span>
                        <span className="text-xs font-medium text-on-surface">
                          {project.status === 'completed' ? '100' : project.status === 'active' ? '42' : '15'}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-surface-container-low rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${
                            project.status === 'completed' ? 'bg-on-surface-muted' : 'bg-primary'
                          }`}
                          style={{ width: project.status === 'completed' ? '100%' : project.status === 'active' ? '42%' : '15%' }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* New Project Card */}
                <button 
                  onClick={() => navigate('/projects/new')}
                  className="card border-2 border-dashed border-outline/30 hover:border-primary/50 hover:bg-surface-container-low/50 transition-all flex flex-col items-center justify-center min-h-[200px]"
                >
                  <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center mb-3">
                    <Plus className="w-6 h-6 text-on-surface-muted" />
                  </div>
                  <span className="text-label-lg text-on-surface-muted">Initiate New Consulting Project</span>
                </button>
              </div>
            </div>

            {/* Right Column - AI Context & Milestones */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              {/* AI Context Intelligence */}
              <div className="card bg-surface-container-low">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                  <span className="text-label-sm text-primary">AI CONTEXT INTELLIGENCE</span>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-surface-container-lowest">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-on-surface">Portfolio Synthesis</span>
                    </div>
                    <p className="text-body-sm text-on-surface-muted italic">
                      "Cross-project analysis indicates a 15% efficiency gain when sharing architectural patterns between active modules."
                    </p>
                  </div>
                  
                  <div className="p-4 rounded-xl bg-warning/5">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                      <span className="text-sm font-medium text-on-surface">Risk Warning</span>
                    </div>
                    <p className="text-body-sm text-on-surface-muted">
                      Compliance bottlenecks detected in active projects regarding data handling protocols.
                    </p>
                  </div>
                </div>
              </div>

              {/* Global Milestones */}
              <div className="card">
                <h3 className="text-label-lg text-on-surface mb-4">Global Milestones</h3>
                <div className="space-y-4">
                  {projects.slice(0, 3).map((project, idx) => (
                    <div key={project.id} className="flex gap-3">
                      <div className={`w-8 h-8 rounded-lg ${idx === 0 ? 'bg-primary/10' : 'bg-surface-container-low'} flex items-center justify-center flex-shrink-0`}>
                        <Calendar className={`w-4 h-4 ${idx === 0 ? 'text-primary' : 'text-on-surface-muted'}`} />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-primary mb-0.5">
                          {new Date(project.updated_at).toLocaleDateString()}
                        </p>
                        <h4 className="text-sm font-medium text-on-surface">{project.name}</h4>
                        <p className="text-xs text-on-surface-muted">{project.client}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Library */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-label-lg text-on-surface">Recent Library</h3>
                  <button className="text-sm text-primary hover:text-primary-container transition-colors">
                    View All
                  </button>
                </div>
                <div className="space-y-3">
                  {projects.slice(0, 3).map((project, index) => (
                    <div key={project.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer">
                      <div className={`w-10 h-10 rounded-lg ${['bg-red-50', 'bg-blue-50', 'bg-green-50'][index]} flex items-center justify-center`}>
                        <FileText className={`w-5 h-5 ${['text-red-500', 'text-blue-500', 'text-green-500'][index]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{project.name}.pdf</p>
                        <p className="text-xs text-on-surface-muted">{project.client} • 2.4 MB</p>
                      </div>
                      <button className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors">
                        <Download className="w-4 h-4 text-on-surface-muted" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-outline/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-on-surface-muted">
              <span className="font-manrope font-semibold text-on-surface">Aria AI Consulting Elite</span>
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
