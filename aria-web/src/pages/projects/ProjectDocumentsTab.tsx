import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Download,
  Edit3,
  FileText,
  FolderKanban,
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  Search,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type {
  ProjectDetail as ProjectDetailType,
  ProjectFile,
  ProjectFolder,
} from "../../types/api";
import { downloadProjectFile } from "./downloadProjectFile";
import { ProjectDocumentsCreateFolderModal } from "./ProjectDocumentsCreateFolderModal";
import { ProjectDocumentsDeleteDialog } from "./ProjectDocumentsDeleteDialog";
import { ProjectDocumentsUploadPanel } from "./ProjectDocumentsUploadPanel";

type ViewMode = "grid" | "list";
type UploadStatus = "uploading" | "done" | "error";

interface ContextMenuState {
  x: number;
  y: number;
  item: ProjectFile | ProjectFolder;
}

interface UploadProgressItem {
  name: string;
  progress: number;
  status: UploadStatus;
}

interface DeleteTarget {
  id: number;
  name: string;
}

interface RequestErrorPayload {
  detail?: string;
}

interface RequestError {
  code?: string;
  message?: string;
  response?: {
    status?: number;
    data?: RequestErrorPayload;
  };
}

interface ProjectDocumentsTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

const MAX_CLIENT_UPLOAD_SIZE = 80 * 1024 * 1024;

