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
