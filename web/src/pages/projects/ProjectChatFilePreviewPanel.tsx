import {
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Loader2,
  PanelRightClose,
  Presentation,
} from "lucide-react";

import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { ProjectFile } from "../../types/api";

function getFileKind(file: ProjectFile | null) {
  const rawType = (file?.file_type || "").toLowerCase();
  const extension = file?.name?.split(".").pop()?.toLowerCase() || "";
  const type = rawType || extension;

  if (type === "md" || extension === "md" || type.includes("markdown")) {
    return { label: "MD", icon: FileText, color: "text-slate-600", canPreview: true };
  }
  if (["ppt", "pptx"].includes(extension) || type.includes("ppt") || type.includes("presentation")) {
    return { label: "PPT", icon: Presentation, color: "text-orange-600", canPreview: false };
  }
  if (["xls", "xlsx", "csv"].includes(extension) || type.includes("xls") || type.includes("sheet")) {
    return { label: "Sheet", icon: FileSpreadsheet, color: "text-emerald-600", canPreview: false };
  }
  if (extension === "pdf" || type.includes("pdf")) {
    return { label: "PDF", icon: FileText, color: "text-red-600", canPreview: false };
  }
  return { label: extension.toUpperCase() || "File", icon: File, color: "text-gray-500", canPreview: false };
}

export function ProjectChatFilePreviewPanel({
  content,
  file,
  isLoading,
  isZh,
  onClose,
  onDownload,
}: {
  content: string;
  file: ProjectFile | null;
  isLoading: boolean;
  isZh: boolean;
  onClose: () => void;
  onDownload: (file: ProjectFile) => void;
}) {
  const kind = getFileKind(file);
  const Icon = kind.icon;

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex min-h-[64px] items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
              <Icon className={`h-4 w-4 ${kind.color}`} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-5 text-gray-900">
                {file?.name || (isZh ? "空间预览" : "Space preview")}
              </p>
              <p className="text-xs leading-4 text-gray-400">
                {kind.canPreview ? (isZh ? "Markdown 预览" : "Markdown preview") : kind.label}
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {file ? (
            <button
              type="button"
              onClick={() => onDownload(file)}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              title={isZh ? "下载" : "Download"}
              aria-label={isZh ? "下载" : "Download"}
            >
              <Download className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label={isZh ? "关闭预览" : "Close preview"}
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!file ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div>
              <FileText className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-900">
                {isZh ? "从左侧空间选择文件" : "Select a file from space"}
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {isZh ? "Markdown 会在这里直接预览，其他格式展示摘要和操作。" : "Markdown opens here. Other formats show a compact brief and actions."}
              </p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : kind.canPreview ? (
          <div className="px-5 py-4">
            {content.trim() ? (
              <div className="md-root project-chat-preview-md">
                <MarkdownRenderer content={content} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
                {isZh ? "这个 Markdown 暂无内容。" : "This Markdown file is empty."}
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 py-5">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
                  <Icon className={`h-5 w-5 ${kind.color}`} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-400">{kind.label}</p>
                  <h3 className="mt-1 break-words text-[14px] font-semibold leading-5 text-gray-950">{file.name}</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                    {file.summary ||
                      (isZh
                        ? "此格式暂不在对话区内直接预览。你可以查看摘要、下载原文件，或进入项目空间继续管理。"
                        : "This format is not previewed inline. Use the summary, download the source file, or manage it in project space.")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
