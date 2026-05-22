import { AlertTriangle, CheckCircle2, FileWarning, ShieldCheck, Trash2, X } from "lucide-react";
import type { ToolCallEvent } from "../../types/api";

export type ProjectChatPendingAction = {
  canConfirm: boolean;
  call: ToolCallEvent;
  sourceContent: string;
};

type ProjectChatActionPreviewPanelProps = {
  action: ProjectChatPendingAction;
  isConfirming?: boolean;
  isZh: boolean;
  onCancel: () => void;
  onConfirm: (content: string, confirmationToken: string) => void;
  onRefreshPreview?: (content: string) => void;
};

function actionKind(call: ToolCallEvent, isZh: boolean) {
  const token = (call.confirmation_token || "").toLowerCase();
  const name = (call.tool_name || "").toLowerCase();
  if (token.includes(":delete:") || name.includes("manage_project_files")) {
    return {
      icon: <Trash2 className="h-4 w-4" />,
      label: isZh ? "删除项目文件" : "Delete project files",
      tone: "rose",
    };
  }
  return {
    icon: <FileWarning className="h-4 w-4" />,
    label: isZh ? "修改项目内容" : "Modify project content",
    tone: "amber",
  };
}

function extractIds(details: string[]) {
  const ids = new Set<string>();
  details.forEach((detail) => {
    detail.match(/\d+/g)?.forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}

export function ProjectChatActionPreviewPanel({
  action,
  isConfirming,
  isZh,
  onCancel,
  onConfirm,
  onRefreshPreview,
}: ProjectChatActionPreviewPanelProps) {
  const call = action.call;
  const canConfirm = action.canConfirm && !!call.confirmation_token;
  const details = call.details || [];
  const ids = extractIds(details);
  const kind = actionKind(call, isZh);
  const affectedCount = ids.length || details.length;

  return (
    <div className="mx-auto mb-3 max-w-4xl overflow-hidden rounded-xl border border-amber-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.10)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-amber-100 bg-amber-50/80 px-4 py-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${kind.tone === "rose" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
          {kind.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">
            {canConfirm
              ? isZh ? "Action Preview：等待确认" : "Action Preview: approval required"
              : isZh ? "Action Preview：需要重新生成" : "Action Preview: refresh required"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {kind.label}
            {affectedCount ? ` · ${isZh ? "影响" : "Affects"} ${affectedCount} ${isZh ? "项" : "item(s)"}` : ""}
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          {canConfirm ? (isZh ? "确认后才会执行" : "Runs only after approval") : (isZh ? "旧审批需刷新" : "Legacy approval")}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
          aria-label={isZh ? "关闭确认面板" : "Close approval panel"}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 px-4 py-3 md:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            {isZh ? "将执行的动作" : "Action to run"}
          </div>
          <p className="text-sm font-medium text-slate-900">{kind.label}</p>
          {call.summary || call.message ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">{call.summary || call.message}</p>
          ) : null}
          <p className="mt-2 text-[11px] leading-5 text-slate-400">
            {canConfirm
              ? isZh
                ? "确认会用同一批工具参数重放，不会让模型重新猜测要删除或修改什么。"
                : "Approval replays the exact same tool arguments instead of asking the model to infer again."
              : isZh
                ? "这条旧审批没有冻结工具参数。请先重新生成确认预览，系统会保存可安全重放的参数。"
                : "This legacy approval does not include frozen tool arguments. Refresh the preview first so the action can be replayed safely."}
          </p>
        </div>

        <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
          <p className="mb-2 text-xs font-semibold text-slate-600">
            {isZh ? "影响范围" : "Impact"}
          </p>
          {details.length ? (
            <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
              {details.map((detail, index) => (
                <p key={`${detail}-${index}`} className="text-xs leading-5 text-slate-600">
                  {detail}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-5 text-slate-500">
              {isZh ? "该操作会修改项目空间内容。" : "This action will modify project-space content."}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <p className="text-xs leading-5 text-slate-500">
          {isZh
            ? canConfirm ? "建议先确认清单无误；取消后不会执行任何修改。" : "重新生成预览不会立刻删除文件，只会重新创建一条可确认的审批。"
            : canConfirm ? "Review the list before approving. Canceling will not change anything." : "Refreshing the preview will not delete files; it only creates a new approvable action."}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          {canConfirm ? (
            <button
              type="button"
              disabled={isConfirming}
              onClick={() => onConfirm(action.sourceContent, call.confirmation_token || "")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {isConfirming ? (isZh ? "正在执行" : "Running") : isZh ? "确认并执行" : "Approve and run"}
            </button>
          ) : (
            <button
              type="button"
              disabled={isConfirming || !onRefreshPreview}
              onClick={() => onRefreshPreview?.(action.sourceContent)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {isConfirming ? (isZh ? "正在生成" : "Refreshing") : isZh ? "重新生成确认预览" : "Refresh approval preview"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
