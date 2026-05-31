import { Sparkles } from "lucide-react";
import type { ProjectQuickPrompt } from "./projectChatCopy";

interface ProjectChatEmptyStateProps {
  choosePromptLabel: string;
  onQuickPrompt: (content: string) => void;
  quickPrompts: ProjectQuickPrompt[];
  startConversationLabel: string;
}

export function ProjectChatEmptyState({
  choosePromptLabel,
  onQuickPrompt,
  quickPrompts,
  startConversationLabel,
}: ProjectChatEmptyStateProps) {
  return (
    <div
      className="flex w-full flex-col items-center justify-center"
      style={{ color: "var(--color-codex-ink-mute)" }}
    >
      <div
        className="mb-4 flex items-center justify-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--codex-r-sm, 6px)",
          background: "var(--color-codex-accent-bg)",
          color: "var(--color-codex-accent)",
          border: "1px solid var(--color-codex-line)",
        }}
      >
        <Sparkles className="h-5 w-5" />
      </div>
      <p
        className="mb-2"
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: "var(--color-codex-ink)",
          letterSpacing: "-0.01em",
        }}
      >
        {startConversationLabel}
      </p>
      <p
        className="mb-6 max-w-xs text-center"
        style={{
          fontSize: 13,
          color: "var(--color-codex-ink-mute)",
          lineHeight: 1.55,
        }}
      >
        {choosePromptLabel}
      </p>
      <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt.key}
            type="button"
            onClick={() => onQuickPrompt(prompt.prompt)}
            className="flex items-center text-left transition-colors"
            style={{
              gap: 10,
              padding: "10px 12px",
              background: "var(--color-codex-bg-elev)",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-sm, 6px)",
            }}
          >
            <span
              className="inline-flex flex-shrink-0 items-center justify-center"
              style={{
                width: 26,
                height: 26,
                borderRadius: "var(--codex-r-sm, 6px)",
                background: "var(--color-codex-accent-bg)",
                color: "var(--color-codex-accent)",
              }}
            >
              <prompt.icon className="h-3.5 w-3.5" />
            </span>
            <span
              style={{
                fontSize: 13,
                color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                fontWeight: 500,
              }}
            >
              {prompt.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
