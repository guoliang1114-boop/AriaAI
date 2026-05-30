import { Download, FileText, Files } from "lucide-react";
import type { ProjectFile } from "../../types/api";

interface ProjectOverviewDocumentsCardProps {
  files: ProjectFile[];
  isZh: boolean;
  onDownload: (file: ProjectFile) => void;
  onOpen: () => void;
}

export function ProjectOverviewDocumentsCard({
  files,
  isZh,
  onDownload,
  onOpen,
}: ProjectOverviewDocumentsCardProps) {
  return (
    <div className="bg-white rounded-xl border border-codex-line">
      <div className="flex items-center justify-between p-5 border-b border-codex-line-soft">
        <h3 className="font-semibold text-codex-ink flex items-center gap-2">
          <Files className="w-4 h-4 text-codex-ink-faint" />
          {isZh ? "最近文档" : "Recent Documents"}
        </h3>
        <button onClick={onOpen} className="text-sm text-primary hover:underline">
          {isZh ? "查看全部" : "View all"}
        </button>
      </div>
      <div className="divide-y divide-gray-100">
        {files.length === 0 ? (
          <div className="text-center py-8 text-codex-ink-faint">
            <p className="text-sm">{isZh ? "暂无文档" : "No documents yet"}</p>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-4 hover:bg-codex-bg-tint transition-colors cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg bg-codex-bg-tint flex items-center justify-center">
                <FileText className="w-5 h-5 text-codex-ink-mute" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-codex-ink truncate">{file.name}</p>
                <p className="text-xs text-codex-ink-faint">{file.file_type.toUpperCase()}</p>
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload(file);
                }}
                className="p-2 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
