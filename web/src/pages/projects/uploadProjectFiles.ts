import { api } from "../../api/client";
import type { ProjectFile } from "../../types/api";

export const MAX_PROJECT_FILE_UPLOAD_SIZE = 80 * 1024 * 1024;

export interface ProjectFileUploadError extends Error {
  reason?: "too_large";
  fileName?: string;
}

interface UploadProjectFilesParams {
  files: File[];
  folderId?: number | null;
  onProgress?: (index: number, progress: number) => void;
  projectId: string;
}

export async function uploadProjectFiles({
  files,
  folderId,
  onProgress,
  projectId,
}: UploadProjectFilesParams) {
  const oversized = files.find((file) => file.size > MAX_PROJECT_FILE_UPLOAD_SIZE);
  if (oversized) {
    const error = new Error("File exceeds upload size limit") as ProjectFileUploadError;
    error.reason = "too_large";
    error.fileName = oversized.name;
    throw error;
  }

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const formData = new FormData();
    formData.append("file", file);
    formData.append("file_type", file.name.split(".").pop() || "unknown");
    formData.append("size", file.size.toString());
    if (folderId != null) {
      formData.append("folder_id", folderId.toString());
    }

    await api.post<ProjectFile>(`/projects/${projectId}/files`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 300000,
      onUploadProgress: (progressEvent) => {
        if (!progressEvent.total || !onProgress) return;
        onProgress(
          index,
          Math.round((progressEvent.loaded * 100) / progressEvent.total),
        );
      },
    });
  }
}
