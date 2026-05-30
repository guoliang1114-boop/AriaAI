import { Loader2, Sparkles } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { ProjectMemorySummaryType } from "../../types/api";

interface ProjectOverviewSummaryCardProps {
  generatingSummary: boolean;
  isZh: boolean;
  onGenerate: (summaryType?: ProjectMemorySummaryType, force?: boolean) => void;
  onSummaryTypeChange: (summaryType: ProjectMemorySummaryType) => void;
  summaryError: string;
  summaryCooldownUntil?: number | null;
  summaryText: string;
  summaryType: ProjectMemorySummaryType;
}

const SUMMARY_TYPES: ProjectMemorySummaryType[] = [
  "overview",
  "risk",
  "delivery",
  "stakeholder",
  "client-facing",
  "financial",
  "documents",
];

function getSummaryTypeLabel(type: ProjectMemorySummaryType, isZh: boolean) {
  if (!isZh) {
    return {
      overview: "Overview",
      risk: "Risk",
      delivery: "Delivery",
      stakeholder: "Stakeholder",
      "client-facing": "Client",
      financial: "Financial",
      documents: "Documents",
    }[type];
  }

  return {
    overview: "概览",
    risk: "风险",
    delivery: "交付",
    stakeholder: "干系人",
    "client-facing": "客户视角",
    financial: "财务",
    documents: "文档",
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
      financial: "Streaming summary focused on financial status, collections, and budget signals",
      documents: "Streaming summary focused on important documents and knowledge gaps",
    }[type];
  }

  return {
    overview: "基于项目记忆流式生成的概览摘要",
    risk: "流式聚焦当前风险、阻塞点和需要关注的事项",
    delivery: "流式聚焦交付进展、重要文档和下一步执行动作",
    stakeholder: "流式聚焦干系人关注点、对齐情况和后续跟进",
    "client-facing": "流式聚焦适合对外沟通的客户视角进展",
    financial: "流式聚焦财务状态、回款风险和预算信号",
    documents: "流式聚焦重要文档、知识缺口和下一步资料动作",
  }[type];
}

export function ProjectOverviewSummaryCard({
  generatingSummary,
  isZh,
  onGenerate,
  onSummaryTypeChange,
  summaryError,
  summaryCooldownUntil,
  summaryText,
  summaryType,
}: ProjectOverviewSummaryCardProps) {
  const title = isZh ? "AI 项目总结" : "AI Project Summary";
  const generateLabel = isZh ? "生成全部总结" : "Generate All";
  const regenerateLabel = isZh ? "重新生成全部" : "Regenerate All";

  const isCoolingDown = !!summaryCooldownUntil && Date.now() < summaryCooldownUntil;
  const actionDisabled = generatingSummary || isCoolingDown;
  const actionLabel = isCoolingDown ? (isZh ? "限流冷却中" : "Cooling down") : regenerateLabel;
  const primaryActionLabel = isCoolingDown ? (isZh ? "限流冷却中" : "Cooling down") : generateLabel;

  const controls = (
    <div className="space-y-2">
      <p className="text-xs text-codex-ink-mute">{getSummaryHint(summaryType, isZh)}</p>
      <div className="flex flex-wrap gap-2">
        {SUMMARY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onSummaryTypeChange(type)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              summaryType === type
                ? "bg-codex-accent text-white"
                : "bg-white/80 text-codex-ink-soft hover:bg-white"
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
      <div className="rounded-xl border border-codex-line-soft bg-gradient-to-r from-indigo-50 to-purple-50 p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
              <Sparkles className="h-4 w-4 text-codex-accent" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-codex-ink">{title}</h3>
                {generatingSummary && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-xs text-codex-accent">
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
            disabled={actionDisabled}
            className="flex items-center gap-1 text-xs text-codex-accent hover:text-codex-accent-ink disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {actionLabel}
          </button>
        </div>

        {summaryError && (
          <div className="mb-3 rounded-lg border border-codex-line bg-codex-bg-tint p-3">
            <p className="text-sm text-codex-bad">{summaryError}</p>
          </div>
        )}

        <div className="md-root">
          <MarkdownRenderer
            content={summaryText
              .replace(/^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/gm, "- ")
              .replace(/\n(?!\n)/g, "\n\n")}
          />
          {generatingSummary && (
            <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-codex-accent-bg0 align-middle" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-codex-line bg-gradient-to-r from-gray-50 to-gray-100 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
            {generatingSummary ? (
              <Loader2 className="h-5 w-5 animate-spin text-codex-accent" />
            ) : (
              <Sparkles className="h-5 w-5 text-codex-ink-faint" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-codex-ink">{title}</h3>
            <p className="mt-0.5 text-xs text-codex-ink-mute">{getSummaryHint(summaryType, isZh)}</p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {summaryError && <p className="text-xs text-codex-bad">{summaryError}</p>}
          <button
            type="button"
            onClick={() => void onGenerate(summaryType, true)}
            disabled={actionDisabled}
            className="flex items-center gap-2 rounded-lg bg-codex-accent px-4 py-2 text-sm font-medium text-white hover:bg-codex-accent disabled:opacity-50"
          >
            {generatingSummary ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {primaryActionLabel}
          </button>
        </div>
      </div>

      <div className="mt-4">{controls}</div>
    </div>
  );
}
