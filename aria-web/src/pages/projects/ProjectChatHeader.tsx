import { AlertTriangle, Bot, ChevronLeft, ChevronRight } from "lucide-react";
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
  exportControl,
  onToggleSidebar,
  onKnowledgeScopeChange,
}: ProjectChatHeaderProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);

  const memoryLabel = isLoadingMemoryStatus || isRebuildingMemory
    ? isZh
      ? "记忆同步中"
      : "Memory syncing"
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
    <div className="border-b border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between">
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
                  !hasMemory
                    ? "bg-gray-100 text-gray-500"
                    : memoryStale
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {memoryLabel}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              {isZh ? "最近同步" : "Last sync"}: {formatProjectMemoryUpdatedAt(memoryUpdatedAt, isZh)}
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

          {exportControl}
        </div>
      </div>

      {memoryStale ? (
        <div className="mt-3 hidden rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 md:flex md:items-start md:gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {isZh
              ? "项目数据最近有更新，聊天使用的项目记忆可能略旧。系统会自动尝试同步。"
              : "Project data changed recently, so the memory used by chat may be slightly outdated. The app will try to sync it automatically."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
