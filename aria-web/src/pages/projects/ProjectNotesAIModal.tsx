import { Loader2, Sparkles, Wand2, X } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";

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

const COPY = {
  title: { zh: "AI 写作助手", en: "AI Writing Assistant" },
  draftLabel: { zh: "草稿或补充说明", en: "Draft or instruction" },
  draftPlaceholder: {
    zh: "输入补充要求，或留空以直接润色当前文档。",
    en: "Add guidance here, or leave empty to polish the current document.",
  },
  generate: { zh: "生成", en: "Generate" },
  resultLabel: { zh: "生成结果", en: "Generated result" },
  resultEmpty: {
    zh: "生成结果会显示在这里",
    en: "The generated result will appear here",
  },
  replace: { zh: "替换当前内容", en: "Replace" },
  append: { zh: "追加到文档", en: "Append" },
} as const;

function pick(
  isZh: boolean,
  value: {
    zh: string;
    en: string;
  },
) {
  return isZh ? value.zh : value.en;
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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-indigo-600" />
            <h3 className="font-semibold text-gray-900">
              {pick(isZh, COPY.title)}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-gray-700">
                {pick(isZh, COPY.draftLabel)}
              </label>
              <textarea
                value={aiDraft}
                onChange={(event) => onChangeDraft(event.target.value)}
                placeholder={pick(isZh, COPY.draftPlaceholder)}
                className="min-h-[220px] resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                onClick={onGenerate}
                disabled={aiLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {aiLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {pick(isZh, COPY.generate)}
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-gray-700">
                {pick(isZh, COPY.resultLabel)}
              </label>
              <div className="min-h-[220px] overflow-auto rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                {aiResult.trim() ? (
                  <div className="md-root text-sm">
                    <MarkdownRenderer content={aiResult} />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400">
                    {pick(isZh, COPY.resultEmpty)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onApply("replace")}
                  disabled={!aiResult.trim()}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {pick(isZh, COPY.replace)}
                </button>
                <button
                  onClick={() => onApply("append")}
                  disabled={!aiResult.trim()}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {pick(isZh, COPY.append)}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
