import { Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getProjectChatCopy } from "./projectChatCopy";

type ProjectChatHeaderProps = {
  isSidebarOpen: boolean;
  title: string;
  subtitle: string;
  knowledgeScope: "project" | "client" | "global";
  exportControl?: React.ReactNode;
  onToggleSidebar: () => void;
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
};

export function ProjectChatHeader({
  isSidebarOpen,
  title,
  subtitle,
  knowledgeScope,
  exportControl,
  onToggleSidebar,
  onKnowledgeScopeChange,
}: ProjectChatHeaderProps) {
  const { i18n } = useTranslation();
  const copy = getProjectChatCopy(i18n.language.startsWith("zh"));

  return (
    <div className="flex items-center justify-between border-b border-gray-100 bg-white p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100"
        >
          {isSidebarOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 md:flex">
          <span className="text-xs text-gray-400">{copy.knowledgeScope}</span>
          <select
            value={knowledgeScope}
            onChange={(event) => onKnowledgeScopeChange(event.target.value as "project" | "client" | "global")}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="project">{copy.currentProject}</option>
            <option value="client">{copy.currentClient}</option>
            <option value="global">{copy.globalKnowledge}</option>
          </select>
        </div>
        {exportControl}
      </div>
    </div>
  );
}
