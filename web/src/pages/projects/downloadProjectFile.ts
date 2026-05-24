import { api } from "../../api/client";

interface DownloadProjectFileParams {
  fileId: number;
  fileName: string;
  projectId: string;
}

export async function downloadProjectFile({
  fileId,
  fileName,
  projectId,
}: DownloadProjectFileParams) {
  const response = await api.get<Blob>(`/projects/${projectId}/files/${fileId}/download`, {
    responseType: "blob",
  });

  const url = window.URL.createObjectURL(new Blob([response]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
