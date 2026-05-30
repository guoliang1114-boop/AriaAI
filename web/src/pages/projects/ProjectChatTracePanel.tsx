import { useState } from "react";
import { Activity, ChevronDown, Clock3, FileText, ShieldCheck, Wrench } from "lucide-react";
import type { ChatTrace } from "../../types/api";

interface ProjectChatTracePanelProps {
  trace: ChatTrace;
  isZh: boolean;
}

function formatPolicy(policy: string, isZh: boolean) {
  const labels: Record<string, string> = isZh
    ? {
        direct_answer: "直接回答",
        read_only_tool: "只读工具",
        write_artifact: "生成交付物",
        modify_existing_file: "修改已有文件",
        durable_task: "可恢复任务",
        destructive_action: "危险操作",
      }
    : {
        direct_answer: "Direct answer",
        read_only_tool: "Read-only tools",
        write_artifact: "Write artifact",
        modify_existing_file: "Modify file",
        durable_task: "Durable task",
        destructive_action: "Destructive action",
      };
  return labels[policy] || policy;
}

function formatMode(mode: string, isZh: boolean) {
  const labels: Record<string, string> = isZh
    ? {
        standalone_qa: "普通问答",
        project_deep_dive: "项目深问答",
        cross_project_portfolio: "客户组合视图",
        workspace_inventory: "全项目盘点",
        skill_execution: "Skill 执行",
        task_orchestration: "任务编排",
      }
    : {
        standalone_qa: "Standalone Q&A",
        project_deep_dive: "Project deep dive",
        cross_project_portfolio: "Client portfolio",
        workspace_inventory: "Workspace inventory",
        skill_execution: "Skill execution",
        task_orchestration: "Task orchestration",
      };
  return labels[mode] || mode;
}

