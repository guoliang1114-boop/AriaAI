import {
  BookOpen,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const uploadDropdownRef = useRef<HTMLDivElement | null>(null);
  const [showUploadFolderSelect, setShowUploadFolderSelect] = useState(false);

  const openUploadPicker = (folderId?: number | null) => {
    uploadTargetFolderIdRef.current = folderId ?? folderList[0]?.id ?? null;
    fileInputRef.current?.click();
  };

  useEffect(() => {
    if (!showUploadFolderSelect) return;

    const closeOnOutsideInteraction = (event: MouseEvent) => {
      if (uploadDropdownRef.current?.contains(event.target as Node)) return;
      setShowUploadFolderSelect(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowUploadFolderSelect(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showUploadFolderSelect]);

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
            className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
            title={copy.newDocument}
            type="button"
          >
            {isCreatingDoc ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
            <span>{isZh ? "新增" : "New"}</span>
          </button>
          <div ref={uploadDropdownRef} className="relative flex min-w-0 flex-1">
            <button
              onClick={() => {
                if (folderList.length <= 1) {
                  openUploadPicker(folderList[0]?.id ?? null);
                } else {
                  setShowUploadFolderSelect((value) => !value);
                }
              }}
              disabled={isUploadingFile}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:border-primary/40 hover:bg-gray-50 hover:text-primary active:scale-[0.98] disabled:opacity-50"
              title={isZh ? "上传文件" : "Upload file"}
              type="button"
            >
              {isUploadingFile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>{isZh ? "上传" : "Upload"}</span>
              {folderList.length > 1 ? (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              ) : null}
            </button>
            {showUploadFolderSelect && folderList.length > 1 ? (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="text-[12px] font-semibold leading-5 text-slate-700">
                    {isZh ? "选择上传目录" : "Select upload folder"}
                  </p>
                  <p className="text-[11px] leading-4 text-slate-400">
                    {isZh ? "文件会保存到所选项目空间目录" : "Files will be saved to the selected space folder"}
                  </p>
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {folderList.map((folder) => {
                    const fileCountInFolder = groupedFiles.get(folder.id)?.length ?? 0;
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => {
                          setShowUploadFolderSelect(false);
                          openUploadPicker(folder.id);
                        }}
                        className="group flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                      >
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                          <FolderOpen className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 break-words text-[13px] font-medium leading-5 text-slate-800 group-hover:text-primary">
                            {folder.name}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">
                            {isZh ? `${fileCountInFolder} 个文件` : `${fileCountInFolder} files`}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setShowUploadFolderSelect(false)}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-[12px] font-medium text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                  {isZh ? "取消" : "Cancel"}
                </button>
              </div>
            ) : null}
          </div>
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
