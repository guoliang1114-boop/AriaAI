import {
  BookOpen,
  Brain,
  ClipboardList,
  DollarSign,
  Files,
  Flag,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";

export type ProjectDetailTabId =
  | "overview"
  | "briefing"
  | "space"
  | "documents"
  | "milestones"
  | "notes"
  | "todos"
  | "chat"
  | "stakeholders"
  | "financials"
  | "memory"
  | "anchors"
  | "settings";

interface ProjectDetailTabConfig {
  id: ProjectDetailTabId;
  labelKey: string;
  icon: typeof LayoutDashboard;
  path: string;
  getPath: (projectId: string) => string;
  hiddenInNav?: boolean;
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
    id: "briefing",
    labelKey: "projects.projectDetail.briefing",
    icon: ClipboardList,
    path: "briefing",
    getPath: (projectId) => `/projects/${projectId}/briefing`,
  },
  {
    id: "space",
    labelKey: "projects.projectDetail.space",
    icon: BookOpen,
    path: "space",
    getPath: (projectId) => `/projects/${projectId}/space`,
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
    id: "stakeholders",
    labelKey: "projects.projectDetail.stakeholders",
    icon: Users,
    path: "stakeholders",
    getPath: (projectId) => `/projects/${projectId}/stakeholders`,
  },
  {
    id: "memory",
    labelKey: "projects.projectDetail.memory",
    icon: Brain,
    path: "memory",
    getPath: (projectId) => `/projects/${projectId}/memory`,
  },
  {
    id: "anchors",
    labelKey: "projects.projectDetail.anchors",
    icon: SlidersHorizontal,
    path: "anchors",
    getPath: (projectId) => `/projects/${projectId}/anchors`,
    hiddenInNav: true,
  },
  {
    id: "financials",
    labelKey: "projects.projectDetail.financials",
    icon: DollarSign,
    path: "financials",
    getPath: (projectId) => `/projects/${projectId}/financials`,
  },
  {
    id: "notes",
    labelKey: "projects.projectDetail.notes",
    icon: BookOpen,
    path: "notes",
    getPath: (projectId) => `/projects/${projectId}/notes`,
    hiddenInNav: true,
  },
  {
    id: "documents",
    labelKey: "projects.projectDetail.documents",
    icon: Files,
    path: "documents",
    getPath: (projectId) => `/projects/${projectId}/documents`,
    hiddenInNav: true,
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

  const legacySpacePaths = [
    `/projects/${projectId}/notes`,
    `/projects/${projectId}/documents`,
  ];
  if (legacySpacePaths.includes(pathname)) {
    return "space";
  }

  const matchedTab = PROJECT_DETAIL_TABS.find(
    (tab) => pathname === tab.getPath(projectId),
  );

  return matchedTab?.id ?? "overview";
}
