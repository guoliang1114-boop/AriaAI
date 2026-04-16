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
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <h3 className="font-semibold text-gray-900">
              {isZh ? "AI 椤圭洰鎽樿" : "AI Project Summary"}
            </h3>
          </div>
          <button
            onClick={onGenerate}
            disabled={generatingSummary}
            className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {isZh ? "閲嶆柊鐢熸垚" : "Regenerate"}
          </button>
        </div>
        {summaryError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-lg">
            <p className="text-sm text-red-600">{summaryError}</p>
          </div>
        )}
        {generatingSummary ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            {isZh ? "姝ｅ湪鐢熸垚鎽樿..." : "Generating summary..."}
          </div>
        ) : (
          <div className="md-root">
            <MarkdownRenderer
              content={summaryText
                .replace(/^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/gm, "- ")
                .replace(/\n(?!\n)/g, "\n\n")}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
            {generatingSummary ? (
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
            ) : (
              <Sparkles className="w-5 h-5 text-gray-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {isZh ? "AI 椤圭洰鎽樿" : "AI Project Summary"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {isZh
                ? "鍩轰簬椤圭洰鏂囨。銆侀噷绋嬬鍜岃储鍔＄姸鍐电敓鎴愭櫤鑳芥€荤粨"
                : "Generate intelligent summary based on documents, milestones & financials"}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
          <button
            onClick={onGenerate}
            disabled={generatingSummary}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {isZh ? "鐢熸垚鎽樿" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
