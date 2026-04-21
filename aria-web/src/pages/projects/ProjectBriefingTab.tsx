import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, FileText, Loader2, MessageSquare, RefreshCw, Users } from "lucide-react";
import { api } from "../../api/client";
import type { ProjectDetail, ProjectMeetingBriefing } from "../../types/api";

interface ProjectBriefingTabProps {
  projectDetail: ProjectDetail;
  projectId: string;
}

function BriefingSection({
  title,
  items,
  emptyText,
  tone = "default",
}: {
  title: string;
  items: string[];
  emptyText: string;
  tone?: "default" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-gray-200 bg-white text-gray-900";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-sm font-semibold">{title}</div>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current opacity-50" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 text-sm opacity-70">{emptyText}</div>
      )}
    </div>
  );
}

function formatDate(value?: string | null, isZh = true) {
  if (!value) return isZh ? "未设置日期" : "No date";
  return new Date(value).toLocaleDateString(isZh ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatPromptSection(title: string, items: string[]) {
  if (!items.length) return `${title}\n- 暂无`;
  return `${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
}

export function ProjectBriefingTab({ projectDetail, projectId }: ProjectBriefingTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const [briefing, setBriefing] = useState<ProjectMeetingBriefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadBriefing = async () => {
    setIsLoading(true);
    setError("");
    try {
      const data = await api.get<ProjectMeetingBriefing>(`/projects/${projectId}/briefing`);
      setBriefing(data);
    } catch (err) {
      console.error("Failed to load project briefing:", err);
      setError(isZh ? "加载会前简报失败，请稍后重试。" : "Failed to load briefing. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBriefing();
  }, [projectId]);

  const project = briefing?.project ?? projectDetail.project;
  const generatedAt = briefing?.generated_at
    ? new Date(briefing.generated_at).toLocaleString(isZh ? "zh-CN" : "en-US")
    : "";
  const openChatWithBriefing = () => {
    if (!briefing) return;
    const prompt = [
      `请基于这张会前简报，帮我准备一份面向客户会议的沟通话术和会议推进计划。`,
      `项目：${briefing.project.name}`,
      `客户：${briefing.project.client}`,
      formatPromptSection("建议说什么", briefing.meeting_card.say),
      formatPromptSection("需要避开什么", briefing.meeting_card.avoid),
      formatPromptSection("需要确认的问题", briefing.meeting_card.confirm),
      formatPromptSection("历史经验提醒", briefing.meeting_card.experience),
      "请输出：1）开场话术；2）关键议题顺序；3）每个关键人应关注的表达方式；4）会后行动清单。",
    ].join("\n\n");
    const params = new URLSearchParams({ q: prompt });
    navigate(`/projects/${projectId}/chat?${params.toString()}`);
  };

  if (isLoading && !briefing) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {isZh ? "会议前 30 秒" : "30-second pre-meeting"}
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-gray-950">
              {isZh ? "会前简报" : "Meeting Briefing"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
              {isZh
                ? "基于项目记忆、客户记忆、结构化干系人、待办和里程碑生成，不额外调用模型，适合会议前快速扫一眼。"
                : "Assembled from project memory, client memory, structured stakeholders, todos, and milestones without an extra model call."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadBriefing()}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isZh ? "刷新简报" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={openChatWithBriefing}
            disabled={!briefing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
          >
            <MessageSquare className="h-4 w-4" />
            {isZh ? "带着简报开启对话" : "Open chat with briefing"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-gray-50 p-4">
            <div className="text-xs text-gray-500">{isZh ? "项目" : "Project"}</div>
            <div className="mt-1 truncate text-sm font-semibold text-gray-900">{project.name}</div>
          </div>
          <div className="rounded-2xl bg-gray-50 p-4">
            <div className="text-xs text-gray-500">{isZh ? "客户" : "Client"}</div>
            <div className="mt-1 truncate text-sm font-semibold text-gray-900">{project.client || "-"}</div>
          </div>
          <div className="rounded-2xl bg-gray-50 p-4">
            <div className="text-xs text-gray-500">{isZh ? "阶段" : "Stage"}</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">{project.status}</div>
          </div>
          <div className="rounded-2xl bg-gray-50 p-4">
            <div className="text-xs text-gray-500">{isZh ? "生成时间" : "Generated"}</div>
            <div className="mt-1 truncate text-sm font-semibold text-gray-900">{generatedAt || "-"}</div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BriefingSection
          title={isZh ? "这次建议说什么" : "What to say"}
          items={briefing?.meeting_card.say ?? []}
          emptyText={isZh ? "暂无明确建议，可先刷新项目记忆。" : "No clear talking points yet. Refresh project memory first."}
          tone="success"
        />
        <BriefingSection
          title={isZh ? "这次尽量避开什么" : "What to avoid"}
          items={briefing?.meeting_card.avoid ?? []}
          emptyText={isZh ? "暂无敏感点或风险禁区。" : "No sensitivities or avoid-list items yet."}
          tone="warning"
        />
        <BriefingSection
          title={isZh ? "需要确认的问题" : "What to confirm"}
          items={briefing?.meeting_card.confirm ?? []}
          emptyText={isZh ? "暂无开放问题。" : "No open questions yet."}
        />
        <BriefingSection
          title={isZh ? "历史经验提醒" : "Lessons from history"}
          items={briefing?.meeting_card.experience ?? []}
          emptyText={isZh ? "暂无客户历史经验沉淀。" : "No client lessons captured yet."}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Users className="h-4 w-4 text-primary" />
            {isZh ? "关键客户侧干系人" : "Key client stakeholders"}
          </div>
          {briefing?.stakeholders.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {briefing.stakeholders.map((stakeholder, index) => (
                <div key={`${stakeholder.name}-${index}`} className="rounded-2xl bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-950">{stakeholder.name || (isZh ? "未命名" : "Unnamed")}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {[stakeholder.role, stakeholder.influence_type, stakeholder.relationship_status].filter(Boolean).join(" / ") || "-"}
                      </div>
                    </div>
                    {stakeholder.relationship_status ? (
                      <span className="rounded-full bg-white px-2 py-1 text-xs text-gray-600">{stakeholder.relationship_status}</span>
                    ) : null}
                  </div>
                  {stakeholder.concerns ? <p className="mt-3 text-sm leading-6 text-gray-700">{stakeholder.concerns}</p> : null}
                  {stakeholder.last_action ? <p className="mt-2 text-xs text-gray-500">{stakeholder.last_action}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">
              {isZh ? "暂无结构化干系人。建议先在干系人页补齐关键客户联系人。" : "No structured stakeholders yet. Add key client contacts on the Stakeholders page."}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Clock3 className="h-4 w-4 text-primary" />
              {isZh ? "近期节奏" : "Near-term cadence"}
            </div>
            <div className="space-y-3">
              {(briefing?.signals.upcoming_milestones ?? []).map((item) => (
                <div key={`milestone-${item.id}`} className="rounded-2xl bg-gray-50 p-3 text-sm">
                  <div className="font-medium text-gray-900">{item.title}</div>
                  <div className="mt-1 text-xs text-gray-500">{formatDate(item.due_date, isZh)} · {item.priority}</div>
                </div>
              ))}
              {(briefing?.signals.pending_todos ?? []).map((item) => (
                <div key={`todo-${item.id}`} className="rounded-2xl bg-gray-50 p-3 text-sm">
                  <div className="font-medium text-gray-900">{item.content}</div>
                  <div className="mt-1 text-xs text-gray-500">{formatDate(item.due_date, isZh)}</div>
                </div>
              ))}
              {!briefing?.signals.upcoming_milestones.length && !briefing?.signals.pending_todos.length ? (
                <div className="rounded-2xl bg-gray-50 p-3 text-sm text-gray-500">
                  {isZh ? "暂无近期里程碑或待办。" : "No near-term milestones or todos."}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <FileText className="h-4 w-4 text-primary" />
              {isZh ? "最近资料" : "Recent documents"}
            </div>
            <div className="space-y-3">
              {(briefing?.signals.recent_documents ?? []).map((item) => (
                <div key={`doc-${item.id}`} className="rounded-2xl bg-gray-50 p-3 text-sm">
                  <div className="font-medium text-gray-900">{item.name}</div>
                  {item.summary ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{item.summary}</div> : null}
                </div>
              ))}
              {!briefing?.signals.recent_documents.length ? (
                <div className="rounded-2xl bg-gray-50 p-3 text-sm text-gray-500">
                  {isZh ? "暂无最近资料。" : "No recent documents."}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {(briefing?.project.memory_stale || briefing?.client.memory_stale) ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-semibold">{isZh ? "记忆可能不是最新" : "Memory may be stale"}</div>
            <div className="mt-1">
              {isZh
                ? "当前简报仍可参考，但建议在重要会议前刷新项目记忆或客户记忆。"
                : "This briefing is still useful, but refresh project or client memory before important meetings."}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4" />
          {isZh ? "项目和客户记忆当前没有标记为过期。" : "Project and client memory are not marked stale."}
        </div>
      )}
    </div>
  );
}
