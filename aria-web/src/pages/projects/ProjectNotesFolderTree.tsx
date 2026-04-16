import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
} from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";

interface ProjectNotesFolderTreeProps {
  folderList: ProjectFolder[];
  groupedFiles: Map<number | "uncategorized", ProjectFile[]>;
  isZh: boolean;
  onCreateDocument: (folderId?: number | null) => void;
  onSelectFile: (fileId: number) => void;
  onToggleFolder: (key: string | number) => void;
  openFolders: Record<string, boolean>;
  selectedFileId: number | null;
}

export function ProjectNotesFolderTree({
  folderList,
  groupedFiles,
  isZh,
  onCreateDocument,
  onSelectFile,
  onToggleFolder,
  openFolders,
  selectedFileId,
}: ProjectNotesFolderTreeProps) {
  const copy = getProjectNotesCopy(isZh);

  return (
    <div className="space-y-2">
      {folderList.map((folder) => {
        const folderFiles = groupedFiles.get(folder.id) || [];
        const isOpen = openFolders[folder.id] ?? true;

        return (
          <div
            key={folder.id}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white"
          >
            <div className="flex w-full items-center justify-between px-3 py-2.5 hover:bg-gray-50">
              <button
                onClick={() => onToggleFolder(folder.id)}
                className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-gray-800"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                )}
                <FolderOpen className="h-4 w-4 text-amber-500" />
                {folder.name}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateDocument(folder.id);
                }}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title={copy.createInFolder}
              >
                <FilePlus2 className="h-4 w-4" />
              </button>
            </div>

            {isOpen && (
              <div className="space-y-1 px-2 pb-2">
                {folderFiles.length > 0 ? (
                  folderFiles.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => onSelectFile(file.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        selectedFileId === file.id
                          ? "bg-primary/10 text-primary"
                          : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <FileText className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{file.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-gray-400">
                    {copy.noDocuments}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {(groupedFiles.get("uncategorized") || []).length > 0 && (
        <div className="overflow-hidden rounded-xl border border-dashed border-gray-200 bg-white">
          <button
            onClick={() => onToggleFolder("uncategorized")}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {openFolders.uncategorized ? (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )}
            <FolderOpen className="h-4 w-4 text-gray-400" />
            {copy.uncategorized}
          </button>
          {openFolders.uncategorized && (
            <div className="space-y-1 px-2 pb-2">
              {(groupedFiles.get("uncategorized") || []).map((file) => (
                <button
                  key={file.id}
                  onClick={() => onSelectFile(file.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    selectedFileId === file.id
                      ? "bg-primary/10 text-primary"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <FileText className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{file.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
