import { getApiBaseUrl } from "../../config/api";
import type { GeneratedArtifact } from "../../types/api";

type DownloadArtifactOptions = {
  artifact?: GeneratedArtifact | null;
  artifactId?: number;
  fileName?: string;
  path?: string;
};

function buildDownloadUrl({ artifact, artifactId, path }: DownloadArtifactOptions) {
  const resolvedId = artifactId ?? artifact?.id;
  if (resolvedId) {
    return `${getApiBaseUrl()}/artifacts/${resolvedId}/download`;
  }

  const resolvedPath = path ?? artifact?.path;
  if (!resolvedPath) {
    throw new Error("Missing artifact path");
  }

  const params = new URLSearchParams({ path: resolvedPath });
  return `${getApiBaseUrl()}/artifacts/download-by-path?${params.toString()}`;
}

function resolveFilename({ artifact, fileName, path }: DownloadArtifactOptions) {
  return fileName ?? artifact?.name ?? path?.split("/").pop() ?? "artifact";
}

export async function downloadArtifact(options: DownloadArtifactOptions) {
  const response = await fetch(buildDownloadUrl(options), {
    headers: {
      "X-Auth-Token": localStorage.getItem("authToken") || "",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download artifact (${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = resolveFilename(options);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
