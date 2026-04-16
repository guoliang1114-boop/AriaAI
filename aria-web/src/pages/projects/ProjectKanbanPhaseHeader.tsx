import { ChevronRight } from 'lucide-react'
import type { PhaseConfig } from './ProjectsPhaseSection'

interface ProjectKanbanPhaseHeaderProps {
  isExpanded: boolean
  isZh: boolean
  onToggle: () => void
  phase: PhaseConfig
  totalProjects: number
  totalValue: number
}

export function ProjectKanbanPhaseHeader({
  isExpanded,
  isZh,
  onToggle,
  phase,
  totalProjects,
  totalValue,
}: ProjectKanbanPhaseHeaderProps) {
  const Icon = phase.icon

  return (
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
                <p className="text-xl font-bold text-gray-900">
                  CNY {(totalValue / 10000).toFixed(0)}
                  {isZh ? '万' : 'K'}
                </p>
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
  )
}
