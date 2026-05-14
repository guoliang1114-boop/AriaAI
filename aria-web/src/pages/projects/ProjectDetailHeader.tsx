import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { ArrowLeft, Circle } from "lucide-react";
import type { Project } from "../../types/api";
import { PROJECT_DETAIL_TABS } from "./projectDetailTabs";

const fallbackStatusTone = "bg-slate-100 text-slate-600 ring-slate-200";

const statusTone: Partial<Record<Project["status"], string>> = {
  lead: "bg-sky-50 text-sky-700 ring-sky-200",
  opportunity: "bg-amber-50 text-amber-700 ring-amber-200",
  won: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  delivering: "bg-blue-50 text-blue-700 ring-blue-200",
  archived: "bg-slate-100 text-slate-600 ring-slate-200",
};

const statusText: Partial<Record<Project["status"], { zh: string; en: string }>> = {
  lead: { zh: "线索", en: "Lead" },
  opportunity: { zh: "机会", en: "Opportunity" },
  won: { zh: "已赢单", en: "Won" },
  delivering: { zh: "交付中", en: "Delivering" },
  archived: { zh: "已归档", en: "Archived" },
};

export function ProjectDetailHeader({
  project,
  onBack,
  projectId,
}: {
  project: Project;
  onBack: () => void;
  projectId: string;
}) {
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const rawStatus = String(project.status || "").trim();
  const statusMeta = statusText[project.status];
  const statusLabel = statusMeta ? (isZh ? statusMeta.zh : statusMeta.en) : rawStatus || (isZh ? "未知状态" : "Unknown");
  const statusClassName = statusTone[project.status] ?? fallbackStatusTone;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto max-w-full px-4 sm:px-6">
        <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
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
                    <span className="max-w-[220px] truncate">{project.client}</span>
                  </>
                ) : null}
              </div>
              <h1 className="truncate font-manrope text-xl font-semibold text-slate-950 sm:text-2xl">
                {project.name}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${statusClassName}`}
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
          {PROJECT_DETAIL_TABS.filter((tab) => !tab.hiddenInNav).map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.getPath(projectId)}
              end={tab.path === ""}
              className={({ isActive }) =>
                `flex flex-shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:px-4 ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`
              }
            >
              <tab.icon className="h-4 w-4" />
              {tab.id === "memory"
                ? isZh ? "项目记忆" : "Memory"
                : tab.id === "stakeholders"
                  ? isZh ? "干系人" : "Stakeholders"
                  : tab.id === "briefing"
                    ? isZh ? "会前简报" : "Briefing"
                    : t(tab.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
