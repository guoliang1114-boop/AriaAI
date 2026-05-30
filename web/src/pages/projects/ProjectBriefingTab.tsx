import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  User,
} from "lucide-react";
import { api } from "../../api/client";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type {
  ProjectDetail,
  ProjectMeetingBriefing,
  ProjectMeetingBriefingRefineResponse,
} from "../../types/api";
import { useAppTimeZone } from "../../hooks/useAppTimeZone";
import { formatDateOnly, formatDateTime as formatWithTimeZone } from "../../utils/timezone";
import { CxPanel } from "./ProjectOverviewPanels";

interface ProjectBriefingTabProps {
  projectDetail: ProjectDetail;
  projectId: string;
}

type Tone = "good" | "warn" | "info" | "neutral";

const TONE_INK: Record<Tone, string> = {
  good: "var(--color-codex-good)",
  warn: "var(--color-codex-warn)",
  info: "var(--color-codex-info, var(--color-codex-accent))",
  neutral: "var(--color-codex-ink-soft, var(--color-codex-ink))",
};

function MeetingCardSection({
  title,
  en,
  tone,
  items,
  emptyText,
}: {
  title: string;
  en: string;
  tone: Tone;
  items: string[];
  emptyText: string;
}) {
  const ink = TONE_INK[tone];
  return (
    <section
      style={{
        background: "var(--color-codex-bg-elev)",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-md, 8px)",
        padding: "16px 18px",
      }}
    >
      <div className="flex items-center" style={{ gap: 8, marginBottom: 12 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 99,
            background: ink,
            flexShrink: 0,
          }}
        />
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-codex-ink)",
          }}
        >
          {title}
        </h3>
        <span
          style={{
            fontSize: 11,
            color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
            marginLeft: 4,
          }}
        >
          {en}
        </span>
      </div>
      {items.length > 0 ? (
        <ul
          className="m-0 p-0"
          style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}
        >
          {items.map((item, i) => (
            <li
              key={`${title}-${i}`}
              className="flex"
              style={{
                gap: 10,
                fontSize: 13,
                color: "var(--color-codex-ink)",
                lineHeight: 1.6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: ink,
                  paddingTop: 2,
                  fontWeight: 600,
                  fontFamily: 'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  minWidth: 18,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--color-codex-ink-mute)",
            lineHeight: 1.6,
          }}
        >
          {emptyText}
        </p>
      )}
    </section>
  );
}

