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
    <aside className="w-80 border-r border-gray-200 bg-gray-50/70 flex flex-col">
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">
              {isZh ? "鍜ㄨ椤圭洰鏂囨。" : "Consulting Project Docs"}
            </p>
            <h3 className="mt-1 text-base font-semibold text-gray-900">{projectName}</h3>
          </div>
          <BookOpen className="w-5 h-5 text-primary mt-0.5" />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onInitTemplate}
            disabled={isBootstrapping}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isBootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {isZh ? "鍜ㄨ鍞墠妯℃澘" : "Consulting Pre-sales"}
          </button>
          <button
            onClick={() => onCreateDocument(folderList[0]?.id ?? null)}
            disabled={isCreatingDoc}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title={isZh ? "鏂板缓鏂囨。" : "New document"}
          >
            {isCreatingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {folderList.map((folder) => {
          const folderFiles = groupedFiles.get(folder.id) || [];
          const isOpen = openFolders[folder.id] ?? true;

          return (
            <div key={folder.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50">
                <button
                  onClick={() => onToggleFolder(folder.id)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-800 text-left flex-1"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <FolderOpen className="w-4 h-4 text-amber-500" />
                  {folder.name}
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateDocument(folder.id);
                  }}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  title={isZh ? "鍦ㄦ鍒嗙粍鏂板缓鏂囨。" : "Create document in this folder"}
                >
                  <FilePlus2 className="w-4 h-4" />
                </button>
              </div>

              {isOpen && (
                <div className="px-2 pb-2 space-y-1">
                  {folderFiles.length > 0 ? (
                    folderFiles.map((file) => (
                      <button
                        key={file.id}
                        onClick={() => onSelectFile(file.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                          selectedFileId === file.id
                            ? "bg-primary/10 text-primary"
                            : "text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <FileText className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs text-gray-400">
                      {isZh ? "鏆傛棤鏂囨。" : "No documents yet"}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {(groupedFiles.get("uncategorized") || []).length > 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white overflow-hidden">
            <button
              onClick={() => onToggleFolder("uncategorized")}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {openFolders.uncategorized ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              <FolderOpen className="w-4 h-4 text-gray-400" />
              {isZh ? "鏈垎缁勬枃妗?" : "Uncategorized"}
            </button>
            {openFolders.uncategorized && (
              <div className="px-2 pb-2 space-y-1">
                {(groupedFiles.get("uncategorized") || []).map((file) => (
                  <button
                    key={file.id}
                    onClick={() => onSelectFile(file.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      selectedFileId === file.id
                        ? "bg-primary/10 text-primary"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {markdownFiles.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
            <BookOpen className="w-10 h-10 mx-auto text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-800">
              {isZh ? "杩樻病鏈夐」鐩枃妗?" : "No project documents yet"}
            </p>
            <p className="mt-1 text-xs leading-6 text-gray-500">
              {isZh
                ? "鍏堢敓鎴愬挩璇㈠敭鍓嶆ā鏉匡紝灏辫兘寰楀埌涓€濂楅€傚悎鍜ㄨ椤圭洰鎺ㄨ繘鐨勬爣鍑嗘枃妗ｇ洰褰曘€?"
                : "Create the consulting pre-sales template to start with a structured notes tree."}
            </p>
            <button
              onClick={onInitTemplate}
              disabled={isBootstrapping}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {isBootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {isZh ? "鐢熸垚鍜ㄨ鍞墠妯℃澘" : "Create Consulting Pre-sales Template"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
