import type { ProjectMemoryQuickAction } from "./projectChatCopy";

interface ProjectChatMemoryQuickBarProps {
  actions: ProjectMemoryQuickAction[];
  onSelect: (prompt: string) => void;
}

export function ProjectChatMemoryQuickBar({
  actions,
  onSelect,
}: ProjectChatMemoryQuickBarProps) {
  return (
    <div className="border-b border-gray-100 bg-gray-50/80 px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => onSelect(action.prompt)}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
