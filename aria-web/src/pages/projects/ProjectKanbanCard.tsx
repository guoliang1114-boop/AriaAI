import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react'
import type { ProjectStageConfig } from '../../types/enums'
import type { Project } from '../../types/api'

const formatAmountInTenThousand = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return '0'
  const tenThousand = amount / 10000
  if (tenThousand < 1) {
    return amount.toLocaleString('zh-CN')
  }
  const hasFraction = tenThousand % 1 !== 0
  return hasFraction
    ? tenThousand.toLocaleString('zh-CN', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : tenThousand.toLocaleString('zh-CN')
}

interface ProjectKanbanCardProps {
  onClick: () => void
  project: Project
  stage: ProjectStageConfig
}

export function ProjectKanbanCard({ onClick, project, stage }: ProjectKanbanCardProps) {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  return (
    <div
      onClick={onClick}
      className="group relative bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden"
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${stage.lightColor}`} />

      <div className="pl-3">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {project.client}
              </span>
            </div>
            <h4 className="font-semibold text-sm text-gray-900 leading-snug line-clamp-2">
              {project.name}
            </h4>
          </div>
        </div>

        {project.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-3 leading-relaxed">
            {project.description}
          </p>
        )}

        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${stage.bgColor} ${stage.color}`}>
            <stage.icon className="w-3 h-3" />
            {isZh ? stage.labelZh : stage.label}
          </span>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-gray-50">
          <div className="flex items-center gap-2">
            {project.contract_amount ? (
              <span className="text-xs font-bold text-gray-800">
                CNY {formatAmountInTenThousand(project.contract_amount)}
                {isZh ? '万' : 'K'}
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                {isZh ? '待报价' : 'Quote Pending'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <Calendar className="w-3 h-3" />
            <span>
              {new Date(project.updated_at).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
