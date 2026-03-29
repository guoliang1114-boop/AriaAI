import { useState } from 'react'
import { TrendingUp, Building2, Shield, Users, Briefcase, Sparkles, Clock, FileOutput, Zap } from 'lucide-react'

// Category Filter
const categories = [
  { id: 'all', label: 'All Capabilities' },
  { id: 'strategy', label: 'Strategy & Growth' },
  { id: 'finance', label: 'Finance' },
  { id: 'digital', label: 'Digital & Tech' },
  { id: 'risk', label: 'Risk & Compliance' },
  { id: 'org', label: 'Org & People' },
  { id: 'market', label: 'Market & Client' },
]

// Hero Section
function HeroSection() {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-8 lg:p-10 mb-8 text-white">
      <div className="flex items-start justify-between">
        <div>
          <span className="inline-block px-3 py-1 text-xs font-semibold text-blue-200 bg-blue-500/30 rounded-full mb-4">
            ELITE EDITION
          </span>
          <h1 className="text-3xl lg:text-4xl font-bold mb-2">The Intelligent Stratum</h1>
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">Skills Hub</h2>
          <p className="text-blue-100 max-w-xl">
            Curated AI-driven operational modules designed for senior consultants. Select your domain to initiate deep analytical tasks or rapid strategic outputs.
          </p>
        </div>
        <div className="hidden md:flex gap-8 text-center">
          <div>
            <div className="text-4xl font-bold">142</div>
            <div className="text-sm text-blue-200">ACTIVE SKILLS</div>
          </div>
          <div>
            <div className="text-4xl font-bold">24</div>
            <div className="text-sm text-blue-200">NEW TODAY</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Skill Type Badge
function TypeBadge({ type }: { type: 'quick' | 'deep' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded ${
      type === 'quick'
        ? 'bg-green-100 text-green-700'
        : 'bg-blue-100 text-blue-700'
    }`}>
      {type === 'quick' ? (
        <><Zap className="w-3 h-3" /> Quick Tool</>
      ) : (
        <><Clock className="w-3 h-3" /> Deep Task</>
      )}
    </span>
  )
}

// Skill Card
interface Skill {
  id: string
  icon: typeof TrendingUp
  category: string
  categoryColor: string
  title: string
  description: string
  type: 'quick' | 'deep'
  time: string
  output: string
}

function SkillCard({ skill }: { skill: Skill }) {
  const Icon = skill.icon

  return (
    <div className="bg-white rounded-xl p-6 border border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer group">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors">
          <Icon className="w-6 h-6 text-blue-600" />
        </div>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${skill.categoryColor}`}>
          {skill.category}
        </span>
      </div>

      {/* Content */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{skill.title}</h3>
      <p className="text-sm text-gray-500 mb-4 line-clamp-2">{skill.description}</p>

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-gray-500 pt-4 border-t border-gray-100">
        <div className="flex items-center gap-1">
          <TypeBadge type={skill.type} />
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {skill.time}
          </span>
          <span className="flex items-center gap-1">
            <FileOutput className="w-3 h-3" />
            {skill.output}
          </span>
        </div>
      </div>
    </div>
  )
}

// CTA Section
function CTASection() {
  return (
    <div className="mt-10 bg-gray-50 rounded-xl p-8 border border-gray-200">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Can&apos;t find a specific skill?</h3>
          <p className="text-gray-500">
            Our concierge AI can build custom workflows based on your project requirements in under 2 hours.
          </p>
        </div>
        <button className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors">
          Request Custom Workflow
        </button>
      </div>
    </div>
  )
}

// Main Skills Hub
export function Skills() {
  const [activeCategory, setActiveCategory] = useState('all')

  const skills: Skill[] = [
    {
      id: '1',
      icon: TrendingUp,
      category: 'STRATEGY & GROWTH',
      categoryColor: 'bg-blue-100 text-blue-700',
      title: 'Market Penetration Matrix',
      description: 'Advanced analysis for expansion strategies. Automatically calculates TAM/SAM/SOM based on real-time competitor data streams and regulatory hurdles.',
      type: 'deep',
      time: '~45 mins',
      output: 'PPTX Deck & Interactive Dashboard',
    },
    {
      id: '2',
      icon: Building2,
      category: 'FINANCE',
      categoryColor: 'bg-green-100 text-green-700',
      title: 'Automated CAPEX Modeling',
      description: 'Convert asset logs into dynamic 5-year investment forecast spreadsheets.',
      type: 'quick',
      time: '~5 mins',
      output: 'XLSX Export',
    },
    {
      id: '3',
      icon: Shield,
      category: 'RISK & COMPLIANCE',
      categoryColor: 'bg-red-100 text-red-700',
      title: 'GDPR Gap Analysis',
      description: 'Scans policy documents and identifies operational delta against EU 2024 updates.',
      type: 'deep',
      time: '~25 mins',
      output: 'PDF Audit Report',
    },
    {
      id: '4',
      icon: Sparkles,
      category: 'DIGITAL & TECH',
      categoryColor: 'bg-purple-100 text-purple-700',
      title: 'Legacy Stack Audit',
      description: 'Analyze tech debt and suggest modernization paths with cost-benefit ratios.',
      type: 'deep',
      time: '~60 mins',
      output: 'Roadmap JSON',
    },
    {
      id: '5',
      icon: Users,
      category: 'ORG & PEOPLE',
      categoryColor: 'bg-orange-100 text-orange-700',
      title: 'Talent Retention Predictor',
      description: 'Proprietary AI modeling to identify flight risks based on engagement metrics.',
      type: 'deep',
      time: '~15 mins',
      output: 'Insights Dashboard',
    },
    {
      id: '6',
      icon: Briefcase,
      category: 'PROPOSALS',
      categoryColor: 'bg-indigo-100 text-indigo-700',
      title: 'Smart RFP Summarizer',
      description: 'Extract key requirements, timelines, and mandatory KPIs from complex tender docs.',
      type: 'quick',
      time: '~3 mins',
      output: 'Exec Summary',
    },
    {
      id: '7',
      icon: TrendingUp,
      category: 'OPERATIONS',
      categoryColor: 'bg-teal-100 text-teal-700',
      title: 'Supply Chain Stress-Test',
      description: 'Simulate global logistics disruptions and calculate impact on TTM.',
      type: 'deep',
      time: '~40 mins',
      output: 'Impact Model',
    },
  ]

  const filteredSkills = activeCategory === 'all'
    ? skills
    : skills.filter(s => s.category.toLowerCase().includes(activeCategory))

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <HeroSection />

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 mb-8">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeCategory === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSkills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
      </div>

      <CTASection />
    </div>
  )
}
