import { Loader2, X } from "lucide-react";
import type { RefObject } from "react";

interface ProjectDocumentsCreateFolderModalProps {
  creatingFolder: boolean;
  folderInputRef: RefObject<HTMLInputElement | null>;
  folderName: string;
  isZh: boolean;
  onClose: () => void;
  onCreate: () => void;
  onFolderNameChange: (value: string) => void;
}

export function ProjectDocumentsCreateFolderModal({
  creatingFolder,
  folderInputRef,
  folderName,
  isZh,
  onClose,
  onCreate,
  onFolderNameChange,
}: ProjectDocumentsCreateFolderModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">
            {isZh ? "鏂板缓文件澶?" : "New Folder"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {isZh ? "文件澶瑰悕绉?" : "Folder name"}
          </label>
          <input
            ref={folderInputRef}
            type="text"
            value={folderName}
            onChange={(event) => onFolderNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && folderName.trim()) {
                onCreate();
              }
              if (event.key === "Escape") {
                onClose();
              }
            }}
            placeholder={isZh ? "请输入文件夹名称" : "Enter folder name"}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            onClick={onCreate}
            disabled={!folderName.trim() || creatingFolder}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {creatingFolder && <Loader2 className="w-4 h-4 animate-spin" />}
            {isZh ? "鍒涘缓" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
