import { Loader2, Trash2 } from "lucide-react";

interface DeleteTarget {
  id: number;
  name: string;
}

interface ProjectDocumentsDeleteDialogProps {
  deleting: boolean;
  fileToDelete: DeleteTarget;
  isZh: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ProjectDocumentsDeleteDialog({
  deleting,
  fileToDelete,
  isZh,
  onClose,
  onConfirm,
}: ProjectDocumentsDeleteDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4 p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-codex-bg-tint flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-codex-bad" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-codex-ink">
              {isZh ? "删除文件" : "Delete File"}
            </h3>
            <p className="text-sm text-codex-ink-mute mt-1">
              {isZh ? "此操作不可撤销" : "This action cannot be undone"}
            </p>
          </div>
        </div>

        <div className="bg-codex-bg-tint rounded-lg p-4 mb-6">
          <p className="text-sm text-codex-ink-soft truncate">
            <span className="text-codex-ink-mute">{isZh ? "文件: " : "File: "}</span>
            <span className="font-medium">{fileToDelete.name}</span>
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-codex-line rounded-lg text-sm font-medium text-codex-ink-soft hover:bg-codex-bg-tint transition-colors"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 bg-codex-bg-tint0 text-white rounded-lg text-sm font-medium hover:bg-codex-bad disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isZh ? "删除" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
