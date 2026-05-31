import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  PanelRightOpen,
  TriangleAlert,
} from "lucide-react";
import type { ToolCallEvent } from "../../types/api";

interface ProjectChatToolCallCardProps {
  call: ToolCallEvent;
  isZh: boolean;
  onOpenTasks?: () => void;
}

const STATUS_STYLES: Record<ToolCallEvent["status"], string> = {
  pending: "border-codex-line bg-codex-bg-tint text-codex-ink-soft",
  running: "border-codex-line bg-codex-bg-tint text-codex-warn",
  completed: "border-codex-line bg-codex-accent-bg text-codex-good",
  error: "border-codex-line bg-codex-bg-tint text-codex-bad",
  blocked: "border-codex-line bg-codex-bg-tint text-codex-warn",
  confirmation_required: "border-codex-line bg-codex-bg-tint text-codex-warn",
  skipped: "border-codex-line bg-codex-bg-tint text-codex-ink-soft",
};

const WORKFLOW_STEP_STYLES: Record<ToolCallEvent["status"], string> = {
  pending: "border-codex-line bg-codex-bg-elev",
  running: "border-codex-line bg-codex-accent-bg/65",
  completed: "border-codex-line bg-codex-bg-elev",
  error: "border-codex-line bg-codex-bg-tint/70",
  blocked: "border-codex-line bg-codex-bg-tint/70",
  confirmation_required: "border-codex-line bg-codex-bg-tint/70",
  skipped: "border-codex-line bg-codex-bg-tint/70",
};

// Tone-tinted badges (background mix + tone ink) match the rest of the
// redesign — overview chips, milestone status pills. No more white-on-
// solid which read as the V0.0.5 indigo/violet pattern.
const WORKFLOW_BADGE_STYLES: Record<ToolCallEvent["status"], string> = {
  pending:
    "bg-codex-bg-tint text-codex-ink-soft",
  running:
    "bg-[color:color-mix(in_oklch,var(--color-codex-accent)_14%,transparent)] text-codex-accent",
  completed:
    "bg-[color:color-mix(in_oklch,var(--color-codex-good)_14%,transparent)] text-codex-good",
  error:
    "bg-[color:color-mix(in_oklch,var(--color-codex-bad)_14%,transparent)] text-codex-bad",
  blocked:
    "bg-[color:color-mix(in_oklch,var(--color-codex-warn)_14%,transparent)] text-codex-warn",
  confirmation_required:
    "bg-[color:color-mix(in_oklch,var(--color-codex-warn)_14%,transparent)] text-codex-warn",
  skipped: "bg-codex-bg-tint text-codex-ink-mute",
};

const WORKFLOW_DETAIL_PREFERENCE_KEY =
  "aria.projectChat.workflowStepDetailsExpanded";

function StatusIcon({ status }: { status: ToolCallEvent["status"] }) {
  if (status === "pending") {
    return <Clock3 className="h-3.5 w-3.5" />;
  }
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5" />;
  }
  return <TriangleAlert className="h-3.5 w-3.5" />;
}

function statusLabel(
  status: ToolCallEvent["status"],
  isZh: boolean,
  isWorkflowStep = false,
) {
  if (status === "pending") return isZh ? "等待中" : "Pending";
  if (status === "running")
    return isZh
      ? isWorkflowStep
        ? "进行中"
        : "执行中"
      : isWorkflowStep
        ? "In progress"
        : "Running";
  if (status === "completed") return isZh ? "已完成" : "Done";
  if (status === "blocked") return isZh ? "已拦截" : "Blocked";
  if (status === "confirmation_required") return isZh ? "待确认" : "Confirm";
  if (status === "skipped") return isZh ? "已跳过" : "Skipped";
  return isZh
    ? isWorkflowStep
      ? "需处理"
      : "失败"
    : isWorkflowStep
      ? "Needs attention"
      : "Failed";
}

function toolDisplayName(toolName: string, isZh: boolean) {
  if (toolName === "manage_project_files")
    return isZh ? "管理项目文件" : "Manage project files";
  if (toolName === "manage_project_folders")
    return isZh ? "管理项目文件夹" : "Manage project folders";
  if (toolName === "write_project_office_document")
    return isZh ? "生成项目文档" : "Create project document";
  if (toolName === "update_project_markdown_document")
    return isZh ? "更新项目文档" : "Update project document";
  if (toolName === "read_project_file")
    return isZh ? "读取项目文件" : "Read project file";
  if (toolName === "read_project_markdown_document")
    return isZh ? "读取项目文档" : "Read project document";
  return toolName;
}

