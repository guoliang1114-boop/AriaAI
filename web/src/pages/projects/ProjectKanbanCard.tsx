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

const MARKDOWN_BOLD = /\*\*(.*?)\*\*/g;
const LEADING_BULLET = /^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/;
const LABEL_PREFIX = /^([^:：]{1,12})[:：]\s*/;

function truncateSummary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function toCardSummary(rawText: string, isZh: boolean): string {
  const normalized = rawText
    .replace(MARKDOWN_BOLD, "$1")
    .split(/\r?\n+/)
    .map((line) => line.replace(LEADING_BULLET, "").trim())
    .filter(Boolean);

  const candidates = normalized
    .map((line) => line.replace(LABEL_PREFIX, "").trim())
    .filter(Boolean);

  const firstMeaningful = candidates[0] || "";
  const firstSentence = firstMeaningful.split(/[。！？.!?；;]/)[0]?.trim() || firstMeaningful;

  return truncateSummary(firstSentence, isZh ? 36 : 72);
}

interface ProjectKanbanCardProps {
  onClick: () => void;
  onPointerEnter?: () => void;
  onPointerDown?: () => void;
  project: Project;
  stage: ProjectStageConfig;
}

export function ProjectKanbanCard({ onClick, onPointerEnter, onPointerDown, project, stage }: ProjectKanbanCardProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const sourceText = project.context_summary?.trim() || project.description?.trim() || "";
  const summaryText = sourceText ? toCardSummary(sourceText, isZh) : "";

  return (
    <div
      onClick={onClick}
      onMouseEnter={onPointerEnter}
      onPointerDown={onPointerDown}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-gray-100 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-lg"
    >
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${stage.lightColor}`} />

      <div className="pl-2.5">
        <div className="mb-1.5 min-w-0">
          <div className="mb-1 text-[11px] font-semibold leading-4 text-gray-400">
            {project.client}
          </div>
          <h4 className="line-clamp-2 text-[13px] font-semibold leading-5 text-gray-900">
            {project.name}
          </h4>
        </div>

        <div className="mb-2.5 min-h-[18px] text-[11px] leading-4 text-gray-500">
          {summaryText ? (
            <p className="line-clamp-1">{summaryText}</p>
          ) : (
            <p className="line-clamp-1">{isZh ? "暂无项目摘要" : "No summary yet"}</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-50 pt-2.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${stage.bgColor} ${stage.color}`}
          >
            <stage.icon className="h-3 w-3" />
            {isZh ? stage.labelZh : stage.label}
          </span>

          {project.contract_amount ? (
            <span className="text-[11px] font-semibold text-gray-800">
              CNY {formatAmountInTenThousand(project.contract_amount)}
              {isZh ? "万" : "K"}
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
              {isZh ? "待报价" : "Quote Pending"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
