import { useTranslation } from "react-i18next";
import { AlertTriangle, Calendar, Sparkles } from "lucide-react";
import type { ProjectStageConfig } from "../../types/enums";
import type { Project } from "../../types/api";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";

const formatAmountInTenThousand = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return "0";
  const tenThousand = amount / 10000;
  if (tenThousand < 1) {
    return amount.toLocaleString("zh-CN");
  }
  const hasFraction = tenThousand % 1 !== 0;
  return hasFraction
    ? tenThousand.toLocaleString("zh-CN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : tenThousand.toLocaleString("zh-CN");
};

interface ProjectKanbanCardProps {
  onClick: () => void;
  project: Project;
  stage: ProjectStageConfig;
}

export function ProjectKanbanCard({ onClick, project, stage }: ProjectKanbanCardProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const hasMemory = (project.memory_version || 0) > 0;
  const memoryLabel = !hasMemory
    ? isZh
      ? "未生成记忆"
      : "No Memory"
    : project.memory_stale
      ? isZh
        ? "记忆待刷新"
        : "Memory Stale"
      : isZh
        ? "记忆已同步"
        : "Memory Ready";

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-lg"
    >
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${stage.lightColor}`} />

      <div className="pl-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {project.client}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  !hasMemory
                    ? "bg-gray-100 text-gray-500"
                    : project.memory_stale
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {project.memory_stale ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {memoryLabel}
              </span>
            </div>
            <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">
              {project.name}
            </h4>
          </div>
        </div>

        {project.context_summary ? (
          <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-gray-600">
            {project.context_summary.replace(/^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/gm, "").trim()}
          </p>
        ) : project.description ? (
          <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-gray-500">
            {project.description}
          </p>
        ) : null}

        <div className="mb-2 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${stage.bgColor} ${stage.color}`}
          >
            <stage.icon className="h-3 w-3" />
            {isZh ? stage.labelZh : stage.label}
          </span>
        </div>

        {hasMemory && project.memory_updated_at ? (
          <div className="mb-3 text-[11px] text-gray-400">
            {isZh ? "记忆更新于 " : "Memory updated "}
            {formatProjectMemoryUpdatedAt(project.memory_updated_at, isZh)}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-gray-50 pt-3">
          <div className="flex items-center gap-2">
            {project.contract_amount ? (
              <span className="text-xs font-bold text-gray-800">
                CNY {formatAmountInTenThousand(project.contract_amount)}
                {isZh ? "万" : "K"}
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                {isZh ? "待报价" : "Quote Pending"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <Calendar className="h-3 w-3" />
            <span>
              {new Date(project.updated_at).toLocaleDateString(isZh ? "zh-CN" : "en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
