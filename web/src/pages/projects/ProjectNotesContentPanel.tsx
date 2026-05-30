import {
  BookOpen,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  FileType2,
  Loader2,
  Presentation,
} from "lucide-react";
import type { ComponentType } from "react";
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

type FileIconMeta = {
  Icon: ComponentType<{ className?: string }>;
  className: string;
  label: string;
};

function getProjectSpaceFileIconMeta(file: ProjectFile): FileIconMeta {
  const rawType = (file.file_type || "").toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const type = rawType || extension;

  if (type === "md" || extension === "md" || type.includes("markdown")) {
    return { Icon: FileText, className: "text-codex-ink-soft", label: "MD" };
  }
  if (["doc", "docx"].includes(extension) || type.includes("doc") || type.includes("word")) {
    return { Icon: FileType2, className: "text-codex-accent", label: "DOCX" };
  }
  if (["ppt", "pptx"].includes(extension) || type.includes("ppt") || type.includes("presentation")) {
    return { Icon: Presentation, className: "text-codex-warn", label: "PPTX" };
  }
  if (extension === "pdf" || type.includes("pdf")) {
    return { Icon: FileText, className: "text-codex-bad", label: "PDF" };
  }
  if (
    ["xls", "xlsx", "csv"].includes(extension) ||
    type.includes("xls") ||
    type.includes("sheet") ||
    type.includes("csv")
  ) {
    return { Icon: FileSpreadsheet, className: "text-codex-good", label: "XLSX" };
  }
  return { Icon: File, className: "text-codex-ink-mute", label: extension.toUpperCase() || "FILE" };
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
  const isMarkdown = (() => {
    const type = (selectedFile?.file_type || "").toLowerCase();
    const ext = selectedFile?.name?.split(".").pop()?.toLowerCase() || "";
    return type === "md" || ext === "md" || type.includes("markdown");
  })();
  console.log("[ProjectNotesContentPanel] render selectedFile=", selectedFile?.name, "isMarkdown=", isMarkdown, "contentLen=", content.length, "isLoadingDoc=", isLoadingDoc);

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <BookOpen className="mx-auto h-12 w-12 text-codex-ink-faint" />
          <p className="mt-4 text-base font-medium text-codex-ink">{copy.emptyTitle}</p>
          <p className="mt-2 text-sm text-codex-ink-mute">{copy.emptyDescription}</p>
        </div>
      </div>
    );
  }

  if (isLoadingDoc) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-codex-accent" />
      </div>
    );
  }

  if (!isMarkdown) {
    const { Icon, className, label } = getProjectSpaceFileIconMeta(selectedFile);
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="w-full max-w-2xl rounded-xl border border-codex-line bg-codex-bg-tint p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white text-codex-accent shadow-sm">
              <Icon className={`h-6 w-6 ${className}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-codex-ink-faint">
                {label}
              </p>
              <h3 className="mt-1 truncate text-lg font-semibold text-codex-ink">
                {selectedFile.name}
              </h3>
              {selectedFile.summary ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-codex-ink-soft">
                  {selectedFile.summary}
                </p>
              ) : (
                <p className="mt-3 text-sm leading-6 text-codex-ink-mute">
                  {isZh
                    ? "此文件已保存在项目空间中。.md 文件可直接编辑，源文件和交付物可在这里下载。"
                    : "This file is stored in the project space. Markdown editing is available for .md files; source files and deliverables can be downloaded here."}
                </p>
              )}
              <button
                type="button"
                onClick={() => onDownloadFile(selectedFile)}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-codex-accent px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
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
            className="h-full min-h-[calc(100vh-15rem)] w-full resize-none rounded-lg border border-codex-line bg-white px-4 py-4 font-mono text-sm leading-7 text-codex-ink-soft focus:outline-none focus:ring-2 focus:ring-primary/20"
            spellCheck={false}
          />
        </div>
      )}

      {showPreview && (
        <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
          <div className="h-full min-h-[calc(100vh-15rem)] overflow-auto rounded-lg border border-codex-line bg-codex-bg-tint px-5 py-4">
            {content.trim() ? (
              <div className="md-root">
                <MarkdownRenderer content={content} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-codex-ink-faint">
                {copy.previewEmpty}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
