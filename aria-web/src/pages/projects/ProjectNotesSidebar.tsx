import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  Wand2,
} from "lucide-react";
import type { ProjectFile, ProjectFolder } from "../../types/api";

const COPY = {
  heading: { zh: "咨询项目笔记", en: "Consulting Project Docs" },
  bootstrap: { zh: "咨询售前模板", en: "Consulting Pre-sales" },
  newDocument: { zh: "新建文档", en: "New document" },
  createInFolder: {
    zh: "在该文件夹中新建文档",
    en: "Create document in this folder",
  },
  noDocuments: { zh: "暂无文档", en: "No documents yet" },
  uncategorized: { zh: "未分组", en: "Uncategorized" },
  emptyTitle: { zh: "还没有项目文档", en: "No project documents yet" },
  emptyDescription: {
    zh: "可以先生成咨询售前模板，快速得到结构化的项目笔记目录。",
    en: "Create the consulting pre-sales template to start with a structured notes tree.",
  },
  emptyAction: {
    zh: "创建咨询售前模板",
    en: "Create Consulting Pre-sales Template",
  },
} as const;

function pick(
  isZh: boolean,
  value: {
    zh: string;
    en: string;
  },
) {
  return isZh ? value.zh : value.en;
}

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
  return (
    <aside className="flex w-80 flex-col border-r border-gray-200 bg-gray-50/70">
      <div className="border-b border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">
              {pick(isZh, COPY.heading)}
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
            {pick(isZh, COPY.bootstrap)}
          </button>
          <button
            onClick={() => onCreateDocument(folderList[0]?.id ?? null)}
            disabled={isCreatingDoc}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title={pick(isZh, COPY.newDocument)}
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
                  title={pick(isZh, COPY.createInFolder)}
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
                      {pick(isZh, COPY.noDocuments)}
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
              {pick(isZh, COPY.uncategorized)}
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

        {markdownFiles.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-800">
              {pick(isZh, COPY.emptyTitle)}
            </p>
            <p className="mt-1 text-xs leading-6 text-gray-500">
              {pick(isZh, COPY.emptyDescription)}
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
              {pick(isZh, COPY.emptyAction)}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
