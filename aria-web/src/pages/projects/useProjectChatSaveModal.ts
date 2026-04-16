import { useEffect, useMemo, useState } from "react";
import type { ProjectFile } from "../../types/api";

interface UseProjectChatSaveModalOptions {
  defaultFileName: string;
  files: ProjectFile[];
  isOpen: boolean;
}

export function useProjectChatSaveModal({
  defaultFileName,
  files,
  isOpen,
}: UseProjectChatSaveModalOptions) {
  const [action, setAction] = useState<"merge" | "new">("merge");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);

  const mdFiles = useMemo(
    () => files.filter((file) => file.file_type?.toLowerCase() === "md"),
    [files],
  );

  const filesInSelectedFolder = useMemo(
    () =>
      mdFiles.filter((file) =>
        selectedFolderId == null ? file.folder_id == null : file.folder_id === selectedFolderId,
      ),
    [mdFiles, selectedFolderId],
  );

  useEffect(() => {
    if (!isOpen) return;
    setAction("merge");
    setSelectedFolderId(null);
    setSelectedFileId(null);
    setFileName(defaultFileName);
    setLoading(false);
  }, [defaultFileName, isOpen]);

  useEffect(() => {
    if (action === "merge") {
      setSelectedFileId(filesInSelectedFolder[0]?.id ?? null);
    }
  }, [action, filesInSelectedFolder]);

  return {
    action,
    fileName,
    filesInSelectedFolder,
    loading,
    mdFiles,
    selectedFileId,
    selectedFolderId,
    setAction,
    setFileName,
    setLoading,
    setSelectedFileId,
    setSelectedFolderId,
  };
}
