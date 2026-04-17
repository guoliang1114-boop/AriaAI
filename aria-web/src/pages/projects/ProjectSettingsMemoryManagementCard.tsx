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
      ? "未生成"
      : "Not Built"
    : project.memory_stale
      ? isZh
        ? "待刷新"
        : "Stale"
      : isZh
        ? "已同步"
        : "Ready";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
          <Brain className="h-4 w-4 text-gray-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">{isZh ? "记忆管理" : "Memory Management"}</h3>
          <p className="mt-1 text-xs text-gray-500">
            {isZh
              ? "在这里查看项目记忆状态、来源覆盖，并直接重建或打开完整记忆页。"
              : "Review memory status, source coverage, and manage rebuild actions from here."}
          </p>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{isZh ? "状态" : "Status"}</span>
          <span className="font-medium text-gray-900">{statusText}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{isZh ? "版本" : "Version"}</span>
          <span className="font-medium text-gray-900">{project.memory_version || 0}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-gray-500">{isZh ? "更新时间" : "Updated"}</span>
          <span className="text-right font-medium text-gray-900">
            {formatProjectMemoryUpdatedAt(project.memory_updated_at, isZh)}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          {isZh ? "来源覆盖" : "Source Coverage"}
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
          onClick={onRebuild}
          disabled={isRebuilding}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
        >
          {isRebuilding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isZh ? "重建记忆" : "Rebuild Memory"}
        </button>

        <button
          type="button"
          onClick={onOpenMemory}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {isZh ? "打开记忆页" : "Open Memory Page"}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
