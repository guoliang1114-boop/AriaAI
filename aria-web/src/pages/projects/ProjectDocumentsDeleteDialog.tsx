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
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {isZh ? "删除文件" : "Delete File"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {isZh ? "姝ゆ搷浣滀笉鍙挙閿€" : "This action cannot be undone"}
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-700 truncate">
            <span className="text-gray-500">{isZh ? "文件: " : "File: "}</span>
            <span className="font-medium">{fileToDelete.name}</span>
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isZh ? "删除" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