export function ProjectDocumentsTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectDocumentsTabProps) {
  const { folders } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localFiles, setLocalFiles] = useState<ProjectFile[]>(projectDetail.files);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>([]);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);
  const prevFilesLengthRef = useRef(projectDetail.files.length);

  const currentFolder = searchParams.get("folder");

  useEffect(() => {
    if (
      !isUploadingRef.current &&
      projectDetail.files.length !== prevFilesLengthRef.current
    ) {
      prevFilesLengthRef.current = projectDetail.files.length;
      setLocalFiles(projectDetail.files);
    }
  }, [projectDetail.files]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      setContextMenu(null);
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) {
        setShowNewMenu(false);
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (showFolderModal && folderInputRef.current) {
      setTimeout(() => folderInputRef.current?.focus(), 100);
    }
  }, [showFolderModal]);

  const getFolderName = (folderId: number | null | undefined): string | null => {
    if (!folderId) return null;
    const folder = folders.find((item) => item.id === folderId);
    return folder?.name || null;
  };

  const filteredFolders = folders.filter((folder) => {
    if (currentFolder !== null) return false;
    return folder.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const filteredFiles = localFiles.filter((file) => {
    const folderNameValue = getFolderName(file.folder_id);
    return (
      folderNameValue === currentFolder &&
      file.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const isEmpty = filteredFolders.length === 0 && filteredFiles.length === 0;

  const getFileIcon = (fileType: string) => {
    const type = fileType.toLowerCase();
    if (type.includes("pdf")) return <FileText className="w-6 h-6 text-red-500" />;
    if (type.includes("doc") || type.includes("word")) {
      return <FileText className="w-6 h-6 text-blue-500" />;
    }
    if (type.includes("xls") || type.includes("sheet") || type.includes("csv")) {
      return <FileText className="w-6 h-6 text-green-500" />;
    }
    if (type.includes("ppt") || type.includes("presentation")) {
      return <FileText className="w-6 h-6 text-orange-500" />;
    }
    if (type.includes("image") || type.includes("jpg") || type.includes("png")) {
      return <FileText className="w-6 h-6 text-purple-500" />;
    }
    return <FileText className="w-6 h-6 text-gray-500" />;
  };

  const enterFolder = (folderNameValue: string) => {
    setSearchParams({ folder: folderNameValue });
    setSearchQuery("");
  };

  const goToRoot = () => {
    setSearchParams({});
    setSearchQuery("");
  };

  const handleContextMenu = (
    event: React.MouseEvent,
    item: ProjectFile | ProjectFolder,
  ) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, item });
  };

  const handleDownload = async (file: ProjectFile) => {
    try {
      await downloadProjectFile({
        fileId: file.id,
        fileName: file.name,
        projectId,
      });
    } catch (error) {
      console.error("Failed to download file:", error);
      toast.error(isZh ? "下载失败" : "Download failed");
    }
  };

  const handleDeleteFile = (fileId: number, fileName: string) => {
    setFileToDelete({ id: fileId, name: fileName });
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!fileToDelete) return;

    setDeleting(true);
    try {
      await api.delete(`/projects/${projectId}/files/${fileToDelete.id}`);
      setLocalFiles((prev) => prev.filter((file) => file.id !== fileToDelete.id));
      setShowDeleteModal(false);
      setFileToDelete(null);
    } catch (error) {
      console.error("Failed to delete file:", error);
      toast.error(isZh ? "删除失败" : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const uploadFiles = async (filesToUpload: File[]) => {
    isUploadingRef.current = true;
    setUploading(true);
    setShowUploadPanel(true);
    setUploadProgress(
      filesToUpload.map((file) => ({
        name: file.name,
        progress: 0,
        status: "uploading",
      })),
    );

    const oversized = filesToUpload.filter((file) => file.size > MAX_CLIENT_UPLOAD_SIZE);
    if (oversized.length > 0) {
      toast.error(
        isZh
          ? `文件过大：${oversized[0].name} 超过 80MB 限制`
          : `File too large: ${oversized[0].name} exceeds 80MB limit`,
      );
      setUploadProgress(
        filesToUpload.map((file) => ({
          name: file.name,
          progress: 0,
          status: oversized.includes(file) ? "error" : "uploading",
        })),
      );
      setUploading(false);
      isUploadingRef.current = false;
      return;
    }

    try {
      let folderId: number | null = null;
      if (currentFolder) {
        const folder = folders.find((item) => item.name === currentFolder);
        if (folder) {
          folderId = folder.id;
        }
      }

      for (let index = 0; index < filesToUpload.length; index += 1) {
        const file = filesToUpload[index];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("file_type", file.name.split(".").pop() || "unknown");
        formData.append("size", file.size.toString());
        if (folderId) {
          formData.append("folder_id", folderId.toString());
        }

        try {
          await api.post(`/projects/${projectId}/files`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
            timeout: 300000,
            onUploadProgress: (progressEvent) => {
              if (!progressEvent.total) return;
              const progress = Math.round(
                (progressEvent.loaded * 100) / progressEvent.total,
              );
              setUploadProgress((prev) =>
                prev.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, progress } : item,
                ),
              );
            },
          });

          setUploadProgress((prev) =>
            prev.map((item, itemIndex) =>
              itemIndex === index
                ? { ...item, progress: 100, status: "done" }
                : item,
            ),
          );
        } catch (error) {
          const requestError = error as RequestError;
          setUploadProgress((prev) =>
            prev.map((item, itemIndex) =>
              itemIndex === index ? { ...item, status: "error" } : item,
            ),
          );

          const status = requestError.response?.status;
          const message = requestError.message || "";
          if (status === 413) {
            toast.error(isZh ? `文件过大：${file.name}` : `File too large: ${file.name}`);
          } else if (
            requestError.code === "ECONNABORTED" ||
            message.includes("timeout")
          ) {
            toast.error(
              isZh
                ? `上传超时：${file.name}，请检查网络或尝试压缩文件`
                : `Upload timeout: ${file.name}, please check your network or compress the file`,
            );
          } else if (!requestError.response) {
            toast.error(
              isZh
                ? `网络错误，无法上传 ${file.name}`
                : `Network error, unable to upload ${file.name}`,
            );
          } else {
            const detail = requestError.response?.data?.detail || "";
            toast.error(
              isZh
                ? `上传失败：${file.name}${detail ? ` (${detail})` : ""}`
                : `Upload failed: ${file.name}${detail ? ` (${detail})` : ""}`,
            );
          }
        }
      }

      try {
        const updatedDetail = await api.get<ProjectDetailType>(
          `/projects/${projectId}/detail`,
        );
        setLocalFiles(updatedDetail.files);
      } catch (error) {
        console.error("Failed to refresh files:", error);
      }

      setTimeout(() => {
        setShowUploadPanel(false);
        setUploadProgress([]);
      }, 2000);
    } catch (error) {
      console.error("Failed to upload files:", error);
    } finally {
      setUploading(false);
      isUploadingRef.current = false;
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length > 0) {
      await uploadFiles(selectedFiles);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;

    setCreatingFolder(true);
    try {
      await api.post(`/projects/${projectId}/folders`, { name: folderName.trim() });
      setShowFolderModal(false);
      setFolderName("");
      onUpdate();
    } catch (error) {
      console.error("Failed to create folder:", error);
      toast.error(isZh ? "创建文件夹失败" : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length > 0) {
      await uploadFiles(droppedFiles);
    }
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const isFile = "file_type" in contextMenu.item;

    return (
      <div
        className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]"
        style={{ top: contextMenu.y, left: contextMenu.x }}
      >
        {isFile ? (
          <>
            <button
              onClick={() => {
                void handleDownload(contextMenu.item as ProjectFile);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {isZh ? "下载" : "Download"}
            </button>
            <button
              onClick={() => setContextMenu(null)}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Edit3 className="w-4 h-4" />
              {isZh ? "重命名" : "Rename"}
            </button>
            <button
              onClick={() => setContextMenu(null)}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              {isZh ? "分享" : "Share"}
            </button>
            <div className="h-px bg-gray-100 my-1" />
            <button
              onClick={() => {
                handleDeleteFile(contextMenu.item.id, contextMenu.item.name);
                setContextMenu(null);
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
                enterFolder(contextMenu.item.name);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <FolderKanban className="w-4 h-4" />
              {isZh ? "打开" : "Open"}
            </button>
            <button
              onClick={() => setContextMenu(null)}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <Edit3 className="w-4 h-4" />
              {isZh ? "重命名" : "Rename"}
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
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
            {isZh ? "所有文件" : "All Files"}
          </button>
          {currentFolder && (
            <>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <span className="px-3 py-1.5 text-gray-900 font-medium">
                {currentFolder}
              </span>
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
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-48 sm:w-64"
            />
          </div>

          <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === "grid"
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
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
              onClick={() => setShowNewMenu((value) => !value)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
              {isZh ? "新建" : "New"}
            </button>

            {showNewMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50">
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {isZh ? "上传文件" : "Upload File"}
                </button>
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setShowFolderModal(true);
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
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      <div
        className="flex-1 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && !uploading && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center z-20">
            <Upload className="w-12 h-12 text-primary mb-3" />
            <p className="text-primary font-medium">
              {isZh ? "释放以上传文件" : "Drop files to upload"}
            </p>
          </div>
        )}

        {isEmpty ? (
          <div className="h-full flex flex-col items-center bg-white rounded-xl border border-dashed border-gray-200 pt-16">
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
              <Upload className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium mb-2">
              {currentFolder
                ? isZh
                  ? "此文件夹为空"
                  : "This folder is empty"
                : isZh
                  ? "将文件拖放到此处"
                  : "Drop files here"}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              {currentFolder
                ? isZh
                  ? "点击右上角新建按钮添加文件"
                  : "Click the New button to add files"
                : isZh
                  ? "或点击右上角新建按钮"
                  : "Or click the New button above"}
            </p>
            {currentFolder && (
              <button
                onClick={goToRoot}
                className="text-sm text-primary hover:underline mb-12"
              >
                {isZh ? "返回上级" : "Go back"}
              </button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="flex-1 overflow-auto">
            {filteredFolders.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-500 mb-3 px-1">
                  {isZh ? "文件夹" : "Folders"}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {filteredFolders.map((folder) => (
                    <div
                      key={folder.id}
                      onClick={() => enterFolder(folder.name)}
                      onContextMenu={(event) => handleContextMenu(event, folder)}
                      className="group bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer relative"
                    >
                      <div className="flex flex-col items-center text-center">
                        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                          <FolderKanban className="w-7 h-7 text-blue-500" />
                        </div>
                        <h4 className="font-medium text-gray-900 text-sm truncate w-full">
                          {folder.name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1">
                          {isZh ? "文件夹" : "Folder"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredFiles.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3 px-1">
                  {isZh ? "文件" : "Files"}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {filteredFiles.map((file) => (
                    <div
                      key={file.id}
                      onContextMenu={(event) => handleContextMenu(event, file)}
                      className="group bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer relative"
                    >
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteFile(file.id, file.name);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="flex flex-col items-center text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                          {getFileIcon(file.file_type)}
                        </div>
                        <h4
                          className="font-medium text-gray-900 text-sm truncate w-full"
                          title={file.name}
                        >
                          {file.name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(file.uploaded_at).toLocaleString(
                            isZh ? "zh-CN" : "en-GB",
                            { hour12: false },
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">
                    {isZh ? "名称" : "Name"}
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-32">
                    {isZh ? "类型" : "Type"}
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-52">
                    {isZh ? "修改日期" : "Modified"}
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3 w-20">
                    {isZh ? "操作" : "Action"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredFolders.map((folder) => (
                  <tr
                    key={folder.id}
                    onClick={() => enterFolder(folder.name)}
                    onContextMenu={(event) => handleContextMenu(event, folder)}
                    className="hover:bg-gray-50 cursor-pointer group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                          <FolderKanban className="w-5 h-5 text-blue-500" />
                        </div>
                        <span className="font-medium text-gray-900 text-sm">
                          {folder.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {isZh ? "文件夹" : "Folder"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">-</td>
                    <td className="px-4 py-3 text-right">
                      <button className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredFiles.map((file) => (
                  <tr
                    key={file.id}
                    onContextMenu={(event) => handleContextMenu(event, file)}
                    className="hover:bg-gray-50 cursor-pointer group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                          {getFileIcon(file.file_type)}
                        </div>
                        <span className="font-medium text-gray-900 text-sm">
                          {file.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 uppercase">
                      {file.file_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {new Date(file.uploaded_at).toLocaleString(
                        isZh ? "zh-CN" : "en-GB",
                        { hour12: false },
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDownload(file);
                          }}
                          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteFile(file.id, file.name);
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {renderContextMenu()}

      {showFolderModal && (
        <ProjectDocumentsCreateFolderModal
          creatingFolder={creatingFolder}
          folderInputRef={folderInputRef}
          folderName={folderName}
          isZh={isZh}
          onClose={() => {
            setShowFolderModal(false);
            setFolderName("");
          }}
          onCreate={() => void handleCreateFolder()}
          onFolderNameChange={setFolderName}
        />
      )}

      {showDeleteModal && fileToDelete && (
        <ProjectDocumentsDeleteDialog
          deleting={deleting}
          fileToDelete={fileToDelete}
          isZh={isZh}
          onClose={() => {
            setShowDeleteModal(false);
            setFileToDelete(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {showUploadPanel && uploadProgress.length > 0 && (
        <ProjectDocumentsUploadPanel
          isZh={isZh}
          uploadProgress={uploadProgress}
          onClose={() => {
            setShowUploadPanel(false);
            setUploadProgress([]);
          }}
        />
      )}
    </div>
  );
}
