import { AlertCircle, CheckCircle2, X } from "lucide-react";

type UploadStatus = "uploading" | "done" | "error";

interface UploadProgressItem {
  name: string;
  progress: number;
  status: UploadStatus;
}

interface ProjectDocumentsUploadPanelProps {
  isZh: boolean;
  uploadProgress: UploadProgressItem[];
  onClose: () => void;
}

export function ProjectDocumentsUploadPanel({
  isZh,
  uploadProgress,
  onClose,
}: ProjectDocumentsUploadPanelProps) {
  return (
    <div className="fixed bottom-6 right-6 w-80 bg-white rounded-xl shadow-xl border border-codex-line z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-codex-line-soft">
        <h4 className="font-medium text-codex-ink text-sm">
          {isZh ? "上传文件" : "Uploading Files"}
        </h4>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {uploadProgress.map((file, index) => (
          <div key={index} className="px-4 py-3 border-b border-codex-line-soft last:border-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-codex-ink-soft truncate flex-1 mr-2">
                {file.name}
              </span>
              {file.status === "done" && (
                <CheckCircle2 className="w-4 h-4 text-codex-good" />
              )}
              {file.status === "error" && (
                <AlertCircle className="w-4 h-4 text-codex-bad" />
              )}
              {file.status === "uploading" && (
                <span className="text-xs text-codex-ink-mute">{file.progress}%</span>
              )}
            </div>
            <div className="h-1.5 bg-codex-bg-tint rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  file.status === "error"
                    ? "bg-codex-bg-tint0"
                    : file.status === "done"
                      ? "bg-codex-good"
                      : "bg-codex-accent"
                }`}
                style={{ width: `${file.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
