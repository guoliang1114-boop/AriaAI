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
    <div className="border-b border-codex-line-soft bg-codex-bg-tint/80 px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => onSelect(action.prompt)}
            className="rounded-full border border-codex-line bg-white px-3 py-1.5 text-xs font-medium text-codex-ink-soft transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-codex-accent"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
