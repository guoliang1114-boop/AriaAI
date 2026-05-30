/**
 * Run Activity Timeline (Product Run Event v1).
 *
 * Renders the normalized ``RunActivityTimeline`` from ``runActivityStore`` —
 * Skill banner (if any), per-step list with status badges, optional task
 * progress, confirmation card, and delivered artifacts. Visual treatment is
 * intentionally minimal at the scaffold stage; the surrounding chat shell
 * (``ProjectChatMessages`` / ``ChatStreamingMessage``) renders it next to the
 * existing legacy UI behind ``isRunHarnessV1Enabled``.
 */
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import type {
  ActivityStep,
  RunActivityTimeline,
  StepStatus,
} from "../../stores/runActivityReducer";
import type { ToolProgressStatus } from "../../types/productRunEvent";

interface Props {
  timeline: RunActivityTimeline;
}

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "等待中",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
};

const ITEM_STATUS_LABEL: Record<ToolProgressStatus, string> = {
  pending: "等待",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
};

function statusIcon(status: StepStatus | ToolProgressStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-codex-good" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-codex-bad" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-codex-accent" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-codex-ink-faint" />;
  }
}

function StepRow({ step, expanded, onToggle }: { step: ActivityStep; expanded: boolean; onToggle: () => void }) {
  const hasItems = step.items.length > 0;
  return (
    <li className="rounded-lg border border-codex-line bg-white">
      <button
        type="button"
        onClick={hasItems ? onToggle : undefined}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
          hasItems ? "hover:bg-codex-bg-tint" : "cursor-default"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-codex-bg-tint text-xs tabular-nums text-codex-ink-mute">
            {step.index}
          </span>
          <span className="truncate text-sm text-codex-ink-soft">{step.title}</span>
          {step.truncated && (
            <span className="flex items-center gap-1 rounded bg-codex-bg-tint px-1.5 py-0.5 text-[11px] text-codex-warn">
              <AlertTriangle className="h-3 w-3" />截断
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 text-xs text-codex-ink-mute">
          {typeof step.duration_ms === "number" && (
            <span className="tabular-nums">{step.duration_ms}ms</span>
          )}
          {statusIcon(step.status)}
          <span>{STEP_STATUS_LABEL[step.status] ?? step.status}</span>
          {hasItems && (expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
        </div>
      </button>
      {hasItems && expanded && (
        <ul className="space-y-1 border-t border-codex-line-soft px-3 py-2">
          {step.items.map((item, i) => (
            <li key={`${item.tool_name}-${i}`} className="flex items-start gap-2 text-xs text-codex-ink-soft">
              {statusIcon(item.status)}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-codex-ink-soft">{item.tool_name}</span>
                {item.detail && <span className="ml-1 text-codex-ink-mute">— {item.detail}</span>}
              </span>
              <span className="text-codex-ink-faint">{ITEM_STATUS_LABEL[item.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProjectChatActivityTimeline({ timeline }: Props) {
  // Default-expand the in-progress (last running) step, fold the rest.
  const initialExpanded = new Set<number>();
  const lastRunning = [...timeline.steps].reverse().find((s) => s.status === "running");
  if (lastRunning) initialExpanded.add(lastRunning.index);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(initialExpanded);

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const totalSteps = timeline.steps.length;
  const finishedSteps = timeline.steps.filter((s) => s.status === "completed" || s.status === "failed").length;

  return (
    <section className="space-y-2 text-sm" aria-label="Run activity timeline">
      {timeline.skill && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-codex-accent">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Skill：{timeline.skill.name}</span>
        </div>
      )}

      {timeline.task && (
        <div className="rounded-lg border border-codex-line bg-codex-bg-tint px-3 py-1.5 text-xs text-codex-ink-soft">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              任务 #{timeline.task.task_id}
              {timeline.task.step_title ? ` · ${timeline.task.step_title}` : ""}
            </span>
            <span className="tabular-nums text-codex-ink-mute">
              {typeof timeline.task.progress_pct === "number"
                ? `${timeline.task.progress_pct}%`
                : ""}
              {timeline.task.total_steps
                ? ` ${timeline.task.current_step ?? "-"}/${timeline.task.total_steps}`
                : ""}
            </span>
          </div>
        </div>
      )}

      {timeline.status && !timeline.final_status && (
        <div className="flex items-center gap-2 rounded-lg border border-codex-line bg-white px-3 py-1.5 text-xs text-codex-ink-mute shadow-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-codex-accent" />
          <span className="truncate">{timeline.status.message}</span>
          {typeof timeline.status.progress === "number" && (
            <span className="ml-auto tabular-nums text-codex-ink-faint">
              {Math.round(timeline.status.progress * 100) / 100}%
            </span>
          )}
        </div>
      )}

      {totalSteps > 0 && (
        <details open={timeline.final_status !== "completed"} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1 text-xs text-codex-ink-mute hover:bg-codex-bg-tint">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            {timeline.final_status === "completed" ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-codex-good" />
                <span>已完成 · {totalSteps} 步</span>
                {timeline.artifacts.length > 0 && (
                  <span className="text-codex-ink-faint">· {timeline.artifacts.length} 个交付物</span>
                )}
              </span>
            ) : (
              <span>
                活动 · {finishedSteps}/{totalSteps} 步
                {timeline.final_status === "failed" ? " · 失败" : ""}
              </span>
            )}
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {timeline.steps.map((step) => (
              <StepRow
                key={step.index}
                step={step}
                expanded={expandedSteps.has(step.index)}
                onToggle={() => toggleStep(step.index)}
              />
            ))}
          </ul>
        </details>
      )}

      {timeline.confirmation && (
        <div className="rounded-lg border border-codex-line bg-codex-bg-tint px-3 py-2 text-xs text-codex-warn">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            需要确认：{timeline.confirmation.action}
          </div>
          <p className="mt-0.5 text-codex-warn">{timeline.confirmation.impact}</p>
        </div>
      )}

      {timeline.artifacts.length > 0 && (
        <ul className="space-y-1">
          {timeline.artifacts.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-codex-line bg-white px-3 py-1.5 text-xs"
            >
              <span className="truncate text-codex-ink-soft">
                📎 #{a.id} <span className="uppercase text-codex-ink-faint">{a.type}</span>
              </span>
              {a.download_url && (
                <a
                  href={a.download_url}
                  className="text-codex-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  下载
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {timeline.error && (
        <div className="rounded-lg border border-codex-line bg-codex-bg-tint px-3 py-2 text-xs text-codex-bad">
          <div className="flex items-center gap-1.5 font-medium">
            <XCircle className="h-3.5 w-3.5" /> 失败：{timeline.error.code}
          </div>
          <p className="mt-0.5 text-codex-bad">{timeline.error.message}</p>
        </div>
      )}
    </section>
  );
}
