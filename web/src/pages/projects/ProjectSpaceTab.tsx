import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectNotesTab } from "./ProjectNotesTab";

interface ProjectSpaceTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

export function ProjectSpaceTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectSpaceTabProps) {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] flex-col">
      <ProjectNotesTab
        projectId={projectId}
        projectName={projectDetail.project.name}
        files={projectDetail.files}
        folders={projectDetail.folders}
        onUpdate={onUpdate}
      />
    </div>
  );
}
