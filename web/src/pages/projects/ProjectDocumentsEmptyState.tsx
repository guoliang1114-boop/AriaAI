import { Upload } from "lucide-react";

interface ProjectDocumentsEmptyStateProps {
  currentFolder: string | null;
  goToRoot: () => void;
  isZh: boolean;
}

export function ProjectDocumentsEmptyState({
  currentFolder,
  goToRoot,
  isZh,
}: ProjectDocumentsEmptyStateProps) {
  return (
    <div className="h-full flex flex-col items-center bg-white rounded-xl border border-dashed border-gray-200 pt-16">
      <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
        <Upload className="w-8 h-8 text-gray-300" />
      </div>
      <p className="text-gray-500 font-medium mb-2">
        {currentFolder
          ? isZh
            ? "这个文件夹还是空的"
            : "This folder is empty"
          : isZh
            ? "把文件拖到这里开始上传"
            : "Drop files here"}
      </p>
      <p className="text-sm text-gray-400 mb-4">
        {currentFolder
          ? isZh
            ? "点击上方新建按钮添加文件"
            : "Click the New button to add files"
          : isZh
            ? "或者点击上方新建按钮"
            : "Or click the New button above"}
      </p>
      {currentFolder && (
        <button onClick={goToRoot} className="text-sm text-primary hover:underline mb-12">
          {isZh ? "返回根目录" : "Go back"}
        </button>
      )}
    </div>
  );
}
