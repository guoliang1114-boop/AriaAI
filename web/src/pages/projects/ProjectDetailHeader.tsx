import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { ArrowLeft, Circle, Edit2, MoreHorizontal, Trash2, Users } from "lucide-react";
import type { Project } from "../../types/api";
import { resolveProjectStage } from "../../types/enums";
import { PROJECT_DETAIL_TABS, type ProjectDetailTabId } from "./projectDetailTabs";

/**
 * Status pill tone derived from the project stage. Returns Codex
 * surface + ink + border CSS values that work in both light and dark
 * (the warmth picker handles the warm/cool variations).
 */
function statusPillStyle(stage: ReturnType<typeof resolveProjectStage>): React.CSSProperties {
  // Phase → tone mapping. The old per-stage Tailwind palette
  // (blue / amber / emerald / indigo / violet / cyan / teal / sky)
  // didn't track Codex tokens; map each phase to one of the four
  // codex tones (accent / good / warn / bad / muted ink).
  const tone = stage.phase === "delivery"
    ? "good"
    : stage.phase === "archived"
      ? "neutral"
      : "accent"; // business phase
  const map = {
    accent: {
      color: "var(--color-codex-accent-ink)",
      background: "var(--color-codex-accent-bg)",
      border: "color-mix(in oklch, var(--color-codex-accent) 30%, transparent)",
    },
    good: {
      color: "var(--color-codex-good)",
      background: "color-mix(in oklch, var(--color-codex-good) 12%, transparent)",
      border: "color-mix(in oklch, var(--color-codex-good) 30%, transparent)",
    },
    neutral: {
      color: "var(--color-codex-ink-mute)",
      background: "var(--color-codex-bg-tint)",
      border: "var(--color-codex-line)",
    },
  } as const;
  const palette = map[tone];
  return {
    color: palette.color,
    background: palette.background,
    border: `1px solid ${palette.border}`,
  };
}

const TAB_LABEL_ZH: Partial<Record<ProjectDetailTabId, string>> = {
  memory: "项目记忆",
  stakeholders: "干系人",
  briefing: "会前简报",
  milestones: "任务",
};

const TAB_LABEL_EN: Partial<Record<ProjectDetailTabId, string>> = {
  memory: "Memory",
  stakeholders: "Stakeholders",
  briefing: "Briefing",
  milestones: "Tasks",
};

