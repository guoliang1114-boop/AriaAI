import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  Project,
  ProjectDetail as ProjectDetailType,
} from "../../types/api";
import { ProjectChatTab } from "./ProjectChatTab";
import { ProjectNotesTab } from "./ProjectNotesTab";
import type { ProjectDetailTabId } from "./projectDetailTabs";

type ProjectPanelId = "chat" | "notes";

const PANEL_WRAPPER_CLASSNAMES: Record<ProjectPanelId, string> = {
  chat: "h-[calc(100vh-3.5rem)] min-h-[32rem] px-3 py-3",
  notes: "min-h-[calc(100vh-3.5rem)] max-w-full px-4 py-4",
};

function PanelContainer({
  isActive,
  className,
  tabId,
  children,
}: {
  isActive: boolean;
  className?: string;
  tabId: ProjectPanelId;
  children: ReactNode;
}) {
  return (
    <div className={isActive ? className ?? PANEL_WRAPPER_CLASSNAMES[tabId] : "hidden"}>
      {children}
    </div>
  );
}

interface PersistentPanelConfigArgs {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  isChatFocusMode: boolean;
  onChatFocusModeChange: (value: boolean) => void;
  onRefresh: () => void;
}

function buildPersistentPanelConfig({
  projectId,
  project,
  projectDetail,
  isChatFocusMode,
  onChatFocusModeChange,
  onRefresh,
}: PersistentPanelConfigArgs): Array<{
  id: ProjectPanelId;
  element: ReactNode;
}> {
  return [
    {
      id: "chat",
      element: (
        <ProjectChatTab
          project={project}
          files={projectDetail.files}
          folders={projectDetail.folders}
          isFullscreen={isChatFocusMode}
          onFullscreenChange={onChatFocusModeChange}
          onProjectUpdate={onRefresh}
        />
      ),
    },
    {
      id: "notes",
      element: (
        <ProjectNotesTab
          projectId={projectId}
          projectName={project.name}
          files={projectDetail.files}
          folders={projectDetail.folders}
          onUpdate={onRefresh}
        />
      ),
    },

  ];
}

export function PersistentProjectPanels({
  projectId,
  project,
  projectDetail,
  activeTabId,
  isChatFocusMode,
  onChatFocusModeChange,
  onRefresh,
}: {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  activeTabId: ProjectDetailTabId;
  isChatFocusMode: boolean;
  onChatFocusModeChange: (value: boolean) => void;
  onRefresh: () => void;
}) {
  const [mountedPersistentPanels, setMountedPersistentPanels] = useState<
    Record<ProjectPanelId, boolean>
  >({
    chat: activeTabId === "chat",
    notes: activeTabId === "notes",
  });

  useEffect(() => {
    if (activeTabId === "chat" || activeTabId === "notes") {
      setMountedPersistentPanels((current) =>
        current[activeTabId]
          ? current
          : {
              ...current,
              [activeTabId]: true,
            },
      );
    }
  }, [activeTabId]);

  const panels = buildPersistentPanelConfig({
    projectId,
    project,
    projectDetail,
    isChatFocusMode,
    onChatFocusModeChange,
    onRefresh,
  });

  return (
    <>
      {panels.map((panel) => {
        const shouldMount = mountedPersistentPanels[panel.id];

        if (!shouldMount) {
          return null;
        }

        return (
          <PanelContainer
            key={panel.id}
            isActive={activeTabId === panel.id}
            className={
              panel.id === "chat" && isChatFocusMode
                ? "fixed inset-0 z-50 h-screen w-screen min-h-screen bg-white px-0 py-0"
                : undefined
            }
            tabId={panel.id}
          >
            {panel.element}
          </PanelContainer>
        );
      })}
    </>
  );
}
