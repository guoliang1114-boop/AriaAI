import { Check, FolderOpen, Loader2, X } from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";

interface ProjectNotesMoveDialogProps {
  file: ProjectFile | null;
  folderList: ProjectFolder[];
  isMoving: boolean;
  isOpen: boolean;
  isZh: boolean;
  targetFolderId: number | null;
  onChangeTargetFolder: (folderId: number | null) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function ProjectNotesMoveDialog({
  file,
  folderList,
  isMoving,
  isOpen,
  isZh,
  targetFolderId,
  onChangeTargetFolder,
  onClose,
  onConfirm,
}: ProjectNotesMoveDialogProps) {
  const copy = getProjectNotesCopy(isZh);

  if (!isOpen || !file) return null;

  const targets: Array<{ id: number | null; name: string; muted?: boolean }> = [
    ...folderList.map((folder) => ({ id: folder.id, name: folder.name })),
    { id: null, name: copy.uncategorized, muted: true },
  ];
  const isSameFolder = (file.folder_id ?? null) === targetFolderId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-codex-line bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-codex-ink">
              {copy.moveDocument}
            </h3>
            <p className="mt-1 truncate text-sm text-codex-ink-mute">
              {file.name}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isMoving}
            className="rounded-lg p-2 text-codex-ink-faint hover:bg-codex-bg-tint hover:text-codex-ink-soft disabled:opacity-50"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 max-h-80 space-y-2 overflow-y-auto pr-1">
          {targets.map((target) => {
            const selected = target.id === targetFolderId;
            return (
              <button
                key={target.id ?? "uncategorized"}
                type="button"
                onClick={() => onChangeTargetFolder(target.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                  selected
                    ? "border-primary/40 bg-primary/5 text-codex-accent"
                    : "border-codex-line bg-white text-codex-ink-soft hover:border-primary/30 hover:bg-codex-bg-tint"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    target.muted
                      ? "bg-codex-bg-tint text-codex-ink-mute"
                      : "bg-codex-bg-tint text-codex-warn"
                  }`}
                >
                  <FolderOpen className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium leading-5">
                    {target.name}
                  </span>
                </span>
                {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isMoving}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-codex-ink-soft hover:bg-codex-bg-tint disabled:opacity-50"
            type="button"
          >
            {copy.cancel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isMoving || isSameFolder}
            className="inline-flex items-center gap-2 rounded-xl bg-codex-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            type="button"
          >
            {isMoving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {copy.move}
          </button>
        </div>
      </div>
    </div>
  );
}
