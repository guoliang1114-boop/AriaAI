import { Edit3, FolderKanban, Share2, Trash2, Upload } from "lucide-react";
import type { ProjectFile } from "../../types/api";

interface FolderMenuItem {
  id: number
  name: string
}

interface ContextMenuState {
  item: ProjectFile | FolderMenuItem
  x: number
  y: number
}

interface ProjectDocumentsContextMenuProps {
  contextMenu: ContextMenuState | null
  enterFolder: (folderName: string) => void
  handleDeleteFile: (fileId: number, fileName: string) => void
  handleDownload: (file: ProjectFile) => Promise<void>
  isZh: boolean
  onClose: () => void
}

export function ProjectDocumentsContextMenu({
  contextMenu,
  enterFolder,
  handleDeleteFile,
  handleDownload,
  isZh,
  onClose,
}: ProjectDocumentsContextMenuProps) {
  if (!contextMenu) return null

  const isFile = "file_type" in contextMenu.item

  return (
    <div
      className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]"
      style={{ top: contextMenu.y, left: contextMenu.x }}
    >
      {isFile ? (
        <>
          <button
            onClick={() => {
              void handleDownload(contextMenu.item as ProjectFile)
              onClose()
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            {isZh ? "下载" : "Download"}
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            {isZh ? "重命名" : "Rename"}
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Share2 className="w-4 h-4" />
            {isZh ? "分享" : "Share"}
          </button>
          <div className="h-px bg-gray-100 my-1" />
          <button
            onClick={() => {
              handleDeleteFile(contextMenu.item.id, contextMenu.item.name)
              onClose()
            }}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {isZh ? "删除" : "Delete"}
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => {
              enterFolder(contextMenu.item.name)
              onClose()
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <FolderKanban className="w-4 h-4" />
            {isZh ? "打开" : "Open"}
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            {isZh ? "重命名" : "Rename"}
          </button>
        </>
      )}
    </div>
  )
}
