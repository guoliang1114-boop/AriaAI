import { Check } from 'lucide-react'
import { PROJECT_STAGE_CONFIGS, type ProjectStage } from '../../types/enums'

interface NewProjectStageSelectorProps {
  value: ProjectStage
  onChange: (value: ProjectStage) => void
}

export function NewProjectStageSelector({ value, onChange }: NewProjectStageSelectorProps) {
  const currentStage = PROJECT_STAGE_CONFIGS.find(stage => stage.id === value) || PROJECT_STAGE_CONFIGS[0]
  const archivedStage = PROJECT_STAGE_CONFIGS.find(stage => stage.id === 'archived') || PROJECT_STAGE_CONFIGS[0]

  return (
    <div>
      <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border mb-4 ${currentStage.bgColor} ${currentStage.borderColor}`}>
        {(() => {
          const Icon = currentStage.icon
          return <Icon className={`w-4 h-4 ${currentStage.color}`} />
        })()}
        <span className={`text-sm font-medium ${currentStage.color}`}>{currentStage.labelZh}</span>
        <span className="text-xs text-on-surface-muted ml-1">— {currentStage.description}</span>
      </div>

      <p className="text-xs font-medium text-on-surface-muted mb-2">商机阶段</p>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {PROJECT_STAGE_CONFIGS.filter(stage => stage.phase === 'business').map(stage => {
          const Icon = stage.icon
          const active = value === stage.id
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onChange(stage.id)}
              className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
                active
                  ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm ring-2 ring-offset-1 ring-current/30`
                  : 'bg-surface-container-lowest border-outline/15 text-on-surface-muted hover:border-outline/30 hover:bg-surface-container-low'
              }`}
            >
              {active && <Check className="absolute top-1.5 right-1.5 w-3 h-3" />}
              <Icon className="w-4 h-4" />
              <span className="text-xs leading-tight font-medium">{stage.labelZh}</span>
            </button>
          )
        })}
      </div>

      <p className="text-xs font-medium text-on-surface-muted mb-2">交付阶段</p>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {PROJECT_STAGE_CONFIGS.filter(stage => stage.phase === 'delivery').map(stage => {
          const Icon = stage.icon
          const active = value === stage.id
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onChange(stage.id)}
              className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
                active
                  ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm ring-2 ring-offset-1 ring-current/30`
                  : 'bg-surface-container-lowest border-outline/15 text-on-surface-muted hover:border-outline/30 hover:bg-surface-container-low'
              }`}
            >
              {active && <Check className="absolute top-1.5 right-1.5 w-3 h-3" />}
              <Icon className="w-4 h-4" />
              <span className="text-xs leading-tight font-medium">{stage.labelZh}</span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => onChange('archived')}
        className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
          value === 'archived'
            ? `${archivedStage.bgColor} ${archivedStage.color} ${archivedStage.borderColor} shadow-sm`
            : 'bg-surface-container-lowest border-outline/15 text-on-surface-muted hover:border-outline/30'
        }`}
      >
        {value === 'archived' && <Check className="w-3.5 h-3.5" />}
        {(() => {
          const Icon = archivedStage.icon
          return <Icon className="w-4 h-4" />
        })()}
        <span className="font-medium">{archivedStage.labelZh}</span>
      </button>
    </div>
  )
}
