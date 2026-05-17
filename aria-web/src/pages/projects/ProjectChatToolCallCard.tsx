import { CheckCircle2, Loader2, TriangleAlert, Wrench } from "lucide-react";
import type { ToolCallEvent } from "../../types/api";

interface ProjectChatToolCallCardProps {
  call: ToolCallEvent;
  isZh: boolean;
}

const STATUS_STYLES: Record<ToolCallEvent["status"], string> = {
  running: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

const WORKFLOW_STEP_STYLES: Record<ToolCallEvent["status"], string> = {
  running: "border-blue-200 bg-blue-50/80",
  completed: "border-emerald-200 bg-white",
  error: "border-rose-200 bg-rose-50/70",
};

const WORKFLOW_BADGE_STYLES: Record<ToolCallEvent["status"], string> = {
  running: "bg-blue-600 text-white",
  completed: "bg-emerald-600 text-white",
  error: "bg-rose-600 text-white",
};

function StatusIcon({ status }: { status: ToolCallEvent["status"] }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5" />;
  }
  return <TriangleAlert className="h-3.5 w-3.5" />;
}

export function ProjectChatToolCallCard({
  call,
  isZh,
}: ProjectChatToolCallCardProps) {
  const isWorkflowStep = Boolean(call.step_index);
  if (isWorkflowStep) {
    const stepTitle = call.step_title || call.tool_name.replace(/^步骤\s+\d+\/\d+：/, "");
    return (
      <div className={`rounded-2xl border px-4 py-3.5 shadow-sm ${WORKFLOW_STEP_STYLES[call.status]}`}>
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold tabular-nums shadow-sm ${WORKFLOW_BADGE_STYLES[call.status]}`}
          >
            {call.step_index}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-gray-950">
                {isZh ? `步骤 ${call.step_index}/${call.step_total || 4}` : `Step ${call.step_index}/${call.step_total || 4}`}
                <span className="mx-1 text-gray-300">·</span>
                {stepTitle}
              </p>
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600">
                <StatusIcon status={call.status} />
                {call.status === "running"
                  ? isZh
                    ? "进行中"
                    : "In progress"
                  : call.status === "completed"
                    ? isZh
                      ? "已完成"
                      : "Done"
                    : isZh
                      ? "需处理"
                      : "Needs attention"}
              </span>
            </div>
            {call.message ? <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{call.message}</p> : null}
            {call.summary ? <p className="mt-1 text-xs leading-relaxed text-gray-500">{call.summary}</p> : null}
            {call.error ? <p className="mt-1.5 text-xs leading-relaxed text-rose-600">{call.error}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border px-3.5 py-3 ${STATUS_STYLES[call.status]}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/80">
          <Wrench className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900">{call.tool_name}</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium">
              <StatusIcon status={call.status} />
              {call.status === "running"
                ? isZh
                  ? "执行中"
                  : "Running"
                : call.status === "completed"
                  ? isZh
                    ? "已完成"
                    : "Done"
                  : isZh
                    ? "失败"
                    : "Failed"}
            </span>
          </div>
          {call.message ? <p className="mt-1 text-xs text-gray-600">{call.message}</p> : null}
          {call.summary ? <p className="mt-1 text-xs text-gray-600">{call.summary}</p> : null}
          {call.error ? <p className="mt-1 text-xs text-rose-600">{call.error}</p> : null}
        </div>
      </div>
    </div>
  );
}
