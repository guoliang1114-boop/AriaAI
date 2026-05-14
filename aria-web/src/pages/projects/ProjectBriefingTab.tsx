import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, ExternalLink, FileText, Loader2, MessageSquare, RefreshCw, Sparkles, Target, Users } from "lucide-react";
import { api } from "../../api/client";
import type { ProjectDetail, ProjectMeetingBriefing, ProjectMeetingBriefingRefineResponse } from "../../types/api";
import { resolveProjectStage } from "../../types/enums";
import { useAppTimeZone } from "../../hooks/useAppTimeZone";
import { formatDateOnly, formatDateTime as formatWithTimeZone } from "../../utils/timezone";

interface ProjectBriefingTabProps {
  projectDetail: ProjectDetail;
  projectId: string;
}

type MeetingTemplateId = "status" | "executive" | "risk" | "commercial";

const MEETING_TEMPLATES: Array<{
  id: MeetingTemplateId;
  zhLabel: string;
  enLabel: string;
  zhDescription: string;
  enDescription: string;
  zhPrompt: string;
  enPrompt: string;
}> = [
  {
    id: "status",
    zhLabel: "项目例会",
    enLabel: "Status meeting",
    zhDescription: "同步进展、问题和会后行动",
    enDescription: "Align progress, issues, and follow-up actions",
    zhPrompt: "请按项目例会场景输出：进展同步、风险说明、待确认问题、会后行动清单。",
    enPrompt: "For a status meeting, output progress updates, risks, questions to confirm, and follow-up actions.",
  },
  {
    id: "executive",
    zhLabel: "高层汇报",
    enLabel: "Executive briefing",
    zhDescription: "强调价值、决策和向上汇报口径",
    enDescription: "Emphasize value, decisions, and executive framing",
    zhPrompt: "请按高层汇报场景输出：开场价值陈述、关键决策点、量化收益表达、需要领导拍板的事项。",
    enPrompt: "For an executive briefing, output value framing, decision points, quantified benefits, and leadership asks.",
  },
  {
    id: "risk",
    zhLabel: "风险沟通",
    enLabel: "Risk alignment",
    zhDescription: "控制敏感点，推动阻塞事项",
    enDescription: "Handle sensitivities and unblock risks",
    zhPrompt: "请按风险沟通场景输出：风险分级、敏感表达方式、需要客户确认的边界、降风险行动。",
    enPrompt: "For risk alignment, output risk levels, careful wording, boundaries to confirm, and de-risking actions.",
  },
  {
    id: "commercial",
    zhLabel: "商务推进",
    enLabel: "Commercial push",
    zhDescription: "推进预算、采购、续约或回款",
    enDescription: "Move budget, procurement, renewal, or collection forward",
    zhPrompt: "请按商务推进场景输出：商务目标、采购/预算阻塞点、不同干系人的沟通重点、下一步推进路径。",
    enPrompt: "For a commercial discussion, output commercial goals, procurement or budget blockers, stakeholder messaging, and next steps.",
  },
];

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
      ? "border-amber-200 bg-amber-50/70 text-amber-950"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
        : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
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

function CompactSignalList({
  emptyText,
  items,
  renderItem,
}: {
  emptyText: string;
  items: Array<unknown>;
  renderItem: (item: unknown, index: number) => ReactNode;
}) {
  if (!items.length) {
    return <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{emptyText}</div>;
  }
  return <div className="space-y-2">{items.map(renderItem)}</div>;
}

