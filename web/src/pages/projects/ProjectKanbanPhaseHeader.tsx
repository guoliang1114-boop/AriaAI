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
      className={`relative cursor-pointer overflow-hidden rounded-2xl border transition-all duration-300 ${
        isExpanded
          ? `bg-gradient-to-r ${phase.gradient} border-gray-200 shadow-sm`
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-md"
      }`}
    >
      <div className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${phase.bgColor} shadow-sm`}>
              <Icon className={`h-7 w-7 ${phase.color}`} />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${phase.color}`}>{isZh ? phase.labelZh : phase.label}</h2>
              <p className="mt-1 text-sm text-gray-500">{isZh ? phase.subtitle : phase.subtitleEn}</p>
            </div>
          </div>

          <div className="flex items-center gap-8">
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{totalProjects}</p>
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "项目" : "Projects"}
              </p>
            </div>
            {totalValue > 0 ? (
              <div className="border-l border-gray-200 px-8 text-center">
                <p className="text-xl font-bold text-gray-900">
                  CNY {(totalValue / 10000).toFixed(0)}
                  {isZh ? "万" : "K"}
                </p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-gray-500">
                  {isZh ? "金额" : "Value"}
                </p>
              </div>
            ) : null}
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full ${
                isExpanded ? phase.bgColor : "bg-gray-50"
              } transition-all duration-300`}
            >
              <ChevronRight
                className={`h-6 w-6 text-gray-400 transition-transform duration-300 ${
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
