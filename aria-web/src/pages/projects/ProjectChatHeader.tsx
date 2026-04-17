import { Bot, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getProjectChatCopy } from "./projectChatCopy";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";

type ProjectChatHeaderProps = {
  hasMemory: boolean;
  isSidebarOpen: boolean;
  isLoadingMemoryStatus: boolean;
  isRebuildingMemory: boolean;
  title: string;
  subtitle: string;
  knowledgeScope: "project" | "client" | "global";
  memoryStale: boolean;
  memoryUpdatedAt?: string | null;
  memoryVersion: number;
  exportControl?: React.ReactNode;
  onRebuildMemory: () => void;
  onToggleSidebar: () => void;
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
};

export function ProjectChatHeader({
  hasMemory,
  isSidebarOpen,
  isLoadingMemoryStatus,
  isRebuildingMemory,
  title,
  subtitle,
  knowledgeScope,
  memoryStale,
  memoryUpdatedAt,
  memoryVersion,
  exportControl,
  onRebuildMemory,
  onToggleSidebar,
  onKnowledgeScopeChange,
}: ProjectChatHeaderProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);

  const memoryLabel = isLoadingMemoryStatus
    ? isZh
      ? "记忆加载中"
      : "Loading memory"
    : !hasMemory
      ? isZh
        ? "未生成记忆"
        : "No memory"
      : memoryStale
        ? isZh
          ? "记忆待刷新"
          : "Memory stale"
        : isZh
          ? "记忆已同步"
          : "Memory ready";

  return (
    <div className="flex items-center justify-between border-b border-gray-100 bg-white p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100"
        >
          {isSidebarOpen ? (
            <ChevronLeft className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 md:block">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                memoryStale
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {memoryLabel}
            </span>
            <span className="text-[11px] text-gray-400">
              {isZh ? "版本" : "v"}
              {memoryVersion || 0}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {isZh ? "更新时间" : "Updated"}:{" "}
            {formatProjectMemoryUpdatedAt(memoryUpdatedAt, isZh)}
          </p>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <span className="text-xs text-gray-400">{copy.knowledgeScope}</span>
          <select
            value={knowledgeScope}
            onChange={(event) =>
              onKnowledgeScopeChange(event.target.value as "project" | "client" | "global")
            }
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="project">{copy.currentProject}</option>
            <option value="client">{copy.currentClient}</option>
            <option value="global">{copy.globalKnowledge}</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onRebuildMemory}
          disabled={isRebuildingMemory}
          className="hidden items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 md:inline-flex"
        >
          {isRebuildingMemory ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isZh ? "重建记忆" : "Rebuild Memory"}
        </button>

        {exportControl}
      </div>
    </div>
  );
}
