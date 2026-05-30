/**
 * Workspace (工作台) — V0.0.6 Codex redesign · PR 8/N.
 *
 * Per ``design_handoff_aria_codex_redesign/direction-codex-part1.jsx:141``:
 *   - Outer page is plain Codex parchment (``bg-codex-bg``), no
 *     gradient, no card-frame wrapper.
 *   - Left column = greeting block + 常用 Skill cards + 进行中项目
 *     table.
 *   - Right column = 今日待办 / 即将里程碑 / 最近对话 (REFACTOR LANDING
 *     IN PR 9/N — for now wrapped in lightly-styled Codex frames so
 *     the page reads cohesively while we work on the panels).
 *
 * Data hooks, navigation handlers, and the Workspace's role as the
 * first authenticated route are unchanged.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Calendar,
  FileText,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import type { AxiosError } from "axios";

import { api } from "../api/client";
import { CxLogo, CxSkeleton, CxStatus, CxTopProgress, type CxStatusTone } from "../components/codex";
import { PageTitle } from "../components/PageTitle";
import { parseAppDateTime } from "../utils/timezone";
import type {
  Conversation,
  MyProjectTodo,
  SkillSummary,
  User,
} from "../types/api";

interface DashboardProjectSummary {
  id: number
  name: string
  client: string
  status: string
  contract_amount?: number
  updated_at: string
  memory_stale?: boolean
  memory_version?: number
}

function formatRelativeTime(value?: string | null, isZh = true) {
  if (!value) return isZh ? "暂无记录" : "No recent activity";
  const diffMinutes = Math.floor((Date.now() - parseAppDateTime(value).getTime()) / 60000);
  if (diffMinutes < 1) return isZh ? "刚刚" : "Just now";
  if (diffMinutes < 60)
    return isZh ? `${diffMinutes} 分钟前` : `${diffMinutes} min ago`;
  if (diffMinutes < 1440)
    return isZh
      ? `${Math.floor(diffMinutes / 60)} 小时前`
      : `${Math.floor(diffMinutes / 60)} h ago`;
  if (diffMinutes < 2880) return isZh ? "昨天" : "Yesterday";
  const days = Math.floor(diffMinutes / 1440);
  return isZh ? `${days} 天前` : `${days} d ago`;
}

function getStageLabel(status: string, isZh: boolean): string {
  const map: Record<string, [string, string]> = {
    lead: ["线索", "Lead"],
    qualified: ["商机", "Qualified"],
    proposal: ["方案", "Proposal"],
    negotiation: ["谈判", "Negotiation"],
    contracting: ["签约", "Contracting"],
    kickoff: ["启动", "Kickoff"],
    execution: ["执行", "Execution"],
    delivery: ["交付", "Delivery"],
    support: ["运维", "Support"],
    archived: ["归档", "Archived"],
  };
  const [zh, en] = map[status] || [status, status];
  return isZh ? zh : en;
}

function statusTone(status: string): CxStatusTone {
  if (["lead", "qualified"].includes(status)) return "mute";
  if (["proposal", "negotiation", "contracting"].includes(status)) return "warn";
  if (["kickoff", "execution", "delivery"].includes(status)) return "accent";
  if (status === "support") return "good";
  if (status === "archived") return "mute";
  return "neutral";
}

function getStoredUser(): User | null {
  try {
    const raw =
      typeof window !== "undefined" ? window.localStorage.getItem("user") : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.display_name && !parsed.email) return null;
    return {
      id: typeof parsed.id === "number" ? parsed.id : 0,
      email: parsed.email || "",
      display_name: parsed.display_name || parsed.email || "",
      is_admin: !!parsed.is_admin,
      is_active: parsed.is_active !== false,
    };
  } catch {
    return null;
  }
}

function getGreeting(isZh: boolean): string {
  const hour = new Date().getHours();
  if (hour < 5) return isZh ? "夜深了" : "Late night";
  if (hour < 12) return isZh ? "早上好" : "Good morning";
  if (hour < 14) return isZh ? "中午好" : "Good afternoon";
  if (hour < 18) return isZh ? "下午好" : "Good afternoon";
  return isZh ? "晚上好" : "Good evening";
}

function formatHeroDate(isZh: boolean): string {
  const now = new Date();
  if (isZh) {
    const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekDays[now.getDay()]}`;
  }
  return now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

/**
 * Compact due-date label for the right rail rows. Today / 明天 in zh
 * (Today / Tomorrow in en) get word labels; further-out dates show as
 * "M/D" so the rail stays scannable.
 */
