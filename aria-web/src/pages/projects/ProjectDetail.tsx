import { useTranslation } from "react-i18next";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowLeft, FolderKanban, Home, Loader2, RefreshCw, ServerCrash } from "lucide-react";
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
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
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
        <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_30%)] bg-gray-50">
          <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl items-center px-6 py-12">
            <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
              <section className="rounded-[2rem] border border-white/80 bg-white/90 p-8 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur">
                <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                  isServiceUnavailable ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                }`}>
                  {isServiceUnavailable ? <ServerCrash className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {copy.badge}
                </div>
                <h1 className="mt-6 text-3xl font-semibold tracking-tight text-gray-950 md:text-4xl">
                  {copy.title}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">{copy.description}</p>
                {error ? (
                  <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    <div className="font-medium text-gray-900">{isZh ? "错误详情" : "Error detail"}</div>
                    <div className="mt-1 break-words">{error}</div>
                  </div>
                ) : null}

                <div className="mt-8 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void refreshProjectDetail()}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {copy.primaryAction}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/projects")}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    <FolderKanban className="h-4 w-4" />
                    {copy.secondaryAction}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    <Home className="h-4 w-4" />
                    {isZh ? "回到首页" : "Dashboard"}
                  </button>
                </div>
              </section>

              <aside className="space-y-4">
                <div className="rounded-[2rem] border border-white/80 bg-white/80 p-6 shadow-sm backdrop-blur">
                  <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${
                    isServiceUnavailable ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {isServiceUnavailable ? <ServerCrash className="h-6 w-6" /> : <ArrowLeft className="h-6 w-6" />}
                  </div>
                  <h2 className="text-lg font-semibold text-gray-950">{copy.hintTitle}</h2>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-gray-600">
                    <p>{copy.hintOne}</p>
                    <p>{copy.hintTwo}</p>
                  </div>
                </div>

                <div className="rounded-[2rem] border border-white/80 bg-white/80 p-6 shadow-sm backdrop-blur">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">
                    {isZh ? "快捷入口" : "Quick links"}
                  </h3>
                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      onClick={() => navigate("/projects")}
                      className="rounded-2xl border border-gray-100 bg-white px-4 py-4 text-left transition hover:bg-gray-50"
                    >
                      <div className="text-sm font-medium text-gray-950">{t("nav.projects")}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {isZh ? "查看项目列表，确认项目是否仍然存在。" : "Open the project list and confirm this project still exists."}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/chat")}
                      className="rounded-2xl border border-gray-100 bg-white px-4 py-4 text-left transition hover:bg-gray-50"
                    >
                      <div className="text-sm font-medium text-gray-950">{isZh ? "对话" : "Chat"}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {isZh ? "如果项目页暂时不可用，可以先继续通用对话。" : "Continue in general chat while this page recovers."}
                      </div>
                    </button>
                  </div>
                </div>
              </aside>
            </div>
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
