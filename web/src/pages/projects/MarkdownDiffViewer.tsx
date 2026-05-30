import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { X, FileText } from "lucide-react";

interface MarkdownDiffViewerProps {
  oldContent: string;
  newContent: string;
  fileName?: string;
  isZh?: boolean;
  onClose: () => void;
}

export function MarkdownDiffViewer({
  oldContent,
  newContent,
  fileName,
  isZh = true,
  onClose,
}: MarkdownDiffViewerProps) {
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const changes = useMemo(() => {
    return diffLines(oldContent || "", newContent || "");
  }, [oldContent, newContent]);

  const addedCount = changes.filter((c) => c.added).length;
  const removedCount = changes.filter((c) => c.removed).length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-codex-line bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-codex-line-soft px-5 py-3">
          <div className="flex items-center gap-2.5">
            <FileText className="h-4 w-4 text-codex-ink-faint" />
            <h3 className="text-sm font-semibold text-codex-ink">
              {isZh ? "文件变更对比" : "File Changes"}
              {fileName ? ` — ${fileName}` : ""}
            </h3>
            <span className="ml-2 inline-flex items-center gap-1.5 text-xs">
              {removedCount > 0 ? (
                <span className="rounded-full bg-codex-bg-tint px-2 py-0.5 text-codex-bad">
                  -{removedCount}
                </span>
              ) : null}
              {addedCount > 0 ? (
                <span className="rounded-full bg-codex-accent-bg px-2 py-0.5 text-codex-good">
                  +{addedCount}
                </span>
              ) : null}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-codex-ink-faint hover:bg-codex-bg-tint hover:text-codex-ink-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toggle raw views */}
        <div className="flex items-center gap-2 border-b border-codex-line-soft px-5 py-2">
          <button
            onClick={() => setShowOld((v) => !v)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showOld ? "bg-codex-bg-tint text-codex-ink-soft" : "text-codex-ink-faint hover:text-codex-ink-soft"
            }`}
          >
            {isZh ? "原内容" : "Original"}
          </button>
          <button
            onClick={() => setShowNew((v) => !v)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showNew ? "bg-codex-bg-tint text-codex-ink-soft" : "text-codex-ink-faint hover:text-codex-ink-soft"
            }`}
          >
            {isZh ? "新内容" : "New"}
          </button>
        </div>

        {/* Diff body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {showOld ? (
            <div className="mb-4 rounded-lg border border-codex-line bg-codex-bg-tint p-3">
              <p className="mb-2 text-xs font-medium text-codex-ink-faint">
                {isZh ? "原内容" : "Original"}
              </p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-codex-ink-soft">
                {oldContent || (isZh ? "（空文件）" : "(empty)")}
              </pre>
            </div>
          ) : null}
          {showNew ? (
            <div className="mb-4 rounded-lg border border-codex-line bg-codex-bg-tint p-3">
              <p className="mb-2 text-xs font-medium text-codex-ink-faint">
                {isZh ? "新内容" : "New"}
              </p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-codex-ink-soft">
                {newContent || (isZh ? "（空文件）" : "(empty)")}
              </pre>
            </div>
          ) : null}

          {!showOld && !showNew ? (
            <div className="space-y-0.5 font-mono text-xs leading-relaxed">
              {changes.map((part, index) => {
                const lines = part.value.split("\n").filter((line, i, arr) => {
                  // Keep empty lines if they're not trailing
                  if (i === arr.length - 1 && line === "" && arr.length > 1) return false;
                  return true;
                });
                if (part.added) {
                  return lines.map((line, li) => (
                    <div
                      key={`add-${index}-${li}`}
                      className="flex bg-codex-accent-bg/60 text-codex-good"
                    >
                      <span className="w-6 shrink-0 select-none pr-2 text-right text-codex-good">+</span>
                      <span className="break-all">{line || " "}</span>
                    </div>
                  ));
                }
                if (part.removed) {
                  return lines.map((line, li) => (
                    <div
                      key={`rem-${index}-${li}`}
                      className="flex bg-codex-bg-tint/60 text-codex-bad"
                    >
                      <span className="w-6 shrink-0 select-none pr-2 text-right text-codex-bad">-</span>
                      <span className="break-all">{line || " "}</span>
                    </div>
                  ));
                }
                return lines.map((line, li) => (
                  <div key={`same-${index}-${li}`} className="flex text-codex-ink-soft">
                    <span className="w-6 shrink-0 select-none pr-2 text-right text-codex-ink-faint">
                      &middot;
                    </span>
                    <span className="break-all">{line || " "}</span>
                  </div>
                ));
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
