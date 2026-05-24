import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectDetail as ProjectDetailType, ProjectFile } from "../../types/api";
import { downloadProjectFile } from "./downloadProjectFile";
import { ProjectAnchorsCard } from "./ProjectAnchorsCard";
import { ProjectOverviewDocumentsCard } from "./ProjectOverviewDocumentsCard";
import { ProjectOverviewInfoCard } from "./ProjectOverviewInfoCard";
import { ProjectOverviewMemoryCard } from "./ProjectOverviewMemoryCard";
import { ProjectOverviewMilestonesCard } from "./ProjectOverviewMilestonesCard";
import { ProjectOverviewSidebar } from "./ProjectOverviewSidebar";
import { ProjectOverviewSummaryCard } from "./ProjectOverviewSummaryCard";
import { buildProjectSkillPrompt, ProjectSkillWorkflowsCard } from "./ProjectSkillWorkflowsCard";
import { useProjectOverviewData } from "./useProjectOverviewData";
import { formatDateOnly } from "../../utils/timezone";

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

  const { project, financials } = projectDetail;
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
    handleSummaryTypeChange,
    isLoadingMemory,
    isRebuildingMemory,
    memory,
    recentFiles,
    recentMilestones,
    recentTodos,
    rebuildMemory,
    setDescExpanded,
    summaryCooldownUntil,
    summaryError,
    summaryText,
    summaryType,
  } = useProjectOverviewData({
    language: i18n.language,
    isZh,
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
      toast.error(isZh ? "下载失败" : "Download failed");
    }
  };

  const handleStartProjectSkill = (intent: "brief" | "risk" | "stakeholder") => {
    const prompt = buildProjectSkillPrompt({
      intent,
      isZh,
      projectDetail,
    });
    const params = new URLSearchParams({
      project: String(project.id),
      projectName: project.name,
      q: prompt,
    });
    navigate(`/skills?${params.toString()}`);
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 space-y-6 lg:col-span-8">
        <ProjectOverviewInfoCard
          contractAmountText={
            (project.contract_amount ?? 0) > 0
              ? `CNY ${formatAmountInTenThousand(project.contract_amount)}${isZh ? "万" : "K"}`
              : ""
          }
          createdAt={formatDateOnly(project.created_at)}
          descExpanded={descExpanded}
          description={project.description}
          isZh={isZh}
          onEdit={() => navigate(`/projects/${projectId}/settings`, { state: { edit: true } })}
          onToggleDescription={() => setDescExpanded((value) => !value)}
          projectClient={project.client}
          projectStatus={project.status}
        />

        <ProjectSkillWorkflowsCard
          isZh={isZh}
          onStart={handleStartProjectSkill}
          projectDetail={projectDetail}
        />

        <ProjectOverviewSummaryCard
          generatingSummary={generatingSummary}
          isZh={isZh}
          onGenerate={generateSummary}
          onSummaryTypeChange={handleSummaryTypeChange}
          summaryCooldownUntil={summaryCooldownUntil}
          summaryError={summaryError}
          summaryText={summaryText}
          summaryType={summaryType}
        />

        <ProjectAnchorsCard
          clientName={project.client}
          isZh={isZh}
          memory={memory}
          onManage={() => navigate(`/projects/${projectId}/anchors`)}
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ProjectOverviewMilestonesCard
            isZh={isZh}
            milestones={recentMilestones}
            onOpen={() => navigate(`/projects/${projectId}/milestones`)}
          />
          <ProjectOverviewDocumentsCard
            files={recentFiles}
            isZh={isZh}
            onDownload={(file) => void handleDownload(file)}
            onOpen={() => navigate(`/projects/${projectId}/space`)}
          />
        </div>
      </div>

      <ProjectOverviewSidebar
        financials={financials}
        formatAmount={formatAmount}
        isZh={isZh}
        memoryCard={
          <ProjectOverviewMemoryCard
            isLoading={isLoadingMemory}
            isRebuilding={isRebuildingMemory}
            isZh={isZh}
            memory={memory}
            onRebuild={() => void rebuildMemory()}
          />
        }
        onGoToDocuments={() => navigate(`/projects/${projectId}/space`)}
        onGoToFinancials={() => navigate(`/projects/${projectId}/financials`)}
        onGoToMilestones={() => navigate(`/projects/${projectId}/milestones`)}
        onGoToTodos={() => navigate(`/projects/${projectId}/milestones`)}
        recentTodos={recentTodos}
      />
    </div>
  );
}
