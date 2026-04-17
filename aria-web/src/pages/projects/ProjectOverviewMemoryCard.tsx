import { Brain, Loader2, RefreshCw } from "lucide-react";
import type { ProjectMemory } from "../../types/api";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";

interface ProjectOverviewMemoryCardProps {
  isZh: boolean;
  isLoading: boolean;
  isRebuilding: boolean;
  memory: ProjectMemory | null;
  onRebuild: () => void;
}

export function ProjectOverviewMemoryCard({
  isZh,
  isLoading,
  isRebuilding,
  memory,
  onRebuild,
}: ProjectOverviewMemoryCardProps) {
  const hasMemory = !!memory && memory.memory_version > 0;
  const statusText = isLoading
    ? isZh
      ? "加载中"
      : "Loading"
    : memory?.stale
      ? isZh
        ? "需要刷新"
        : "Stale"
      : hasMemory
        ? isZh
          ? "已同步"
          : "Ready"
        : isZh
          ? "未生成"
          : "Not built";

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 p-5">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <Brain className="h-4 w-4 text-gray-400" />
          {isZh ? "项目记忆" : "Project Memory"}
        </h3>
        <button
          type="button"
          onClick={onRebuild}
          disabled={isLoading || isRebuilding}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {isRebuilding ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {isZh ? "重建" : "Rebuild"}
        </button>
      </div>

      <div className="space-y-3 p-5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{isZh ? "状态" : "Status"}</span>
          <span className="font-medium text-gray-900">{statusText}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{isZh ? "版本" : "Version"}</span>
          <span className="font-medium text-gray-900">{memory?.memory_version ?? 0}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-gray-500">{isZh ? "更新时间" : "Updated"}</span>
          <span className="text-right font-medium text-gray-900">
            {formatProjectMemoryUpdatedAt(memory?.last_updated_at, isZh)}
          </span>
        </div>

        {hasMemory && (
          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            {memory?.project_brief
              ? memory.project_brief
              : isZh
                ? "项目记忆已构建，可供概览摘要和项目聊天复用。"
                : "Project memory is ready for overview summaries and chat context."}
          </div>
        )}
      </div>
    </div>
  );
}
