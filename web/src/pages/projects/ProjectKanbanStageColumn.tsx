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
      <div className={`mb-2.5 rounded-lg border p-2.5 ${stage.borderColor} ${stage.bgColor}`}>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80 shadow-sm">
              <Icon className={`h-3 w-3 ${stage.color}`} />
            </div>
            <span className={`text-xs font-semibold ${stage.color}`}>
              {isZh ? stage.labelZh : stage.label}
            </span>
          </div>
          <span className="min-w-[22px] rounded-full bg-white/80 px-1.5 py-0.5 text-center text-[11px] font-semibold shadow-sm">
            {projects.length}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <p className="truncate text-[11px] text-gray-500">{stage.description}</p>
          {totalValue > 0 && (
            <span className="text-[11px] font-medium text-gray-600">
              CNY {(totalValue / 10000).toFixed(0)}
              {isZh ? '万' : 'K'}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-[100px] flex-1 space-y-2.5">
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
