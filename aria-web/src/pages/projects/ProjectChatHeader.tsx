import { AlertTriangle, Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getProjectChatCopy } from "./projectChatCopy";
import {
  formatProjectMemoryUpdatedAt,
  formatProjectMemoryUpdatedAtCompact,
} from "./projectMemoryTime";

type ProjectChatHeaderProps = {
  hasMemory: boolean;
  isSidebarOpen: boolean;
  isLoadingMemoryStatus: boolean;
  isRebuildingMemory: boolean;
  isFullscreen: boolean;
  title: string;
  subtitle: string;
  knowledgeScope: "project" | "client" | "global";
  memoryStale: boolean;
  memoryUpdatedAt?: string | null;
  memoryVersion: number;
  skillControl?: React.ReactNode;
  skillSaveControl?: React.ReactNode;
  onRebuildMemory: () => void;
  onToggleSidebar: () => void;
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
};

export function ProjectChatHeader({
  hasMemory,
  isSidebarOpen,
  isLoadingMemoryStatus,
  isRebuildingMemory,
  isFullscreen,
  title,
  subtitle,
  knowledgeScope,
  memoryStale,
  memoryUpdatedAt,
  skillControl,
  skillSaveControl,
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
        ? "暂无记忆"
        : "No memory"
      : memoryStale
        ? isZh
          ? "记忆待刷新"
          : "Memory stale"
        : isZh
          ? "记忆已同步"
          : "Memory ready";

  return (
    <div className="border-b border-gray-100 bg-white px-4 py-3">
      <div className={`flex ${isFullscreen ? "items-center justify-between gap-3" : "flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"}`}>
        <div className="flex min-w-0 items-center gap-3">
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
          {!isFullscreen ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Bot className="h-5 w-5 text-primary" />
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold leading-5 text-gray-900">{title}</h3>
              <span
                className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  !hasMemory
                    ? "bg-gray-100 text-gray-500"
                    : memoryStale
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                }`}
                title={`${isZh ? "最近同步" : "Last sync"}: ${formatProjectMemoryUpdatedAt(memoryUpdatedAt, isZh)}`}
              >
                {memoryLabel}
              </span>
              {hasMemory && memoryUpdatedAt ? (
                <span className="hidden shrink-0 text-[11px] text-gray-400 sm:inline">
                  {formatProjectMemoryUpdatedAtCompact(memoryUpdatedAt, isZh)}
                </span>
              ) : null}
            </div>
            {!isFullscreen ? (
              <p className="mt-0.5 truncate text-xs text-gray-500">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className={`flex items-center gap-2 ${isFullscreen ? "shrink-0 flex-nowrap" : "flex-wrap xl:justify-end"}`}>
          {!isFullscreen ? (
            <div className="hidden items-center gap-2 lg:flex">
              {skillControl}
              {skillSaveControl}
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
          ) : null}

          <div className={`${isFullscreen ? "" : "ml-auto xl:ml-0"} flex items-center gap-2`}>
            {!isFullscreen ? skillSaveControl : null}
          </div>
        </div>
      </div>

      {memoryStale && !isFullscreen ? (
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