export function ProjectChatTracePanel({ trace, isZh }: ProjectChatTracePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const timings = trace.stage_timings || {};
  const toolDecisions = trace.tool_decisions || [];
  const blockedTools = toolDecisions.filter((tool) => tool.status === "error" || String((tool as any).status) === "blocked");
  const artifacts = trace.artifacts || [];
  const promptLayers = trace.prompt_layers || [];
  const fallbackEvents = trace.fallback_events || [];
  const totalMs = timings.total_stream_ms;
  const prepareMs = timings.prepare_total_ms;
  const firstEventMs = timings.model_first_event_ms;

  // Render an ms value as ms when <1000, s with one decimal otherwise — keeps
  // chips short for fast turns while showing useful precision for slow ones.
  const formatMs = (raw: number | string | undefined): string | null => {
    if (raw === undefined || raw === null || raw === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(1)}s`;
  };

  const prepareLabel = formatMs(prepareMs);
  const firstEventLabel = formatMs(firstEventMs);
  const totalLabel = formatMs(totalMs);

  return (
    <div className="mt-3 w-full max-w-3xl rounded-2xl border border-codex-line bg-white/80 px-3.5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-codex-bg-tint px-2.5 py-1 text-xs font-medium text-codex-ink-soft">
            <Activity className="h-3.5 w-3.5" />
            {formatMode(trace.chat_mode, isZh)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-codex-accent-bg px-2.5 py-1 text-xs font-medium text-codex-good">
            <ShieldCheck className="h-3.5 w-3.5" />
            {formatPolicy(trace.action_policy, isZh)}
          </span>
          {trace.model_used ? (
            <span className="rounded-full bg-codex-bg-tint px-2.5 py-1 text-xs font-medium text-codex-ink-mute">{trace.model_used}</span>
          ) : null}
          {prepareLabel ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-codex-bg-tint px-2.5 py-1 text-xs font-medium text-codex-ink-mute"
              title={isZh ? "请求前准备（prepare_total_ms）" : "Prepare (prepare_total_ms)"}
            >
              <Clock3 className="h-3.5 w-3.5" />
              {isZh ? "准备" : "Prep"} {prepareLabel}
            </span>
          ) : null}
          {firstEventLabel ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-codex-bg-tint px-2.5 py-1 text-xs font-medium text-codex-ink-mute"
              title={isZh ? "首次响应（model_first_event_ms）" : "First token (model_first_event_ms)"}
            >
              <Clock3 className="h-3.5 w-3.5" />
              {isZh ? "首响" : "TTFT"} {firstEventLabel}
            </span>
          ) : null}
          {totalLabel ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-codex-bg-tint px-2.5 py-1 text-xs font-medium text-codex-ink-mute"
              title={isZh ? "本轮总耗时（total_stream_ms）" : "Total (total_stream_ms)"}
            >
              <Clock3 className="h-3.5 w-3.5" />
              {isZh ? "总" : "Total"} {totalLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1 rounded-full border border-codex-line bg-white px-2.5 py-1 text-xs font-medium text-codex-ink-mute transition hover:border-codex-line-strong hover:text-codex-ink-soft"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? (isZh ? "收起执行依据" : "Hide trace") : (isZh ? "执行依据" : "Trace")}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-codex-line-soft pt-3">
          <div>
            <p className="text-xs font-semibold text-codex-ink-soft">{isZh ? "路由原因" : "Routing reason"}</p>
            <p className="mt-1 text-xs leading-relaxed text-codex-ink-mute">
              {trace.intent_method || "policy_guard"} · {trace.intent_reason || (isZh ? "无额外说明" : "No extra reason")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-codex-bg-tint px-3 py-2">
              <p className="text-xs text-codex-ink-faint">{isZh ? "工具决策" : "Tool decisions"}</p>
              <p className="mt-1 text-sm font-semibold text-codex-ink-soft">{toolDecisions.length}</p>
            </div>
            <div className="rounded-xl bg-codex-bg-tint px-3 py-2">
              <p className="text-xs text-codex-ink-faint">{isZh ? "生成物" : "Artifacts"}</p>
              <p className="mt-1 text-sm font-semibold text-codex-ink-soft">{artifacts.length}</p>
            </div>
            <div className="rounded-xl bg-codex-bg-tint px-3 py-2">
              <p className="text-xs text-codex-ink-faint">{isZh ? "Prompt 层" : "Prompt layers"}</p>
              <p className="mt-1 text-sm font-semibold text-codex-ink-soft">{promptLayers.length}</p>
            </div>
          </div>
          {blockedTools.length ? (
            <div className="rounded-xl border border-codex-line-soft bg-codex-bg-tint px-3 py-2">
              <p className="text-xs font-semibold text-codex-warn">{isZh ? "已阻止的工具调用" : "Blocked tool calls"}</p>
              <div className="mt-1 space-y-1">
                {blockedTools.map((tool, index) => (
                  <p key={`${tool.tool_name}-${index}`} className="text-xs text-codex-warn">
                    <Wrench className="mr-1 inline h-3.5 w-3.5" />
                    {tool.tool_name}: {tool.error || tool.message || tool.summary || "blocked"}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {fallbackEvents.length ? (
            <div className="rounded-xl border border-codex-line-soft bg-codex-bg-tint px-3 py-2">
              <p className="text-xs font-semibold text-codex-ink-soft">{isZh ? "系统保护记录" : "Guardrail events"}</p>
              <div className="mt-1 space-y-1">
                {fallbackEvents.map((event, index) => (
                  <p key={`${event.type || "event"}-${index}`} className="text-xs leading-relaxed text-codex-ink-mute">
                    {event.stage ? `${event.stage} · ` : ""}
                    {event.type || "event"}
                    {event.tool_name ? ` · ${event.tool_name}` : ""}
                    {event.reason ? `：${event.reason}` : ""}
                    {event.changes?.length ? `：${event.changes.join("；")}` : ""}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {artifacts.length ? (
            <div>
              <p className="text-xs font-semibold text-codex-ink-soft">{isZh ? "本轮生成物" : "Artifacts"}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {artifacts.map((artifact) => (
                  <span key={`${artifact.id ?? artifact.path}-${artifact.name}`} className="inline-flex items-center gap-1 rounded-lg bg-codex-bg-tint px-2 py-1 text-xs text-codex-ink-soft">
                    <FileText className="h-3.5 w-3.5" />
                    {artifact.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
