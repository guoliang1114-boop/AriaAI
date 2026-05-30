import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";

interface ProjectMemoryInsightCardProps {
  actionLabel?: string;
  content: string;
  emptyDescription?: string;
  emptyTitle?: string;
  error: string;
  generated?: boolean;
  hint: string;
  isZh: boolean;
  loading: boolean;
  onRefresh: () => void;
  title: string;
}

export function ProjectMemoryInsightCard({
  actionLabel: customActionLabel,
  content,
  emptyDescription,
  emptyTitle,
  error,
  generated = false,
  hint,
  isZh,
  loading,
  onRefresh,
  title,
}: ProjectMemoryInsightCardProps) {
  const actionLabel = customActionLabel || (content || generated ? (isZh ? "重新生成摘要" : "Regenerate") : isZh ? "生成摘要" : "Generate");
  const fallbackEmptyTitle = generated
    ? isZh
      ? "已生成，但暂无可展示内容"
      : "Generated, but no content to show"
    : isZh
      ? "尚未生成本维度摘要"
      : "This summary has not been generated yet";
  const fallbackEmptyDescription = generated
    ? isZh
      ? "系统已完成本轮生成，但该维度没有足够信息形成摘要。可以先补充项目资料，或点击重新生成。"
      : "This summary was generated, but there was not enough information for this view. Add project data or regenerate."
    : isZh
      ? "点击生成摘要后，系统会基于当前项目记忆生成本维度内容。"
      : "Click Generate to create this view from the current project memory.";

  return (
    <div className="rounded-xl border border-codex-line-soft bg-gradient-to-r from-indigo-50 to-sky-50 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
            <Sparkles className="h-4 w-4 text-codex-accent" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-codex-ink">{title}</h3>
              {loading ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-xs text-codex-accent">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {isZh ? "生成中" : "Streaming"}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-codex-ink-mute">{hint}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-codex-line bg-white px-3 py-1.5 text-xs font-medium text-codex-ink-soft hover:bg-codex-bg-tint disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {actionLabel}
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-codex-line-soft bg-codex-bg-tint p-3 text-sm text-codex-bad">
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
            <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-codex-accent align-middle" />
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg bg-white/70 p-3 text-sm text-codex-ink-mute">
          {loading ? (
            isZh ? "正在整理项目摘要..." : "Generating summary..."
          ) : (
            <div className="space-y-1">
              <div className="font-medium text-codex-ink-soft">{emptyTitle || fallbackEmptyTitle}</div>
              <div>{emptyDescription || fallbackEmptyDescription}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
