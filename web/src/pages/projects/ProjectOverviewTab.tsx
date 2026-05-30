import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { useProjectDetailActions } from "./ProjectDetailActionsContext";
import {
  ProjectOverviewActivityTimelinePanel,
  ProjectOverviewAISnapshotPanel,
  ProjectOverviewArchivePanel,
  ProjectOverviewBriefingPreviewPanel,
  ProjectOverviewLoadingSkeleton,
  ProjectOverviewMemoryExcerptPanel,
  ProjectOverviewStakeholdersPreviewPanel,
  ProjectOverviewTeamPanel,
} from "./ProjectOverviewPanels";
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
  onProjectUpdate,
}: ProjectOverviewTabProps) {
  void onProjectUpdate;
  const { project, members } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const actions = useProjectDetailActions();

  const {
    formatAmountInTenThousand,
    generateSummary,
    generatingSummary,
    isLoadingMemory,
    memory,
    recentFiles,
    recentMilestones,
    recentTodos,
    summaryText,
  } = useProjectOverviewData({
    language: i18n.language,
    isZh,
    projectDetail,
    projectId,
  });

  const ownerMember = members.find((member) => member.role === "owner") || members[0];
  const ownerLabel = ownerMember?.user.display_name;

  const contractAmount = project.contract_amount ?? 0;
  const contractAmountText = contractAmount > 0
    ? isZh
      ? `¥${formatAmountInTenThousand(contractAmount)} 万`
      : `CNY ${formatAmountInTenThousand(contractAmount)}K`
    : "";

  const briefText = (summaryText || memory?.project_brief || "").trim();

  if (isLoadingMemory && !memory && !briefText) {
    return <ProjectOverviewLoadingSkeleton isZh={isZh} />;
  }

  return (
    <div
      className="grid gap-5"
      style={{
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        alignItems: "start",
      }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: 20 }}>
        <ProjectOverviewAISnapshotPanel
          briefText={briefText}
          isZh={isZh}
          loading={generatingSummary}
          memory={memory}
          memoryStale={Boolean(project.memory_stale)}
          memoryUpdatedAt={project.memory_updated_at}
          memoryVersion={project.memory_version}
          onRegenerate={() => void generateSummary("overview", true)}
          ownerLabel={ownerLabel}
        />

        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          <ProjectOverviewMemoryExcerptPanel
            isZh={isZh}
            memory={memory}
            memoryVersion={project.memory_version}
            onOpenMemory={() => navigate(`/projects/${projectId}/memory`)}
          />
          <ProjectOverviewBriefingPreviewPanel
            isZh={isZh}
            memory={memory}
            onOpenBriefing={() => navigate(`/projects/${projectId}/briefing`)}
          />
        </div>

        <ProjectOverviewActivityTimelinePanel
          files={recentFiles}
          isZh={isZh}
          memoryUpdatedAt={project.memory_updated_at}
          memoryVersion={project.memory_version}
          milestones={recentMilestones}
          onOpenChat={() => navigate(`/projects/${projectId}/chat`)}
          todos={recentTodos}
        />
      </div>

      <aside className="flex flex-col" style={{ gap: 16, position: "sticky", top: 76 }}>
        <ProjectOverviewArchivePanel
          contractAmountText={contractAmountText}
          createdAt={project.created_at ? formatDateOnly(project.created_at) : null}
          isZh={isZh}
          ownerLabel={ownerLabel}
          project={project}
        />
        <ProjectOverviewStakeholdersPreviewPanel
          isZh={isZh}
          memory={memory}
          onOpenStakeholders={() => navigate(`/projects/${projectId}/stakeholders`)}
        />
        <ProjectOverviewTeamPanel
          isZh={isZh}
          members={members}
          onInviteMember={actions ? () => actions.openMembers() : undefined}
        />
      </aside>
    </div>
  );
}
