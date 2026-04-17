import { Brain, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type { Project } from "../../types/api";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";

interface ProjectSettingsMemoryManagementCardProps {
  coverageItems: Array<{ label: string; value: number }>;
  isRebuilding: boolean;
  isZh: boolean;
  onOpenMemory: () => void;
  onRebuild: () => void;
  project: Project;
}

export function ProjectSettingsMemoryManagementCard({
  coverageItems,
  isRebuilding,
  isZh,
  onOpenMemory,
  onRebuild,
  project,
}: ProjectSettingsMemoryManagementCardProps) {
  const hasMemory = (project.memory_version || 0) > 0;
  const statusText = !hasMemory
    ? isZh
      ? "尚未整理"
      : "Not prepared"
    : project.memory_stale
      ? isZh
        ? "建议更新"
        : "Needs refresh"
      : isZh
        ? "可直接使用"
        : "Ready to use";

  const helperText = !hasMemory
    ? isZh
      ? "系统还没有为这个项目整理出可复用的项目记忆。"
      : "No reusable project memory has been prepared for this project yet."
    : project.memory_stale
      ? isZh
        ? "项目最近有变化，建议更新后再用于总结、沟通和交付判断。"
        : "The project changed recently, so refreshing memory is recommended before using it for summaries or decisions."
      : isZh
        ? "这份项目记忆可以直接用于概览、聊天和执行页面。"
        : "This project memory is ready for overview, chat, and execution views.";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
          <Brain className="h-4 w-4 text-gray-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">{isZh ? "项目记忆概况" : "Project Memory"}</h3>
          <p className="mt-1 text-xs text-gray-500">
            {isZh
              ? "把项目里的关键信息整理成一份可复用的共识底稿，方便概览、聊天和执行协作。"
              : "A reusable project brief built from key project signals for overview, chat, and execution collaboration."}
          </p>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{isZh ? "当前状态" : "Current status"}</span>
          <span className="font-medium text-gray-900">{statusText}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-gray-500">{isZh ? "最近同步" : "Last sync"}</span>
          <span className="text-right font-medium text-gray-900">
            {formatProjectMemoryUpdatedAt(project.memory_updated_at, isZh)}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-600">
        {helperText}
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          {isZh ? "当前覆盖来源" : "Current coverage"}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {coverageItems.map((item) => (
            <div key={item.label} className="rounded-lg bg-gray-50 px-3 py-2">
              <div className="text-[11px] text-gray-500">{item.label}</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onOpenMemory}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {isZh ? "查看项目记忆" : "Open Memory Page"}
          <ChevronRight className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onRebuild}
          disabled={isRebuilding}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
        >
          {isRebuilding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isZh ? "更新项目记忆" : "Refresh Memory"}
        </button>
      </div>
    </div>
  );
}
