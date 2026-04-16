import { Lightbulb, Loader2, Sparkles, Wand2 } from 'lucide-react'

interface AISuggestion {
  name: string
  description: string
}

interface NewProjectAIPanelProps {
  aiError: string | null
  aiQuery: string
  isAILoading: boolean
  onApplySuggestion: (suggestion: AISuggestion) => void
  onQueryChange: (value: string) => void
  onRun: () => void
  suggestions: AISuggestion[]
}

export function NewProjectAIPanel({
  aiError,
  aiQuery,
  isAILoading,
  onApplySuggestion,
  onQueryChange,
  onRun,
  suggestions,
}: NewProjectAIPanelProps) {
  return (
    <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 to-purple-500/5 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-on-surface">AI 智能填写</span>
      </div>
      <p className="text-xs text-on-surface-muted mb-3">描述项目背景，AI 自动生成项目名称和描述</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Lightbulb className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-muted pointer-events-none" />
          <input
            type="text"
            value={aiQuery}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), onRun())}
            placeholder="例如：帮助太太乐进行 ERP 系统升级..."
            className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={isAILoading || !aiQuery.trim()}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white text-sm rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 whitespace-nowrap"
        >
          {isAILoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          {isAILoading ? '生成中...' : 'AI 填写'}
        </button>
      </div>
      {aiError && <p className="mt-2 text-xs text-amber-600">⚠️ {aiError}</p>}
      {suggestions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs text-on-surface-muted">其他建议（点击应用）</p>
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.name}-${index}`}
              type="button"
              onClick={() => onApplySuggestion(suggestion)}
              className="w-full text-left px-3.5 py-2.5 bg-white rounded-xl border border-outline/15 hover:border-primary/30 transition-colors"
            >
              <p className="text-sm font-medium text-on-surface">{suggestion.name}</p>
              <p className="text-xs text-on-surface-muted line-clamp-1 mt-0.5">{suggestion.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
