import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectDetail as ProjectDetailType, ProjectFile } from "../../types/api";
import { downloadProjectFile } from "./downloadProjectFile";
import { ProjectOverviewDocumentsCard } from "./ProjectOverviewDocumentsCard";
import { ProjectOverviewInfoCard } from "./ProjectOverviewInfoCard";
import { ProjectOverviewMilestonesCard } from "./ProjectOverviewMilestonesCard";
import { ProjectOverviewNotesCard } from "./ProjectOverviewNotesCard";
import { ProjectOverviewSidebar } from "./ProjectOverviewSidebar";
import { ProjectOverviewSummaryCard } from "./ProjectOverviewSummaryCard";
import { useProjectOverviewData } from "./useProjectOverviewData";

interface ProjectOverviewTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onProjectUpdate: () => void;
}

export function ProjectOverviewTab({
  projectDetail,
  projectId,
  onProjectUpdate: _onProjectUpdate,
}: ProjectOverviewTabProps) {
  void _onProjectUpdate;

  const { project, financials, md_notes } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const toast = useToast();
  const {
    descExpanded,
    formatAmount,
    formatAmountInTenThousand,
    generateSummary,
    generatingSummary,
    overviewNotesText,
    recentFiles,
    recentMilestones,
    recentTodos,
    setDescExpanded,
    summaryError,
    summaryText,
  } = useProjectOverviewData({
    isZh,
    mdNotes: md_notes,
    projectDetail,
    projectId,
  });

  const handleDownload = async (file: ProjectFile) => {
    try {
      await downloadProjectFile({
        fileId: file.id,
        fileName: file.name,
        projectId,
      });
    } catch (error) {
      console.error("Failed to download file:", error);
      toast.error(isZh ? "涓嬭浇澶辫触" : "Download failed");
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-6">
        <ProjectOverviewInfoCard
          contractAmountText={
            (project.contract_amount ?? 0) > 0
              ? `CNY ${formatAmountInTenThousand(project.contract_amount)}${isZh ? "涓?" : "K"}`
              : ""
          }
          createdAt={new Date(project.created_at).toLocaleDateString()}
          descExpanded={descExpanded}
          description={project.description}
          isZh={isZh}
          notes={project.notes}
          onEdit={() =>
            navigate(`/projects/${projectId}/settings`, { state: { edit: true } })
          }
          onToggleDescription={() => setDescExpanded((value) => !value)}
          projectClient={project.client}
          projectStatus={project.status}
        />

        <ProjectOverviewSummaryCard
          generatingSummary={generatingSummary}
          isZh={isZh}
          onGenerate={generateSummary}
          summaryError={summaryError}
          summaryText={summaryText || project.context_summary || ""}
        />

        {overviewNotesText.length > 0 && (
          <ProjectOverviewNotesCard
            isZh={isZh}
            notesText={overviewNotesText}
            onOpen={() => navigate(`/projects/${projectId}/notes`)}
          />
        )}

        <ProjectOverviewMilestonesCard
          isZh={isZh}
          milestones={recentMilestones}
          onOpen={() => navigate(`/projects/${projectId}/milestones`)}
        />

        <ProjectOverviewDocumentsCard
          files={recentFiles}
          isZh={isZh}
          onDownload={(file) => void handleDownload(file)}
          onOpen={() => navigate(`/projects/${projectId}/documents`)}
        />
      </div>

      <ProjectOverviewSidebar
        financials={financials}
        formatAmount={formatAmount}
        isZh={isZh}
        onGoToDocuments={() => navigate(`/projects/${projectId}/documents`)}
        onGoToFinancials={() => navigate(`/projects/${projectId}/financials`)}
        onGoToMilestones={() => navigate(`/projects/${projectId}/milestones`)}
        onGoToTodos={() => navigate(`/projects/${projectId}/todos`)}
        recentTodos={recentTodos}
      />
    </div>
  );
}
