import { useState } from 'react'
import { Plus, CheckCircle2, FileText, Table2, Presentation, Download, Settings } from 'lucide-react'

// Project Status Badge
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    'Active': 'bg-blue-100 text-blue-700',
    'Planning': 'bg-amber-100 text-amber-700',
    'Completed': 'bg-green-100 text-green-700',
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'Active' ? 'bg-blue-500' : status === 'Planning' ? 'bg-amber-500' : 'bg-green-500'}`} />
      {status}
    </span>
  )
}

// Progress Bar
function ProgressBar({ progress, color = 'blue' }: { progress: number; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-600',
    green: 'bg-green-500',
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span>Overall Progress</span>
        <span>{progress}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colors[color]} rounded-full transition-all`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// Featured Project Card
function FeaturedProject() {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-200">
      <div className="flex gap-6">
        {/* Project Cover */}
        <div className="w-48 h-32 bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center flex-shrink-0">
          <div className="text-center">
            <div className="text-gray-500 text-sm font-medium">PROJECT</div>
            <div className="text-gray-600 text-xs">CONTEXT</div>
            <div className="text-gray-500 text-2xl font-bold mt-1">WORK</div>
            <div className="mt-2 px-2 py-0.5 bg-blue-600 text-white text-xs rounded">PRIORITY 01</div>
          </div>
        </div>

        {/* Project Info */}
        <div className="flex-1">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="text-xs font-semibold text-blue-600 tracking-wide">GLOBAL LOGISTICS CORP</span>
              <h3 className="text-xl font-bold text-gray-900 mt-1">Digital Transformation 2024</h3>
            </div>
            <StatusBadge status="Active" />
          </div>

          <p className="text-sm text-gray-500 mb-4">
            Modernizing the legacy supply chain infrastructure with AI-driven predictive modeling and cloud-native architectural shifts.
          </p>

          <ProgressBar progress={74} />
        </div>
      </div>
    </div>
  )
}

// Project Card
interface Project {
  id: string
  icon: typeof CheckCircle2
  iconBg: string
  client: string
  status: string
  title: string
  phase: string
  progress: number
}

function ProjectCard({ project }: { project: Project }) {
  const Icon = project.icon

  return (
    <div className="bg-white rounded-xl p-5 border border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 ${project.iconBg} rounded-lg flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-gray-700" />
        </div>
        <span className="px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-100 rounded">
          {project.status.toUpperCase()}
        </span>
      </div>

      <span className="text-xs font-semibold text-gray-400 tracking-wide">{project.client}</span>
      <h4 className="font-semibold text-gray-900 mt-1 mb-3">{project.title}</h4>

      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span>{project.phase}</span>
        <span>{project.progress}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full"
          style={{ width: `${project.progress}%` }}
        />
      </div>
    </div>
  )
}

// AI Context Intelligence
function AIContextPanel() {
  return (
    <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 bg-blue-500 rounded-full" />
        <span className="text-xs font-semibold text-gray-500 tracking-wide">AI CONTEXT INTELLIGENCE</span>
        <button className="ml-auto p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded">
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-white rounded-lg p-4 mb-4">
        <h5 className="font-medium text-gray-900 mb-2">Portfolio Synthesis</h5>
        <p className="text-sm text-gray-600 italic">
          &quot;Cross-project analysis indicates a 15% efficiency gain when sharing architectural patterns between Health Systems and Logistics modules.&quot;
        </p>
      </div>

      <div className="bg-white rounded-lg p-4">
        <h5 className="font-medium text-gray-900 mb-2">Risk Warning</h5>
        <p className="text-sm text-gray-600">
          Compliance bottlenecks detected in 2 active projects regarding GDPR data handling protocols.
        </p>
      </div>
    </div>
  )
}

// Global Milestones
function MilestonesPanel() {
  const milestones = [
    {
      date: 'Tomorrow, 09:00 AM',
      title: 'Logistics Q3 Review',
      description: 'Stakeholder presentation for Global Logistics Corp.',
      icon: 'flag',
    },
    {
      date: 'Thursday, Oct 12',
      title: 'Patient Data Integration',
      description: 'System-wide backup and migration window.',
      icon: 'calendar',
    },
    {
      date: 'Monday, Oct 16',
      title: 'FinTech Strategy Kickoff',
      description: 'Onboarding session with executive leadership.',
      icon: 'users',
    },
  ]

  return (
    <div className="mt-6">
      <h4 className="font-semibold text-gray-900 mb-4">Global Milestones</h4>
      <div className="space-y-4">
        {milestones.map((m, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs">📅</span>
            </div>
            <div>
              <div className="text-xs text-blue-600 font-medium">{m.date}</div>
              <div className="text-sm font-medium text-gray-900">{m.title}</div>
              <div className="text-xs text-gray-500">{m.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Recent Library
function RecentLibrary() {
  const files = [
    { name: 'Architectural_V4_Final.pdf', project: 'DIGITAL TRANSFORMATION', size: '2.4 MB', icon: FileText, color: 'text-red-500' },
    { name: 'Risk_Assessment_Matrix.xlsx', project: 'FINTECH', size: '1.1 MB', icon: Table2, color: 'text-green-500' },
    { name: 'Q4_Retail_Strategy_Deck.pptx', project: 'NEXUS RETAIL', size: '8.9 MB', icon: Presentation, color: 'text-orange-500' },
  ]

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900">Recent Library</h4>
        <a href="#" className="text-sm text-blue-600 hover:text-blue-700">View All</a>
      </div>
      <div className="space-y-3">
        {files.map((file, i) => {
          const Icon = file.icon
          return (
            <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 cursor-pointer transition-colors">
              <Icon className={`w-8 h-8 ${file.color}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{file.name}</div>
                <div className="text-xs text-gray-500">{file.project} • {file.size}</div>
              </div>
              <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                <Download className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// New Project Card
function NewProjectCard() {
  return (
    <button className="w-full h-full min-h-[180px] border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-3 text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
        <Plus className="w-6 h-6" />
      </div>
      <span className="font-medium">Initiate New Consulting Project</span>
    </button>
  )
}

// Main Projects Page
export function Projects() {
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active')

  const projects: Project[] = [
    {
      id: '1',
      icon: CheckCircle2,
      iconBg: 'bg-amber-100',
      client: 'FINTECH SOLUTIONS INC',
      status: 'Planning',
      title: 'Risk Mitigation Protocol',
      phase: 'Stage 1: Assessment',
      progress: 15,
    },
    {
      id: '2',
      icon: CheckCircle2,
      iconBg: 'bg-blue-100',
      client: 'AURA HEALTH SYSTEMS',
      status: 'Active',
      title: 'AI Patient Diagnostics',
      phase: 'Integration Phase',
      progress: 42,
    },
    {
      id: '3',
      icon: CheckCircle2,
      iconBg: 'bg-green-100',
      client: 'NEXUS RETAIL',
      status: 'Completed',
      title: 'Omnichannel Strategy',
      phase: 'Delivery Success',
      progress: 100,
    },
  ]

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Consulting Portfolio</h1>
          <p className="text-gray-500">Strategic project management and delivery hub.</p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'active'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setActiveTab('archived')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'archived'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Archived
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <FeaturedProject />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
            <NewProjectCard />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <AIContextPanel />
          <MilestonesPanel />
          <RecentLibrary />
        </div>
      </div>
    </div>
  )
}
