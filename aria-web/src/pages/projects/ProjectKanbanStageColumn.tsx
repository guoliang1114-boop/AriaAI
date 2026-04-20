import { useTranslation } from 'react-i18next'
import type { ProjectStageConfig } from '../../types/enums'
import type { Project } from '../../types/api'
import { ProjectKanbanCard } from './ProjectKanbanCard'

interface ProjectKanbanStageColumnProps {
  onProjectClick: (id: number) => void
  onProjectPrefetch?: (id: number) => void
  projects: Project[]
  stage: ProjectStageConfig
}

export function ProjectKanbanStageColumn({
  onProjectClick,
  onProjectPrefetch,
  projects,
  stage,
}: ProjectKanbanStageColumnProps) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const Icon = stage.icon
  const totalValue = projects.reduce((sum, project) => sum + (project.contract_amount || 0), 0)

  return (
    <div className="flex flex-col h-full min-w-0 w-full">
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
          <p className="text-xs text-gray-500 truncate">{stage.description}</p>
          {totalValue > 0 && (
            <span className="text-xs font-medium text-gray-600">
              CNY {(totalValue / 10000).toFixed(0)}
              {isZh ? '万' : 'K'}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 min-h-[100px]">
        {projects.map((project) => (
          <ProjectKanbanCard
            key={project.id}
            onClick={() => onProjectClick(project.id)}
            onPointerDown={() => onProjectPrefetch?.(project.id)}
            onPointerEnter={() => onProjectPrefetch?.(project.id)}
            project={project}
            stage={stage}
          />
        ))}
      </div>
    </div>
  )
}
