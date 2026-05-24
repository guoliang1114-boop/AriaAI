import { Upload } from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectDocumentsEmptyState } from "./ProjectDocumentsEmptyState";
import { ProjectDocumentsGridView } from "./ProjectDocumentsGridView";
import { ProjectDocumentsListView } from "./ProjectDocumentsListView";

interface ProjectDocumentsBrowserProps {
  currentFolder: string | null;
  enterFolder: (folderName: string) => void;
  filteredFiles: ProjectFile[];
  filteredFolders: ProjectFolder[];
  goToRoot: () => void;
  handleContextMenu: (event: React.MouseEvent, item: ProjectFile | ProjectFolder) => void;
  handleDeleteFile: (fileId: number, fileName: string) => void;
  handleDownload: (file: ProjectFile) => Promise<void>;
  isDragging: boolean;
  isEmpty: boolean;
  isZh: boolean;
  uploading: boolean;
  viewMode: "grid" | "list";
}

export function ProjectDocumentsBrowser({
  currentFolder,
  enterFolder,
  filteredFiles,
  filteredFolders,
  goToRoot,
  handleContextMenu,
  handleDeleteFile,
  handleDownload,
  isDragging,
  isEmpty,
  isZh,
  uploading,
  viewMode,
}: ProjectDocumentsBrowserProps) {
  return (
    <div className="flex-1 relative">
      {isDragging && !uploading && (
        <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center z-20">
          <Upload className="w-12 h-12 text-primary mb-3" />
          <p className="text-primary font-medium">
            {isZh ? "拖放文件即可上传" : "Drop files to upload"}
          </p>
        </div>
      )}

      {isEmpty ? (
        <ProjectDocumentsEmptyState
          currentFolder={currentFolder}
          goToRoot={goToRoot}
          isZh={isZh}
        />
      ) : viewMode === "grid" ? (
        <ProjectDocumentsGridView
          enterFolder={enterFolder}
          filteredFiles={filteredFiles}
          filteredFolders={filteredFolders}
          handleContextMenu={handleContextMenu}
          handleDeleteFile={handleDeleteFile}
          isZh={isZh}
        />
      ) : (
        <ProjectDocumentsListView
          enterFolder={enterFolder}
          filteredFiles={filteredFiles}
          filteredFolders={filteredFolders}
          handleContextMenu={handleContextMenu}
          handleDeleteFile={handleDeleteFile}
          handleDownload={handleDownload}
          isZh={isZh}
        />
      )}
    </div>
  );
}
