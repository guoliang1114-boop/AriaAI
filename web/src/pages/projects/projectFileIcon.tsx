/**
 * Inline file-type icon used by chat-side and docs lists. Extracted
 * from the deprecated ``ProjectNotesFolderTree`` so the icon helper
 * survives the notes-tab teardown.
 */
import {
  File,
  FileSpreadsheet,
  FileText,
  FileType2,
  Presentation,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ProjectFile } from "../../types/api";

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
    return { Icon: FileType2, className: "text-codex-accent", label: "DOC" };
  }
  if (["ppt", "pptx"].includes(extension) || type.includes("ppt") || type.includes("presentation")) {
    return { Icon: Presentation, className: "text-codex-warn", label: "PPT" };
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
    return { Icon: FileSpreadsheet, className: "text-codex-good", label: "XLS" };
  }
  return { Icon: File, className: "text-codex-ink-mute", label: extension.toUpperCase() || "FILE" };
}

export function ProjectSpaceFileIcon({ file }: { file: ProjectFile }) {
  const { Icon, className, label } = getProjectSpaceFileIconMeta(file);

  return (
    <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
      <Icon className={`h-4 w-4 ${className}`} />
      {label !== "MD" ? (
        <span className="absolute -bottom-1 -right-1 rounded-[3px] bg-white px-0.5 text-[7px] font-semibold leading-3 text-codex-ink-mute shadow-sm ring-1 ring-gray-200">
          {label}
        </span>
      ) : null}
    </span>
  );
}
