import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
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
  taskControl?: React.ReactNode;
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
  taskControl,
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
    <div className="border-b border-slate-100 bg-white px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            {isSidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold leading-5 text-gray-900">{title}</h3>
              <span
                className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${
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
                <span className="hidden shrink-0 text-[11px] text-gray-400 lg:inline">
                  {formatProjectMemoryUpdatedAtCompact(memoryUpdatedAt, isZh)}
                </span>
              ) : null}
            </div>
            {!isFullscreen ? (
              <p className="mt-0.5 hidden truncate text-xs text-gray-500 2xl:block">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className={`flex items-center gap-2 ${isFullscreen ? "shrink-0 flex-nowrap" : "shrink-0"}`}>
          {!isFullscreen ? (
            <div className="hidden items-center gap-2 lg:flex">
              {skillControl}
              {skillSaveControl}
              {taskControl}
              <span className="text-xs text-gray-400">{copy.knowledgeScope}</span>
              <select
                value={knowledgeScope}
                onChange={(event) =>
                  onKnowledgeScopeChange(event.target.value as "project" | "client" | "global")
                }
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="project">{copy.currentProject}</option>
                <option value="client">{copy.currentClient}</option>
                <option value="global">{copy.globalKnowledge}</option>
              </select>
            </div>
          ) : null}

          <div className={`${isFullscreen ? "" : "ml-auto xl:ml-0"} flex items-center gap-2`}>
            {!isFullscreen ? skillSaveControl : null}
            <div className={isFullscreen ? "" : "lg:hidden"}>{taskControl}</div>
          </div>
        </div>
      </div>

      {memoryStale && !isFullscreen ? (
        <div className="mt-2 hidden rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs text-amber-800 lg:flex lg:items-center lg:gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <p className="truncate">
            {isZh
              ? "项目数据最近有更新，聊天使用的项目记忆可能略旧。系统会自动尝试同步。"
              : "Project data changed recently, so the memory used by chat may be slightly outdated. The app will try to sync it automatically."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
