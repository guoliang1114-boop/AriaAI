import { useTranslation } from "react-i18next";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { FolderKanban, Home, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { PageTitle } from "../../components/PageTitle";
import { ServiceErrorState } from "../../components/ServiceErrorState";
import { ProjectBriefingTab } from "./ProjectBriefingTab";
import { ProjectDetailLayout } from "./ProjectDetailLayout";
import { ProjectFinancialsTab } from "./ProjectFinancialsTab";
import { ProjectMemoryTab } from "./ProjectMemoryTab";
import { ProjectMilestonesTab } from "./ProjectMilestonesTab";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectStakeholdersTab } from "./ProjectStakeholdersTab";
import { ProjectTodosTab } from "./ProjectTodosTab";
import { getActiveProjectDetailTabId, type ProjectDetailTabId } from "./projectDetailTabs";
import { useProjectDetailData } from "./useProjectDetailData";

function renderProjectDetailContent(
  activeTabId: ProjectDetailTabId,
  projectId: string,
  projectDetail: NonNullable<ReturnType<typeof useProjectDetailData>["projectDetail"]>,
  onRefresh: () => void,
) {
  switch (activeTabId) {
    case "briefing":
      return (
        <ProjectBriefingTab
          projectDetail={projectDetail}
          projectId={projectId}
        />
      );
    case "documents":
      // The documents tab is handled by PersistentProjectPanels (kept
      // mounted across tab switches so editor / dropzone state
      // survives). Returning null here avoids double-render — the
      // layout container is also ``hidden`` for documents/chat.
      return null;
    case "milestones":
      return (
        <div className="space-y-6">
          <ProjectMilestonesTab
            projectDetail={projectDetail}
            projectId={projectId}
            onUpdate={onRefresh}
          />
          <ProjectTodosTab
            projectId={projectId}
            memoryVersion={projectDetail.project.memory_version ?? 0}
            todos={projectDetail.todos}
            onUpdate={onRefresh}
          />
        </div>
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
    case "stakeholders":
      return (
        <ProjectStakeholdersTab
          projectDetail={projectDetail}
          projectId={projectId}
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
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTabId = getActiveProjectDetailTabId(location.pathname, id);
  const { error, errorStatus, initialLoading, projectDetail, refreshProjectDetail } =
    useProjectDetailData(id);

  if (initialLoading) {
    return (
      <>
        <PageTitle title="Project" />
        <div
          className="theme-codex min-h-full flex items-center justify-center"
          style={{ background: "var(--color-codex-bg)" }}
        >
          <Loader2
            className="w-7 h-7 animate-spin"
            style={{ color: "var(--color-codex-accent)" }}
          />
        </div>
      </>
    );
  }

  if (!projectDetail) {
    const isServiceUnavailable = errorStatus === 502 || errorStatus === 503 || errorStatus === 504;
    const copy = isServiceUnavailable
      ? {
          badge: String(errorStatus),
          title: isZh ? "服务正在更新，项目暂时打不开" : "Service is updating",
          description: isZh
            ? "这通常发生在部署重启、网关短暂不可用或后端服务还没完全恢复时。项目数据大概率没有丢，稍等几十秒后重试即可。"
            : "This usually happens during deployment, gateway restart, or while the backend is coming back online. Your project data is likely safe. Try again shortly.",
          hintTitle: isZh ? "你可以先这样做" : "What you can do",
          hintOne: isZh ? "点击“重新尝试”再次加载当前项目。" : "Click Retry to load this project again.",
          hintTwo: isZh ? "如果仍然 502，可以先返回项目列表，等部署完成后再进入。" : "If 502 continues, return to Projects and come back after deployment finishes.",
          primaryAction: isZh ? "重新尝试" : "Retry",
          secondaryAction: isZh ? "返回项目列表" : "Back to projects",
        }
      : {
          badge: errorStatus === 404 ? "404" : "Error",
          title: errorStatus === 404
            ? isZh ? "没有找到这个项目" : "Project not found"
            : isZh ? "项目暂时无法加载" : "Project could not be loaded",
          description: errorStatus === 404
            ? isZh
              ? "这个项目可能已被删除、链接已过期，或当前账号暂时无法访问。"
              : "This project may have been deleted, the link may be outdated, or your account may not have access."
            : isZh
              ? "请求项目详情时遇到问题。你可以重试，或先返回项目列表继续其他工作。"
              : "Something went wrong while loading the project detail. You can retry or return to the project list.",
          hintTitle: isZh ? "下一步建议" : "Next step",
          hintOne: isZh ? "如果是刚部署后出现，建议先重试一次。" : "If this happened right after deployment, retry once.",
          hintTwo: isZh ? "如果项目确实不存在，请从项目列表重新进入。" : "If the project no longer exists, reopen it from the project list.",
          primaryAction: isZh ? "重新尝试" : "Retry",
          secondaryAction: isZh ? "返回项目列表" : "Back to projects",
        };

    return (
      <>
        <PageTitle title="Project" />
        <ServiceErrorState
          actions={[
            {
              icon: <RefreshCw className="h-4 w-4" />,
              label: copy.primaryAction,
              onClick: () => void refreshProjectDetail(),
            },
            {
              icon: <FolderKanban className="h-4 w-4" />,
              label: copy.secondaryAction,
              onClick: () => navigate("/projects"),
              variant: "secondary",
            },
            {
              icon: <Home className="h-4 w-4" />,
              label: isZh ? "回到首页" : "Dashboard",
              onClick: () => navigate("/"),
              variant: "secondary",
            },
          ]}
          badge={copy.badge}
          description={copy.description}
          detail={error}
          detailLabel={isZh ? "错误详情" : "Error detail"}
          hints={[copy.hintOne, copy.hintTwo]}
          hintTitle={copy.hintTitle}
          linksTitle={isZh ? "快捷入口" : "Quick links"}
          serviceUnavailable={isServiceUnavailable}
          title={copy.title}
          links={[
            {
              label: t("nav.projects"),
              description: isZh ? "查看项目列表，确认项目是否仍然存在。" : "Open the project list and confirm this project still exists.",
              icon: <FolderKanban className="h-4 w-4" />,
              onClick: () => navigate("/projects"),
            },
            {
              label: isZh ? "对话" : "Chat",
              description: isZh ? "如果项目页暂时不可用，可以先继续通用对话。" : "Continue in general chat while this page recovers.",
              icon: <MessageSquare className="h-4 w-4" />,
              onClick: () => navigate("/chat"),
            },
          ]}
        />
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
