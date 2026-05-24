import { useState } from "react";
import type { ReactNode } from "react";
import type {
  Project,
  ProjectDetail as ProjectDetailType,
} from "../../types/api";
import { PersistentProjectPanels } from "./PersistentProjectPanels";
import { ProjectDetailHeader } from "./ProjectDetailHeader";
import type { ProjectDetailTabId } from "./projectDetailTabs";

export function ProjectDetailLayout({
  projectId,
  project,
  projectDetail,
  activeTabId,
  onBack,
  onRefresh,
  children,
}: {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  activeTabId: ProjectDetailTabId;
  onBack: () => void;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const [isChatFocusMode, setIsChatFocusMode] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("aria-project-chat-fullscreen") === "true";
  });
  const isPersistentTab =
    activeTabId === "chat" || activeTabId === "notes";

  return (
    <div className={activeTabId === "chat" && isChatFocusMode ? "h-screen overflow-hidden bg-gray-50" : "min-h-full bg-gray-50"}>
      {!(activeTabId === "chat" && isChatFocusMode) ? (
        <ProjectDetailHeader
          project={project}
          onBack={onBack}
          projectId={projectId}
          compact
        />
      ) : null}

      <PersistentProjectPanels
        projectId={projectId}
        project={project}
        projectDetail={projectDetail}
        activeTabId={activeTabId}
        isChatFocusMode={isChatFocusMode}
        onChatFocusModeChange={setIsChatFocusMode}
        onRefresh={onRefresh}
      />

      <div
        className={`mx-auto min-h-[calc(100vh-3.5rem)] max-w-full px-4 py-4 ${isPersistentTab ? "hidden" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
