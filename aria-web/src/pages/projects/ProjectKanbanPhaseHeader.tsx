import { ChevronRight, Loader2, RefreshCw, Wand2 } from "lucide-react";
import type { PhaseConfig } from "./ProjectsPhaseSection";

interface ProjectKanbanPhaseHeaderProps {
  isExpanded: boolean;
  isGenerating: boolean;
  isRefreshing: boolean;
  isZh: boolean;
  noMemoryCount: number;
  onRefreshPhase: () => void;
  onToggle: () => void;
  phase: PhaseConfig;
  staleCount: number;
  totalProjects: number;
  totalValue: number;
}

export function ProjectKanbanPhaseHeader({
  isExpanded,
  isGenerating,
  isRefreshing,
  isZh,
  noMemoryCount,
  onRefreshPhase,
  onToggle,
  phase,
  staleCount,
  totalProjects,
  totalValue,
}: ProjectKanbanPhaseHeaderProps) {
  const Icon = phase.icon;
  const primaryActionLabel =
    staleCount > 0
      ? isZh
        ? "刷新本阶段记忆"
        : "Refresh Phase Memory"
      : isZh
        ? "补齐缺失记忆"
        : "Generate Missing Memory";

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
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={`text-xl font-bold ${phase.color}`}>
                  {isZh ? phase.labelZh : phase.label}
                </h2>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  {isZh ? `待刷新 ${staleCount}` : `Stale ${staleCount}`}
                </span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {isZh ? `未生成 ${noMemoryCount}` : `Missing ${noMemoryCount}`}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {isZh ? phase.subtitle : phase.subtitleEn}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRefreshPhase();
              }}
              disabled={(isRefreshing || isGenerating) || (staleCount === 0 && noMemoryCount === 0)}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {isRefreshing || isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : staleCount > 0 ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {primaryActionLabel}
            </button>

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
    </div>
  );
}
