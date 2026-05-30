import { Loader2, Sparkles, Wand2 } from "lucide-react";

interface SuggestionItem {
  name: string;
  description: string;
}

interface ProjectSettingsAIAssistantProps {
  aiError: string;
  description: string;
  isAILoading: boolean;
  isZh: boolean;
  onApplySuggestion: (suggestion: SuggestionItem) => void;
  onPolish: () => void;
  onSuggest: () => void;
  showSuggestions: boolean;
  suggestions: SuggestionItem[];
}

export function ProjectSettingsAIAssistant({
  aiError,
  description,
  isAILoading,
  isZh,
  onApplySuggestion,
  onPolish,
  onSuggest,
  showSuggestions,
  suggestions,
}: ProjectSettingsAIAssistantProps) {
  return (
    <div className="rounded-xl border border-primary/10 bg-gradient-to-r from-primary/5 to-purple-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-codex-accent" />
        <span className="text-sm font-medium text-codex-ink-soft">
          {isZh ? "AI 助手" : "AI Assistant"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSuggest}
          disabled={isAILoading}
          className="flex items-center gap-1.5 rounded-lg bg-codex-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-codex-accent/90 disabled:opacity-50"
        >
          {isAILoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          {isZh ? "生成建议" : "Generate"}
        </button>

        {description && (
          <button
            type="button"
            onClick={onPolish}
            disabled={isAILoading}
            className="flex items-center gap-1.5 rounded-lg border border-primary bg-white px-3 py-1.5 text-sm text-codex-accent transition-colors hover:bg-codex-accent/5 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isZh ? "优化描述" : "Polish"}
          </button>
        )}
      </div>

      {aiError && <div className="mt-2 text-xs text-codex-warn">{aiError}</div>}

      {showSuggestions && suggestions.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-codex-ink-mute">
            {isZh ? "AI 建议，点击即可应用" : "AI suggestions, click to apply"}
          </p>
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.name}-${index}`}
              type="button"
              onClick={() => onApplySuggestion(suggestion)}
              className="w-full rounded-lg border border-codex-line bg-white p-3 text-left transition-all hover:border-primary/50 hover:shadow-sm"
            >
              <p className="text-sm font-medium text-codex-ink">{suggestion.name}</p>
              <p className="line-clamp-2 text-xs text-codex-ink-mute">
                {suggestion.description}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
