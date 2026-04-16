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
  label: string;
  labelZh: string;
  icon: typeof LayoutDashboard;
  path: string;
  getPath: (projectId: string) => string;
}

export const PROJECT_DETAIL_TABS: ProjectDetailTabConfig[] = [
  {
    id: "overview",
    label: "Overview",
    labelZh: "\u6982\u89c8",
    icon: LayoutDashboard,
    path: "",
    getPath: (projectId) => `/projects/${projectId}`,
  },
  {
    id: "notes",
    label: "Notes",
    labelZh: "\u7b14\u8bb0",
    icon: BookOpen,
    path: "notes",
    getPath: (projectId) => `/projects/${projectId}/notes`,
  },
  {
    id: "todos",
    label: "Todos",
    labelZh: "\u5f85\u529e",
    icon: ListTodo,
    path: "todos",
    getPath: (projectId) => `/projects/${projectId}/todos`,
  },
  {
    id: "milestones",
    label: "Milestones",
    labelZh: "\u91cc\u7a0b\u7891",
    icon: Flag,
    path: "milestones",
    getPath: (projectId) => `/projects/${projectId}/milestones`,
  },
  {
    id: "chat",
    label: "Project Chat",
    labelZh: "\u9879\u76ee\u5bf9\u8bdd",
    icon: MessageSquare,
    path: "chat",
    getPath: (projectId) => `/projects/${projectId}/chat`,
  },
  {
    id: "financials",
    label: "Financials",
    labelZh: "\u8d22\u52a1",
    icon: DollarSign,
    path: "financials",
    getPath: (projectId) => `/projects/${projectId}/financials`,
  },
  {
    id: "documents",
    label: "Documents",
    labelZh: "\u6587\u6863",
    icon: Files,
    path: "documents",
    getPath: (projectId) => `/projects/${projectId}/documents`,
  },
  {
    id: "settings",
    label: "Settings",
    labelZh: "\u8bbe\u7f6e",
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
