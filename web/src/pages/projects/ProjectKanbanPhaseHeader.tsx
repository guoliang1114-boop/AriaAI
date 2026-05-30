import { ChevronRight } from "lucide-react";
import type { PhaseConfig } from "./ProjectsPhaseSection";

interface ProjectKanbanPhaseHeaderProps {
  isExpanded: boolean;
  isZh: boolean;
  onToggle: () => void;
  phase: PhaseConfig;
  totalProjects: number;
  totalValue: number;
}

export function ProjectKanbanPhaseHeader({
  isExpanded,
  isZh,
  onToggle,
  phase,
  totalProjects,
  totalValue,
}: ProjectKanbanPhaseHeaderProps) {
  const Icon = phase.icon;

  return (
    <div
      onClick={onToggle}
      className={`relative cursor-pointer overflow-hidden rounded-xl border transition-all duration-300 ${
        isExpanded
          ? `bg-gradient-to-r ${phase.gradient} border-codex-line shadow-sm`
          : "border-codex-line bg-white hover:border-codex-line-strong hover:shadow-md"
      }`}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${phase.bgColor} shadow-sm`}>
              <Icon className={`h-5 w-5 ${phase.color}`} />
            </div>
            <div>
              <h2 className={`text-base font-semibold ${phase.color}`}>{isZh ? phase.labelZh : phase.label}</h2>
              <p className="mt-0.5 text-xs text-codex-ink-mute">{isZh ? phase.subtitle : phase.subtitleEn}</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-lg font-semibold text-codex-ink">{totalProjects}</p>
              <p className="mt-0.5 text-xs font-medium text-codex-ink-mute">
                {isZh ? "项目" : "Projects"}
              </p>
            </div>
            {totalValue > 0 ? (
              <div className="border-l border-codex-line px-6 text-center">
                <p className="text-base font-semibold text-codex-ink">
                  CNY {(totalValue / 10000).toFixed(0)}
                  {isZh ? "万" : "K"}
                </p>
                <p className="mt-0.5 text-xs font-medium text-codex-ink-mute">
                  {isZh ? "金额" : "Value"}
                </p>
              </div>
            ) : null}
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full ${
                isExpanded ? phase.bgColor : "bg-codex-bg-tint"
              } transition-all duration-300`}
            >
              <ChevronRight
                className={`h-4 w-4 text-codex-ink-faint transition-transform duration-300 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
