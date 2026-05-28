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
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-rose-600" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-slate-400" />;
  }
}

function StepRow({ step, expanded, onToggle }: { step: ActivityStep; expanded: boolean; onToggle: () => void }) {
  const hasItems = step.items.length > 0;
  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={hasItems ? onToggle : undefined}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
          hasItems ? "hover:bg-slate-50" : "cursor-default"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-xs tabular-nums text-slate-500">
            {step.index}
          </span>
          <span className="truncate text-sm text-slate-800">{step.title}</span>
          {step.truncated && (
            <span className="flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
              <AlertTriangle className="h-3 w-3" />截断
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 text-xs text-slate-500">
          {typeof step.duration_ms === "number" && (
            <span className="tabular-nums">{step.duration_ms}ms</span>
          )}
          {statusIcon(step.status)}
          <span>{STEP_STATUS_LABEL[step.status] ?? step.status}</span>
          {hasItems && (expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
        </div>
      </button>
      {hasItems && expanded && (
        <ul className="space-y-1 border-t border-slate-100 px-3 py-2">
          {step.items.map((item, i) => (
            <li key={`${item.tool_name}-${i}`} className="flex items-start gap-2 text-xs text-slate-600">
              {statusIcon(item.status)}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-slate-700">{item.tool_name}</span>
                {item.detail && <span className="ml-1 text-slate-500">— {item.detail}</span>}
              </span>
              <span className="text-slate-400">{ITEM_STATUS_LABEL[item.status]}</span>
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
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Skill：{timeline.skill.name}</span>
        </div>
      )}

      {timeline.task && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              任务 #{timeline.task.task_id}
              {timeline.task.step_title ? ` · ${timeline.task.step_title}` : ""}
            </span>
            <span className="tabular-nums text-slate-500">
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

      {totalSteps > 0 && (
        <details open={timeline.final_status !== "completed"} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1 text-xs text-slate-500 hover:bg-slate-50">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            <span>
              活动 · {finishedSteps}/{totalSteps} 步
              {timeline.final_status === "failed" ? " · 失败" : ""}
            </span>
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
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            需要确认：{timeline.confirmation.action}
          </div>
          <p className="mt-0.5 text-amber-800">{timeline.confirmation.impact}</p>
        </div>
      )}

      {timeline.artifacts.length > 0 && (
        <ul className="space-y-1">
          {timeline.artifacts.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
            >
              <span className="truncate text-slate-700">
                📎 #{a.id} <span className="uppercase text-slate-400">{a.type}</span>
              </span>
              {a.download_url && (
                <a
                  href={a.download_url}
                  className="text-primary hover:underline"
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
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <div className="flex items-center gap-1.5 font-medium">
            <XCircle className="h-3.5 w-3.5" /> 失败：{timeline.error.code}
          </div>
          <p className="mt-0.5 text-rose-800">{timeline.error.message}</p>
        </div>
      )}
    </section>
  );
}
