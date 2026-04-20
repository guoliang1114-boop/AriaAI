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
  Loader2,
  Save,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import { api } from "../../api/client";
import type {
  ClientMemoryResponse,
  ProjectDetail as ProjectDetailType,
  ProjectMemoryEditableSlot,
  ProjectMemory,
  ProjectMemoryResponse,
  ProjectMember,
} from "../../types/api";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { ProjectOverviewMemoryCard } from "./ProjectOverviewMemoryCard";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";
import { useProjectMemorySummary } from "./useProjectMemorySummary";

interface ProjectMemoryTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
}

interface ClientSummary {
  id: number;
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
  isZh,
  members,
  memory,
  onManageMembers,
}: {
  isZh: boolean;
  members: ProjectMember[];
  memory: ProjectMemory | null;
  onManageMembers: () => void;
}) {
  const pinnedNotes = memory?.stakeholder_notes_detail?.pinned || [];
  const aiNotes = memory?.stakeholder_notes_detail?.ai || memory?.stakeholder_notes || [];
  const hasStakeholderCoverage = members.length > 0 && pinnedNotes.length > 0;

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
                  ? "把成员、沟通提醒和 AI 观察放在一起，方便判断下一步对齐动作。"
                  : "Combine members, communication reminders, and AI observations for the next alignment move."}
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onManageMembers}
          className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
        >
          {isZh ? "管理成员" : "Manage Members"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white/80 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{isZh ? "项目成员" : "Members"}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{members.length}</div>
          <div className="mt-2 text-sm text-gray-600">
            {members.length
              ? members.slice(0, 3).map((member) => member.user.display_name).join(" / ")
              : isZh
                ? "还没有维护项目成员"
                : "No project members yet"}
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white/80 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{isZh ? "固定沟通提示" : "Pinned reminders"}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{pinnedNotes.length}</div>
          <p className="mt-2 text-sm text-gray-600">
            {pinnedNotes.length
              ? pinnedNotes[0]
              : isZh
                ? "建议固定关键人的偏好、禁区和跟进节奏"
                : "Pin preferences, sensitivities, and follow-up cadence"}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white/80 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{isZh ? "分析结论" : "Analysis"}</div>
          <p className="mt-2 text-sm text-gray-700">
            {hasStakeholderCoverage
              ? isZh
                ? "干系人信息已有基础覆盖，下一步应围绕固定提示安排沟通。"
                : "Stakeholder coverage exists. Use pinned reminders to plan the next touchpoint."
              : members.length
                ? isZh
                  ? "已有成员，但缺少长期沟通提示，建议从 AI 建议中挑选并固定。"
                  : "Members exist, but long-term reminders are missing. Promote useful AI notes to pinned items."
                : isZh
                  ? "缺少成员和关键联系人，建议先补齐项目干系人。"
                  : "Members and key contacts are missing. Add stakeholders first."}
          </p>
        </div>
      </div>

      {aiNotes.length ? (
        <div className="mt-4 rounded-xl border border-gray-100 bg-white/70 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{isZh ? "AI 干系人观察" : "AI stakeholder observations"}</div>
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

function EditableSlotCard({
  title,
  description,
  slotKey,
  slotDetail,
  isZh,
  projectId,
  onSaved,
}: {
  title: string
  description: string
  slotKey: "key_risks" | "open_questions" | "stakeholder_notes"
  slotDetail?: ProjectMemoryEditableSlot
  isZh: boolean
  projectId: string
  onSaved: (memory: ProjectMemoryResponse["memory"]) => void
}) {
  const [value, setValue] = useState((slotDetail?.pinned || []).join("\n"))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue((slotDetail?.pinned || []).join("\n"))
  }, [slotDetail?.pinned])

  const handleSave = async () => {
    try {
      setSaving(true)
      const response = await api.patch<{ memory: ProjectMemory }>(`/projects/${projectId}/memory/slots/${slotKey}`, {
        pinned: value
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      })
      onSaved(response.memory)
    } catch (error) {
      console.error(`Failed to update ${slotKey}:`, error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isZh ? "保存" : "Save"}
        </button>
      </div>

      {slotDetail?.ai?.length ? (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {isZh ? "AI 建议" : "AI suggestions"}
          </div>
          <ul className="mt-2 space-y-2 text-sm text-gray-700">
            {slotDetail.ai.map((item, index) => (
              <li key={`${item}-${index}`} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          {isZh ? "固定内容（每行一条）" : "Pinned items (one per line)"}
        </div>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={6}
          className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          placeholder={isZh ? "输入希望长期保留的要点，每行一条。" : "Add the items that should stay pinned, one per line."}
        />
      </div>
    </div>
  )
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
      await Promise.all([
        overviewInsight.refresh(true),
        riskInsight.refresh(true),
        stakeholderInsight.refresh(true),
      ]);
    } finally {
      setIsRebuildingMemory(false);
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
  }, [projectId]);

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
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "当前阶段" : "Current Stage"}
            </div>
            <div className="mt-2 text-lg font-semibold text-gray-900">
              {memory?.current_stage || project.status}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "当前目标" : "Current Objective"}
            </div>
            <div className="mt-2 text-sm leading-relaxed text-gray-900">
              {memory?.current_objective || (isZh ? "暂未明确当前目标" : "No objective yet")}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "记忆更新时间" : "Memory Updated"}
            </div>
            <div className="mt-2 text-sm font-medium text-gray-900">{memoryUpdatedText}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
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
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "异步状态" : "Async Status"}
            </div>
            <div className="mt-1 font-semibold text-gray-900">{rebuildStatusText}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "最近触发" : "Last Trigger"}
            </div>
            <div className="mt-1 font-semibold text-gray-900">{lastTrigger}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "最近失败" : "Last Failed"}
            </div>
            <div className="mt-1 font-semibold text-gray-900">
              {formatProjectMemoryUpdatedAt(memoryMeta?.memory_rebuild_failed_at, isZh)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DetailCard icon={Brain} title={isZh ? "项目概况" : "Project Brief"}>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "核心摘要" : "Core Summary"}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-gray-700">
                {memory?.project_brief || (isZh ? "暂无项目概况" : "No project brief yet")}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
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
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "近期进展" : "Recent Progress"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无近期进展" : "No recent progress yet."}
                items={memory?.recent_progress || []}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
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
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "关键风险" : "Key Risks"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无关键风险" : "No key risks yet."}
                items={memory?.key_risks || []}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
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
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
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
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
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
        isZh={isZh}
        members={members}
        memory={memory}
        onManageMembers={() => navigate(`/projects/${projectId}/settings`)}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <EditableSlotCard
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
        <EditableSlotCard
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
        <EditableSlotCard
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
