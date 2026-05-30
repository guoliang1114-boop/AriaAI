import { AlertCircle } from "lucide-react";

interface ProjectTodoDeleteDialogProps {
  isZh: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  todoContent: string;
}

export function ProjectTodoDeleteDialog({
  isZh,
  onCancel,
  onConfirm,
  todoContent,
}: ProjectTodoDeleteDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-codex-line-soft bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-codex-bg-tint">
            <AlertCircle className="h-5 w-5 text-codex-bad" />
          </div>
          <div>
            <h3 className="font-semibold text-codex-ink">
              {isZh ? "确认删除待办" : "Delete Todo"}
            </h3>
            <p className="text-sm text-codex-ink-mute">
              {isZh ? "此操作不可撤销" : "This action cannot be undone"}
            </p>
          </div>
        </div>
        <p className="mb-6 text-sm text-codex-ink-soft">
          {isZh ? "确定要删除“" : 'Are you sure you want to delete "'}
          <span className="font-medium text-codex-ink">{todoContent}</span>
          {isZh ? "”吗？" : '"?'}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-codex-ink-soft transition-colors hover:bg-codex-bg-tint"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-lg bg-codex-bad px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-codex-bad"
          >
            {isZh ? "确认删除" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
