import { Loader2, X } from "lucide-react";
import { getProjectNotesCopy } from "./projectNotesCopy";

type DocumentDialogMode = "create" | "rename";

interface ProjectNotesDocumentDialogProps {
  isOpen: boolean;
  isPending: boolean;
  isZh: boolean;
  mode: DocumentDialogMode;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function ProjectNotesDocumentDialog({
  isOpen,
  isPending,
  isZh,
  mode,
  value,
  onChange,
  onClose,
  onSubmit,
}: ProjectNotesDocumentDialogProps) {
  const copy = getProjectNotesCopy(isZh);
  if (!isOpen) return null;

  const title =
    mode === "create" ? copy.createDocument : copy.renameDocument;
  const description =
    mode === "create"
      ? copy.createDocumentDescription
      : copy.renameDocumentDescription;
  const submitLabel = mode === "create" ? copy.create : copy.save;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700">
            {copy.documentName}
          </label>
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onSubmit();
            }}
            placeholder={copy.documentNamePlaceholder}
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20"
            autoFocus
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            {copy.cancel}
          </button>
          <button
            onClick={onSubmit}
            disabled={!value.trim() || isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
