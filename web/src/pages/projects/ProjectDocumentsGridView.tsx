import { FolderKanban, Trash2 } from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { getProjectDocumentFileIcon } from "./projectDocumentsIcons";
import { formatDateTime, getResolvedAppTimeZone } from "../../utils/timezone";

interface ProjectDocumentsGridViewProps {
  enterFolder: (folderName: string) => void;
  filteredFiles: ProjectFile[];
  filteredFolders: ProjectFolder[];
  handleContextMenu: (event: React.MouseEvent, item: ProjectFile | ProjectFolder) => void;
  handleDeleteFile: (fileId: number, fileName: string) => void;
  isZh: boolean;
}

export function ProjectDocumentsGridView({
  enterFolder,
  filteredFiles,
  filteredFolders,
  handleContextMenu,
  handleDeleteFile,
  isZh,
}: ProjectDocumentsGridViewProps) {
  return (
    <div className="flex-1 overflow-auto">
      {filteredFolders.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-codex-ink-mute mb-3 px-1">
            {isZh ? "文件夹" : "Folders"}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredFolders.map((folder) => (
              <div
                key={folder.id}
                onClick={() => enterFolder(folder.name)}
                onContextMenu={(event) => handleContextMenu(event, folder)}
                className="group bg-white rounded-xl border border-codex-line p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer relative"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-codex-accent-bg flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                    <FolderKanban className="w-7 h-7 text-codex-accent" />
                  </div>
                  <h4 className="font-medium text-codex-ink text-sm truncate w-full">
                    {folder.name}
                  </h4>
                  <p className="text-xs text-codex-ink-faint mt-1">
                    {isZh ? "文件夹" : "Folder"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredFiles.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-codex-ink-mute mb-3 px-1">
            {isZh ? "文件" : "Files"}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                onContextMenu={(event) => handleContextMenu(event, file)}
                className="group bg-white rounded-xl border border-codex-line p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer relative"
              >
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeleteFile(file.id, file.name);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-bad"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-codex-bg-tint flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                    {getProjectDocumentFileIcon(file.file_type)}
                  </div>
                  <h4 className="font-medium text-codex-ink text-sm truncate w-full" title={file.name}>
                    {file.name}
                  </h4>
                  <p className="text-xs text-codex-ink-faint mt-1">
                    {formatDateTime(file.uploaded_at, isZh ? "zh-CN" : "en-GB", { hour12: false }, getResolvedAppTimeZone())}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
