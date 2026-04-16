import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type {
  ProjectDetail as ProjectDetailType,
  ProjectFile,
  ProjectFolder,
} from "../../types/api";
import { downloadProjectFile } from "./downloadProjectFile";

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

interface UseProjectDocumentsManagerParams {
  currentFolder: string | null;
  files: ProjectFile[];
  folders: ProjectFolder[];
  isZh: boolean;
  onUpdate: () => void;
  projectId: string;
  toast: {
    error: (message: string) => void;
  };
}

const MAX_CLIENT_UPLOAD_SIZE = 80 * 1024 * 1024;

export function useProjectDocumentsManager({
  currentFolder,
  files,
  folders,
  isZh,
  onUpdate,
  projectId,
  toast,
}: UseProjectDocumentsManagerParams) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localFiles, setLocalFiles] = useState<ProjectFile[]>(files);
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
  const prevFilesLengthRef = useRef(files.length);

  useEffect(() => {
    if (!isUploadingRef.current && files.length !== prevFilesLengthRef.current) {
      prevFilesLengthRef.current = files.length;
      setLocalFiles(files);
    }
  }, [files]);

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
      toast.error(isZh ? "涓嬭浇澶辫触" : "Download failed");
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
      toast.error(isZh ? "鍒犻櫎澶辫触" : "Delete failed");
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
          ? `鏂囦欢杩囧ぇ锛?{oversized[0].name} 瓒呰繃 80MB 闄愬埗`
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
            toast.error(isZh ? `鏂囦欢杩囧ぇ锛?{file.name}` : `File too large: ${file.name}`);
          } else if (
            requestError.code === "ECONNABORTED" ||
            message.includes("timeout")
          ) {
            toast.error(
              isZh
                ? `涓婁紶瓒呮椂锛?{file.name}锛岃妫€鏌ョ綉缁滄垨灏濊瘯鍘嬬缉鏂囦欢`
                : `Upload timeout: ${file.name}, please check your network or compress the file`,
            );
          } else if (!requestError.response) {
            toast.error(
              isZh
                ? `缃戠粶閿欒锛屾棤娉曚笂浼?${file.name}`
                : `Network error, unable to upload ${file.name}`,
            );
          } else {
            const detail = requestError.response?.data?.detail || "";
            toast.error(
              isZh
                ? `涓婁紶澶辫触锛?{file.name}${detail ? ` (${detail})` : ""}`
                : `Upload failed: ${file.name}${detail ? ` (${detail})` : ""}`,
            );
          }
        }
      }

      try {
        const updatedDetail = await api.get<ProjectDetailType>(`/projects/${projectId}/detail`);
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
      toast.error(isZh ? "鍒涘缓鏂囦欢澶瑰け璐?" : "Failed to create folder");
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

  return {
    confirmDelete,
    contextMenu,
    creatingFolder,
    deleting,
    fileInputRef,
    fileToDelete,
    folderInputRef,
    folderName,
    handleContextMenu,
    handleCreateFolder,
    handleDeleteFile,
    handleDownload,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    isDragging,
    localFiles,
    newMenuRef,
    setContextMenu,
    setFileToDelete,
    setFolderName,
    setShowDeleteModal,
    setShowFolderModal,
    setShowNewMenu,
    setShowUploadPanel,
    setUploadProgress,
    showDeleteModal,
    showFolderModal,
    showNewMenu,
    showUploadPanel,
    uploadProgress,
    uploading,
  };
}
