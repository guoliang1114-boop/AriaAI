import { Download, ExternalLink, FileText } from "lucide-react";
import type { GeneratedArtifact } from "../../types/api";

interface ProjectChatArtifactCardProps {
  artifact: GeneratedArtifact;
  isZh: boolean;
  onDownload: (artifact: GeneratedArtifact) => void;
  onOpen?: (artifact: GeneratedArtifact) => void;
}

export function ProjectChatArtifactCard({
  artifact,
  isZh,
  onDownload,
  onOpen,
}: ProjectChatArtifactCardProps) {
  const canOpenInSpace = Boolean(onOpen && artifact.project_file_id);
  const canDownload = Boolean(artifact.path);
  const isTextArtifact = artifact.file_type === "text";

  return (
    <div className={`rounded-xl border px-3.5 py-3 ${isTextArtifact ? "border-blue-200 bg-blue-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ${isTextArtifact ? "text-blue-600" : "text-emerald-600"}`}>
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{artifact.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className={`rounded-full bg-white px-2 py-0.5 border ${isTextArtifact ? "border-blue-100" : "border-emerald-100"}`}>
              {isTextArtifact ? (isZh ? "文本" : "TEXT") : artifact.file_type.toUpperCase()}
            </span>
            {artifact.description ? <span className="truncate">{artifact.description}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canOpenInSpace ? (
            <button
              type="button"
              onClick={() => onOpen?.(artifact)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {isZh ? "打开" : "Open"}
            </button>
          ) : null}
          {canDownload ? (
            <button
              type="button"
              onClick={() => onDownload(artifact)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <Download className="h-3.5 w-3.5" />
              {isZh ? "下载" : "Download"}
            </button>
          ) : null}
        </div>
      </div>
      {isTextArtifact && artifact.description ? (
        <div className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-blue-100 bg-white/80 p-3 text-xs leading-5 text-slate-600">
          {artifact.description}
        </div>
      ) : null}
    </div>
  );
}
