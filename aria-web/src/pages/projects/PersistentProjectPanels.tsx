import type { ReactNode } from "react";
import type {
  Project,
  ProjectDetail as ProjectDetailType,
} from "../../types/api";
import { ProjectChatTab } from "./ProjectChatTab";
import { ProjectNotesTab } from "./ProjectNotesTab";
import { ProjectTodosTab } from "./ProjectTodosTab";
import type { ProjectDetailTabId } from "./projectDetailTabs";

type PersistentPanelId = "chat" | "notes" | "todos";

const PANEL_WRAPPER_CLASSNAMES: Partial<Record<ProjectDetailTabId, string>> = {
  chat: "flex-1 overflow-hidden px-6 py-4",
  notes: "min-h-[calc(100vh-180px)] max-w-full px-6 py-6",
  todos: "min-h-[calc(100vh-180px)] max-w-full px-6 py-6",
};

function PanelContainer({
  isActive,
  tabId,
  children,
}: {
  isActive: boolean;
  tabId: ProjectDetailTabId;
  children: ReactNode;
}) {
  return (
    <div className={isActive ? PANEL_WRAPPER_CLASSNAMES[tabId] ?? "" : "hidden"}>
      {children}
    </div>
  );
}

interface PersistentPanelConfigArgs {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  onRefresh: () => void;
}

function buildPersistentPanelConfig({
  projectId,
  project,
  projectDetail,
  onRefresh,
}: PersistentPanelConfigArgs): Array<{
  id: PersistentPanelId;
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
    {
      id: "todos",
      element: (
        <ProjectTodosTab
          projectId={projectId}
          todos={projectDetail.todos}
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
  onRefresh,
}: {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  activeTabId: ProjectDetailTabId;
  onRefresh: () => void;
}) {
  const panels = buildPersistentPanelConfig({
    projectId,
    project,
    projectDetail,
    onRefresh,
  });

  return (
    <>
      {panels.map((panel) => (
        <PanelContainer
          key={panel.id}
          isActive={activeTabId === panel.id}
          tabId={panel.id}
        >
          {panel.element}
        </PanelContainer>
      ))}
    </>
  );
}
