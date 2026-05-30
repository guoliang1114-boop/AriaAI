import { Loader2, Sparkles, Wand2, X } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { getProjectNotesCopy } from "./projectNotesCopy";

interface ProjectNotesAIModalProps {
  aiDraft: string;
  aiLoading: boolean;
  aiResult: string;
  isOpen: boolean;
  isZh: boolean;
  onApply: (mode: "replace" | "append") => void;
  onChangeDraft: (value: string) => void;
  onClose: () => void;
  onGenerate: () => void;
}

export function ProjectNotesAIModal({
  aiDraft,
  aiLoading,
  aiResult,
  isOpen,
  isZh,
  onApply,
  onChangeDraft,
  onClose,
  onGenerate,
}: ProjectNotesAIModalProps) {
  const copy = getProjectNotesCopy(isZh);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-codex-line-soft px-6 py-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-codex-accent" />
            <h3 className="font-semibold text-codex-ink">{copy.aiTitle}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-codex-ink-faint hover:bg-codex-bg-tint"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-codex-ink-soft">
                {copy.aiDraftLabel}
              </label>
              <textarea
                value={aiDraft}
                onChange={(event) => onChangeDraft(event.target.value)}
                placeholder={copy.aiDraftPlaceholder}
                className="min-h-[220px] resize-none rounded-xl border border-codex-line bg-codex-bg-tint px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                onClick={onGenerate}
                disabled={aiLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-codex-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-codex-accent disabled:opacity-50"
              >
                {aiLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {copy.generate}
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-codex-ink-soft">
                {copy.generatedResult}
              </label>
              <div className="min-h-[220px] overflow-auto rounded-xl border border-codex-line bg-codex-bg-tint px-4 py-3">
                {aiResult.trim() ? (
                  <div className="md-root text-sm">
                    <MarkdownRenderer content={aiResult} />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-codex-ink-faint">
                    {copy.generatedResultEmpty}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onApply("replace")}
                  disabled={!aiResult.trim()}
                  className="flex-1 rounded-lg bg-codex-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {copy.replace}
                </button>
                <button
                  onClick={() => onApply("append")}
                  disabled={!aiResult.trim()}
                  className="flex-1 rounded-lg border border-codex-line px-4 py-2.5 text-sm font-medium text-codex-ink-soft hover:bg-codex-bg-tint disabled:opacity-50"
                >
                  {copy.append}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
