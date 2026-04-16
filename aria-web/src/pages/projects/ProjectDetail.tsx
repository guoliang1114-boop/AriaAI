import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Routes, Route, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageTitle } from "../../components/PageTitle";
import { ProjectDocumentsTab } from "./ProjectDocumentsTab";
import { ProjectFinancialsTab } from "./ProjectFinancialsTab";
import { ProjectMilestonesTab } from "./ProjectMilestonesTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";
import { ProjectDetailLayout } from "./ProjectDetailLayout";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { getActiveProjectDetailTabId } from "./projectDetailTabs";
import { useProjectDetailData } from "./useProjectDetailData";

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
        <Routes>
          <Route
            path="/"
            element={
              <ProjectOverviewTab
                projectDetail={projectDetail}
                projectId={id!}
                onProjectUpdate={refreshProjectDetail}
              />
            }
          />
          <Route
            path="/documents"
            element={
              <ProjectDocumentsTab
                projectDetail={projectDetail}
                projectId={id!}
                onUpdate={refreshProjectDetail}
              />
            }
          />
          <Route
            path="/milestones"
            element={
              <ProjectMilestonesTab
                projectDetail={projectDetail}
                projectId={id!}
                onUpdate={refreshProjectDetail}
              />
            }
          />
          <Route
            path="/financials"
            element={
              <ProjectFinancialsTab
                projectDetail={projectDetail}
                projectId={id!}
                onUpdate={refreshProjectDetail}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <ProjectSettingsTab
                projectDetail={projectDetail}
                onUpdate={refreshProjectDetail}
              />
            }
          />
        </Routes>
      </ProjectDetailLayout>
    </>
  );
}

export default ProjectDetail;
