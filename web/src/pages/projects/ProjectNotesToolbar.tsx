import {
  Eye,
  Download,
  FolderInput,
  Loader2,
  MoreVertical,
  Pencil,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ProjectFile } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";

export function ProjectNotesToolbar({
  dirty,
  isDeletingDoc,
  isRenamingDoc,
  isSaving,
  isZh,
  mode,
  selectedFile,
  showMoreMenu,
  onOpenAIModal,
  onOpenMove,
  onOpenRename,
  onRequestDelete,
  onDownloadFile,
  onSave,
  onSetMode,
  onToggleMoreMenu,
}: {
  dirty: boolean;
  isDeletingDoc: boolean;
  isRenamingDoc: boolean;
  isSaving: boolean;
  isZh: boolean;
  mode: "edit" | "preview" | "split";
  selectedFile: ProjectFile | null;
  showMoreMenu: boolean;
  onOpenAIModal: () => void;
  onOpenMove: () => void;
  onOpenRename: () => void;
  onRequestDelete: () => void;
  onDownloadFile: () => void;
  onSave: () => void;
  onSetMode: (mode: "edit" | "preview" | "split") => void;
  onToggleMoreMenu: () => void;
}) {
  const copy = getProjectNotesCopy(isZh);
  const isMarkdown = selectedFile?.file_type?.toLowerCase() === "md";

  return (
    <div className="flex items-center justify-between gap-4 border-b border-codex-line bg-white px-5 py-4">
      <div className="min-w-0">
        <p className="text-xs text-codex-ink-faint">
          {copy.currentDocument}
        </p>
        <h3 className="mt-1 truncate text-lg font-semibold text-codex-ink">
          {selectedFile?.name || copy.selectDocument}
        </h3>
        {dirty && (
          <p className="mt-1 text-xs text-codex-warn">{copy.unsavedChanges}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isMarkdown ? (
          <div className="flex items-center rounded-lg bg-codex-bg-tint p-1">
            <button
              onClick={() => onSetMode("edit")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === "edit"
                  ? "bg-white text-codex-ink shadow-sm"
                  : "text-codex-ink-mute"
              }`}
            >
              {copy.edit}
            </button>
            <button
              onClick={() => onSetMode("split")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === "split"
                  ? "bg-white text-codex-ink shadow-sm"
                  : "text-codex-ink-mute"
              }`}
            >
              {copy.split}
            </button>
            <button
              onClick={() => onSetMode("preview")}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm ${
                mode === "preview"
                  ? "bg-white text-codex-ink shadow-sm"
                  : "text-codex-ink-mute"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              {copy.preview}
            </button>
          </div>
        ) : null}

        <button
          onClick={onOpenAIModal}
          disabled={!selectedFile || !isMarkdown}
          className="inline-flex items-center gap-2 rounded-lg bg-codex-accent-bg px-3 py-2 text-sm font-medium text-codex-accent-ink hover:bg-codex-accent-bg disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {copy.aiAssist}
        </button>

        <button
          onClick={onSave}
          disabled={!selectedFile || !isMarkdown || isSaving || !dirty}
          className="inline-flex items-center gap-2 rounded-lg bg-codex-accent px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {copy.save}
        </button>

        {selectedFile && !isMarkdown ? (
          <button
            onClick={onDownloadFile}
            className="inline-flex items-center gap-2 rounded-lg bg-codex-accent px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            {isZh ? "下载" : "Download"}
          </button>
        ) : null}

        <button
          onClick={onToggleMoreMenu}
          disabled={!selectedFile}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-codex-line bg-white text-codex-ink-soft hover:bg-codex-bg-tint disabled:opacity-50"
          title={copy.moreActions}
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {showMoreMenu && (
          <div className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border border-codex-line bg-white py-1 shadow-lg">
            <button
              onClick={onOpenMove}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-codex-ink-soft hover:bg-codex-bg-tint"
            >
              <FolderInput className="h-4 w-4 text-codex-ink-faint" />
              {copy.moveDocument}
            </button>
            <button
              onClick={onOpenRename}
              disabled={isRenamingDoc || !isMarkdown}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-codex-ink-soft hover:bg-codex-bg-tint disabled:opacity-50"
            >
              {isRenamingDoc ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="h-4 w-4 text-codex-ink-faint" />
              )}
              {copy.rename}
            </button>
            <button
              onClick={onRequestDelete}
              disabled={isDeletingDoc}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-codex-bad hover:bg-codex-bg-tint disabled:opacity-50"
            >
              {isDeletingDoc ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 text-codex-bad" />
              )}
              {copy.delete}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
