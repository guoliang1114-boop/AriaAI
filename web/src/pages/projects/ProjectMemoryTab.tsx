import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Clock3,
  FileText,
  GitCompare,
  Loader2,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import { api } from "../../api/client";
import type {
  ClientMemory,
  ClientMemoryResponse,
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
  ProjectMemorySnapshot,
  MemorySnapshotDiffResponse,
} from "../../types/api";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { ProjectMemorySlotCard } from "./ProjectMemorySlotCard";
import { ProjectOverviewMemoryCard } from "./ProjectOverviewMemoryCard";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";
import { dispatchProjectMemoryStateUpdated } from "./useProjectDetailData";
import { useProjectMemorySummary } from "./useProjectMemorySummary";

interface ProjectMemoryTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
}

interface ClientSummary {
  id: number;
  contact?: string;
  industry?: string;
  name: string;
}

function normalizeClientName(value: string) {
  return value.trim().toLowerCase();
}

function getApiErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { detail?: string; message?: string } | string } }).response;
    if (typeof response?.data === "string") return response.data;
    return response?.data?.detail || response?.data?.message;
  }
  if (error instanceof Error) return error.message;
  return undefined;
}

function formatDiffValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "空";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function SectionList({
  emptyText,
  items,
}: {
  emptyText: string;
  items: string[];
}) {
  if (items.length === 0) {
    return <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">{emptyText}</div>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm text-gray-700">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DetailCard({
  children,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  icon: typeof Brain;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
          <Icon className="h-4 w-4 text-gray-600" />
        </div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function StakeholderManagementCard({
  client,
  clientMemory,
  isZh,
  memory,
  onOpenClientMemory,
}: {
  client: ClientSummary | null;
  clientMemory: ClientMemory | null;
  isZh: boolean;
  memory: ProjectMemory | null;
  onOpenClientMemory: () => void;
}) {
  const pinnedNotes = memory?.stakeholder_notes_detail?.pinned || [];
  const aiNotes = memory?.stakeholder_notes_detail?.ai || memory?.stakeholder_notes || [];
  const clientContacts = clientMemory?.key_contacts || [];
  const hasClientContacts = clientContacts.length > 0 || Boolean(client?.contact?.trim());
  const hasStakeholderCoverage = hasClientContacts && pinnedNotes.length > 0;

  return (
    <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{isZh ? "干系人管理与分析" : "Stakeholder Management & Analysis"}</h3>
              <p className="mt-0.5 text-sm text-gray-500">
                {isZh
                  ? "这里的干系人优先指客户侧联系人、决策人、使用方和影响方，用来判断下一步客户对齐动作。"
                  : "Stakeholders here mean client-side contacts, decision makers, users, and influencers for the next alignment move."}
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenClientMemory}
          disabled={!client}
          className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
        >
          {isZh ? "打开客户记忆" : "Open Client Memory"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white/80 p-4">
          <div className="text-xs font-medium text-gray-500">{isZh ? "关联客户" : "Linked Client"}</div>
          <div className="mt-2 text-xl font-semibold text-gray-900">{client?.name || (isZh ? "未关联" : "Not linked")}</div>
          <div className="mt-2 text-sm text-gray-600">
            {client?.contact || client?.industry || (isZh ? "建议先在项目设置中关联客户" : "Link a client in project settings first")}
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white/80 p-4">
          <div className="text-xs font-medium text-gray-500">{isZh ? "客户关键联系人" : "Client key contacts"}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{clientContacts.length}</div>
          <p className="mt-2 text-sm text-gray-600">
            {clientContacts.length
              ? clientContacts.slice(0, 2).map((contact) => `${contact.name || (isZh ? "未命名" : "Unnamed")} ${contact.role ? `/${contact.role}` : ""}`).join(" · ")
              : client?.contact
                ? client.contact
              : isZh
                ? "客户记忆尚未沉淀关键联系人"
                : "No client key contacts captured yet"}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white/80 p-4">
          <div className="text-xs font-medium text-gray-500">{isZh ? "分析结论" : "Analysis"}</div>
          <p className="mt-2 text-sm text-gray-700">
            {hasStakeholderCoverage
              ? isZh
                ? "客户侧关键人和长期沟通提醒已有基础覆盖，适合直接用于下一次客户沟通准备。"
                : "Stakeholder coverage exists. Use pinned reminders to plan the next touchpoint."
              : hasClientContacts
                ? isZh
                  ? "已有客户联系人线索，但缺少固定沟通提示，建议从 AI 观察中挑选并固定。"
                  : "Client contact signals exist, but pinned reminders are missing. Promote useful AI notes."
                : isZh
                  ? "客户侧关键人还不清晰，建议先在客户资料或客户记忆中补齐联系人、角色和决策影响。"
                  : "Client-side stakeholders are unclear. Capture contacts, roles, and decision influence first."}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-100 bg-white/70 p-4">
        <div className="text-xs font-medium text-gray-500">{isZh ? "固定沟通提醒" : "Pinned communication reminders"}</div>
        {pinnedNotes.length ? (
          <ul className="mt-2 grid gap-2 text-sm text-gray-700 md:grid-cols-2">
            {pinnedNotes.slice(0, 4).map((item, index) => (
              <li key={`${item}-${index}`} className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500">
            {isZh ? "还没有固定客户侧干系人提醒，可以从 AI 观察中挑选长期有效的偏好、禁区和跟进节奏。" : "No pinned client-side stakeholder reminders yet. Promote preferences, sensitivities, and cadence from AI observations."}
          </p>
        )}
      </div>

      {aiNotes.length ? (
        <div className="mt-4 rounded-xl border border-gray-100 bg-white/70 p-4">
          <div className="text-xs font-medium text-gray-500">{isZh ? "AI 干系人观察" : "AI stakeholder observations"}</div>
          <ul className="mt-2 grid gap-2 text-sm text-gray-700 md:grid-cols-2">
            {aiNotes.slice(0, 4).map((item, index) => (
              <li key={`${item}-${index}`} className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectMemoryTab({ projectDetail, projectId }: ProjectMemoryTabProps) {
  const { project, files, milestones, todos, members, financials } = projectDetail;
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const isZh = i18n.language.startsWith("zh");
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [memoryMeta, setMemoryMeta] = useState<ProjectMemoryResponse | null>(null);
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);
  const [isPromotingToClient, setIsPromotingToClient] = useState(false);
  const [clientPromotionError, setClientPromotionError] = useState<string | null>(null);
  const [clientPromotionMessage, setClientPromotionMessage] = useState<string | null>(null);
  const [linkedClient, setLinkedClient] = useState<ClientSummary | null>(null);
  const [clientMemory, setClientMemory] = useState<ClientMemory | null>(null);
  const [snapshots, setSnapshots] = useState<ProjectMemorySnapshot[]>([]);
  const [isRollingBackSnapshotId, setIsRollingBackSnapshotId] = useState<number | null>(null);
  const [rollbackConfirmSnapshot, setRollbackConfirmSnapshot] = useState<ProjectMemorySnapshot | null>(null);
  const [snapshotDiff, setSnapshotDiff] = useState<MemorySnapshotDiffResponse | null>(null);
  const [diffLoadingSnapshotId, setDiffLoadingSnapshotId] = useState<number | null>(null);

  const overviewInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成项目记忆摘要失败，请稍后重试" : "Failed to generate project memory summary",
    language: i18n.language,
    memoryVersion: memory?.memory_version ?? project.memory_version ?? 0,
    projectId,
    summaryType: "overview",
  });
  const riskInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成项目风险摘要失败，请稍后重试" : "Failed to generate project risk summary",
    language: i18n.language,
    memoryVersion: memory?.memory_version ?? project.memory_version ?? 0,
    projectId,
    summaryType: "risk",
  });
  const stakeholderInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成干系人摘要失败，请稍后重试" : "Failed to generate stakeholder summary",
    language: i18n.language,
    memoryVersion: memory?.memory_version ?? project.memory_version ?? 0,
    projectId,
    summaryType: "stakeholder",
  });

  const refreshMemory = async () => {
    setIsLoadingMemory(true);
    try {
      const data = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
      setMemoryMeta(data);
      setMemory(data.memory);
    } catch (error) {
      console.error("Failed to load project memory:", error);
      setMemoryMeta(null);
      setMemory(null);
    } finally {
      setIsLoadingMemory(false);
    }
  };

  const refreshSnapshots = async () => {
    try {
      const data = await api.get<ProjectMemorySnapshot[]>(`/projects/${projectId}/memory/snapshots`);
      setSnapshots(data);
    } catch (error) {
      console.error("Failed to load project memory snapshots:", error);
      setSnapshots([]);
    }
  };

  const refreshLinkedClientMemory = async () => {
    const clientName = project.client?.trim() || "";
    if (!clientName) {
      setLinkedClient(null);
      setClientMemory(null);
      return;
    }

    try {
      const clients = await api.get<ClientSummary[]>("/clients");
      const matchedClient = clients.find(
        (client) => normalizeClientName(client.name) === normalizeClientName(clientName),
      );
      setLinkedClient(matchedClient || null);

      if (!matchedClient) {
        setClientMemory(null);
        return;
      }

      const memoryData = await api.get<ClientMemoryResponse>(`/clients/${matchedClient.id}/memory`);
      setClientMemory(memoryData.memory);
    } catch (error) {
      console.error("Failed to load linked client memory:", error);
      setClientMemory(null);
    }
  };

  const rebuildMemory = async () => {
    setIsRebuildingMemory(true);
    try {
      const data = await api.post<ProjectMemoryResponse>(
        `/projects/${projectId}/memory/rebuild`,
        {},
        { timeout: 60000 },
      );
      setMemoryMeta(data);
      setMemory(data.memory);
      dispatchProjectMemoryStateUpdated({
        projectId: Number(projectId),
        memory_stale: data.memory_stale,
        memory_updated_at: data.memory_updated_at,
        memory_version: data.memory_version,
        memory_rebuild_status: data.memory_rebuild_status ?? "idle",
        memory_rebuild_failed_at: data.memory_rebuild_failed_at ?? null,
        project_brief: data.memory.project_brief,
      });
      await Promise.all([
        overviewInsight.refresh(true),
        riskInsight.refresh(true),
        stakeholderInsight.refresh(true),
        refreshSnapshots(),
      ]);
    } finally {
      setIsRebuildingMemory(false);
    }
  };

  const rollbackSnapshot = async (snapshot: ProjectMemorySnapshot) => {
    setIsRollingBackSnapshotId(snapshot.id);
    try {
      const data = await api.post<ProjectMemoryResponse>(
        `/projects/${projectId}/memory/snapshots/${snapshot.id}/rollback`,
        {},
        { timeout: 60000 },
      );
      setMemoryMeta({
        project_id: Number(projectId),
        memory: data.memory,
        memory_version: data.memory_version,
        memory_stale: false,
        memory_updated_at: data.memory.last_updated_at,
        memory_rebuild_status: "idle",
        memory_rebuild_failed_at: null,
      });
      setMemory(data.memory);
      dispatchProjectMemoryStateUpdated({
        projectId: Number(projectId),
        memory_stale: false,
        memory_updated_at: data.memory.last_updated_at,
        memory_version: data.memory_version,
        memory_rebuild_status: "idle",
        memory_rebuild_failed_at: null,
        project_brief: data.memory.project_brief,
      });
      await Promise.all([refreshSnapshots(), overviewInsight.refresh(true), riskInsight.refresh(true), stakeholderInsight.refresh(true)]);
    } finally {
      setIsRollingBackSnapshotId(null);
      setRollbackConfirmSnapshot(null);
    }
  };

  const loadSnapshotDiff = async (snapshot: ProjectMemorySnapshot) => {
    setDiffLoadingSnapshotId(snapshot.id);
    try {
      const data = await api.get<MemorySnapshotDiffResponse>(
        `/projects/${projectId}/memory/snapshots/${snapshot.id}/diff`,
      );
      setSnapshotDiff(data);
    } finally {
      setDiffLoadingSnapshotId(null);
    }
  };

  const promoteToClientMemory = async () => {
    setClientPromotionError(null);
    setClientPromotionMessage(null);

    const clientName = project.client?.trim() || "";
    const projectHasMemory = Boolean(memory) && (memory?.memory_version ?? project.memory_version ?? 0) > 0;
    if (!clientName) {
      setClientPromotionError(isZh ? "这个项目还没有填写客户，暂时不能沉淀到客户记忆。" : "This project has no client yet.");
      return;
    }
    if (!projectHasMemory) {
      setClientPromotionError(
        isZh
          ? "请先刷新项目记忆，再把稳定的项目经验沉淀到客户记忆。"
          : "Rebuild project memory first, then promote it into client memory.",
      );
      return;
    }

    setIsPromotingToClient(true);
    try {
      const clients = await api.get<ClientSummary[]>("/clients");
      const matchedClient = clients.find(
        (client) => normalizeClientName(client.name) === normalizeClientName(clientName),
      );
      if (!matchedClient) {
        throw new Error(
          isZh
            ? `没有找到同名客户「${clientName}」，请先在客户空间创建或修正客户名称。`
            : `No matching client named "${clientName}" was found.`,
        );
      }

      const promoted = await api.post<ClientMemoryResponse>(
        `/clients/${matchedClient.id}/memory/promote-project`,
        { project_id: Number(projectId) },
        { timeout: 120000 },
      );
      const promotedAt = promoted.memory_updated_at || new Date().toISOString();
      setMemory((currentMemory) =>
        currentMemory
          ? {
              ...currentMemory,
              _client_promotion: {
                client_id: matchedClient.id,
                client_name: matchedClient.name,
                promoted_at: promotedAt,
                trigger: "manual_project_memory_promote",
              },
            }
          : currentMemory,
      );
      setClientPromotionMessage(
        isZh
          ? `已沉淀到「${matchedClient.name}」客户记忆，客户画像和经验库已更新。`
          : `Promoted into ${matchedClient.name} client memory.`,
      );
    } catch (error) {
      console.error("Failed to promote project memory into client memory:", error);
      setClientPromotionError(
        getApiErrorMessage(error) ||
          (isZh
            ? "沉淀到客户记忆失败，请稍后重试或先刷新项目记忆。"
            : "Failed to promote project memory. Please try again later."),
      );
    } finally {
      setIsPromotingToClient(false);
    }
  };

  useEffect(() => {
    void refreshMemory();
    void refreshSnapshots();
  }, [projectId]);

  useEffect(() => {
    void refreshLinkedClientMemory();
  }, [project.client]);

  const sourceCoverage = useMemo(
    () => [
      { label: isZh ? "项目文档" : "Documents", value: files.length },
      { label: isZh ? "里程碑" : "Milestones", value: milestones.length },
      { label: isZh ? "待办" : "Todos", value: todos.length },
      { label: isZh ? "项目成员" : "Members", value: members.length },
      { label: isZh ? "财务记录" : "Payments", value: financials.payments.length },
    ],
    [files.length, financials.payments.length, isZh, members.length, milestones.length, todos.length],
  );

  const memoryUpdatedText = formatProjectMemoryUpdatedAt(memory?.last_updated_at, isZh);
  const rebuildStatusText =
    memoryMeta?.memory_rebuild_status === "queued"
      ? isZh
        ? "排队中"
        : "Queued"
      : memoryMeta?.memory_rebuild_status === "rebuilding"
        ? isZh
          ? "重建中"
          : "Rebuilding"
        : memoryMeta?.memory_rebuild_status === "failed"
          ? isZh
            ? "重建失败"
            : "Failed"
          : isZh
            ? "空闲"
            : "Idle";
  const lastTrigger = memory?.rebuild_log?.length
    ? memory.rebuild_log[memory.rebuild_log.length - 1]?.trigger || (isZh ? "未知" : "Unknown")
    : isZh
      ? "暂无"
      : "N/A";
  const promotionMeta = memory?._client_promotion
  const clientName = project.client?.trim() || "";
  const hasProjectMemory = Boolean(memory) && (memory?.memory_version ?? project.memory_version ?? 0) > 0;

  return (
    <div className="space-y-6">
      {promotionMeta ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {isZh ? "这个项目的经验已经沉淀到客户记忆" : "This project has been promoted into client memory"}
              </div>
              <div className="mt-1 text-emerald-800">
                {isZh
                  ? `客户：${promotionMeta.client_name} · 沉淀时间：${formatProjectMemoryUpdatedAt(promotionMeta.promoted_at, isZh)}`
                  : `Client: ${promotionMeta.client_name} · Promoted at ${formatProjectMemoryUpdatedAt(promotionMeta.promoted_at, isZh)}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/clients/${promotionMeta.client_id}/memory`)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              {isZh ? "打开客户记忆" : "Open client memory"}
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 via-emerald-50 to-white p-4 text-sm text-teal-950">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4 text-teal-700" />
                {isZh ? "把项目经验提升到客户记忆" : "Promote project learning into client memory"}
              </div>
              <p className="mt-1 max-w-3xl text-teal-800">
                {isZh
                  ? clientName
                    ? `将当前项目记忆沉淀到「${clientName}」客户空间，后续客户画像、决策偏好和经验复用会更连贯。`
                    : "项目暂未填写客户。补齐客户后，就可以把项目沉淀为客户级长期经验。"
                  : clientName
                    ? `Promote this project memory into ${clientName}'s client workspace for reusable long-term context.`
                    : "Add a client to this project before promoting memory."}
              </p>
              {!hasProjectMemory ? (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  {isZh ? "建议先刷新项目记忆，再沉淀到客户记忆。" : "Rebuild project memory before promoting it."}
                </p>
              ) : null}
              {clientPromotionError ? (
                <p className="mt-2 text-xs font-medium text-red-700">{clientPromotionError}</p>
              ) : null}
              {clientPromotionMessage ? (
                <p className="mt-2 text-xs font-medium text-emerald-700">{clientPromotionMessage}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void promoteToClientMemory()}
              disabled={isPromotingToClient || !clientName || !hasProjectMemory}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-900/10 transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 disabled:shadow-none"
            >
              {isPromotingToClient ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
              {isZh ? "提升到客户记忆" : "Promote to client memory"}
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <ProjectOverviewMemoryCard
            isLoading={isLoadingMemory}
            isRebuilding={isRebuildingMemory}
            isZh={isZh}
            memory={memory}
            rebuildStatus={memoryMeta?.memory_rebuild_status}
            rebuildFailedAt={memoryMeta?.memory_rebuild_failed_at}
            onRebuild={() => {
              void rebuildMemory();
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium text-gray-500">
              {isZh ? "当前阶段" : "Current Stage"}
            </div>
            <div className="mt-2 text-lg font-semibold text-gray-900">
              {memory?.current_stage || project.status}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium text-gray-500">
              {isZh ? "当前目标" : "Current Objective"}
            </div>
            <div className="mt-2 text-sm leading-relaxed text-gray-900">
              {memory?.current_objective || (isZh ? "暂未明确当前目标" : "No objective yet")}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium text-gray-500">
              {isZh ? "记忆更新时间" : "Memory Updated"}
            </div>
            <div className="mt-2 text-sm font-medium text-gray-900">{memoryUpdatedText}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium text-gray-500">
              {isZh ? "来源覆盖" : "Source Coverage"}
            </div>
            <div className="mt-2 text-sm text-gray-900">
              {sourceCoverage.reduce((sum, item) => sum + item.value, 0)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
              {sourceCoverage.map((item) => (
                <div key={item.label} className="rounded-lg bg-gray-50 px-2.5 py-2">
                  <div>{item.label}</div>
                  <div className="mt-1 font-semibold text-gray-900">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <ProjectMemoryInsightCard
            content={overviewInsight.content}
            error={overviewInsight.error}
            generated={overviewInsight.generated}
            hint={
              isZh
                ? "用业务语言快速理解当前项目共识，适合项目经理和业务负责人先看这一块。"
                : "Business-readable overview of the current project consensus."
            }
            isZh={isZh}
            loading={overviewInsight.loading}
            onRefresh={() => {
              void overviewInsight.refresh(true);
            }}
            title={isZh ? "AI 项目记忆摘要" : "AI Memory Overview"}
          />
        </div>
        <div className="xl:col-span-1">
          <ProjectMemoryInsightCard
            content={riskInsight.content}
            error={riskInsight.error}
            generated={riskInsight.generated}
            hint={
              isZh
                ? "聚焦关键风险、阻塞点和需要尽快处理的问题。"
                : "Focused view of the major risks and blockers."
            }
            isZh={isZh}
            loading={riskInsight.loading}
            onRefresh={() => {
              void riskInsight.refresh(true);
            }}
            title={isZh ? "AI 风险摘要" : "AI Risk Summary"}
          />
        </div>
        <div className="xl:col-span-1">
          <ProjectMemoryInsightCard
            content={stakeholderInsight.content}
            error={stakeholderInsight.error}
            generated={stakeholderInsight.generated}
            hint={
              isZh
                ? "用来理解关键干系人状态、沟通重点和预期管理。"
                : "Useful for understanding stakeholder signals and communication focus."
            }
            isZh={isZh}
            loading={stakeholderInsight.loading}
            onRefresh={() => {
              void stakeholderInsight.refresh(true);
            }}
            title={isZh ? "AI 干系人摘要" : "AI Stakeholder Summary"}
          />
        </div>
      </div>

      {memory?.stale ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">
                {isZh ? "这份项目记忆可能已经过期" : "This project memory may be out of date"}
              </div>
              <div className="mt-1 text-amber-800">
                {isZh
                  ? "项目近期发生了变化。你现在看到的内容仍可参考，但建议重建后再用于正式判断。"
                  : "The project changed recently. This memory is still useful, but rebuilding it is recommended before relying on it for decisions."}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
          <div>
            <div className="text-xs font-medium text-gray-500">
              {isZh ? "异步状态" : "Async Status"}
            </div>
            <div className="mt-1 font-semibold text-gray-900">{rebuildStatusText}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500">
              {isZh ? "最近触发" : "Last Trigger"}
            </div>
            <div className="mt-1 font-semibold text-gray-900">{lastTrigger}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500">
              {isZh ? "最近失败" : "Last Failed"}
            </div>
            <div className="mt-1 font-semibold text-gray-900">
              {formatProjectMemoryUpdatedAt(memoryMeta?.memory_rebuild_failed_at, isZh)}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold text-gray-950">
              <Clock3 className="h-4 w-4 text-indigo-600" />
              {isZh ? "记忆历史版本" : "Memory history"}
            </div>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              {isZh
                ? "每次项目记忆重建或回滚都会保留快照，方便追踪 AI 记忆变化，并在摘要跑偏时恢复到上一版。"
                : "Every rebuild or rollback keeps a snapshot, so you can audit memory changes and restore a previous version if needed."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshSnapshots()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
          >
            {isZh ? "刷新历史" : "Refresh history"}
          </button>
        </div>

        {snapshots.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {snapshots.slice(0, 6).map((snapshot) => {
              const isCurrent = snapshot.memory_version === (memory?.memory_version ?? project.memory_version);
              const isRollingBack = isRollingBackSnapshotId === snapshot.id;
              return (
                <div key={snapshot.id} className="rounded-xl border border-indigo-100 bg-white/85 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-950">
                        {isZh ? `版本 ${snapshot.memory_version}` : `Version ${snapshot.memory_version}`}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{formatProjectMemoryUpdatedAt(snapshot.created_at, isZh)}</div>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
                        {isZh ? "当前" : "Current"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                    {isZh ? "触发" : "Trigger"}: {snapshot.trigger || "-"}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void loadSnapshotDiff(snapshot)}
                      disabled={diffLoadingSnapshotId === snapshot.id}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-wait disabled:text-gray-400"
                    >
                      {diffLoadingSnapshotId === snapshot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
                      {isZh ? "查看变化" : "View diff"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRollbackConfirmSnapshot(snapshot)}
                      disabled={isCurrent || isRollingBack}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                    >
                      {isRollingBack ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                      {isZh ? "恢复到这一版" : "Restore this version"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-indigo-200 bg-white/70 p-4 text-sm text-gray-500">
            {isZh ? "暂无记忆历史。下一次刷新项目记忆后会自动生成快照。" : "No memory history yet. The next rebuild will create a snapshot automatically."}
          </div>
        )}
        {snapshotDiff ? (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-950">
                  {isZh
                    ? `版本 ${snapshotDiff.from_snapshot.memory_version} 与当前版本 ${snapshotDiff.to.memory_version} 的变化`
                    : `Version ${snapshotDiff.from_snapshot.memory_version} vs current ${snapshotDiff.to.memory_version}`}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {isZh ? `变化字段 ${snapshotDiff.summary.changed} 个，未变化 ${snapshotDiff.summary.unchanged} 个。` : `${snapshotDiff.summary.changed} changed fields, ${snapshotDiff.summary.unchanged} unchanged.`}
                </p>
              </div>
              <button type="button" onClick={() => setSnapshotDiff(null)} className="text-sm font-medium text-indigo-700 hover:text-indigo-900">
                {isZh ? "收起" : "Collapse"}
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {snapshotDiff.fields.length ? (
                snapshotDiff.fields.slice(0, 8).map((field) => (
                  <div key={field.field} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="text-xs font-semibold text-gray-500">{field.label}</div>
                    {field.kind === "list" ? (
                      <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                        <div className="rounded-md bg-emerald-50 p-2 text-emerald-800">
                          <div className="text-xs font-semibold">{isZh ? "新增" : "Added"}</div>
                          <div className="mt-1 whitespace-pre-wrap">{(field.added || []).map(formatDiffValue).join("\n") || (isZh ? "无" : "None")}</div>
                        </div>
                        <div className="rounded-md bg-rose-50 p-2 text-rose-800">
                          <div className="text-xs font-semibold">{isZh ? "移除" : "Removed"}</div>
                          <div className="mt-1 whitespace-pre-wrap">{(field.removed || []).map(formatDiffValue).join("\n") || (isZh ? "无" : "None")}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                        <div className="rounded-md bg-rose-50 p-2 text-rose-800">
                          <div className="text-xs font-semibold">{isZh ? "旧版本" : "Before"}</div>
                          <div className="mt-1 whitespace-pre-wrap">{formatDiffValue(field.before)}</div>
                        </div>
                        <div className="rounded-md bg-emerald-50 p-2 text-emerald-800">
                          <div className="text-xs font-semibold">{isZh ? "当前版本" : "Current"}</div>
                          <div className="mt-1 whitespace-pre-wrap">{formatDiffValue(field.after)}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">{isZh ? "这个快照与当前记忆没有可见差异。" : "No visible differences from current memory."}</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {rollbackConfirmSnapshot ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-amber-100 p-2 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-950">{isZh ? "确认恢复项目记忆？" : "Restore project memory?"}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {isZh
                    ? `将恢复到版本 ${rollbackConfirmSnapshot.memory_version}，系统会生成一个新的当前版本，历史快照仍会保留。`
                    : `This restores version ${rollbackConfirmSnapshot.memory_version} and creates a new current version. Existing snapshots remain available.`}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRollbackConfirmSnapshot(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void rollbackSnapshot(rollbackConfirmSnapshot)}
                disabled={isRollingBackSnapshotId === rollbackConfirmSnapshot.id}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-indigo-300"
              >
                {isRollingBackSnapshotId === rollbackConfirmSnapshot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isZh ? "确认恢复" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DetailCard icon={Brain} title={isZh ? "项目概况" : "Project Brief"}>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-gray-500">
                {isZh ? "核心摘要" : "Core Summary"}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-gray-700">
                {memory?.project_brief || (isZh ? "暂无项目概况" : "No project brief yet")}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500">
                {isZh ? "当前目标" : "Current Objective"}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-gray-700">
                {memory?.current_objective || (isZh ? "暂无当前目标" : "No current objective yet")}
              </div>
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={Clock3} title={isZh ? "近期进展与下一步" : "Recent Progress & Next Steps"}>
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">
                {isZh ? "近期进展" : "Recent Progress"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无近期进展" : "No recent progress yet."}
                items={memory?.recent_progress || []}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">
                {isZh ? "下一步动作" : "Next Actions"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无下一步动作" : "No next actions yet."}
                items={memory?.next_actions || []}
              />
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={ShieldAlert} title={isZh ? "风险与待确认问题" : "Risks & Open Questions"}>
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">
                {isZh ? "关键风险" : "Key Risks"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无关键风险" : "No key risks yet."}
                items={memory?.key_risks || []}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">
                {isZh ? "待确认问题" : "Open Questions"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无待确认问题" : "No open questions yet."}
                items={memory?.open_questions || []}
              />
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={FileText} title={isZh ? "重要文档与财务状态" : "Documents & Financial Status"}>
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">
                {isZh ? "重要文档" : "Important Documents"}
              </div>
              {memory?.important_documents?.length ? (
                <div className="space-y-3">
                  {memory.important_documents.map((document, index) => (
                    <div key={`${document.name}-${index}`} className="rounded-lg bg-gray-50 p-3">
                      <div className="text-sm font-medium text-gray-900">{document.name}</div>
                      <div className="mt-1 text-sm text-gray-600">{document.reason}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">
                  {isZh ? "暂无重要文档线索" : "No important document signals yet."}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">
                {isZh ? "财务状态" : "Financial Status"}
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">
                {memory?.financial_status || (isZh ? "暂无财务状态" : "No financial status yet.")}
              </div>
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={Target} title={isZh ? "交付信号" : "Delivery Signals"}>
          <SectionList
            emptyText={isZh ? "暂无交付信号" : "No delivery signals yet."}
            items={memory?.delivery_signals || []}
          />
        </DetailCard>

        <DetailCard icon={Users} title={isZh ? "干系人备注" : "Stakeholder Notes"}>
          <SectionList
            emptyText={isZh ? "暂无干系人备注" : "No stakeholder notes yet."}
            items={memory?.stakeholder_notes || []}
          />
        </DetailCard>
      </div>

      <StakeholderManagementCard
        client={linkedClient}
        clientMemory={clientMemory}
        isZh={isZh}
        memory={memory}
        onOpenClientMemory={() => {
          if (linkedClient) navigate(`/clients/${linkedClient.id}/memory`);
        }}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <ProjectMemorySlotCard
          description={isZh ? "固定必须长期保留的风险判断。" : "Pin the risk calls that should stay over time."}
          isZh={isZh}
          onSaved={(nextMemory) => {
            setMemory(nextMemory)
            void Promise.all([
              overviewInsight.refresh(true),
              riskInsight.refresh(true),
              stakeholderInsight.refresh(true),
            ])
          }}
          projectId={projectId}
          slotDetail={memory?.key_risks_detail}
          slotKey="key_risks"
          title={isZh ? "固定风险要点" : "Pinned Risk Notes"}
        />
        <ProjectMemorySlotCard
          description={isZh ? "固定必须持续跟踪的开放问题。" : "Pin the open questions that must stay visible."}
          isZh={isZh}
          onSaved={(nextMemory) => {
            setMemory(nextMemory)
            void Promise.all([
              overviewInsight.refresh(true),
              riskInsight.refresh(true),
              stakeholderInsight.refresh(true),
            ])
          }}
          projectId={projectId}
          slotDetail={memory?.open_questions_detail}
          slotKey="open_questions"
          title={isZh ? "固定开放问题" : "Pinned Open Questions"}
        />
        <ProjectMemorySlotCard
          description={isZh ? "固定关键干系人的偏好和沟通提醒。" : "Pin stakeholder preferences and communication reminders."}
          isZh={isZh}
          onSaved={(nextMemory) => {
            setMemory(nextMemory)
            void Promise.all([
              overviewInsight.refresh(true),
              riskInsight.refresh(true),
              stakeholderInsight.refresh(true),
            ])
          }}
          projectId={projectId}
          slotDetail={memory?.stakeholder_notes_detail}
          slotKey="stakeholder_notes"
          title={isZh ? "固定干系人提示" : "Pinned Stakeholder Notes"}
        />
      </div>
    </div>
  );
}
