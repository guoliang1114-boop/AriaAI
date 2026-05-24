import {
  ChevronRight,
  FolderKanban,
  LayoutGrid,
  List,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import type { ChangeEvent, RefObject } from "react";

type ViewMode = "grid" | "list";

interface ProjectDocumentsToolbarProps {
  currentFolder: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  goToRoot: () => void
  isZh: boolean
  newMenuRef: RefObject<HTMLDivElement | null>
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void
  onOpenFolderModal: () => void
  onSearchQueryChange: (value: string) => void
  onToggleNewMenu: () => void
  onViewModeChange: (viewMode: ViewMode) => void
  searchQuery: string
  setShowNewMenu: (value: boolean | ((value: boolean) => boolean)) => void
  showNewMenu: boolean
  viewMode: ViewMode
}

export function ProjectDocumentsToolbar({
  currentFolder,
  fileInputRef,
  goToRoot,
  isZh,
  newMenuRef,
  onFileSelect,
  onOpenFolderModal,
  onSearchQueryChange,
  onToggleNewMenu,
  onViewModeChange,
  searchQuery,
  setShowNewMenu,
  showNewMenu,
  viewMode,
}: ProjectDocumentsToolbarProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
      <nav className="flex items-center gap-1 text-sm">
        <button
          onClick={goToRoot}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
            currentFolder === null
              ? "text-gray-900 font-medium"
              : "hover:bg-gray-100 text-gray-600"
          }`}
        >
          <FolderKanban className="w-4 h-4" />
          {isZh ? "全部文件" : "All Files"}
        </button>
        {currentFolder && (
          <>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <span className="px-3 py-1.5 text-gray-900 font-medium">{currentFolder}</span>
          </>
        )}
      </nav>

      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={isZh ? "搜索文件..." : "Search files..."}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-48 sm:w-64"
          />
        </div>

        <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5">
          <button
            onClick={() => onViewModeChange("grid")}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === "grid"
                ? "bg-gray-100 text-gray-900"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === "list"
                ? "bg-gray-100 text-gray-900"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        <div className="relative" ref={newMenuRef}>
          <button
            onClick={onToggleNewMenu}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            {isZh ? "新建" : "New"}
          </button>

          {showNewMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50">
              <button
                onClick={() => {
                  setShowNewMenu(false)
                  fileInputRef.current?.click()
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {isZh ? "上传文件" : "Upload File"}
              </button>
              <button
                onClick={() => {
                  setShowNewMenu(false)
                  onOpenFolderModal()
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <FolderKanban className="w-4 h-4" />
                {isZh ? "新建文件夹" : "New Folder"}
              </button>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onFileSelect}
          className="hidden"
        />
      </div>
    </div>
  )
}
