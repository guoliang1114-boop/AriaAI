import { BookOpen, Download, FileText, Loader2 } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { ProjectFile } from "../../types/api";

interface ProjectNotesContentPanelProps {
  content: string;
  copy: {
    editPlaceholder: string;
    emptyDescription: string;
    emptyTitle: string;
    previewEmpty: string;
  };
  isLoadingDoc: boolean;
  isZh: boolean;
  mode: "edit" | "preview" | "split";
  selectedFile: ProjectFile | null;
  onDownloadFile: (file: ProjectFile) => void;
  updateContent: (value: string) => void;
}

export function ProjectNotesContentPanel({
  content,
  copy,
  isLoadingDoc,
  isZh,
  mode,
  onDownloadFile,
  selectedFile,
  updateContent,
}: ProjectNotesContentPanelProps) {
  const showEdit = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";
  const isMarkdown = selectedFile?.file_type?.toLowerCase() === "md";

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-base font-medium text-gray-900">{copy.emptyTitle}</p>
          <p className="mt-2 text-sm text-gray-500">{copy.emptyDescription}</p>
        </div>
      </div>
    );
  }

  if (isLoadingDoc) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isMarkdown) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-gray-50 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-sm">
              <FileText className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">
                {selectedFile.file_type?.toUpperCase() || "FILE"}
              </p>
              <h3 className="mt-1 truncate text-lg font-semibold text-gray-900">
                {selectedFile.name}
              </h3>
              {selectedFile.summary ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                  {selectedFile.summary}
                </p>
              ) : (
                <p className="mt-3 text-sm leading-6 text-gray-500">
                  {isZh
                    ? "此文件已保存在项目空间中。.md 文件可直接编辑，源文件和交付物可在这里下载。"
                    : "This file is stored in the project space. Markdown editing is available for .md files; source files and deliverables can be downloaded here."}
                </p>
              )}
              <button
                type="button"
                onClick={() => onDownloadFile(selectedFile)}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                <Download className="h-4 w-4" />
                {isZh ? "下载" : "Download"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 p-4">
      {showEdit && (
        <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
          <textarea
            value={content}
            onChange={(event) => updateContent(event.target.value)}
            placeholder={copy.editPlaceholder}
            className="h-full min-h-[calc(100vh-340px)] w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-4 font-mono text-sm leading-7 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/20"
            spellCheck={false}
          />
        </div>
      )}

      {showPreview && (
        <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
          <div className="h-full min-h-[calc(100vh-340px)] overflow-auto rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
            {content.trim() ? (
              <div className="md-root">
                <MarkdownRenderer content={content} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                {copy.previewEmpty}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
