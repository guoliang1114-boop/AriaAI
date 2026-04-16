import {
  BookOpen,
  FilePlus2,
  Loader2,
  Wand2,
} from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectNotesFolderTree } from "./ProjectNotesFolderTree";
import { getProjectNotesCopy } from "./projectNotesCopy";

export function ProjectNotesSidebar({
  folderList,
  groupedFiles,
  isBootstrapping,
  isCreatingDoc,
  isZh,
  markdownFiles,
  openFolders,
  projectName,
  selectedFileId,
  onCreateDocument,
  onInitTemplate,
  onSelectFile,
  onToggleFolder,
}: {
  folderList: ProjectFolder[];
  groupedFiles: Map<number | "uncategorized", ProjectFile[]>;
  isBootstrapping: boolean;
  isCreatingDoc: boolean;
  isZh: boolean;
  markdownFiles: ProjectFile[];
  openFolders: Record<string, boolean>;
  projectName: string;
  selectedFileId: number | null;
  onCreateDocument: (folderId?: number | null) => void;
  onInitTemplate: () => void;
  onSelectFile: (fileId: number) => void;
  onToggleFolder: (key: string | number) => void;
}) {
  const copy = getProjectNotesCopy(isZh);

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
            onClick={onInitTemplate}
            disabled={isBootstrapping}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isBootstrapping ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {copy.bootstrap}
          </button>
          <button
            onClick={() => onCreateDocument(folderList[0]?.id ?? null)}
            disabled={isCreatingDoc}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title={copy.newDocument}
          >
            {isCreatingDoc ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
          </button>
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

        {markdownFiles.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-800">
              {copy.noProjectDocuments}
            </p>
            <p className="mt-1 text-xs leading-6 text-gray-500">
              {copy.emptySidebarDescription}
            </p>
            <button
              onClick={onInitTemplate}
              disabled={isBootstrapping}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isBootstrapping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {copy.emptyAction}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