function formatDueLabel(value: string, isZh: boolean): string {
  const due = parseAppDateTime(value);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const today = new Date();
  const todayDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const diff = Math.round((dueDay - todayDay) / 86400000);
  if (diff < 0) return isZh ? `逾期 ${Math.abs(diff)}d` : `${Math.abs(diff)}d late`;
  if (diff === 0) return isZh ? "今天" : "Today";
  if (diff === 1) return isZh ? "明天" : "Tomorrow";
  return `${due.getMonth() + 1}/${due.getDate()}`;
}

// Quick skill card definitions — wired to the existing skill resolver
// below so clicking a card routes to the right Skill or falls back to
// a chat prompt when the underlying skill isn't installed.
type SkillCard = {
  key: "digital_strategy" | "pre_meeting_brief" | "rfp_breakdown";
  title: string;
  desc: string;
  fallbackPrompt: string;
  matcher: (s: SkillSummary) => boolean;
  icon: "target" | "calendar" | "file";
};

const SKILL_CARDS: { zh: SkillCard[]; en: SkillCard[] } = {
  zh: [
    {
      key: "digital_strategy",
      title: "数字化战略分析",
      desc: "三层战略框架 · 行业洞察",
      fallbackPrompt: "进行一次数字化战略分析",
      matcher: (s) => /digital[-_ ]?strategy|数字化战略/i.test(s.name || ""),
      icon: "target",
    },
    {
      key: "pre_meeting_brief",
      title: "会前简报",
      desc: "10 分钟生成一页纸",
      fallbackPrompt: "帮我准备会前简报",
      matcher: (s) => /pre[-_ ]?meeting|会前简报|briefing/i.test(s.name || ""),
      icon: "calendar",
    },
    {
      key: "rfp_breakdown",
      title: "RFP 拆解",
      desc: "评分维度 · 响应大纲",
      fallbackPrompt: "帮我拆解一份 RFP",
      matcher: (s) => /rfp|招标/i.test(s.name || ""),
      icon: "file",
    },
  ],
  en: [
    {
      key: "digital_strategy",
      title: "Digital Strategy",
      desc: "3-tier framework + industry insights",
      fallbackPrompt: "Run a digital strategy analysis",
      matcher: (s) => /digital[-_ ]?strategy/i.test(s.name || ""),
      icon: "target",
    },
    {
      key: "pre_meeting_brief",
      title: "Pre-meeting Brief",
      desc: "A 1-pager in 10 minutes",
      fallbackPrompt: "Help me prepare a pre-meeting brief",
      matcher: (s) => /pre[-_ ]?meeting|briefing/i.test(s.name || ""),
      icon: "calendar",
    },
    {
      key: "rfp_breakdown",
      title: "RFP Breakdown",
      desc: "Scoring + response outline",
      fallbackPrompt: "Help me break down an RFP",
      matcher: (s) => /rfp/i.test(s.name || ""),
      icon: "file",
    },
  ],
};

function getCardIcon(icon: SkillCard["icon"]) {
  if (icon === "target") return Target;
  if (icon === "calendar") return Calendar;
  return FileText;
}

