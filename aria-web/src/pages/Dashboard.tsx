import { BarChart3, ArrowUpRight, Zap, ChevronRight } from 'lucide-react'

// Hero Section
function HeroSection() {
  return (
    <div className="relative bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-8 lg:p-10 mb-8 overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500 rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2" />
      </div>

      <div className="relative z-10">
        <span className="inline-block px-3 py-1 text-xs font-semibold text-blue-300 bg-blue-500/20 rounded-full mb-4">
          CONSULTING ELITE EDITION
        </span>
        <h1 className="text-4xl lg:text-5xl font-bold text-white mb-4">Aria AI</h1>
        <p className="text-lg text-gray-300 mb-6 max-w-xl">
          Not just chat, handle everything. Your cognitive partner for strategic excellence.
        </p>
        <div className="flex items-center gap-3">
          <button className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors">
            Start New Project
          </button>
          <button className="px-5 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors">
            Browse Skills
          </button>
        </div>
      </div>
    </div>
  )
}

// Deep Tasks Section
function DeepTasksSection() {
  const tasks = [
    { category: 'STRATEGY', title: 'Market Research' },
    { category: 'PLANNING', title: 'Strategic Planning' },
  ]

  return (
    <div className="bg-white rounded-xl p-6 border border-gray-200">
      <div className="flex items-start justify-between mb-6">
        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
          <BarChart3 className="w-6 h-6 text-blue-600" />
        </div>
        <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowUpRight className="w-5 h-5" />
        </button>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">Deep Tasks</h3>
      <p className="text-sm text-gray-500 mb-6">
        Execute complex, multi-stage workflows including Market Research and Strategic Planning with high-fidelity output.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {tasks.map((task, i) => (
          <div key={i} className="p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-gray-200 cursor-pointer transition-colors">
            <span className="text-xs font-medium text-gray-400">{task.category}</span>
            <p className="text-sm font-medium text-gray-900 mt-1">{task.title}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Quick Tools Section
function QuickToolsSection() {
  const tools = [
    { name: 'SWOT Analysis', icon: '⚡' },
    { name: 'Meeting Minutes', icon: '📝' },
  ]

  return (
    <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-6 text-white">
      <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-6">
        <Zap className="w-6 h-6 text-white" />
      </div>

      <h3 className="text-lg font-semibold mb-2">Quick Tools</h3>
      <p className="text-sm text-blue-100 mb-6">
        Rapid execution for daily consulting essentials. Turn minutes into moments.
      </p>

      <div className="space-y-3">
        {tools.map((tool, i) => (
          <button
            key={i}
            className="w-full flex items-center justify-between px-4 py-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-left"
          >
            <span className="font-medium">{tool.name}</span>
            <ChevronRight className="w-4 h-4 text-blue-200" />
          </button>
        ))}
      </div>
    </div>
  )
}

// Project Space Section
function ProjectSpaceSection() {
  const projects = [
    { status: 'ACTIVE', title: 'Global Logistics Q4', updated: '2h ago', color: 'green' },
    { status: 'RESEARCH', title: 'Retail Expansion', updated: '5h ago', color: 'blue' },
  ]

  return (
    <div className="mt-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Project Space</h3>
          <p className="text-sm text-gray-500 max-w-md">
            Centralize your intelligence. Manage multiple client projects with isolated knowledge bases and dedicated AI context.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-8 h-8 bg-gray-200 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600">
                U{i}
              </div>
            ))}
          </div>
          <span className="text-sm text-gray-400">+4</span>
          <a href="/projects" className="ml-2 text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
            View all projects
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {projects.map((project, i) => (
          <div key={i} className="bg-white rounded-xl p-4 border border-gray-200 hover:border-gray-300 cursor-pointer transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${project.color === 'green' ? 'bg-green-500' : 'bg-blue-500'}`} />
              <span className="text-xs font-medium text-gray-500">{project.status}</span>
            </div>
            <h4 className="font-semibold text-gray-900 mb-1">{project.title}</h4>
            <p className="text-xs text-gray-400">Last updated {project.updated}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Recent Intelligence Section
function RecentIntelligenceSection() {
  const items = [
    {
      tag: '@market_research',
      tagColor: 'blue',
      time: '14 Oct, 10:20 AM',
      title: 'Automotive EV Trends 2025',
      description: 'Comprehensive analysis of solid-state battery adoption and infrastructure growth in EU markets.',
    },
    {
      tag: '@pitch_deck',
      tagColor: 'orange',
      time: '13 Oct, 4:45 PM',
      title: 'Series B - FinTech Narrative',
      description: 'Strategic narrative refinement and competitive landscape mapping for quarterly board review.',
    },
    {
      tag: '@meeting_minutes',
      tagColor: 'blue',
      time: '13 Oct, 9:00 AM',
      title: 'Product Alignment Sync',
      description: 'Action items: UI design freeze, Backend scalability audit, and Q1 roadmap sign-off.',
    },
  ]

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-gray-900">Recent Intelligence</h3>
        <button className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          History
          <span>↺</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((item, i) => (
          <div key={i} className="bg-white rounded-xl p-5 border border-gray-200 hover:border-gray-300 cursor-pointer transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                item.tagColor === 'orange' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {item.tag}
              </span>
              <span className="text-xs text-gray-400">{item.time}</span>
            </div>
            <h4 className="font-semibold text-gray-900 mb-2">{item.title}</h4>
            <p className="text-sm text-gray-500">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Main Dashboard
export function Dashboard() {
  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <HeroSection />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DeepTasksSection />
        <QuickToolsSection />
      </div>

      <ProjectSpaceSection />
      <RecentIntelligenceSection />
    </div>
  )
}
