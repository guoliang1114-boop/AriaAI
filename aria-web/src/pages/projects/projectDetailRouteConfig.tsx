import type { ReactElement } from "react";
import { ProjectDocumentsTab } from "./ProjectDocumentsTab";
import { ProjectFinancialsTab } from "./ProjectFinancialsTab";
import { ProjectMilestonesTab } from "./ProjectMilestonesTab";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

interface ProjectDetailRouteConfigArgs {
  projectDetail: ProjectDetailType;
  projectId: string;
  onRefresh: () => void;
}

interface ProjectDetailRouteConfigItem {
  path: string;
  element: ReactElement;
}

export function buildProjectDetailRouteConfig({
  projectDetail,
  projectId,
  onRefresh,
}: ProjectDetailRouteConfigArgs): ProjectDetailRouteConfigItem[] {
  return [
    {
      path: "/",
      element: (
        <ProjectOverviewTab
          projectDetail={projectDetail}
          projectId={projectId}
          onProjectUpdate={onRefresh}
        />
      ),
    },
    {
      path: "/documents",
      element: (
        <ProjectDocumentsTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "/milestones",
      element: (
        <ProjectMilestonesTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "/financials",
      element: (
        <ProjectFinancialsTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "/settings",
      element: (
        <ProjectSettingsTab
          projectDetail={projectDetail}
          onUpdate={onRefresh}
        />
      ),
    },
  ];
}
