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
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <FileText className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">
              {isZh ? "文件变更对比" : "File Changes"}
              {fileName ? ` — ${fileName}` : ""}
            </h3>
            <span className="ml-2 inline-flex items-center gap-1.5 text-xs">
              {removedCount > 0 ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">
                  -{removedCount}
                </span>
              ) : null}
              {addedCount > 0 ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">
                  +{addedCount}
                </span>
              ) : null}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toggle raw views */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-2">
          <button
            onClick={() => setShowOld((v) => !v)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showOld ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {isZh ? "原内容" : "Original"}
          </button>
          <button
            onClick={() => setShowNew((v) => !v)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showNew ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {isZh ? "新内容" : "New"}
          </button>
        </div>

        {/* Diff body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {showOld ? (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                {isZh ? "原内容" : "Original"}
              </p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
                {oldContent || (isZh ? "（空文件）" : "(empty)")}
              </pre>
            </div>
          ) : null}
          {showNew ? (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                {isZh ? "新内容" : "New"}
              </p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
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
                      className="flex bg-emerald-50/60 text-emerald-900"
                    >
                      <span className="w-6 shrink-0 select-none pr-2 text-right text-emerald-400">+</span>
                      <span className="break-all">{line || " "}</span>
                    </div>
                  ));
                }
                if (part.removed) {
                  return lines.map((line, li) => (
                    <div
                      key={`rem-${index}-${li}`}
                      className="flex bg-red-50/60 text-red-900"
                    >
                      <span className="w-6 shrink-0 select-none pr-2 text-right text-red-400">-</span>
                      <span className="break-all">{line || " "}</span>
                    </div>
                  ));
                }
                return lines.map((line, li) => (
                  <div key={`same-${index}-${li}`} className="flex text-gray-600">
                    <span className="w-6 shrink-0 select-none pr-2 text-right text-gray-300">
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