export function ProjectDetailHeader({
  project,
  onBack,
  projectId,
  onEdit,
  onOpenMembers,
  onDelete,
  canEdit = true,
  canDelete = true,
}: {
  project: Project;
  onBack: () => void;
  projectId: string;
  onEdit?: () => void;
  onOpenMembers?: () => void;
  onDelete?: () => void;
  /** Permission gates — supplied by ``useProjectAccess`` upstream. */
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const rawStatus = String(project.status || "").trim();
  const stage = resolveProjectStage(rawStatus);
  const statusLabel = rawStatus
    ? isZh
      ? stage.labelZh
      : stage.label
    : isZh
      ? "未知状态"
      : "Unknown";
  const visibleTabs = PROJECT_DETAIL_TABS;
  const labelFor = (tab: { id: ProjectDetailTabId; labelKey: string }) => {
    const map = isZh ? TAB_LABEL_ZH : TAB_LABEL_EN;
    return map[tab.id] ?? t(tab.labelKey);
  };

  return (
    <header
      className="theme-codex sticky top-0 z-30"
      style={{
        background:
          "color-mix(in oklch, var(--color-codex-bg-elev) 75%, var(--color-codex-bg))",
        borderBottom: "1px solid var(--color-codex-line)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div className="flex h-[52px] min-w-0 items-center px-4 sm:px-6" style={{ gap: 12 }}>
        <button
          type="button"
          onClick={onBack}
          title={t("nav.projects")}
          aria-label={t("nav.projects")}
          className="inline-flex flex-shrink-0 items-center justify-center transition-colors"
          style={{
            width: 30,
            height: 30,
            color: "var(--color-codex-ink-mute)",
            background: "transparent",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-sm, 6px)",
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Title block — client crumb + project name + status pill */}
        <div className="min-w-0 flex-shrink-0" style={{ maxWidth: 360 }}>
          <div
            className="truncate"
            style={{
              fontSize: 11,
              color: "var(--color-codex-ink-mute)",
              lineHeight: 1.3,
            }}
          >
            {project.client || t("nav.projects")}
          </div>
          <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
            <div
              className="truncate"
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
                letterSpacing: "-0.01em",
                lineHeight: 1.35,
              }}
            >
              {project.name}
            </div>
            <span
              className="hidden flex-shrink-0 items-center md:inline-flex"
              style={{
                ...statusPillStyle(stage),
                padding: "1px 8px",
                fontSize: 10.5,
                fontWeight: 500,
                gap: 4,
                borderRadius: 999,
                letterSpacing: "0.02em",
              }}
            >
              <Circle className="h-1.5 w-1.5 fill-current" />
              {statusLabel}
            </span>
            {project.memory_stale ? (
              <span
                className="hidden flex-shrink-0 items-center md:inline-flex"
                style={{
                  padding: "1px 8px",
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "var(--color-codex-warn)",
                  background:
                    "color-mix(in oklch, var(--color-codex-warn) 12%, transparent)",
                  border:
                    "1px solid color-mix(in oklch, var(--color-codex-warn) 28%, transparent)",
                  borderRadius: 999,
                  letterSpacing: "0.02em",
                }}
              >
                {isZh ? "记忆待更新" : "Memory stale"}
              </span>
            ) : null}
          </div>
        </div>

        {/* Tabs nav — horizontal scroll on overflow */}
        <nav className="flex min-w-0 flex-1 items-center overflow-x-auto" style={{ gap: 2 }}>
          {visibleTabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.getPath(projectId)}
              end={tab.path === ""}
              className={({ isActive }) =>
                `flex h-[52px] flex-shrink-0 items-center transition-colors${isActive ? " font-medium" : ""}`
              }
              style={({ isActive }) => ({
                gap: 6,
                padding: "0 10px",
                fontSize: 12.5,
                lineHeight: 1.35,
                color: isActive
                  ? "var(--color-codex-ink)"
                  : "var(--color-codex-ink-mute)",
                borderBottom: `2px solid ${
                  isActive ? "var(--color-codex-accent)" : "transparent"
                }`,
              })}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {labelFor(tab)}
            </NavLink>
          ))}
        </nav>

        {/* Utility area — edit + overflow menu (members / delete). The
         * old Settings tab has been collapsed into these actions per the
         * Codex handoff. Permission flags come from ``useProjectAccess``
         * upstream so the upcoming permissions sprint can lock them
         * without touching this component. */}
        {(onEdit || onOpenMembers || onDelete) ? (
          <div className="flex flex-shrink-0 items-center" style={{ gap: 6 }}>
            {onEdit && canEdit ? (
              <button
                type="button"
                onClick={onEdit}
                title={isZh ? "编辑项目" : "Edit project"}
                aria-label={isZh ? "编辑项目" : "Edit project"}
                className="inline-flex items-center justify-center transition-colors"
                style={{
                  width: 30,
                  height: 30,
                  color: "var(--color-codex-ink-mute)",
                  background: "transparent",
                  border: "1px solid var(--color-codex-line)",
                  borderRadius: "var(--codex-r-sm, 6px)",
                }}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {(onOpenMembers || (onDelete && canDelete)) ? (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  title={isZh ? "更多操作" : "More"}
                  aria-label={isZh ? "更多操作" : "More"}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="inline-flex items-center justify-center transition-colors"
                  style={{
                    width: 30,
                    height: 30,
                    color: "var(--color-codex-ink-mute)",
                    background: menuOpen
                      ? "var(--color-codex-bg-tint)"
                      : "transparent",
                    border: "1px solid var(--color-codex-line)",
                    borderRadius: "var(--codex-r-sm, 6px)",
                  }}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 z-40"
                    style={{
                      top: "calc(100% + 4px)",
                      minWidth: 180,
                      padding: 4,
                      background: "var(--color-codex-bg-elev)",
                      border: "1px solid var(--color-codex-line-strong, var(--color-codex-line))",
                      borderRadius: "var(--codex-r-md, 8px)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                    }}
                  >
                    {onOpenMembers ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenMembers();
                        }}
                        className="flex w-full items-center transition-colors"
                        style={{
                          gap: 8,
                          padding: "6px 8px",
                          fontSize: 12.5,
                          color: "var(--color-codex-ink)",
                          background: "transparent",
                          border: "none",
                          borderRadius: "var(--codex-r-sm, 6px)",
                          textAlign: "left",
                        }}
                      >
                        <Users className="h-3.5 w-3.5" />
                        {isZh ? "成员管理" : "Members"}
                      </button>
                    ) : null}
                    {onDelete && canDelete ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete();
                        }}
                        className="flex w-full items-center transition-colors"
                        style={{
                          gap: 8,
                          padding: "6px 8px",
                          fontSize: 12.5,
                          color: "var(--color-codex-bad)",
                          background: "transparent",
                          border: "none",
                          borderRadius: "var(--codex-r-sm, 6px)",
                          textAlign: "left",
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {isZh ? "删除项目" : "Delete project"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
