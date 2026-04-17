import { Brain, ChevronRight } from "lucide-react";
import type { Project } from "../../types/api";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";

interface ProjectSettingsMemoryManagementCardProps {
  isZh: boolean;
  onOpenMemory: () => void;
  project: Project;
}

export function ProjectSettingsMemoryManagementCard({
  isZh,
  onOpenMemory,
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
          <h3 className="font-semibold text-gray-900">
            {isZh ? "记忆管理" : "Memory Management"}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            {isZh
              ? "在项目记忆页查看结构化内容、风险、下一步动作和重要文档。"
              : "Open the memory page to review structured content, risks, next actions, and key documents."}
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

      <button
        type="button"
        onClick={onOpenMemory}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
      >
        {isZh ? "打开项目记忆页" : "Open Memory Page"}
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
