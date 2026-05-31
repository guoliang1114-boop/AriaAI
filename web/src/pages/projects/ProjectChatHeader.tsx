import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getProjectChatCopy } from "./projectChatCopy";

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
  isSidebarOpen,
  isFullscreen,
  title,
  knowledgeScope,
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

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2"
      style={{
        background: "var(--color-codex-bg-elev)",
        borderBottom: "1px solid var(--color-codex-line-soft)",
      }}
    >
      {/* Left: sidebar toggle + conversation title (project name lives in
       * the unified project shell header above, so we don't repeat it). */}
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-1.5 transition-colors hover:bg-codex-bg-tint"
          style={{ color: "var(--color-codex-ink-mute)" }}
          aria-label={isSidebarOpen ? (isZh ? "收起对话列表" : "Hide conversation list") : (isZh ? "展开对话列表" : "Show conversation list")}
        >
          {isSidebarOpen ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <h3
          className="truncate"
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.4,
            color: "var(--color-codex-ink)",
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </h3>
      </div>

      {/* Right: skill/task/model/scope controls. */}
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
  );
}
