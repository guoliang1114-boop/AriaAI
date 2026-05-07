import type { ReactElement } from "react";
import { ProjectBriefingTab } from "./ProjectBriefingTab";
import { ProjectFinancialsTab } from "./ProjectFinancialsTab";
import { ProjectMemoryTab } from "./ProjectMemoryTab";
import { ProjectMilestonesTab } from "./ProjectMilestonesTab";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";
import { ProjectSpaceTab } from "./ProjectSpaceTab";
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
      path: "",
      element: (
        <ProjectOverviewTab
          projectDetail={projectDetail}
          projectId={projectId}
          onProjectUpdate={onRefresh}
        />
      ),
    },
    {
      path: "briefing",
      element: (
        <ProjectBriefingTab
          projectDetail={projectDetail}
          projectId={projectId}
        />
      ),
    },
    {
      path: "space",
      element: (
        <ProjectSpaceTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "notes",
      element: (
        <ProjectSpaceTab
          projectDetail={projectDetail}
          projectId={projectId}
          initialView="markdown"
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "documents",
      element: (
        <ProjectSpaceTab
          projectDetail={projectDetail}
          projectId={projectId}
          initialView="files"
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "milestones",
      element: (
        <ProjectMilestonesTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "memory",
      element: (
        <ProjectMemoryTab
          projectDetail={projectDetail}
          projectId={projectId}
        />
      ),
    },
    {
      path: "financials",
      element: (
        <ProjectFinancialsTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      ),
    },
    {
      path: "settings",
      element: (
        <ProjectSettingsTab
          projectDetail={projectDetail}
          onUpdate={onRefresh}
        />
      ),
    },
  ];
}
