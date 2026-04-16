import { Download, FileText } from "lucide-react";
import type { GeneratedArtifact } from "../../types/api";

interface ProjectChatArtifactCardProps {
  artifact: GeneratedArtifact;
  isZh: boolean;
  onDownload: (artifact: GeneratedArtifact) => void;
}

export function ProjectChatArtifactCard({
  artifact,
  isZh,
  onDownload,
}: ProjectChatArtifactCardProps) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{artifact.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-white px-2 py-0.5 border border-emerald-100">
              {artifact.file_type.toUpperCase()}
            </span>
            {artifact.description ? <span className="truncate">{artifact.description}</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDownload(artifact)}
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
        >
          <Download className="h-3.5 w-3.5" />
          {isZh ? "下载" : "Download"}
        </button>
      </div>
    </div>
  );
}
