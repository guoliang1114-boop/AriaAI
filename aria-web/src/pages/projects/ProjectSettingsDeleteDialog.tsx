import { Loader2, Trash2 } from "lucide-react";

interface ProjectSettingsDeleteDialogProps {
  deleteConfirmText: string;
  isDeleting: boolean;
  isZh: boolean;
  projectName: string;
  onCancel: () => void;
  onChangeDeleteConfirmText: (value: string) => void;
  onConfirm: () => void;
}

export function ProjectSettingsDeleteDialog({
  deleteConfirmText,
  isDeleting,
  isZh,
  projectName,
  onCancel,
  onChangeDeleteConfirmText,
  onConfirm,
}: ProjectSettingsDeleteDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
            <Trash2 className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {isZh ? "确认删除项目" : "Delete Project"}
            </h3>
            <p className="text-sm text-gray-500">
              {isZh ? "此操作不可恢复" : "This action cannot be undone"}
            </p>
          </div>
        </div>

        <p className="mb-4 text-sm text-gray-600">
          {isZh ? "璇疯緭鍏ラ」鐩悕绉?" : "Please type the project name"}{" "}
          <span className="font-semibold text-gray-900">"{projectName}"</span>{" "}
          {isZh ? "浠ョ‘璁ゅ垹闄ぁ€?" : "to confirm deletion."}
        </p>

        <input
          type="text"
          value={deleteConfirmText}
          onChange={(event) => onChangeDeleteConfirmText(event.target.value)}
          placeholder={projectName}
          className="mb-4 w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-red-300 focus:ring-2 focus:ring-red-100"
          autoFocus
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleteConfirmText !== projectName || isDeleting}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isZh ? "确认删除" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
