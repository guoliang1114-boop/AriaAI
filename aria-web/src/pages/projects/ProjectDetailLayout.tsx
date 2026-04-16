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
  const isChatTab = activeTabId === "chat";
  const isPersistentTab =
    activeTabId === "chat" || activeTabId === "notes" || activeTabId === "todos";

  return (
    <div
      className={
        isChatTab
          ? "flex h-screen flex-col overflow-hidden bg-gray-50"
          : "min-h-full bg-gray-50"
      }
    >
      <ProjectDetailHeader
        project={project}
        onBack={onBack}
        projectId={projectId}
      />

      <PersistentProjectPanels
        projectId={projectId}
        project={project}
        projectDetail={projectDetail}
        activeTabId={activeTabId}
        onRefresh={onRefresh}
      />

      <div
        className={`mx-auto min-h-[calc(100vh-180px)] max-w-full px-6 py-6 ${isPersistentTab ? "hidden" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
