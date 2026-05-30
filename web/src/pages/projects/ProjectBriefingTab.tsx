import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, ExternalLink, FileText, Loader2, MessageSquare, RefreshCw, Sparkles, Users } from "lucide-react";
import { api } from "../../api/client";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { ProjectDetail, ProjectMeetingBriefing, ProjectMeetingBriefingRefineResponse } from "../../types/api";
import { resolveProjectStage } from "../../types/enums";
import { useAppTimeZone } from "../../hooks/useAppTimeZone";
import { formatDateOnly, formatDateTime as formatWithTimeZone } from "../../utils/timezone";

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
      ? "border-codex-line bg-codex-bg-tint/70 text-codex-warn"
      : tone === "success"
        ? "border-codex-line bg-codex-accent-bg/70 text-codex-good"
        : "border-codex-line bg-white text-codex-ink";

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
    return <div className="rounded-lg bg-codex-bg-tint px-3 py-2 text-sm text-codex-ink-mute">{emptyText}</div>;
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

  const project = briefing?.project ?? projectDetail.project;
  const stage = resolveProjectStage(project.status);
  const StageIcon = stage.icon;
  const generatedAt = briefing?.generated_at
    ? formatWithTimeZone(briefing.generated_at, isZh ? "zh-CN" : "en-US", undefined, resolvedTimeZone)
    : "";
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
          meeting_type: "status",
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
      "请基于这张会前简报，帮我准备一份面向客户会议的沟通话术和会议推进计划。",
      "默认场景：项目例会，重点是同步进展、识别风险、确认问题和明确会后行动。",
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
        <Loader2 className="h-8 w-8 animate-spin text-codex-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-codex-line bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-codex-line-soft bg-gradient-to-r from-blue-50 via-white to-emerald-50 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-codex-ink-mute">
              <span>{isZh ? "会前简报" : "Meeting briefing"}</span>
              {generatedAt ? (
                <>
                  <span>/</span>
                  <span>{generatedAt}</span>
                </>
              ) : null}
            </div>
            <h2 className="mt-1 truncate text-xl font-semibold text-codex-ink">
              {isZh ? "30 秒会前卡" : "30-second meeting card"}
            </h2>
            <p className="mt-1 text-sm text-codex-ink-mute">
              {isZh ? "默认聚焦项目例会：先看要说什么，再确认风险和下一步。" : "Focused on status meetings: talking points, risks, and next steps first."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onClick={() => void loadBriefing()}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-codex-line bg-white px-3 py-2 text-sm font-medium text-codex-ink-soft hover:bg-codex-bg-tint disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {isZh ? "刷新" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void refineBriefing(false)}
              disabled={isRefining || !briefing}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/20 bg-codex-accent/5 px-3 py-2 text-sm font-medium text-codex-accent hover:bg-codex-accent/10 disabled:opacity-60"
            >
              {isRefining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {refinedBriefing ? (isZh ? "更新话术" : "Update script") : isZh ? "生成话术" : "Draft script"}
            </button>
            <button
              type="button"
              onClick={openChatWithBriefing}
              disabled={!briefing}
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md bg-codex-accent px-3 py-2 text-sm font-medium text-white hover:bg-codex-accent/90 disabled:opacity-60 sm:col-span-1"
            >
              <MessageSquare className="h-4 w-4" />
              {isZh ? "去对话准备" : "Prepare in chat"}
            </button>
          </div>
        </div>
        {error ? (
          <div className="m-4 rounded-md border border-codex-line bg-codex-bg-tint px-3 py-2 text-sm text-codex-warn">{error}</div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)]">
        <main className="space-y-4">
          <section className="rounded-lg border border-codex-line bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-codex-ink">{isZh ? "打开就看这四件事" : "Start with these four"}</div>
                <p className="mt-1 text-sm text-codex-ink-mute">
                  {isZh ? "不再选择会议类型，先把最重要的沟通动作摆在前面。" : "No meeting-type setup. The key meeting moves stay upfront."}
                </p>
              </div>
              {(briefing?.project.memory_stale || briefing?.client.memory_stale) ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-codex-line bg-codex-bg-tint px-2.5 py-1 text-xs font-medium text-codex-warn">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {isZh ? "记忆可能过期" : "Memory stale"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-codex-line bg-codex-accent-bg px-2.5 py-1 text-xs font-medium text-codex-good">
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
            <div className="rounded-lg border border-codex-line bg-codex-bg-tint px-3 py-2 text-sm text-codex-warn">{refineError}</div>
          ) : null}

          {refinedBriefing ? (
            <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-white via-white to-primary/[0.03] p-6 shadow-sm ring-1 ring-primary/5">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-codex-accent/5 blur-3xl"
              />
              <div className="relative mb-4 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-codex-ink">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-codex-accent/10 text-codex-accent">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  {isZh ? "可直接使用的话术" : "Ready-to-use script"}
                </div>
                <span className="rounded-md bg-codex-bg-tint px-2 py-0.5 text-xs text-codex-ink-soft">
                  {refinedBriefing.cached ? (isZh ? "缓存命中" : "Cache hit") : isZh ? "刚刚生成" : "Generated"}
                </span>
                {refinedGeneratedAt ? <span className="text-xs text-codex-ink-faint">{refinedGeneratedAt}</span> : null}
                <button
                  type="button"
                  onClick={() => void refineBriefing(true)}
                  disabled={isRefining}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-codex-line bg-white/70 px-2.5 py-1 text-xs font-medium text-codex-ink-soft transition hover:bg-white disabled:opacity-60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {isZh ? "重新生成" : "Regenerate"}
                </button>
              </div>
              <div className="briefing-script md-root relative">
                <MarkdownRenderer content={refinedBriefing.content} />
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-codex-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-codex-ink">
              <Users className="h-4 w-4 text-codex-accent" />
              {isZh ? "关键干系人" : "Key stakeholders"}
            </div>
            {briefing?.stakeholders.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {briefing.stakeholders.map((stakeholder, index) => (
                  <div key={`${stakeholder.name}-${index}`} className="rounded-lg bg-codex-bg-tint p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-codex-ink">{stakeholder.name || (isZh ? "未命名" : "Unnamed")}</div>
                        <div className="mt-1 truncate text-xs text-codex-ink-mute">
                          {[stakeholder.role, stakeholder.influence_type, stakeholder.relationship_status].filter(Boolean).join(" / ") || "-"}
                        </div>
                      </div>
                      {stakeholder.relationship_status ? (
                        <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs text-codex-ink-soft">{stakeholder.relationship_status}</span>
                      ) : null}
                    </div>
                    {stakeholder.concerns ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-codex-ink-soft">{stakeholder.concerns}</p> : null}
                    {stakeholder.last_action ? <p className="mt-2 text-xs text-codex-ink-mute">{stakeholder.last_action}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg bg-codex-bg-tint p-3 text-sm text-codex-ink-mute">
                {isZh ? "暂无结构化干系人。建议先在干系人页补齐关键客户联系人。" : "No structured stakeholders yet."}
              </div>
            )}
          </section>
        </main>

        <aside className="space-y-4">
          <section className="rounded-lg border border-codex-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-codex-ink">
              <CalendarDays className="h-4 w-4 text-codex-accent" />
              {isZh ? "项目上下文" : "Project context"}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-codex-ink-mute">{isZh ? "项目" : "Project"}</span>
                <span className="truncate font-medium text-codex-ink">{project.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-codex-ink-mute">{isZh ? "客户" : "Client"}</span>
                <span className="truncate font-medium text-codex-ink">{project.client || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-codex-ink-mute">{isZh ? "阶段" : "Stage"}</span>
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${stage.bgColor} ${stage.color} ${stage.borderColor}`}>
                  <StageIcon className="h-3 w-3" />
                  {isZh ? stage.labelZh : stage.label}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-codex-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-codex-ink">
              <Clock3 className="h-4 w-4 text-codex-accent" />
              {isZh ? "近期节奏" : "Near-term cadence"}
            </div>
            <CompactSignalList
              emptyText={isZh ? "暂无近期里程碑或待办。" : "No near-term milestones or todos."}
              items={[...(briefing?.signals.upcoming_milestones ?? []), ...(briefing?.signals.pending_todos ?? [])]}
              renderItem={(item, index) => {
                const entry = item as { id: number; title?: string; content?: string; due_date?: string | null; priority?: string };
                return (
                  <div key={`cadence-${entry.id}-${index}`} className="rounded-lg bg-codex-bg-tint px-3 py-2 text-sm">
                    <div className="font-medium text-codex-ink">{entry.title || entry.content}</div>
                    <div className="mt-1 text-xs text-codex-ink-mute">
                      {formatDate(entry.due_date, isZh)}{entry.priority ? ` / ${entry.priority}` : ""}
                    </div>
                  </div>
                );
              }}
            />
          </section>

          <section className="rounded-lg border border-codex-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-codex-ink">
              <FileText className="h-4 w-4 text-codex-accent" />
              {isZh ? "资料依据" : "Evidence"}
            </div>
            <CompactSignalList
              emptyText={isZh ? "暂无项目笔记或最近对话片段。" : "No project notes or recent chat snippets yet."}
              items={briefing?.signals.communication_sources ?? []}
              renderItem={(item, index) => {
                const source = item as ProjectMeetingBriefing["signals"]["communication_sources"][number];
                return (
                  <div key={`source-${source.type}-${index}`} className="rounded-lg bg-codex-bg-tint px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-codex-ink">{source.label}</div>
                        {source.created_at ? (
                          <div className="mt-1 text-xs text-codex-ink-faint">{formatDateTime(source.created_at, isZh, resolvedTimeZone)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => openCommunicationSource(source)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-codex-accent hover:bg-codex-accent/5"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {isZh ? "打开" : "Open"}
                      </button>
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-codex-ink-mute">{source.excerpt}</div>
                  </div>
                );
              }}
            />
            {briefing?.signals.recent_documents.length ? (
              <div className="mt-3 border-t border-codex-line-soft pt-3">
                <div className="mb-2 text-xs font-medium text-codex-ink-mute">{isZh ? "最近资料" : "Recent documents"}</div>
                <div className="space-y-2">
                  {briefing.signals.recent_documents.slice(0, 3).map((doc) => (
                    <div key={`doc-${doc.id}`} className="rounded-lg bg-codex-bg-tint px-3 py-2 text-sm">
                      <div className="font-medium text-codex-ink">{doc.name}</div>
                      {doc.summary ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-codex-ink-mute">{doc.summary}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
