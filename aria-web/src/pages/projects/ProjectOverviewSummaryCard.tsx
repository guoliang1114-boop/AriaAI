import { Loader2, Sparkles } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";

interface ProjectOverviewSummaryCardProps {
  generatingSummary: boolean;
  isZh: boolean;
  onGenerate: () => void;
  summaryError: string;
  summaryText: string;
}

export function ProjectOverviewSummaryCard({
  generatingSummary,
  isZh,
  onGenerate,
  summaryError,
  summaryText,
}: ProjectOverviewSummaryCardProps) {
  if (summaryText) {
    return (
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
              <Sparkles className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">
                {isZh ? "AI 项目总结" : "AI Project Summary"}
              </h3>
              {generatingSummary && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[11px] text-indigo-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {isZh ? "生成中" : "Streaming"}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onGenerate}
            disabled={generatingSummary}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {isZh ? "重新生成" : "Regenerate"}
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
            {generatingSummary ? (
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            ) : (
              <Sparkles className="h-5 w-5 text-gray-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {isZh ? "AI 项目总结" : "AI Project Summary"}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {isZh
                ? "基于文档、里程碑和财务信息生成智能总结"
                : "Generate intelligent summary based on documents, milestones & financials"}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
          <button
            onClick={onGenerate}
            disabled={generatingSummary}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isZh ? "生成总结" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