function HeroMeta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: 6,
        fontSize: 12,
        color: "var(--color-codex-ink-mute)",
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function HeroPrimaryButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        gap: 6,
        padding: "7px 12px",
        fontSize: 12.5,
        background: "var(--color-codex-ink)",
        color: "var(--color-codex-bg-elev)",
        border: "none",
        borderRadius: "var(--codex-r-sm, 6px)",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function HeroSecondaryButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        gap: 6,
        padding: "7px 12px",
        fontSize: 12.5,
        color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
        background: "var(--color-codex-bg-elev)",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-sm, 6px)",
      }}
    >
      {icon}
      {children}
    </button>
  );
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
      setError(isZh ? "加载会前简报失败,请稍后重试。" : "Failed to load briefing. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setRefinedBriefing(null);
    setRefineError("");
    void loadBriefing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const project = briefing?.project ?? projectDetail.project;
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
          ? "AI 话术生成失败,可能是模型繁忙或网络超时。卡片仍可继续使用。"
          : "Failed to generate the AI script. The card view is still usable.",
      );
    } finally {
      setIsRefining(false);
    }
  };

  const openChatWithBriefing = () => {
    if (!briefing) return;
    const prompt = [
      "请基于这张会前简报,帮我准备一份面向客户会议的沟通话术和会议推进计划。",
      "默认场景:项目例会,重点是同步进展、识别风险、确认问题和明确会后行动。",
      `项目:${briefing.project.name}`,
      `客户:${briefing.project.client}`,
      formatPromptSection("建议说什么", briefing.meeting_card.say),
      formatPromptSection("需要避开什么", briefing.meeting_card.avoid),
      formatPromptSection("需要确认的问题", briefing.meeting_card.confirm),
      formatPromptSection("历史经验提醒", briefing.meeting_card.experience),
      formatPromptSection(
        "最近沟通来源",
        briefing.signals.communication_sources.map(
          (source) => `${source.label}${source.role ? ` / ${source.role}` : ""}: ${source.excerpt}`,
        ),
      ),
      refinedBriefing?.content ? `AI 话术\n${refinedBriefing.content}` : "",
      "请输出:1)开场话术;2)关键议题顺序;3)每个关键人应关注的表达方式;4)会后行动清单。",
    ]
      .filter(Boolean)
      .join("\n\n");
    sessionStorage.setItem("briefing_prompt", prompt);
    sessionStorage.setItem("briefing_auto_send", "1");
    navigate(`/projects/${projectId}/chat?briefing=1`);
  };

  const openCommunicationSource = (
    source: ProjectMeetingBriefing["signals"]["communication_sources"][number],
  ) => {
    if (source.target === "chat") {
      const params = new URLSearchParams();
      if (source.conversation_id) params.set("conversation", String(source.conversation_id));
      if (source.message_id) params.set("message", String(source.message_id));
      navigate(
        `/projects/${projectId}/chat${params.toString() ? `?${params.toString()}` : ""}`,
      );
      return;
    }
    navigate(`/projects/${projectId}/documents`);
  };

  if (isLoading && !briefing) {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          minHeight: 360,
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 8px)",
        }}
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--color-codex-accent)" }} />
      </div>
    );
  }

  const memoryStale = Boolean(
    briefing?.project.memory_stale || briefing?.client.memory_stale,
  );

  return (
    <div
      className="grid gap-5"
      style={{
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        alignItems: "start",
      }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: 18 }}>
        {/* Hero meeting card */}
        <div
          style={{
            background:
              "linear-gradient(135deg, var(--color-codex-accent-bg) 0%, var(--color-codex-bg-elev) 100%)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
            padding: "20px 24px",
          }}
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div
                className="flex flex-wrap"
                style={{
                  gap: 12,
                  marginBottom: 6,
                  color: "var(--color-codex-ink-mute)",
                  fontSize: 12,
                }}
              >
                <HeroMeta icon={<CalendarDays className="h-3 w-3" />}>
                  {isZh
                    ? generatedAt
                      ? `生成于 ${generatedAt}`
                      : "首张会前卡"
                    : generatedAt
                      ? `Generated ${generatedAt}`
                      : "First card"}
                </HeroMeta>
                <HeroMeta icon={<User className="h-3 w-3" />}>
                  {project.client || (isZh ? "未关联客户" : "No client")}
                </HeroMeta>
                {memoryStale ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-codex-warn)",
                      padding: "1px 8px",
                      borderRadius: 999,
                      background:
                        "color-mix(in oklch, var(--color-codex-warn) 12%, transparent)",
                      border:
                        "1px solid color-mix(in oklch, var(--color-codex-warn) 28%, transparent)",
                    }}
                  >
                    {isZh ? "记忆待更新" : "Memory stale"}
                  </span>
                ) : null}
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 500,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.02em",
                }}
              >
                {isZh ? "30 秒会前卡" : "30-second meeting card"}
              </h2>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 13,
                  color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                  lineHeight: 1.6,
                }}
              >
                {isZh
                  ? "打开就看四件事 — 说什么、避开什么、确认什么、过去的教训。"
                  : "Open and see four things — say, avoid, confirm, lessons."}
              </p>
            </div>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              <HeroSecondaryButton
                onClick={() => void loadBriefing()}
                disabled={isLoading}
                icon={
                  isLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )
                }
              >
                {isZh ? "刷新" : "Refresh"}
              </HeroSecondaryButton>
              <HeroSecondaryButton
                onClick={() => void refineBriefing(false)}
                disabled={isRefining || !briefing}
                icon={
                  isRefining ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )
                }
              >
                {refinedBriefing
                  ? isZh
                    ? "更新话术"
                    : "Update script"
                  : isZh
                    ? "生成话术"
                    : "Draft script"}
              </HeroSecondaryButton>
              <HeroPrimaryButton
                onClick={openChatWithBriefing}
                disabled={!briefing}
                icon={<MessageSquare className="h-3 w-3" />}
              >
                {isZh ? "去对话准备" : "Prepare in chat"}
              </HeroPrimaryButton>
            </div>
          </div>
        </div>

        {error ? (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--codex-r-sm, 6px)",
              background: "color-mix(in oklch, var(--color-codex-warn) 12%, transparent)",
              border: "1px solid color-mix(in oklch, var(--color-codex-warn) 28%, transparent)",
              color: "var(--color-codex-warn)",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        ) : null}

        {/* 2x2 cards */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          <MeetingCardSection
            title={isZh ? "建议说什么" : "Say"}
            en="Say"
            tone="good"
            items={briefing?.meeting_card.say ?? []}
            emptyText={isZh ? "暂无明确建议,可先刷新项目记忆。" : "No clear talking points yet."}
          />
          <MeetingCardSection
            title={isZh ? "尽量避开" : "Avoid"}
            en="Avoid"
            tone="warn"
            items={briefing?.meeting_card.avoid ?? []}
            emptyText={isZh ? "暂无敏感点或风险禁区。" : "No sensitivities captured yet."}
          />
          <MeetingCardSection
            title={isZh ? "需要确认" : "Confirm"}
            en="Confirm"
            tone="neutral"
            items={briefing?.meeting_card.confirm ?? []}
            emptyText={isZh ? "暂无开放问题。" : "No open questions yet."}
          />
          <MeetingCardSection
            title={isZh ? "历史经验" : "Lessons"}
            en="Lessons"
            tone="info"
            items={briefing?.meeting_card.experience ?? []}
            emptyText={isZh ? "暂无客户历史经验沉淀。" : "No client lessons captured yet."}
          />
        </div>

        {/* AI script panel */}
        {refineError ? (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--codex-r-sm, 6px)",
              background: "color-mix(in oklch, var(--color-codex-warn) 12%, transparent)",
              border: "1px solid color-mix(in oklch, var(--color-codex-warn) 28%, transparent)",
              color: "var(--color-codex-warn)",
              fontSize: 12.5,
            }}
          >
            {refineError}
          </div>
        ) : null}
        {refinedBriefing ? (
          <CxPanel
            title={isZh ? "开场话术 (AI 生成)" : "Opening script (AI)"}
            subtitle={
              isZh
                ? `基于上面四张卡片自动生成 · 可直接复制使用${refinedGeneratedAt ? ` · ${refinedGeneratedAt}` : ""}`
                : `Auto-generated from the four cards above${refinedGeneratedAt ? ` · ${refinedGeneratedAt}` : ""}`
            }
            action={
              <button
                type="button"
                onClick={() => void refineBriefing(true)}
                disabled={isRefining}
                className="inline-flex items-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  gap: 4,
                  fontSize: 12,
                  color: "var(--color-codex-accent)",
                  background: "transparent",
                  border: "none",
                }}
              >
                {isRefining ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {isZh ? "重新生成" : "Regenerate"}
              </button>
            }
          >
            <div
              className="briefing-script md-root"
              style={{
                fontSize: 13.5,
                color: "var(--color-codex-ink)",
                lineHeight: 1.8,
                background: "var(--color-codex-bg-tint)",
                padding: "14px 16px",
                borderRadius: "var(--codex-r-sm, 6px)",
              }}
            >
              <MarkdownRenderer content={refinedBriefing.content} />
            </div>
          </CxPanel>
        ) : null}
      </div>

      {/* Right rail */}
      <aside className="flex flex-col" style={{ gap: 16, position: "sticky", top: 76 }}>
        <CxPanel
          title={isZh ? "关键干系人" : "Key stakeholders"}
          subtitle={isZh ? "结合客户记忆的干系人画像" : "Stakeholder map"}
        >
          {briefing?.stakeholders.length ? (
            briefing.stakeholders.slice(0, 5).map((stakeholder, index) => {
              const subtitle = [stakeholder.role, stakeholder.influence_type, stakeholder.relationship_status]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={`${stakeholder.name}-${index}`}
                  className="flex items-start"
                  style={{
                    gap: 10,
                    padding: "9px 0",
                    borderBottom:
                      index === Math.min(briefing.stakeholders.length, 5) - 1
                        ? "none"
                        : "1px solid var(--color-codex-line-soft)",
                  }}
                >
                  <span
                    className="inline-flex flex-shrink-0 items-center justify-center"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 99,
                      background: "var(--color-codex-accent-bg)",
                      color: "var(--color-codex-accent-ink)",
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {(stakeholder.name || "?").slice(0, 1)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 13,
                        color: "var(--color-codex-ink)",
                        fontWeight: 500,
                      }}
                    >
                      {stakeholder.name || (isZh ? "未命名" : "Unnamed")}
                    </div>
                    {subtitle ? (
                      <div
                        className="truncate"
                        style={{ fontSize: 11, color: "var(--color-codex-ink-mute)", marginTop: 2 }}
                      >
                        {subtitle}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                lineHeight: 1.6,
                padding: "6px 0",
              }}
            >
              {isZh
                ? "暂无结构化干系人。建议先在干系人页签补齐。"
                : "No structured stakeholders yet. Capture them in the Stakeholders tab."}
            </p>
          )}
        </CxPanel>

        <CxPanel
          title={isZh ? "近期节奏" : "Near-term cadence"}
          subtitle={isZh ? "即将到期的里程碑与待办" : "Upcoming milestones & todos"}
        >
          {(() => {
            const cadence = [
              ...(briefing?.signals.upcoming_milestones ?? []).map((item) => ({
                key: `milestone-${item.id}`,
                title: item.title,
                meta:
                  `${formatDateOnly(item.due_date || "")}` +
                  (item.priority ? ` · ${item.priority}` : ""),
                tone: "accent" as const,
              })),
              ...(briefing?.signals.pending_todos ?? []).map((item) => ({
                key: `todo-${item.id}`,
                title: item.content,
                meta: formatDateOnly(item.due_date || ""),
                tone: "neutral" as const,
              })),
            ];
            if (cadence.length === 0) {
              return (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12.5,
                    color: "var(--color-codex-ink-mute)",
                    padding: "6px 0",
                  }}
                >
                  {isZh ? "暂无近期里程碑或待办。" : "No near-term milestones or todos."}
                </p>
              );
            }
            return cadence.map((item, i) => (
              <div
                key={item.key}
                className="flex"
                style={{
                  gap: 10,
                  padding: "8px 0",
                  borderBottom:
                    i === cadence.length - 1
                      ? "none"
                      : "1px solid var(--color-codex-line-soft)",
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    color:
                      item.tone === "accent"
                        ? "var(--color-codex-accent)"
                        : "var(--color-codex-ink-mute)",
                    paddingTop: 1,
                    minWidth: 56,
                    fontFamily: 'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  }}
                >
                  {item.meta || (isZh ? "未排期" : "Unscheduled")}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="truncate"
                    style={{
                      fontSize: 13,
                      color: "var(--color-codex-ink)",
                      fontWeight: 500,
                    }}
                  >
                    {item.title}
                  </div>
                </div>
              </div>
            ));
          })()}
        </CxPanel>

        <CxPanel
          title={isZh ? "资料依据" : "Evidence"}
          subtitle={isZh ? "本次卡片来源" : "Sources behind the card"}
        >
          {(briefing?.signals.communication_sources?.length ?? 0) +
            (briefing?.signals.recent_documents?.length ?? 0) ===
          0 ? (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                padding: "6px 0",
              }}
            >
              {isZh
                ? "暂无项目笔记或最近对话片段。"
                : "No project notes or recent chat snippets yet."}
            </p>
          ) : (
            <>
              {(briefing?.signals.communication_sources ?? []).slice(0, 4).map((source, i) => (
                <div
                  key={`source-${source.type}-${i}`}
                  className="flex items-start justify-between"
                  style={{
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--color-codex-line-soft)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <Sparkles
                        className="h-3 w-3 flex-shrink-0"
                        style={{ color: "var(--color-codex-accent)" }}
                      />
                      <span
                        className="truncate"
                        style={{
                          fontSize: 12.5,
                          color: "var(--color-codex-ink)",
                          fontWeight: 500,
                        }}
                      >
                        {source.label}
                      </span>
                    </div>
                    {source.excerpt ? (
                      <p
                        className="line-clamp-2"
                        style={{
                          margin: "4px 0 0",
                          fontSize: 11.5,
                          color: "var(--color-codex-ink-mute)",
                          lineHeight: 1.55,
                        }}
                      >
                        {source.excerpt}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => openCommunicationSource(source)}
                    className="inline-flex flex-shrink-0 items-center transition-colors"
                    style={{
                      gap: 3,
                      fontSize: 11,
                      color: "var(--color-codex-accent)",
                      background: "transparent",
                      border: "none",
                      padding: "2px 6px",
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {isZh ? "打开" : "Open"}
                  </button>
                </div>
              ))}
              {(briefing?.signals.recent_documents ?? []).slice(0, 3).map((doc, i, arr) => (
                <div
                  key={`doc-${doc.id}`}
                  className="flex items-start"
                  style={{
                    gap: 10,
                    padding: "8px 0",
                    borderBottom:
                      i === arr.length - 1
                        ? "none"
                        : "1px solid var(--color-codex-line-soft)",
                  }}
                >
                  <FileText
                    className="h-3 w-3 flex-shrink-0"
                    style={{ color: "var(--color-codex-accent)", marginTop: 4 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 12.5,
                        color: "var(--color-codex-ink)",
                        fontWeight: 500,
                      }}
                    >
                      {doc.name}
                    </div>
                    {doc.summary ? (
                      <p
                        className="line-clamp-2"
                        style={{
                          margin: "4px 0 0",
                          fontSize: 11.5,
                          color: "var(--color-codex-ink-mute)",
                          lineHeight: 1.55,
                        }}
                      >
                        {doc.summary}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </>
          )}
        </CxPanel>
      </aside>
    </div>
  );
}
