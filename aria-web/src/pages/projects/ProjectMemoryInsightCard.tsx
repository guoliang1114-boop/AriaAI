import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";

interface ProjectMemoryInsightCardProps {
  content: string;
  error: string;
  hint: string;
  isZh: boolean;
  loading: boolean;
  onRefresh: () => void;
  title: string;
}

export function ProjectMemoryInsightCard({
  content,
  error,
  hint,
  isZh,
  loading,
  onRefresh,
  title,
}: ProjectMemoryInsightCardProps) {
  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-sky-50 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
            <Sparkles className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">{title}</h3>
              {loading ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[11px] text-indigo-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {isZh ? "流式生成中" : "Streaming"}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-gray-500">{hint}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {isZh ? "刷新" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {content ? (
        <div className="md-root">
          <MarkdownRenderer
            content={content
              .replace(/^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/gm, "- ")
              .replace(/\n(?!\n)/g, "\n\n")}
          />
          {loading ? (
            <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-indigo-500 align-middle" />
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg bg-white/70 p-3 text-sm text-gray-500">
          {loading
            ? isZh
              ? "正在整理项目记忆摘要..."
              : "Generating memory summary..."
            : isZh
              ? "暂时还没有摘要内容。"
              : "No summary available yet."}
        </div>
      )}
    </div>
  );
}