export function ProjectChatToolCallCard({
  call,
  isZh,
  onOpenTasks,
}: ProjectChatToolCallCardProps) {
  const isWorkflowStep = Boolean(call.step_index);
  const hasDetails = Boolean(
    call.message || call.summary || call.error || call.details?.length,
  );
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined")
      return (
        call.status === "running" ||
        call.status === "error" ||
        call.status === "confirmation_required"
      );
    const saved = window.localStorage.getItem(WORKFLOW_DETAIL_PREFERENCE_KEY);
    if (call.status === "confirmation_required") return true;
    if (saved === "expanded") return true;
    if (saved === "collapsed") return false;
    return call.status === "running" || call.status === "error";
  });

  useEffect(() => {
    if (call.status === "error" || call.status === "confirmation_required")
      setExpanded(true);
  }, [call.status]);

  const toggleExpanded = () => {
    setExpanded((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          WORKFLOW_DETAIL_PREFERENCE_KEY,
          next ? "expanded" : "collapsed",
        );
      }
      return next;
    });
  };

  if (isWorkflowStep) {
    const stepTitle =
      call.step_title || call.tool_name.replace(/^步骤\s+\d+\/\d+：/, "");
    const canOpenRecoverableTask =
      call.status === "error" && call.has_recoverable_task && onOpenTasks;
    return (
      <div
        className={`rounded-md border px-3 py-3 ${WORKFLOW_STEP_STYLES[call.status]}`}
      >
        <div className="flex items-start gap-2.5">
          <div
            className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${WORKFLOW_BADGE_STYLES[call.status]}`}
          >
            {call.step_index}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium leading-5 text-codex-ink">
                {isZh
                  ? `步骤 ${call.step_index}/${call.step_total || 4}`
                  : `Step ${call.step_index}/${call.step_total || 4}`}
                <span className="mx-1 text-codex-ink-faint">·</span>
                {toolDisplayName(stepTitle, isZh)}
              </p>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${WORKFLOW_BADGE_STYLES[call.status]}`}
              >
                <StatusIcon status={call.status} />
                {statusLabel(call.status, isZh, true)}
              </span>
              {hasDetails ? (
                <button
                  type="button"
                  onClick={toggleExpanded}
                  className="inline-flex items-center gap-1 rounded-md border border-codex-line bg-codex-bg-elev px-2 py-0.5 text-xs text-codex-ink-mute transition hover:border-codex-line-strong hover:text-codex-ink-soft"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                  {expanded
                    ? isZh
                      ? "收起日志"
                      : "Hide logs"
                    : isZh
                      ? "展开日志"
                      : "Show logs"}
                </button>
              ) : null}
            </div>
            {hasDetails && expanded ? (
              <div className="mt-2 space-y-1.5 rounded-md border border-codex-line-soft bg-codex-bg-elev px-3 py-2">
                {call.message ? (
                  <p className="text-xs leading-relaxed text-codex-ink-soft">
                    {call.message}
                  </p>
                ) : null}
                {call.summary ? (
                  <p className="text-xs leading-relaxed text-codex-ink-mute">
                    {call.summary}
                  </p>
                ) : null}
                {call.error ? (
                  <p className="text-xs leading-relaxed text-codex-bad">
                    {call.error}
                  </p>
                ) : null}
                {call.details?.length ? (
                  <div className="space-y-1 border-t border-codex-line-soft pt-1.5">
                    {call.details.map((detail, index) => (
                      <p
                        key={`${call.step_index}-${index}`}
                        className="text-xs leading-relaxed text-codex-ink-mute"
                      >
                        {detail}
                      </p>
                    ))}
                  </div>
                ) : null}
                {call.status === "error" ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-codex-line-soft bg-codex-bg-tint/80 px-2.5 py-2">
                    <p className="text-xs leading-relaxed text-codex-bad">
                      {canOpenRecoverableTask
                        ? isZh
                          ? "这个步骤已暂停，需要你决定下一步：从失败处重试、取消任务，或查看完整日志。"
                          : "This step is paused. Retry from here, cancel the task, or inspect full logs."
                        : isZh
                          ? "这个工具步骤遇到问题。本次对话没有创建可恢复任务，请根据上方错误调整请求后重新发送。"
                          : "This tool step hit an issue. No recoverable task was created for this chat turn; adjust the request and send it again."}
                    </p>
                    {canOpenRecoverableTask ? (
                      <button
                        type="button"
                        onClick={onOpenTasks}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-codex-bad px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-codex-bad"
                      >
                        <PanelRightOpen className="h-3.5 w-3.5" />
                        {isZh ? "打开任务面板处理" : "Open task panel"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Standalone tool-call card. Codex design wants a compact one-liner
  // summary ("[✓] 检索了 N 个数据源") with the message / error / details
  // tucked behind a chevron — the auto-expansion rules above already
  // handle the surface (running / error / confirmation forced open).
  return (
    <div
      className={`rounded-md border ${STATUS_STYLES[call.status]}`}
      style={{ background: "var(--color-codex-bg-elev)" }}
    >
      <button
        type="button"
        onClick={hasDetails ? toggleExpanded : undefined}
        className="flex w-full items-center text-left transition-colors"
        style={{
          gap: 10,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: hasDetails ? "pointer" : "default",
        }}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <span
          className="inline-flex flex-shrink-0 items-center justify-center"
          style={{
            width: 22,
            height: 22,
            borderRadius: "var(--codex-r-sm, 6px)",
            background:
              call.status === "completed"
                ? "color-mix(in oklch, var(--color-codex-good) 14%, transparent)"
                : call.status === "error"
                  ? "color-mix(in oklch, var(--color-codex-bad) 14%, transparent)"
                  : "var(--color-codex-bg-tint)",
            color:
              call.status === "completed"
                ? "var(--color-codex-good)"
                : call.status === "error"
                  ? "var(--color-codex-bad)"
                  : "var(--color-codex-ink-mute)",
          }}
        >
          <StatusIcon status={call.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="flex flex-wrap items-baseline"
            style={{ gap: 6 }}
          >
            <span
              className="truncate"
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
              }}
            >
              {toolDisplayName(call.tool_name, isZh)}
            </span>
            {call.summary ? (
              <span
                className="truncate"
                style={{
                  fontSize: 12,
                  color: "var(--color-codex-ink-mute)",
                }}
              >
                · {call.summary}
              </span>
            ) : null}
          </div>
          {!call.summary && !expanded && call.message ? (
            <div
              className="truncate"
              style={{
                fontSize: 12,
                color: "var(--color-codex-ink-mute)",
                marginTop: 1,
              }}
            >
              {call.message}
            </div>
          ) : null}
        </div>
        <span
          className="inline-flex flex-shrink-0 items-center"
          style={{
            gap: 4,
            fontSize: 11,
            color:
              call.status === "completed"
                ? "var(--color-codex-good)"
                : call.status === "error"
                  ? "var(--color-codex-bad)"
                  : "var(--color-codex-ink-mute)",
            fontWeight: 500,
          }}
        >
          {statusLabel(call.status, isZh)}
        </span>
        {hasDetails ? (
          <ChevronDown
            className="h-3.5 w-3.5 flex-shrink-0 transition-transform"
            style={{
              color: "var(--color-codex-ink-mute)",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        ) : null}
      </button>

      {hasDetails && expanded ? (
        <div
          style={{
            padding: "0 12px 10px",
            borderTop: "1px solid var(--color-codex-line-soft)",
            marginTop: 0,
          }}
        >
          {call.message && call.summary ? (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
              }}
            >
              {call.message}
            </p>
          ) : null}
          {call.error ? (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--color-codex-bad)",
              }}
            >
              {call.error}
            </p>
          ) : null}
          {call.details?.length ? (
            <div
              className="space-y-1"
              style={{ paddingTop: 8 }}
            >
              {call.details.map((detail, index) => (
                <p
                  key={`${call.tool_name}-${index}`}
                  style={{
                    margin: 0,
                    fontSize: 11.5,
                    lineHeight: 1.55,
                    color: "var(--color-codex-ink-mute)",
                  }}
                >
                  {detail}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