export function Workspace() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<DashboardProjectSummary[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [todos, setTodos] = useState<MyProjectTodo[]>([]);
  const [user] = useState<User | null>(() => getStoredUser());

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [allProjects, allConversations, allSkills, allTodos] = await Promise.all([
        api.get<DashboardProjectSummary[]>("/projects/meta/dashboard-summary"),
        api.get<Conversation[]>("/chat/conversations"),
        api.get<SkillSummary[]>("/skills/meta/summary"),
        // Todos may not yet be available depending on permissions; soft-fail
        // so the workspace still renders the rest of the page if 403/500.
        api.get<MyProjectTodo[]>("/projects/todos/my").catch(() => [] as MyProjectTodo[]),
      ]);
      setProjects(allProjects);
      setConversations(allConversations);
      setSkills(allSkills);
      setTodos(allTodos);
    } catch (err) {
      const apiError = err as AxiosError;
      setError(
        !apiError.response
          ? isZh
            ? "无法连接到服务器"
            : "Unable to reach the server"
          : isZh
            ? "加载工作台失败"
            : "Failed to load workspace",
      );
    } finally {
      setLoading(false);
    }
  };

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status !== "archived"),
    [projects],
  );

  const recentConversations = useMemo(
    () =>
      [...conversations]
        .sort(
          (a, b) =>
            parseAppDateTime(b.updated_at).getTime() -
            parseAppDateTime(a.updated_at).getTime(),
        )
        .slice(0, 5),
    [conversations],
  );

  // Today's todos = anything undone that is either overdue or due in the
  // next ~24 hours. Sorted by due date so the most urgent floats up.
  const todayTodos = useMemo(() => {
    const now = Date.now();
    const endOfTomorrow = now + 36 * 60 * 60 * 1000;
    return todos
      .filter((todo) => !todo.is_done && todo.due_date)
      .filter((todo) => {
        const due = parseAppDateTime(todo.due_date as string).getTime();
        return due <= endOfTomorrow;
      })
      .sort(
        (a, b) =>
          parseAppDateTime(a.due_date as string).getTime() -
          parseAppDateTime(b.due_date as string).getTime(),
      );
  }, [todos]);

  // "Upcoming this week" = undone, due in (~36h … 7d]. Mirrors the prototype's
  // 即将里程碑 panel; without a backend "my milestones" endpoint we surface
  // upcoming-due todos which carry the same "what's around the corner" intent.
  const upcomingTodos = useMemo(() => {
    const now = Date.now();
    const startOfNext = now + 36 * 60 * 60 * 1000;
    const endOfWeek = now + 7 * 24 * 60 * 60 * 1000;
    return todos
      .filter((todo) => !todo.is_done && todo.due_date)
      .filter((todo) => {
        const due = parseAppDateTime(todo.due_date as string).getTime();
        return due > startOfNext && due <= endOfWeek;
      })
      .sort(
        (a, b) =>
          parseAppDateTime(a.due_date as string).getTime() -
          parseAppDateTime(b.due_date as string).getTime(),
      );
  }, [todos]);

  const highPriorityTodayCount = todayTodos.filter(
    (todo) => todo.priority === "high",
  ).length;

  const skillCards = isZh ? SKILL_CARDS.zh : SKILL_CARDS.en;

  const handleSkillCardClick = (card: SkillCard) => {
    const match = skills.find(card.matcher);
    if (match) {
      navigate(`/chat?skill=${match.id}`);
    } else {
      navigate(`/chat?q=${encodeURIComponent(card.fallbackPrompt)}`);
    }
  };

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? "今日工作台" : "Workspace"} />
        <WorkspaceSkeleton />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageTitle title={isZh ? "今日工作台" : "Workspace"} />
        <div
          className="theme-codex flex h-full flex-col items-center justify-center gap-4"
          style={{
            background: "var(--color-codex-bg)",
            color: "var(--color-codex-ink-soft)",
          }}
        >
          <p style={{ fontSize: 13 }}>{error}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5"
            style={{
              padding: "8px 14px",
              background: "var(--color-codex-ink)",
              color: "var(--color-codex-bg-elev)",
              borderRadius: "var(--codex-r-sm, 3px)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {isZh ? "重试" : "Retry"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={isZh ? "今日工作台" : "Workspace"} />
      <div
        className="theme-codex h-full overflow-auto"
        style={{ background: "var(--color-codex-bg)", color: "var(--color-codex-ink)" }}
        data-testid="workspace"
      >
        <div
          className="grid min-w-0"
          style={{
            padding: "36px 36px 40px",
            gap: 48,
            gridTemplateColumns: "minmax(0,1fr) 300px",
          }}
        >
          {/* ============================================================
              LEFT — greeting + skills + projects
              ============================================================ */}
          <div className="flex flex-col" style={{ gap: 40, minWidth: 0 }}>
            {/* Greeting block */}
            <header>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--color-codex-ink-mute)",
                  marginBottom: 10,
                }}
              >
                {formatHeroDate(isZh)}
              </div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 32,
                  fontWeight: 500,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                }}
              >
                {getGreeting(isZh)}
                {user?.display_name ? `，${user.display_name}` : ""}
              </h1>
              <p
                style={{
                  marginTop: 14,
                  fontSize: 14,
                  color: "var(--color-codex-ink-soft)",
                  lineHeight: 1.7,
                  maxWidth: 580,
                }}
              >
                {isZh ? "今天有 " : "You have "}
                <span style={{ color: "var(--color-codex-ink)" }}>
                  {activeProjects.length}{" "}
                  {isZh ? "个进行中项目" : "active projects"}
                </span>
                {isZh ? "、" : ", "}
                <span style={{ color: "var(--color-codex-ink)" }}>
                  {recentConversations.length}{" "}
                  {isZh ? "条最近对话" : "recent chats"}
                </span>
                {isZh
                  ? "。点开下面的项目继续推进，或从常用 Skill 起一个新动作。"
                  : ". Open a project to continue, or pick a quick skill below."}
              </p>
              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="inline-flex items-center gap-1.5"
                  style={{
                    padding: "7px 12px",
                    fontSize: 12.5,
                    background: "var(--color-codex-bg-elev)",
                    color: "var(--color-codex-ink-soft)",
                    border: "1px solid var(--color-codex-line)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {isZh ? "刷新" : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/chat")}
                  className="inline-flex items-center gap-1.5"
                  style={{
                    padding: "7px 14px",
                    fontSize: 12.5,
                    background: "var(--color-codex-ink)",
                    color: "var(--color-codex-bg-elev)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                    fontWeight: 500,
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  {isZh ? "新建对话" : "New chat"}
                </button>
              </div>
            </header>

            {/* Quick skills */}
            <section>
              <SectionHeader
                title={isZh ? "常用 Skill" : "Quick skills"}
                action={
                  <button
                    type="button"
                    onClick={() => navigate("/skills")}
                    style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}
                  >
                    {isZh ? "查看全部 →" : "View all →"}
                  </button>
                }
              />
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 14,
                }}
              >
                {skillCards.map((card) => {
                  const Icon = getCardIcon(card.icon);
                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => handleSkillCardClick(card)}
                      className="codex-row-hov flex flex-col text-left transition"
                      style={{
                        padding: 18,
                        gap: 10,
                        minHeight: 140,
                        background: "var(--color-codex-bg-elev)",
                        border: "1px solid var(--color-codex-line)",
                        borderRadius: "var(--codex-r-md, 6px)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-flex items-center justify-center"
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: "var(--codex-r-sm, 3px)",
                          background: "var(--color-codex-accent-bg)",
                          color: "var(--color-codex-accent)",
                        }}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </span>
                      <div
                        style={{
                          fontSize: 15.5,
                          fontWeight: 500,
                          color: "var(--color-codex-ink)",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {card.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--color-codex-ink-mute)",
                          lineHeight: 1.55,
                        }}
                      >
                        {card.desc}
                      </div>
                      <div
                        className="mt-auto flex items-center justify-between"
                        style={{
                          fontSize: 11,
                          color: "var(--color-codex-ink-faint)",
                        }}
                      >
                        <span className="font-mono">
                          {isZh ? "调用 Skill" : "Open skill"}
                        </span>
                        <span style={{ color: "var(--color-codex-accent)" }}>
                          {isZh ? "调用 →" : "Run →"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Projects */}
            <section style={{ minHeight: 0 }}>
              <SectionHeader
                title={
                  isZh
                    ? `进行中项目 · ${activeProjects.length}`
                    : `Active projects · ${activeProjects.length}`
                }
                action={
                  <button
                    type="button"
                    onClick={() => navigate("/projects")}
                    style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}
                  >
                    {isZh ? "查看全部 →" : "View all →"}
                  </button>
                }
              />

              {/* 5-column grid per the prototype (see
                  ``direction-codex-part1.jsx:191``):
                  项目 / 阶段 / 金额 / 记忆 / arrow. */}
              <div
                className="grid items-center"
                style={{
                  fontSize: 11,
                  color: "var(--color-codex-ink-faint)",
                  padding: "6px 4px 8px",
                  borderBottom: "1px solid var(--color-codex-line)",
                  gridTemplateColumns: "1fr 110px 100px 110px 14px",
                  columnGap: 14,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                <span>{isZh ? "项目" : "Project"}</span>
                <span>{isZh ? "阶段" : "Stage"}</span>
                <span>{isZh ? "金额" : "Amount"}</span>
                <span>{isZh ? "记忆" : "Memory"}</span>
                <span />
              </div>

              {activeProjects.length ? (
                activeProjects.slice(0, 6).map((project, index, arr) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => navigate(`/projects/${project.id}`)}
                    className="codex-row-hov grid w-full items-center text-left"
                    style={{
                      padding: "13px 4px",
                      columnGap: 14,
                      gridTemplateColumns: "1fr 110px 100px 110px 14px",
                      borderBottom:
                        index === arr.length - 1
                          ? "none"
                          : "1px solid var(--color-codex-line-soft)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--color-codex-ink)",
                          letterSpacing: "-0.005em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {project.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--color-codex-ink-mute)",
                          marginTop: 2,
                        }}
                      >
                        {project.client || (isZh ? "未填写客户" : "No client")}
                        {" · "}
                        {formatRelativeTime(project.updated_at, isZh)}
                      </div>
                    </div>
                    <CxStatus tone={statusTone(project.status)}>
                      {getStageLabel(project.status, isZh)}
                    </CxStatus>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 13,
                        color: "var(--color-codex-ink-soft)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {project.contract_amount
                        ? isZh
                          ? `¥${Math.round(project.contract_amount / 10000)}万`
                          : `$${(project.contract_amount / 1000).toFixed(0)}k`
                        : "—"}
                    </span>
                    {project.memory_stale || (project.memory_version ?? 0) === 0 ? (
                      <CxStatus tone="warn">{isZh ? "记忆过期" : "stale"}</CxStatus>
                    ) : (
                      <CxStatus tone="good">
                        {isZh ? `v${project.memory_version}` : `v${project.memory_version}`}
                      </CxStatus>
                    )}
                    <ArrowRight
                      className="h-3 w-3"
                      aria-hidden="true"
                      style={{ color: "var(--color-codex-ink-faint)" }}
                    />
                  </button>
                ))
              ) : (
                <div
                  style={{
                    padding: "20px 0",
                    fontSize: 13,
                    color: "var(--color-codex-ink-mute)",
                    textAlign: "center",
                  }}
                >
                  {isZh ? "暂无进行中的项目。" : "No active projects."}
                </div>
              )}
            </section>
          </div>

          {/* ============================================================
              RIGHT — 今日待办 / 即将到期 / 最近对话 (PR 9/N).
              ============================================================ */}
          <aside
            className="flex flex-col"
            style={{
              gap: 36,
              minWidth: 0,
              borderLeft: "1px solid var(--color-codex-line)",
              paddingLeft: 36,
            }}
            data-testid="workspace-right-rail"
          >
            {/* Today's todos — checkbox + title + project · due + priority dot */}
            <div data-testid="workspace-today-todos">
              <SectionHeader
                title={
                  isZh
                    ? `今日待办 · ${todayTodos.length}`
                    : `Today · ${todayTodos.length}`
                }
                action={
                  highPriorityTodayCount > 0 ? (
                    <CxStatus tone="warn">
                      {isZh
                        ? `${highPriorityTodayCount} 项高优`
                        : `${highPriorityTodayCount} hi-pri`}
                    </CxStatus>
                  ) : null
                }
              />
              {todayTodos.length ? (
                // Plain ``<div>`` rows per the prototype (see
                // ``direction-codex-part1.jsx:216``) — no hover, no
                // navigation. The list is a status read-out, not a
                // jump-target.
                todayTodos.slice(0, 5).map((todo) => (
                  <div
                    key={todo.id}
                    className="flex items-start"
                    style={{
                      gap: 10,
                      padding: "8px 0",
                    }}
                  >
                    {/* Bullet — read-only by design. The earlier
                        square-with-rounded-corners affordance looked
                        like a checkbox and invited the user to tick it,
                        but there's no toggle-done behavior wired up. A
                        dot makes the read-only nature obvious. */}
                    <span
                      aria-hidden="true"
                      className="flex-shrink-0"
                      style={{
                        width: 5,
                        height: 5,
                        marginTop: 8,
                        borderRadius: 999,
                        background: "var(--color-codex-ink-faint)",
                      }}
                    />
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          color: "var(--color-codex-ink)",
                          lineHeight: 1.45,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {todo.content}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--color-codex-ink-mute)",
                          marginTop: 2,
                        }}
                      >
                        {todo.project_name || "—"}
                        {todo.due_date ? (
                          <>
                            {" · "}
                            <span className="font-mono">
                              {formatDueLabel(todo.due_date, isZh)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {todo.priority === "high" && (
                      <span
                        aria-label={isZh ? "高优" : "high priority"}
                        className="flex-shrink-0"
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 999,
                          background: "var(--color-codex-accent)",
                          marginTop: 9,
                        }}
                      />
                    )}
                  </div>
                ))
              ) : (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-codex-ink-mute)",
                    padding: "8px 0",
                    lineHeight: 1.6,
                  }}
                >
                  {isZh
                    ? "今天没有到期的待办。喘口气。"
                    : "No todos due today. Breathe."}
                </p>
              )}
            </div>

            {/* Upcoming this week — date-prefixed rows. Without a backend
                "my milestones" endpoint, we surface upcoming todos which
                carry the same "what's around the corner" intent. */}
            <div data-testid="workspace-upcoming">
              <SectionHeader
                title={isZh ? "即将到期" : "Upcoming"}
                action={
                  <span
                    style={{ fontSize: 11, color: "var(--color-codex-ink-faint)" }}
                  >
                    {isZh ? "未来 7 天" : "next 7 days"}
                  </span>
                }
              />
              {upcomingTodos.length ? (
                // Plain ``<div>`` rows per the prototype (see
                // ``direction-codex-part1.jsx:231``) — date prefix in
                // accent + title + project. Static like the todos above.
                upcomingTodos.slice(0, 4).map((todo) => (
                  <div
                    key={todo.id}
                    className="flex items-start"
                    style={{
                      gap: 12,
                      padding: "8px 0",
                    }}
                  >
                    <span
                      className="font-mono flex-shrink-0"
                      style={{
                        fontSize: 12,
                        color: "var(--color-codex-accent)",
                        paddingTop: 1,
                        minWidth: 36,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {todo.due_date ? formatDueLabel(todo.due_date, isZh) : "—"}
                    </span>
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          color: "var(--color-codex-ink)",
                          lineHeight: 1.45,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {todo.content}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--color-codex-ink-mute)",
                          marginTop: 2,
                        }}
                      >
                        {todo.project_name || "—"}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-codex-ink-mute)",
                    padding: "8px 0",
                    lineHeight: 1.6,
                  }}
                >
                  {isZh
                    ? "未来一周没有到期的待办。"
                    : "Nothing on the radar for the next week."}
                </p>
              )}
            </div>

            {/* Recent conversations — refined row pattern with cleaner
                hover + tighter spacing per the prototype. */}
            <div data-testid="workspace-recent-chats">
              <SectionHeader
                title={isZh ? "最近对话" : "Recent chats"}
                action={
                  <button
                    type="button"
                    onClick={() => navigate("/chat")}
                    style={{ fontSize: 11, color: "var(--color-codex-accent)" }}
                  >
                    {isZh ? "全部 →" : "All →"}
                  </button>
                }
              />
              {recentConversations.length ? (
                recentConversations.slice(0, 4).map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() =>
                      navigate(
                        conv.project_id
                          ? `/projects/${conv.project_id}/chat?conversation=${conv.id}`
                          : `/chat?conversation=${conv.id}`,
                      )
                    }
                    className="codex-row-hov block w-full text-left"
                    style={{
                      padding: "8px 8px",
                      marginLeft: -8,
                      borderRadius: "var(--codex-r-sm, 3px)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--color-codex-ink)",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {conv.title || (isZh ? "未命名对话" : "Untitled chat")}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-codex-ink-mute)",
                        marginTop: 2,
                      }}
                    >
                      {formatRelativeTime(conv.updated_at, isZh)}
                    </div>
                  </button>
                ))
              ) : (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-codex-ink-mute)",
                    padding: "8px 0",
                  }}
                >
                  {isZh ? "暂无对话。" : "No recent chats."}
                </p>
              )}
            </div>

            {/* Tiny brand mark — anchors the rail's bottom edge. */}
            <div
              className="mt-auto flex items-center gap-2"
              style={{
                paddingTop: 18,
                borderTop: "1px solid var(--color-codex-line-soft)",
                color: "var(--color-codex-ink-faint)",
                fontSize: 11,
              }}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              <span className="inline-flex items-center gap-1.5">
                <CxLogo size={16} showWordmark={false} />
                {isZh ? "Aria · 工作台" : "Aria · workspace"}
              </span>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------

