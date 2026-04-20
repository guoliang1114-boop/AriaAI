import { useTranslation } from "react-i18next";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageTitle } from "../../components/PageTitle";
import { ProjectAnchorsTab } from "./ProjectAnchorsTab";
import { ProjectDetailLayout } from "./ProjectDetailLayout";
import { ProjectDocumentsTab } from "./ProjectDocumentsTab";
import { ProjectFinancialsTab } from "./ProjectFinancialsTab";
import { ProjectMemoryTab } from "./ProjectMemoryTab";
import { ProjectMilestonesTab } from "./ProjectMilestonesTab";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";
import { ProjectStakeholdersTab } from "./ProjectStakeholdersTab";
import { getActiveProjectDetailTabId, type ProjectDetailTabId } from "./projectDetailTabs";
import { useProjectDetailData } from "./useProjectDetailData";

function renderProjectDetailContent(
  activeTabId: ProjectDetailTabId,
  projectId: string,
  projectDetail: NonNullable<ReturnType<typeof useProjectDetailData>["projectDetail"]>,
  onRefresh: () => void,
) {
  switch (activeTabId) {
    case "documents":
      return (
        <ProjectDocumentsTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      );
    case "milestones":
      return (
        <ProjectMilestonesTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      );
    case "financials":
      return (
        <ProjectFinancialsTab
          projectDetail={projectDetail}
          projectId={projectId}
          onUpdate={onRefresh}
        />
      );
    case "memory":
      return (
        <ProjectMemoryTab
          projectDetail={projectDetail}
          projectId={projectId}
        />
      );
    case "anchors":
      return (
        <ProjectAnchorsTab
          projectDetail={projectDetail}
          projectId={projectId}
        />
      );
    case "stakeholders":
      return (
        <ProjectStakeholdersTab
          projectDetail={projectDetail}
          projectId={projectId}
        />
      );
    case "settings":
      return (
        <ProjectSettingsTab
          projectDetail={projectDetail}
          onUpdate={onRefresh}
        />
      );
    case "overview":
    default:
      return (
        <ProjectOverviewTab
          projectDetail={projectDetail}
          projectId={projectId}
          onProjectUpdate={onRefresh}
        />
      );
  }
}

export function ProjectDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTabId = getActiveProjectDetailTabId(location.pathname, id);
  const { error, initialLoading, projectDetail, refreshProjectDetail } =
    useProjectDetailData(id);

  if (initialLoading) {
    return (
      <>
        <PageTitle title="Project" />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    );
  }

  if (!projectDetail) {
    return (
      <>
        <PageTitle title="Project" />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500">Project not found</p>
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            <button
              onClick={() => navigate("/projects")}
              className="mt-4 text-primary hover:underline"
            >
              {t("projects.projectDetail.back")}
            </button>
          </div>
        </div>
      </>
    );
  }

  const { project } = projectDetail;

  return (
    <>
      <PageTitle title={project.name} />
      <ProjectDetailLayout
        projectId={id!}
        project={project}
        projectDetail={projectDetail}
        activeTabId={activeTabId}
        onBack={() => navigate("/projects")}
        onRefresh={refreshProjectDetail}
      >
        {renderProjectDetailContent(
          activeTabId,
          id!,
          projectDetail,
          refreshProjectDetail,
        )}
      </ProjectDetailLayout>
    </>
  );
}

export default ProjectDetail;
