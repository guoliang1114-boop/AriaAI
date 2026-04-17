import { useTranslation } from "react-i18next";
import type { ProjectStageConfig } from "../../types/enums";
import type { Project } from "../../types/api";

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
  const summaryText = (project.context_summary?.trim() || project.description?.trim() || "")
    .replace(/^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-lg"
    >
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${stage.lightColor}`} />

      <div className="pl-3">
        <div className="mb-2 min-w-0">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {project.client}
          </div>
          <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">
            {project.name}
          </h4>
        </div>

        <div className="mb-3 min-h-[20px] text-xs leading-relaxed text-gray-500">
          {summaryText ? (
            <p className="line-clamp-2">{summaryText}</p>
          ) : (
            <p className="line-clamp-1">{isZh ? "暂无项目摘要" : "No summary yet"}</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-50 pt-3">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${stage.bgColor} ${stage.color}`}
          >
            <stage.icon className="h-3 w-3" />
            {isZh ? stage.labelZh : stage.label}
          </span>

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
      </div>
    </div>
  );
}
