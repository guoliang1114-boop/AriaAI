import { PROJECT_STAGE_CONFIGS, resolveProjectStage, type ProjectStage } from "../../types/enums";

interface ProjectSettingsStageFieldProps {
  isEditing: boolean;
  isZh: boolean;
  onChange: (value: ProjectStage) => void;
  value: string;
}

function StageOptionGroup({
  columnsClassName,
  isZh,
  onChange,
  stages,
  value,
}: {
  columnsClassName: string;
  isZh: boolean;
  onChange: (value: ProjectStage) => void;
  stages: typeof PROJECT_STAGE_CONFIGS;
  value: string;
}) {
  return (
    <div className={columnsClassName}>
      {stages.map((stage) => {
        const Icon = stage.icon;
        const isActive = resolveProjectStage(value).id === stage.id;
        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => onChange(stage.id)}
            className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all ${
              isActive
                ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm`
                : "bg-codex-bg-tint border-codex-line text-codex-ink-faint hover:bg-codex-bg-tint"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="text-xs leading-tight">
              {isZh ? stage.labelZh : stage.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ProjectSettingsStageField({
  isEditing,
  isZh,
  onChange,
  value,
}: ProjectSettingsStageFieldProps) {
  const businessStages = PROJECT_STAGE_CONFIGS.filter((stage) => stage.phase === "business");
  const deliveryStages = PROJECT_STAGE_CONFIGS.filter((stage) => stage.phase === "delivery");
  const archivedStage =
    PROJECT_STAGE_CONFIGS.find((stage) => stage.id === "archived") || PROJECT_STAGE_CONFIGS[0];

  if (!isEditing) {
    const stage = resolveProjectStage(value);
    const Icon = stage.icon;

    return (
      <div>
        <label className="mb-2 block text-sm font-medium text-codex-ink-soft">
          {isZh ? "项目阶段" : "Project Stage"}
        </label>
        <div
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${stage.bgColor} ${stage.color} ${stage.borderColor}`}
        >
          <Icon className="h-4 w-4" />
          {isZh ? stage.labelZh : stage.label}
        </div>
      </div>
    );
  }

  const ArchivedIcon = archivedStage.icon;
  const isArchivedActive = resolveProjectStage(value).id === "archived";

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-codex-ink-soft">
        {isZh ? "项目阶段" : "Project Stage"}
      </label>
      <div className="space-y-2">
        <p className="text-xs font-medium text-codex-ink-faint">
          {isZh ? "商务阶段" : "Business Phase"}
        </p>
        <StageOptionGroup
          columnsClassName="mb-3 grid grid-cols-5 gap-1.5"
          isZh={isZh}
          onChange={onChange}
          stages={businessStages}
          value={value}
        />

        <p className="text-xs font-medium text-codex-ink-faint">
          {isZh ? "交付阶段" : "Delivery Phase"}
        </p>
        <StageOptionGroup
          columnsClassName="mb-3 grid grid-cols-4 gap-1.5"
          isZh={isZh}
          onChange={onChange}
          stages={deliveryStages}
          value={value}
        />

        <button
          type="button"
          onClick={() => onChange("archived")}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
            isArchivedActive
              ? `${archivedStage.bgColor} ${archivedStage.color} ${archivedStage.borderColor} shadow-sm`
              : "bg-codex-bg-tint border-codex-line text-codex-ink-faint hover:bg-codex-bg-tint"
          }`}
        >
          <ArchivedIcon className="h-4 w-4" />
          {isZh ? archivedStage.labelZh : archivedStage.label}
        </button>
      </div>
    </div>
  );
}
