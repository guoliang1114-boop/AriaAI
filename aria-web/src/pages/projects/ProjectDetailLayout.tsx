import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import {
  BookOpen,
  ChevronRight,
  DollarSign,
  Files,
  Flag,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Settings,
} from "lucide-react";
import type {
  Project,
  ProjectDetail as ProjectDetailType,
} from "../../types/api";
import { ProjectChatTab } from "./ProjectChatTab";
import { ProjectNotesTab } from "./ProjectNotesTab";
import { ProjectTodosTab } from "./ProjectTodosTab";

type TabId =
  | "overview"
  | "documents"
  | "milestones"
  | "notes"
  | "todos"
  | "chat"
  | "financials"
  | "settings";

interface TabConfig {
  id: TabId;
  label: string;
  labelZh: string;
  icon: typeof LayoutDashboard;
  path: string;
  getPath: (projectId: string) => string;
}

const TABS: TabConfig[] = [
  {
    id: "overview",
    label: "Overview",
    labelZh: "概览",
    icon: LayoutDashboard,
    path: "",
    getPath: (id) => `/projects/${id}`,
  },
  {
    id: "notes",
    label: "Notes",
    labelZh: "笔记",
    icon: BookOpen,
    path: "notes",
    getPath: (id) => `/projects/${id}/notes`,
  },
  {
    id: "todos",
    label: "Todos",
    labelZh: "待办",
    icon: ListTodo,
    path: "todos",
    getPath: (id) => `/projects/${id}/todos`,
  },
  {
    id: "milestones",
    label: "Milestones",
    labelZh: "里程碑",
    icon: Flag,
    path: "milestones",
    getPath: (id) => `/projects/${id}/milestones`,
  },
  {
    id: "chat",
    label: "Project Chat",
    labelZh: "项目对话",
    icon: MessageSquare,
    path: "chat",
    getPath: (id) => `/projects/${id}/chat`,
  },
  {
    id: "financials",
    label: "Financials",
    labelZh: "财务",
    icon: DollarSign,
    path: "financials",
    getPath: (id) => `/projects/${id}/financials`,
  },
  {
    id: "documents",
    label: "Documents",
    labelZh: "文档",
    icon: Files,
    path: "documents",
    getPath: (id) => `/projects/${id}/documents`,
  },
  {
    id: "settings",
    label: "Settings",
    labelZh: "设置",
    icon: Settings,
    path: "settings",
    getPath: (id) => `/projects/${id}/settings`,
  },
];

function ProjectHeader({
  project,
  onBack,
  projectId,
}: {
  project: Project;
  onBack: () => void;
  projectId: string;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-full mx-auto px-6">
        <div className="flex items-center gap-2 py-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-primary transition-colors"
          >
            <FolderKanban className="w-4 h-4" />
            <span>{isZh ? "项目空间" : "Projects"}</span>
          </button>
          <ChevronRight className="w-4 h-4 text-gray-400" />
          <span className="text-gray-900 font-medium truncate max-w-[200px] text-sm">
            {project.name}
          </span>
        </div>
      </div>

      <div className="max-w-full mx-auto px-6 border-t border-gray-100">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.getPath(projectId)}
              end={tab.path === ""}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`
              }
            >
              <tab.icon className="w-4 h-4" />
              {isZh ? tab.labelZh : tab.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

function PersistentProjectTabs({
  projectId,
  project,
  projectDetail,
  isChatTab,
  isNotesTab,
  isTodosTab,
  onRefresh,
}: {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  isChatTab: boolean;
  isNotesTab: boolean;
  isTodosTab: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      {isChatTab && (
        <div className="flex-1 overflow-hidden px-6 py-4">
          <ProjectChatTab
            project={project}
            files={projectDetail.files}
            folders={projectDetail.folders}
            onProjectUpdate={onRefresh}
          />
        </div>
      )}
      {!isChatTab && (
        <div className="hidden">
          <ProjectChatTab
            project={project}
            files={projectDetail.files}
            folders={projectDetail.folders}
            onProjectUpdate={onRefresh}
          />
        </div>
      )}

      {isNotesTab && (
        <div className="max-w-full mx-auto px-6 py-6 min-h-[calc(100vh-180px)]">
          <ProjectNotesTab
            projectId={projectId}
            projectName={project.name}
            files={projectDetail.files}
            folders={projectDetail.folders}
            onUpdate={onRefresh}
          />
        </div>
      )}
      {!isNotesTab && (
        <div className="hidden">
          <ProjectNotesTab
            projectId={projectId}
            projectName={project.name}
            files={projectDetail.files}
            folders={projectDetail.folders}
            onUpdate={onRefresh}
          />
        </div>
      )}

      {isTodosTab && (
        <div className="max-w-full mx-auto px-6 py-6 min-h-[calc(100vh-180px)]">
          <ProjectTodosTab
            projectId={projectId}
            todos={projectDetail.todos}
            onUpdate={onRefresh}
          />
        </div>
      )}
      {!isTodosTab && (
        <div className="hidden">
          <ProjectTodosTab
            projectId={projectId}
            todos={projectDetail.todos}
            onUpdate={onRefresh}
          />
        </div>
      )}
    </>
  );
}

export function ProjectDetailLayout({
  projectId,
  project,
  projectDetail,
  isChatTab,
  isNotesTab,
  isTodosTab,
  onBack,
  onRefresh,
  children,
}: {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  isChatTab: boolean;
  isNotesTab: boolean;
  isTodosTab: boolean;
  onBack: () => void;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={
        isChatTab
          ? "bg-gray-50 h-screen overflow-hidden flex flex-col"
          : "min-h-full bg-gray-50"
      }
    >
      <ProjectHeader project={project} onBack={onBack} projectId={projectId} />

      <PersistentProjectTabs
        projectId={projectId}
        project={project}
        projectDetail={projectDetail}
        isChatTab={isChatTab}
        isNotesTab={isNotesTab}
        isTodosTab={isTodosTab}
        onRefresh={onRefresh}
      />

      <div
        className={`max-w-full mx-auto px-6 py-6 min-h-[calc(100vh-180px)] ${isChatTab || isNotesTab || isTodosTab ? "hidden" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
