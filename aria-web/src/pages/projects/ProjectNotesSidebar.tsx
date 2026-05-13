import {
  BookOpen,
  FilePlus2,
  Loader2,
  Upload,
} from "lucide-react";
import { useRef } from "react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectNotesFolderTree } from "./ProjectNotesFolderTree";
import { getProjectNotesCopy } from "./projectNotesCopy";

export function ProjectNotesSidebar({
  folderList,
  groupedFiles,
  isCreatingDoc,
  isUploadingFile,
  isZh,
  fileCount,
  openFolders,
  projectName,
  selectedFileId,
  onCreateDocument,
  onUploadFiles,
  onSelectFile,
  onToggleFolder,
}: {
  folderList: ProjectFolder[];
  groupedFiles: Map<number | "uncategorized", ProjectFile[]>;
  isCreatingDoc: boolean;
  isUploadingFile: boolean;
  isZh: boolean;
  fileCount: number;
  openFolders: Record<string, boolean>;
  projectName: string;
  selectedFileId: number | null;
  onCreateDocument: (folderId?: number | null) => void;
  onUploadFiles: (files: FileList, folderId?: number | null) => void;
  onSelectFile: (fileId: number) => void;
  onToggleFolder: (key: string | number) => void;
}) {
  const copy = getProjectNotesCopy(isZh);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetFolderIdRef = useRef<number | null>(folderList[0]?.id ?? null);

  const openUploadPicker = (folderId?: number | null) => {
    uploadTargetFolderIdRef.current = folderId ?? folderList[0]?.id ?? null;
    fileInputRef.current?.click();
  };

  return (
    <aside className="flex w-80 flex-col border-r border-gray-200 bg-gray-50/70">
      <div className="border-b border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">
              {copy.heading}
            </p>
            <h3 className="mt-1 text-base font-semibold text-gray-900">
              {projectName}
            </h3>
          </div>
          <BookOpen className="mt-0.5 h-5 w-5 text-primary" />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onCreateDocument(folderList[0]?.id ?? null)}
            disabled={isCreatingDoc}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            title={copy.newDocument}
          >
            {isCreatingDoc ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => openUploadPicker(folderList[0]?.id ?? null)}
            disabled={isUploadingFile}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-primary/40 hover:text-primary disabled:opacity-50"
            title={isZh ? "上传文件" : "Upload file"}
            type="button"
          >
            {isUploadingFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files?.length) {
                onUploadFiles(event.currentTarget.files, uploadTargetFolderIdRef.current);
              }
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        <ProjectNotesFolderTree
          folderList={folderList}
          groupedFiles={groupedFiles}
          isZh={isZh}
          onCreateDocument={onCreateDocument}
          onSelectFile={onSelectFile}
          onToggleFolder={onToggleFolder}
          openFolders={openFolders}
          selectedFileId={selectedFileId}
        />

        {fileCount === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-800">
              {copy.noProjectDocuments}
            </p>
            <p className="mt-1 text-xs leading-6 text-gray-500">
              {copy.emptySidebarDescription}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