/**
 * Workspace skeleton — structured placeholder that mirrors the real
 * Workspace layout per the design's CxLoading in
 * ``design_handoff_aria_codex_redesign/direction-codex-states.jsx:23``.
 *
 * Shows greeting block + Skill cards row + projects table on the left,
 * todos + recent chats on the right, plus a 2px accent slider at the
 * very top so the page reads as "fetching" not "broken".
 */
function WorkspaceSkeleton() {
  return (
    <div
      className="theme-codex flex h-full flex-col overflow-hidden"
      style={{ background: "var(--color-codex-bg)", color: "var(--color-codex-ink)" }}
    >
      <CxTopProgress />
      <div
        className="grid min-w-0 flex-1 overflow-hidden"
        style={{
          padding: "36px 36px 40px",
          gap: 48,
          gridTemplateColumns: "minmax(0,1fr) 300px",
        }}
      >
        {/* Left column */}
        <div className="flex flex-col" style={{ gap: 40, minWidth: 0 }}>
          {/* Greeting */}
          <div>
            <CxSkeleton w={140} h={11} style={{ marginBottom: 12 }} />
            <CxSkeleton w={320} h={28} />
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <CxSkeleton w="80%" h={14} />
              <CxSkeleton w="55%" h={14} />
            </div>
          </div>

          {/* Skill cards */}
          <section>
            <div style={{ marginBottom: 14 }}>
              <CxSkeleton w={100} h={13} />
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex flex-col"
                  style={{
                    padding: 18,
                    gap: 10,
                    minHeight: 140,
                    background: "var(--color-codex-bg-elev)",
                    border: "1px solid var(--color-codex-line)",
                    borderRadius: "var(--codex-r-md, 6px)",
                  }}
                >
                  <CxSkeleton w={30} h={30} radius="var(--codex-r-sm, 3px)" />
                  <CxSkeleton w="70%" h={16} />
                  <CxSkeleton w="90%" h={12} />
                  <CxSkeleton w="50%" h={11} style={{ marginTop: "auto" }} />
                </div>
              ))}
            </div>
          </section>

          {/* Projects table */}
          <section>
            <div style={{ marginBottom: 12 }}>
              <CxSkeleton w={120} h={13} />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "1fr 110px 100px 110px 14px",
                  padding: "13px 4px",
                  gap: 14,
                  borderBottom: "1px solid var(--color-codex-line-soft)",
                }}
              >
                <div>
                  <CxSkeleton w="60%" h={14} />
                  <div style={{ marginTop: 5 }}>
                    <CxSkeleton w="40%" h={11} />
                  </div>
                </div>
                <CxSkeleton w={70} h={14} radius={999} />
                <CxSkeleton w={50} h={13} />
                <CxSkeleton w={80} h={13} radius={999} />
                <CxSkeleton w={10} h={10} />
              </div>
            ))}
          </section>
        </div>

        {/* Right rail */}
        <aside
          className="flex flex-col"
          style={{
            gap: 28,
            minWidth: 0,
            borderLeft: "1px solid var(--color-codex-line)",
            paddingLeft: 36,
          }}
        >
          {[0, 1].map((s) => (
            <div key={s}>
              <div style={{ marginBottom: 12 }}>
                <CxSkeleton w={90} h={13} />
              </div>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-start"
                  style={{ gap: 10, padding: "8px 0" }}
                >
                  <CxSkeleton w={14} h={14} radius={3} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <CxSkeleton w="85%" h={13} />
                    <div style={{ marginTop: 5 }}>
                      <CxSkeleton w="50%" h={11} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ marginBottom: 14 }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--color-codex-ink-mute)",
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </h3>
      {action}
    </div>
  );
}
