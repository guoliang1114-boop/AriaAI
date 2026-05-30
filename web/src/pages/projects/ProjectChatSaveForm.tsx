import { FileText, FolderKanban, Loader2 } from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import type { ProjectChatCopy } from "./projectChatCopy";

interface ProjectChatSaveFormProps {
  action: "merge" | "new";
  copy: ProjectChatCopy;
  fileName: string;
  filesInSelectedFolder: ProjectFile[];
  folders: ProjectFolder[];
  loading: boolean;
  onActionChange: (action: "merge" | "new") => void;
  onCancel: () => void;
  onFileNameChange: (value: string) => void;
  onSelectedFileChange: (fileId: number | null) => void;
  onSelectedFolderChange: (folderId: number | null) => void;
  selectedFileId: number | null;
  selectedFolderId: number | null;
}

export function ProjectChatSaveForm({
  action,
  copy,
  fileName,
  filesInSelectedFolder,
  folders,
  loading,
  onActionChange,
  onCancel,
  onFileNameChange,
  onSelectedFileChange,
  onSelectedFolderChange,
  selectedFileId,
  selectedFolderId,
}: ProjectChatSaveFormProps) {
  return (
    <div className="p-5 space-y-4">
      <div className="flex rounded-lg bg-codex-bg-tint p-1">
        <button
          type="button"
          onClick={() => onActionChange("merge")}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            action === "merge" ? "bg-white text-codex-ink shadow-sm" : "text-codex-ink-mute hover:text-codex-ink-soft"
          }`}
        >
          {copy.mergeIntoExisting}
        </button>
        <button
          type="button"
          onClick={() => onActionChange("new")}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            action === "new" ? "bg-white text-codex-ink shadow-sm" : "text-codex-ink-mute hover:text-codex-ink-soft"
          }`}
        >
          {copy.saveAsNew}
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-codex-ink-soft">{copy.selectFolder}</label>
        <div className="max-h-32 overflow-auto border border-codex-line rounded-lg divide-y divide-gray-100">
          <label
            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-codex-bg-tint transition-colors ${
              selectedFolderId === null ? "bg-primary/5" : ""
            }`}
          >
            <input
              type="radio"
              name="folder"
              checked={selectedFolderId === null}
              onChange={() => onSelectedFolderChange(null)}
              className="accent-primary"
            />
            <FolderKanban className="w-4 h-4 text-codex-ink-faint flex-shrink-0" />
            <span className="text-sm text-codex-ink-soft">{copy.rootFolder}</span>
          </label>
          {folders.map((folder) => (
            <label
              key={folder.id}
              className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-codex-bg-tint transition-colors ${
                selectedFolderId === folder.id ? "bg-primary/5" : ""
              }`}
            >
              <input
                type="radio"
                name="folder"
                checked={selectedFolderId === folder.id}
                onChange={() => onSelectedFolderChange(folder.id)}
                className="accent-primary"
              />
              <FolderKanban className="w-4 h-4 text-codex-accent flex-shrink-0" />
              <span className="text-sm text-codex-ink-soft truncate">{folder.name}</span>
            </label>
          ))}
        </div>
      </div>

      {action === "merge" ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-codex-ink-soft">{copy.selectMergeTarget}</label>
          {filesInSelectedFolder.length === 0 ? (
            <p className="text-sm text-codex-ink-faint py-2">{copy.noNoteFiles}</p>
          ) : (
            <div className="max-h-40 overflow-auto border border-codex-line rounded-lg divide-y divide-gray-100">
              {filesInSelectedFolder.map((file) => (
                <label
                  key={file.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-codex-bg-tint transition-colors ${
                    selectedFileId === file.id ? "bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="file"
                    checked={selectedFileId === file.id}
                    onChange={() => onSelectedFileChange(file.id)}
                    className="accent-primary"
                  />
                  <FileText className="w-4 h-4 text-codex-ink-faint flex-shrink-0" />
                  <span className="text-sm text-codex-ink-soft truncate">{file.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-codex-ink-soft">{copy.newNoteFileName}</label>
          <input
            type="text"
            value={fileName}
            onChange={(event) => onFileNameChange(event.target.value)}
            placeholder={copy.newNoteFilePlaceholder}
            className="w-full px-3 py-2 bg-white border border-codex-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <p className="text-xs text-codex-ink-faint">{copy.autoAppendMd}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 px-0 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-codex-ink-soft hover:bg-white border border-codex-line rounded-lg transition-colors disabled:opacity-50"
        >
          {copy.cancel}
        </button>
        <button
          type="submit"
          disabled={loading || (action === "merge" && filesInSelectedFolder.length === 0)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-codex-accent text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {copy.confirmSave}
        </button>
      </div>
    </div>
  );
}
