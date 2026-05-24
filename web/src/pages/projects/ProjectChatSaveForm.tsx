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
      <div className="flex rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => onActionChange("merge")}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            action === "merge" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {copy.mergeIntoExisting}
        </button>
        <button
          type="button"
          onClick={() => onActionChange("new")}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            action === "new" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {copy.saveAsNew}
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">{copy.selectFolder}</label>
        <div className="max-h-32 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
          <label
            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
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
            <FolderKanban className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="text-sm text-gray-800">{copy.rootFolder}</span>
          </label>
          {folders.map((folder) => (
            <label
              key={folder.id}
              className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
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
              <FolderKanban className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="text-sm text-gray-800 truncate">{folder.name}</span>
            </label>
          ))}
        </div>
      </div>

      {action === "merge" ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">{copy.selectMergeTarget}</label>
          {filesInSelectedFolder.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">{copy.noNoteFiles}</p>
          ) : (
            <div className="max-h-40 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {filesInSelectedFolder.map((file) => (
                <label
                  key={file.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
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
                  <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-800 truncate">{file.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">{copy.newNoteFileName}</label>
          <input
            type="text"
            value={fileName}
            onChange={(event) => onFileNameChange(event.target.value)}
            placeholder={copy.newNoteFilePlaceholder}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <p className="text-xs text-gray-400">{copy.autoAppendMd}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 px-0 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
        >
          {copy.cancel}
        </button>
        <button
          type="submit"
          disabled={loading || (action === "merge" && filesInSelectedFolder.length === 0)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {copy.confirmSave}
        </button>
      </div>
    </div>
  );
}
