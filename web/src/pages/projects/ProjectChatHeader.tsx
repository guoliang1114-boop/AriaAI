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
  models?: Array<{
    id: string;
    name: string;
    provider: string;
    available: boolean;
  }>;
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
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
  models,
  selectedModel,
  onModelChange,
  onToggleSidebar,
  onKnowledgeScopeChange,
}: ProjectChatHeaderProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);

  const memoryLabel =
    isLoadingMemoryStatus || isRebuildingMemory
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
    <div className="border-b border-codex-line-soft bg-white px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="rounded-md p-1.5 text-codex-ink-faint transition-colors hover:bg-codex-bg-tint hover:text-codex-ink-soft"
          >
            {isSidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[13px] font-semibold leading-5 text-codex-ink">
                {title}
              </h3>
              <span
                className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline-flex ${
                  !hasMemory
                    ? "bg-codex-bg-tint text-codex-ink-mute"
                    : memoryStale
                      ? "bg-codex-bg-tint text-codex-warn"
                      : "bg-codex-accent-bg text-codex-good"
                }`}
                title={`${isZh ? "最近同步" : "Last sync"}: ${formatProjectMemoryUpdatedAt(memoryUpdatedAt, isZh)}`}
              >
                {memoryLabel}
              </span>
              {hasMemory && memoryUpdatedAt ? (
                <span className="hidden shrink-0 text-xs text-codex-ink-faint lg:inline">
                  {formatProjectMemoryUpdatedAtCompact(memoryUpdatedAt, isZh)}
                </span>
              ) : null}
            </div>
            {!isFullscreen ? (
              <p className="mt-0.5 hidden truncate text-xs text-codex-ink-mute 2xl:block">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={`flex items-center gap-2 ${isFullscreen ? "shrink-0 flex-nowrap" : "shrink-0"}`}
        >
          {!isFullscreen ? (
            <div className="hidden items-center gap-2 lg:flex">
              {skillControl}
              {skillSaveControl}
              {taskControl}
              {models && models.length > 0 && onModelChange ? (
                <>
                  <span className="text-xs text-codex-ink-faint">
                    {isZh ? "模型" : "Model"}
                  </span>
                  <select
                    value={selectedModel || ""}
                    onChange={(event) => onModelChange(event.target.value)}
                    className="rounded-md border border-codex-line bg-white px-2.5 py-1.5 text-[12px] leading-4 text-codex-ink-soft focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id} disabled={!m.available}>
                        {m.name}{" "}
                        {!m.available
                          ? isZh
                            ? "(未配置)"
                            : "(unavailable)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              <span className="text-xs text-codex-ink-faint">
                {copy.knowledgeScope}
              </span>
              <select
                value={knowledgeScope}
                onChange={(event) =>
                  onKnowledgeScopeChange(
                    event.target.value as "project" | "client" | "global",
                  )
                }
                className="rounded-md border border-codex-line bg-white px-2.5 py-1.5 text-[12px] leading-4 text-codex-ink-soft focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="project">{copy.currentProject}</option>
                <option value="client">{copy.currentClient}</option>
                <option value="global">{copy.globalKnowledge}</option>
              </select>
            </div>
          ) : null}

          <div
            className={`${isFullscreen ? "" : "ml-auto xl:ml-0"} flex items-center gap-2`}
          >
            {!isFullscreen ? skillSaveControl : null}
            <div className={isFullscreen ? "" : "lg:hidden"}>{taskControl}</div>
          </div>
        </div>
      </div>

      {memoryStale && !isFullscreen ? (
        <div className="mt-2 hidden rounded-md border border-codex-line bg-codex-bg-tint/60 px-2.5 py-1.5 text-xs text-codex-warn lg:flex lg:items-center lg:gap-2">
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