function formatDate(value?: string | null, isZh = true) {
  if (!value) return isZh ? "未设置日期" : "No date";
  return formatDateOnly(value, {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value?: string | null, isZh = true, timeZone?: string) {
  if (!value) return "";
  return formatWithTimeZone(value, isZh ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }, timeZone);
}

function formatPromptSection(title: string, items: string[]) {
  if (!items.length) return `${title}\n- 暂无`;
  return `${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
}

export function ProjectBriefingTab({ projectDetail, projectId }: ProjectBriefingTabProps) {
  const { i18n } = useTranslation();
  const { resolvedTimeZone } = useAppTimeZone();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const [briefing, setBriefing] = useState<ProjectMeetingBriefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [meetingTemplateId, setMeetingTemplateId] = useState<MeetingTemplateId>("status");
  const [refinedBriefing, setRefinedBriefing] = useState<ProjectMeetingBriefingRefineResponse | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState("");

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
    setRefinedBriefing(null);
    setRefineError("");
    void loadBriefing();
  }, [projectId]);

  useEffect(() => {
    setRefinedBriefing(null);
    setRefineError("");
  }, [meetingTemplateId]);

  const project = briefing?.project ?? projectDetail.project;
  const stage = resolveProjectStage(project.status);
  const StageIcon = stage.icon;
  const generatedAt = briefing?.generated_at
    ? formatWithTimeZone(briefing.generated_at, isZh ? "zh-CN" : "en-US", undefined, resolvedTimeZone)
    : "";
  const selectedTemplate = MEETING_TEMPLATES.find((template) => template.id === meetingTemplateId) ?? MEETING_TEMPLATES[0];
  const refinedGeneratedAt = refinedBriefing?.generated_at
    ? formatWithTimeZone(refinedBriefing.generated_at, isZh ? "zh-CN" : "en-US", undefined, resolvedTimeZone)
    : "";
  const refineBriefing = async (forceRefresh = false) => {
    setIsRefining(true);
    setRefineError("");
    try {
      const data = await api.post<ProjectMeetingBriefingRefineResponse>(
        `/projects/${projectId}/briefing/refine`,
        {
          meeting_type: meetingTemplateId,
          language: isZh ? "zh" : "en",
          force_refresh: forceRefresh,
        },
        { timeout: 60000 },
      );
      setRefinedBriefing(data);
    } catch (err) {
      console.error("Failed to refine project briefing:", err);
      setRefineError(
        isZh
          ? "AI 精炼版生成失败，可能是模型繁忙或网络超时。确定性简报仍可继续使用。"
          : "Failed to generate the AI-refined briefing. The deterministic briefing is still usable.",
      );
    } finally {
      setIsRefining(false);
    }
  };
  const openChatWithBriefing = () => {
    if (!briefing) return;
    const prompt = [
      `请基于这张会前简报，帮我准备一份面向客户会议的沟通话术和会议推进计划。`,
      `会议类型：${isZh ? selectedTemplate.zhLabel : selectedTemplate.enLabel}`,
      isZh ? selectedTemplate.zhPrompt : selectedTemplate.enPrompt,
      `项目：${briefing.project.name}`,
      `客户：${briefing.project.client}`,
      formatPromptSection("建议说什么", briefing.meeting_card.say),
      formatPromptSection("需要避开什么", briefing.meeting_card.avoid),
      formatPromptSection("需要确认的问题", briefing.meeting_card.confirm),
      formatPromptSection("历史经验提醒", briefing.meeting_card.experience),
      formatPromptSection(
        "最近沟通来源",
        briefing.signals.communication_sources.map((source) => `${source.label}${source.role ? ` / ${source.role}` : ""}: ${source.excerpt}`),
      ),
      refinedBriefing?.content ? `AI 精炼版\n${refinedBriefing.content}` : "",
      "请输出：1）开场话术；2）关键议题顺序；3）每个关键人应关注的表达方式；4）会后行动清单。",
    ].filter(Boolean).join("\n\n");
    sessionStorage.setItem("briefing_prompt", prompt);
    sessionStorage.setItem("briefing_auto_send", "1");
    navigate(`/projects/${projectId}/chat?briefing=1`);
  };
  const openCommunicationSource = (source: ProjectMeetingBriefing["signals"]["communication_sources"][number]) => {
    if (source.target === "chat") {
      const params = new URLSearchParams();
      if (source.conversation_id) {
        params.set("conversation", String(source.conversation_id));
      }
      if (source.message_id) {
        params.set("message", String(source.message_id));
      }
      navigate(`/projects/${projectId}/chat${params.toString() ? `?${params.toString()}` : ""}`);
      return;
    }
    navigate(`/projects/${projectId}/space`);
  };

  if (isLoading && !briefing) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{isZh ? "会前简报" : "Meeting briefing"}</span>
              <span>/</span>
              <span>{isZh ? selectedTemplate.zhLabel : selectedTemplate.enLabel}</span>
              {generatedAt ? (
                <>
                  <span>/</span>
                  <span>{generatedAt}</span>
                </>
              ) : null}
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-950">
              {isZh ? "会议作战卡" : "Meeting battle card"}
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadBriefing()}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {isZh ? "刷新" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void refineBriefing(false)}
              disabled={isRefining || !briefing}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            >
              {isRefining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {refinedBriefing ? (isZh ? "读取精炼" : "Load refined") : isZh ? "AI 精炼" : "AI refine"}
            </button>
            <button
              type="button"
              onClick={openChatWithBriefing}
              disabled={!briefing}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              <MessageSquare className="h-4 w-4" />
              {isZh ? "带入对话" : "Open chat"}
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <main className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">{isZh ? "先看这四件事" : "Start with these four"}</div>
                <p className="mt-1 text-sm text-slate-500">
                  {isZh ? "直接用于会前 30 秒扫读。" : "Designed for a 30-second pre-meeting scan."}
                </p>
              </div>
              {(briefing?.project.memory_stale || briefing?.client.memory_stale) ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {isZh ? "记忆可能过期" : "Memory stale"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {isZh ? "记忆可用" : "Memory ready"}
                </span>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <BriefingSection
                title={isZh ? "建议说什么" : "Say"}
                items={briefing?.meeting_card.say ?? []}
                emptyText={isZh ? "暂无明确建议，可先刷新项目记忆。" : "No clear talking points yet."}
                tone="success"
              />
              <BriefingSection
                title={isZh ? "尽量避开什么" : "Avoid"}
                items={briefing?.meeting_card.avoid ?? []}
                emptyText={isZh ? "暂无敏感点或风险禁区。" : "No sensitivities captured yet."}
                tone="warning"
              />
              <BriefingSection
                title={isZh ? "需要确认的问题" : "Confirm"}
                items={briefing?.meeting_card.confirm ?? []}
                emptyText={isZh ? "暂无开放问题。" : "No open questions yet."}
              />
              <BriefingSection
                title={isZh ? "历史经验提醒" : "Lessons"}
                items={briefing?.meeting_card.experience ?? []}
                emptyText={isZh ? "暂无客户历史经验沉淀。" : "No client lessons captured yet."}
              />
            </div>
          </section>

          {refineError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{refineError}</div>
          ) : null}

          {refinedBriefing ? (
            <section className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  {isZh ? "AI 精炼版" : "AI refined"}
                </div>
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                  {refinedBriefing.cached ? (isZh ? "缓存命中" : "Cache hit") : isZh ? "刚刚生成" : "Generated"}
                </span>
                {refinedGeneratedAt ? <span className="text-xs text-slate-400">{refinedGeneratedAt}</span> : null}
                <button
                  type="button"
                  onClick={() => void refineBriefing(true)}
                  disabled={isRefining}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {isZh ? "重新精炼" : "Regenerate"}
                </button>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{refinedBriefing.content}</div>
            </section>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Users className="h-4 w-4 text-primary" />
              {isZh ? "关键干系人" : "Key stakeholders"}
            </div>
            {briefing?.stakeholders.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {briefing.stakeholders.map((stakeholder, index) => (
                  <div key={`${stakeholder.name}-${index}`} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-950">{stakeholder.name || (isZh ? "未命名" : "Unnamed")}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {[stakeholder.role, stakeholder.influence_type, stakeholder.relationship_status].filter(Boolean).join(" / ") || "-"}
                        </div>
                      </div>
                      {stakeholder.relationship_status ? (
                        <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs text-slate-600">{stakeholder.relationship_status}</span>
                      ) : null}
                    </div>
                    {stakeholder.concerns ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-700">{stakeholder.concerns}</p> : null}
                    {stakeholder.last_action ? <p className="mt-2 text-xs text-slate-500">{stakeholder.last_action}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                {isZh ? "暂无结构化干系人。建议先在干系人页补齐关键客户联系人。" : "No structured stakeholders yet."}
              </div>
            )}
          </section>
        </main>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Target className="h-4 w-4 text-primary" />
              {isZh ? "会议类型" : "Meeting type"}
            </div>
            <div className="grid gap-2">
              {MEETING_TEMPLATES.map((template) => {
                const active = template.id === meetingTemplateId;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setMeetingTemplateId(template.id)}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      active
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-sm font-semibold">{isZh ? template.zhLabel : template.enLabel}</div>
                    <div className={`mt-1 text-xs leading-5 ${active ? "text-primary/80" : "text-slate-500"}`}>
                      {isZh ? template.zhDescription : template.enDescription}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CalendarDays className="h-4 w-4 text-primary" />
              {isZh ? "项目上下文" : "Project context"}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">{isZh ? "项目" : "Project"}</span>
                <span className="truncate font-medium text-slate-900">{project.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">{isZh ? "客户" : "Client"}</span>
                <span className="truncate font-medium text-slate-900">{project.client || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">{isZh ? "阶段" : "Stage"}</span>
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${stage.bgColor} ${stage.color} ${stage.borderColor}`}>
                  <StageIcon className="h-3 w-3" />
                  {isZh ? stage.labelZh : stage.label}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Clock3 className="h-4 w-4 text-primary" />
              {isZh ? "近期节奏" : "Near-term cadence"}
            </div>
            <CompactSignalList
              emptyText={isZh ? "暂无近期里程碑或待办。" : "No near-term milestones or todos."}
              items={[...(briefing?.signals.upcoming_milestones ?? []), ...(briefing?.signals.pending_todos ?? [])]}
              renderItem={(item, index) => {
                const entry = item as { id: number; title?: string; content?: string; due_date?: string | null; priority?: string };
                return (
                  <div key={`cadence-${entry.id}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div className="font-medium text-slate-900">{entry.title || entry.content}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDate(entry.due_date, isZh)}{entry.priority ? ` / ${entry.priority}` : ""}
                    </div>
                  </div>
                );
              }}
            />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MessageSquare className="h-4 w-4 text-primary" />
              {isZh ? "证据来源" : "Evidence"}
            </div>
            <CompactSignalList
              emptyText={isZh ? "暂无项目笔记或最近对话片段。" : "No project notes or recent chat snippets yet."}
              items={briefing?.signals.communication_sources ?? []}
              renderItem={(item, index) => {
                const source = item as ProjectMeetingBriefing["signals"]["communication_sources"][number];
                return (
                  <div key={`source-${source.type}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{source.label}</div>
                        {source.created_at ? (
                          <div className="mt-1 text-xs text-slate-400">{formatDateTime(source.created_at, isZh, resolvedTimeZone)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => openCommunicationSource(source)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {isZh ? "打开" : "Open"}
                      </button>
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{source.excerpt}</div>
                  </div>
                );
              }}
            />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileText className="h-4 w-4 text-primary" />
              {isZh ? "最近资料" : "Recent documents"}
            </div>
            <CompactSignalList
              emptyText={isZh ? "暂无最近资料。" : "No recent documents."}
              items={briefing?.signals.recent_documents ?? []}
              renderItem={(item) => {
                const doc = item as ProjectMeetingBriefing["signals"]["recent_documents"][number];
                return (
                  <div key={`doc-${doc.id}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div className="font-medium text-slate-900">{doc.name}</div>
                    {doc.summary ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{doc.summary}</div> : null}
                  </div>
                );
              }}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
