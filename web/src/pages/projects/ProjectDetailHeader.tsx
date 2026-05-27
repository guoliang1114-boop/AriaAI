import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { ArrowLeft, Circle } from "lucide-react";
import type { Project } from "../../types/api";
import { resolveProjectStage } from "../../types/enums";
import { PROJECT_DETAIL_TABS } from "./projectDetailTabs";

export function ProjectDetailHeader({
  project,
  onBack,
  projectId,
  compact = false,
}: {
  project: Project;
  onBack: () => void;
  projectId: string;
  compact?: boolean;
}) {
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
  const statusClassName = `${stage.bgColor} ${stage.color} ${stage.borderColor}`;
  const visibleTabs = PROJECT_DETAIL_TABS.filter((tab) => !tab.hiddenInNav);
  const renderTabLabel = (
    tabId: (typeof visibleTabs)[number]["id"],
    labelKey: string,
  ) =>
    tabId === "memory"
      ? isZh
        ? "项目记忆"
        : "Memory"
      : tabId === "stakeholders"
        ? isZh
          ? "干系人"
          : "Stakeholders"
        : tabId === "briefing"
          ? isZh
            ? "会前简报"
            : "Briefing"
          : tabId === "milestones"
            ? isZh
              ? "任务"
              : "Tasks"
            : t(labelKey);

  if (compact) {
    return (
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
        <div className="flex h-[52px] min-w-0 items-center gap-3 px-4 sm:px-6">
          <button
            onClick={onBack}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-primary/30 hover:text-primary"
            title={t("nav.projects")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-shrink-0 basis-[360px]">
            <div className="truncate text-xs text-slate-500">
              {project.client || t("nav.projects")}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-[13px] font-semibold leading-5 text-slate-950">
                {project.name}
              </div>
              <span
                className={`hidden flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold md:inline-flex ${statusClassName}`}
              >
                <Circle className="h-1.5 w-1.5 fill-current" />
                {statusLabel}
              </span>
            </div>
          </div>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {visibleTabs.map((tab) => (
              <NavLink
                key={tab.id}
                to={tab.getPath(projectId)}
                end={tab.path === ""}
                className={({ isActive }) =>
                  `flex h-[52px] flex-shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium leading-5 transition-colors ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                  }`
                }
              >
                <tab.icon className="h-4 w-4" />
                {renderTabLabel(tab.id, tab.labelKey)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto max-w-full px-4 sm:px-6">
        <div className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              onClick={onBack}
              className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-primary/30 hover:text-primary"
              title={t("nav.projects")}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{t("nav.projects")}</span>
                {project.client ? (
                  <>
                    <span>/</span>
                    <span className="max-w-[220px] truncate">
                      {project.client}
                    </span>
                  </>
                ) : null}
              </div>
              <h1 className="truncate font-manrope text-base font-semibold leading-6 text-slate-950 sm:text-lg">
                {project.name}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${statusClassName}`}
            >
              <Circle className="h-2 w-2 fill-current" />
              {statusLabel}
            </span>
            {project.memory_stale ? (
              <span className="inline-flex items-center rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                {isZh ? "记忆待更新" : "Memory stale"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-full border-t border-slate-100 px-2 sm:px-6">
        <nav className="flex items-center gap-1 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.getPath(projectId)}
              end={tab.path === ""}
              className={({ isActive }) =>
                `flex flex-shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[12.5px] font-medium leading-5 transition-colors sm:px-3 ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`
              }
            >
              <tab.icon className="h-4 w-4" />
              {renderTabLabel(tab.id, tab.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
