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

  return (
    <div className="mt-3 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white/80 px-3.5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            <Activity className="h-3.5 w-3.5" />
            {formatMode(trace.chat_mode, isZh)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            {formatPolicy(trace.action_policy, isZh)}
          </span>
          {trace.model_used ? (
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">{trace.model_used}</span>
          ) : null}
          {typeof totalMs !== "undefined" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
              <Clock3 className="h-3.5 w-3.5" />
              {Math.round(Number(totalMs))}ms
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? (isZh ? "收起执行依据" : "Hide trace") : (isZh ? "执行依据" : "Trace")}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div>
            <p className="text-xs font-semibold text-slate-700">{isZh ? "路由原因" : "Routing reason"}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {trace.intent_method || "policy_guard"} · {trace.intent_reason || (isZh ? "无额外说明" : "No extra reason")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-400">{isZh ? "工具决策" : "Tool decisions"}</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{toolDecisions.length}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-400">{isZh ? "生成物" : "Artifacts"}</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{artifacts.length}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-400">{isZh ? "Prompt 层" : "Prompt layers"}</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{promptLayers.length}</p>
            </div>
          </div>
          {blockedTools.length ? (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold text-amber-800">{isZh ? "已阻止的工具调用" : "Blocked tool calls"}</p>
              <div className="mt-1 space-y-1">
                {blockedTools.map((tool, index) => (
                  <p key={`${tool.tool_name}-${index}`} className="text-xs text-amber-700">
                    <Wrench className="mr-1 inline h-3.5 w-3.5" />
                    {tool.tool_name}: {tool.error || tool.message || tool.summary || "blocked"}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {fallbackEvents.length ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold text-slate-700">{isZh ? "系统保护记录" : "Guardrail events"}</p>
              <div className="mt-1 space-y-1">
                {fallbackEvents.map((event, index) => (
                  <p key={`${event.type || "event"}-${index}`} className="text-xs leading-relaxed text-slate-500">
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
              <p className="text-xs font-semibold text-slate-700">{isZh ? "本轮生成物" : "Artifacts"}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {artifacts.map((artifact) => (
                  <span key={`${artifact.id ?? artifact.path}-${artifact.name}`} className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">
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
