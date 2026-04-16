import type { ReactNode } from "react";
import type {
  Project,
  ProjectDetail as ProjectDetailType,
} from "../../types/api";
import { ProjectChatTab } from "./ProjectChatTab";
import { ProjectNotesTab } from "./ProjectNotesTab";
import { ProjectTodosTab } from "./ProjectTodosTab";
import type { ProjectDetailTabId } from "./projectDetailTabs";

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
  return (
    <>
      <PanelContainer isActive={activeTabId === "chat"} tabId="chat">
        <ProjectChatTab
          project={project}
          files={projectDetail.files}
          folders={projectDetail.folders}
          onProjectUpdate={onRefresh}
        />
      </PanelContainer>

      <PanelContainer isActive={activeTabId === "notes"} tabId="notes">
        <ProjectNotesTab
          projectId={projectId}
          projectName={project.name}
          files={projectDetail.files}
          folders={projectDetail.folders}
          onUpdate={onRefresh}
        />
      </PanelContainer>

      <PanelContainer isActive={activeTabId === "todos"} tabId="todos">
        <ProjectTodosTab
          projectId={projectId}
          todos={projectDetail.todos}
          onUpdate={onRefresh}
        />
      </PanelContainer>
    </>
  );
}
