import { Loader2, Sparkles } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { ProjectMemorySummaryType } from "../../types/api";

interface ProjectOverviewSummaryCardProps {
  generatingSummary: boolean;
  isZh: boolean;
  onGenerate: (summaryType?: ProjectMemorySummaryType, force?: boolean) => void;
  onSummaryTypeChange: (summaryType: ProjectMemorySummaryType) => void;
  summaryError: string;
  summaryText: string;
  summaryType: ProjectMemorySummaryType;
}

const SUMMARY_TYPES: ProjectMemorySummaryType[] = [
  "overview",
  "risk",
  "delivery",
  "stakeholder",
  "client-facing",
];

function getSummaryTypeLabel(type: ProjectMemorySummaryType, isZh: boolean) {
  if (!isZh) {
    return {
      overview: "Overview",
      risk: "Risk",
      delivery: "Delivery",
      stakeholder: "Stakeholder",
      "client-facing": "Client",
    }[type];
  }

  return {
    overview: "概览",
    risk: "风险",
    delivery: "交付",
    stakeholder: "干系人",
    "client-facing": "客户视角",
  }[type];
}

function getSummaryHint(type: ProjectMemorySummaryType, isZh: boolean) {
  if (!isZh) {
    return {
      overview: "Streaming overview generated from project memory",
      risk: "Streaming summary focused on current risks and blocked decisions",
      delivery: "Streaming summary focused on delivery progress and next execution steps",
      stakeholder: "Streaming summary focused on stakeholder alignment and follow-ups",
      "client-facing": "Streaming summary focused on client-safe progress updates",
    }[type];
  }

  return {
    overview: "基于项目记忆流式生成的概览摘要",
    risk: "流式聚焦当前风险、阻塞点和需要关注的事项",
    delivery: "流式聚焦交付进展、重要文档和下一步执行动作",
    stakeholder: "流式聚焦干系人关注点、对齐情况和后续跟进",
    "client-facing": "流式聚焦适合对外沟通的客户视角进展",
  }[type];
}

export function ProjectOverviewSummaryCard({
  generatingSummary,
  isZh,
  onGenerate,
  onSummaryTypeChange,
  summaryError,
  summaryText,
  summaryType,
}: ProjectOverviewSummaryCardProps) {
  const title = isZh ? "AI 项目总结" : "AI Project Summary";
  const generateLabel = isZh ? "生成总结" : "Generate Summary";
  const regenerateLabel = isZh ? "重新生成" : "Regenerate";

  const controls = (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">{getSummaryHint(summaryType, isZh)}</p>
      <div className="flex flex-wrap gap-2">
        {SUMMARY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onSummaryTypeChange(type)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              summaryType === type
                ? "bg-indigo-600 text-white"
                : "bg-white/80 text-gray-600 hover:bg-white"
            }`}
          >
            {getSummaryTypeLabel(type, isZh)}
          </button>
        ))}
      </div>
    </div>
  );

  if (summaryText) {
    return (
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
              <Sparkles className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">{title}</h3>
                {generatingSummary && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[11px] text-indigo-600">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {isZh ? "流式生成中" : "Streaming"}
                  </span>
                )}
              </div>
              {controls}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void onGenerate(summaryType, true)}
            disabled={generatingSummary}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {regenerateLabel}
          </button>
        </div>

        {summaryError && (
          <div className="mb-3 rounded-lg border border-red-100 bg-red-50 p-3">
            <p className="text-sm text-red-600">{summaryError}</p>
          </div>
        )}

        <div className="md-root">
          <MarkdownRenderer
            content={summaryText
              .replace(/^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/gm, "- ")
              .replace(/\n(?!\n)/g, "\n\n")}
          />
          {generatingSummary && (
            <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-indigo-500 align-middle" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
            {generatingSummary ? (
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            ) : (
              <Sparkles className="h-5 w-5 text-gray-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{getSummaryHint(summaryType, isZh)}</p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
          <button
            type="button"
            onClick={() => void onGenerate(summaryType, true)}
            disabled={generatingSummary}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generateLabel}
          </button>
        </div>
      </div>

      <div className="mt-4">{controls}</div>
    </div>
  );
}
