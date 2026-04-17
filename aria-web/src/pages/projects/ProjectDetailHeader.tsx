import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { ChevronRight, FolderKanban } from "lucide-react";
import type { Project } from "../../types/api";
import { PROJECT_DETAIL_TABS } from "./projectDetailTabs";

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

  return (
    <div className="sticky top-0 z-30 border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-full px-6">
        <div className="flex items-center gap-2 py-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-primary"
          >
            <FolderKanban className="h-4 w-4" />
            <span>{t("nav.projects")}</span>
          </button>
          <ChevronRight className="h-4 w-4 text-gray-400" />
          <span className="max-w-[200px] truncate text-sm font-medium text-gray-900">
            {project.name}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-full border-t border-gray-100 px-6">
        <div className="flex items-center gap-1">
          {PROJECT_DETAIL_TABS.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.getPath(projectId)}
              end={tab.path === ""}
              className={({ isActive }) =>
                `flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`
              }
            >
              <tab.icon className="h-4 w-4" />
              {tab.id === "memory" ? (isZh ? "项目记忆" : "Memory") : t(tab.labelKey)}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}
