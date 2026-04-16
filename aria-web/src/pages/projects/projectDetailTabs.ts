import {
  BookOpen,
  DollarSign,
  Files,
  Flag,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Settings,
} from "lucide-react";

export type ProjectDetailTabId =
  | "overview"
  | "documents"
  | "milestones"
  | "notes"
  | "todos"
  | "chat"
  | "financials"
  | "settings";

interface ProjectDetailTabConfig {
  id: ProjectDetailTabId;
  labelKey: string;
  icon: typeof LayoutDashboard;
  path: string;
  getPath: (projectId: string) => string;
}

export const PROJECT_DETAIL_TABS: ProjectDetailTabConfig[] = [
  {
    id: "overview",
    labelKey: "projects.projectDetail.overview",
    icon: LayoutDashboard,
    path: "",
    getPath: (projectId) => `/projects/${projectId}`,
  },
  {
    id: "notes",
    labelKey: "projects.projectDetail.notes",
    icon: BookOpen,
    path: "notes",
    getPath: (projectId) => `/projects/${projectId}/notes`,
  },
  {
    id: "todos",
    labelKey: "projects.projectDetail.todos",
    icon: ListTodo,
    path: "todos",
    getPath: (projectId) => `/projects/${projectId}/todos`,
  },
  {
    id: "milestones",
    labelKey: "projects.projectDetail.milestones",
    icon: Flag,
    path: "milestones",
    getPath: (projectId) => `/projects/${projectId}/milestones`,
  },
  {
    id: "chat",
    labelKey: "projects.projectDetail.chat",
    icon: MessageSquare,
    path: "chat",
    getPath: (projectId) => `/projects/${projectId}/chat`,
  },
  {
    id: "financials",
    labelKey: "projects.projectDetail.financials",
    icon: DollarSign,
    path: "financials",
    getPath: (projectId) => `/projects/${projectId}/financials`,
  },
  {
    id: "documents",
    labelKey: "projects.projectDetail.documents",
    icon: Files,
    path: "documents",
    getPath: (projectId) => `/projects/${projectId}/documents`,
  },
  {
    id: "settings",
    labelKey: "projects.projectDetail.settings",
    icon: Settings,
    path: "settings",
    getPath: (projectId) => `/projects/${projectId}/settings`,
  },
];

export function getActiveProjectDetailTabId(
  pathname: string,
  projectId?: string,
): ProjectDetailTabId {
  if (!projectId) {
    return "overview";
  }

  const matchedTab = PROJECT_DETAIL_TABS.find(
    (tab) => pathname === tab.getPath(projectId),
  );

  return matchedTab?.id ?? "overview";
}
