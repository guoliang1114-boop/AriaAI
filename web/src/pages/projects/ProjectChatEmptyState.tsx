import { Bot } from "lucide-react";
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
    <div className="flex w-full flex-col items-center justify-center text-gray-500">
      <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center mb-4 border border-primary/10">
        <Bot className="w-8 h-8 text-primary/40" />
      </div>
      <p className="text-base font-semibold text-gray-900 mb-2">{startConversationLabel}</p>
      <p className="text-sm text-gray-500 mb-6 max-w-xs text-center">{choosePromptLabel}</p>
      <div className="grid w-full max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt.key}
            onClick={() => onQuickPrompt(prompt.prompt)}
            className="flex items-center gap-2 p-3 bg-white border border-gray-200 hover:border-primary/30 hover:bg-primary/5 rounded-xl text-left transition-all shadow-sm hover:shadow"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <prompt.icon className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-gray-700">{prompt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
