import { Loader2, Trash2 } from "lucide-react";
import type { ProjectFile } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";

interface ProjectNotesDeleteDialogProps {
  file: ProjectFile | null;
  isDeleting: boolean;
  isOpen: boolean;
  isZh: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ProjectNotesDeleteDialog({
  file,
  isDeleting,
  isOpen,
  isZh,
  onClose,
  onConfirm,
}: ProjectNotesDeleteDialogProps) {
  const copy = getProjectNotesCopy(isZh);
  if (!isOpen || !file) return null;

  const body = copy.deleteDocumentConfirm.replace("{name}", file.name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-codex-line-soft bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-codex-bg-tint">
            <Trash2 className="h-5 w-5 text-codex-bad" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-codex-ink">
              {copy.deleteDocument}
            </h3>
            <p className="mt-1 text-sm leading-6 text-codex-ink-mute">{body}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-codex-ink-soft hover:bg-codex-bg-tint disabled:opacity-50"
          >
            {copy.cancel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 rounded-xl bg-codex-bad px-4 py-2.5 text-sm font-medium text-white hover:bg-codex-bad disabled:opacity-50"
          >
            {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
