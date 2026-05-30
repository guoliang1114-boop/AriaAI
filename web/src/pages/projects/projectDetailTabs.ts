import {
  Brain,
  ClipboardList,
  DollarSign,
  Files,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Users,
} from "lucide-react";

/**
 * Project detail tabs — collapsed from the historical 12 to the 7
 * the Codex design handoff spells out (plus Financials, held
 * temporarily until the user supplies its design):
 *
 *   1. 项目对话 (Chat)
 *   2. 概览
 *   3. 会前简报
 *   4. 项目记忆 (will absorb the old "锚点" panel as a pinned section)
 *   5. 干系人
 *   6. 推进 (= 里程碑 + 待办 merged)
 *   7. 文档
 *   + 财务  ← temporary, pending design
 *
 * Removed: 笔记 (per handoff "daily notes belong in chat"), 空间
 * (was a redundant local addition), 锚点 (merging into 项目记忆 in
 * the next phase), 设置 (project-level edit / delete / members now
 * live on the header utility area, not as a tab).
 */
export type ProjectDetailTabId =
  | "overview"
  | "briefing"
  | "chat"
  | "documents"
  | "milestones"
  | "stakeholders"
  | "financials"
  | "memory";

interface ProjectDetailTabConfig {
  id: ProjectDetailTabId;
  labelKey: string;
  icon: typeof LayoutDashboard;
  path: string;
  getPath: (projectId: string) => string;
}

// Order matches the design handoff layout (chat first as the primary
// surface, then overview, briefing, memory, stakeholders, 推进, docs).
// Financials sits at the end pending its design.
export const PROJECT_DETAIL_TABS: ProjectDetailTabConfig[] = [
  {
    id: "chat",
    labelKey: "projects.projectDetail.chat",
    icon: MessageSquare,
    path: "chat",
    getPath: (projectId) => `/projects/${projectId}/chat`,
  },
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
    id: "memory",
    labelKey: "projects.projectDetail.memory",
    icon: Brain,
    path: "memory",
    getPath: (projectId) => `/projects/${projectId}/memory`,
  },
  {
    id: "stakeholders",
    labelKey: "projects.projectDetail.stakeholders",
    icon: Users,
    path: "stakeholders",
    getPath: (projectId) => `/projects/${projectId}/stakeholders`,
  },
  {
    id: "milestones",
    labelKey: "projects.projectDetail.milestones",
    icon: ListTodo,
    path: "milestones",
    getPath: (projectId) => `/projects/${projectId}/milestones`,
  },
  {
    id: "documents",
    labelKey: "projects.projectDetail.documents",
    icon: Files,
    path: "documents",
    getPath: (projectId) => `/projects/${projectId}/documents`,
  },
  {
    id: "financials",
    labelKey: "projects.projectDetail.financials",
    icon: DollarSign,
    path: "financials",
    getPath: (projectId) => `/projects/${projectId}/financials`,
  },
];

export function getActiveProjectDetailTabId(
  pathname: string,
  projectId?: string,
): ProjectDetailTabId {
  if (!projectId) {
    return "overview";
  }

  // Chat sub-routes (e.g. /chat/<conversationId>) still resolve to the
  // chat tab.
  if (
    pathname === `/projects/${projectId}/chat` ||
    pathname.startsWith(`/projects/${projectId}/chat/`)
  ) {
    return "chat";
  }

  // Legacy URLs that pointed at deprecated routes — keep them resolving
  // to the closest live tab so back-buttons / shared links don't 404.
  const legacyToMemoryPaths = [
    `/projects/${projectId}/anchors`,
  ];
  if (legacyToMemoryPaths.includes(pathname)) {
    return "memory";
  }
  const legacyToDocumentsPaths = [
    `/projects/${projectId}/notes`,
    `/projects/${projectId}/space`,
  ];
  if (legacyToDocumentsPaths.includes(pathname)) {
    return "documents";
  }
  // /todos used to live; now under 推进.
  if (pathname === `/projects/${projectId}/todos`) {
    return "milestones";
  }
  // /settings is gone; project edit lives on the header utility area.
  // Fall through to overview so legacy /settings links land somewhere
  // sane instead of 404.
  if (pathname === `/projects/${projectId}/settings`) {
    return "overview";
  }

  const matchedTab = PROJECT_DETAIL_TABS.find(
    (tab) => pathname === tab.getPath(projectId),
  );
  return matchedTab?.id ?? "overview";
}
