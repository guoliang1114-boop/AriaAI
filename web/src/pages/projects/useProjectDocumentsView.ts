import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ProjectFile, ProjectFolder } from "../../types/api";

type ViewMode = "grid" | "list";

interface UseProjectDocumentsViewOptions {
  files: ProjectFile[];
  folders: ProjectFolder[];
}

export function useProjectDocumentsView({
  files,
  folders,
}: UseProjectDocumentsViewOptions) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const currentFolder = searchParams.get("folder");

  const getFolderName = (folderId: number | null | undefined): string | null => {
    if (!folderId) return null;
    const folder = folders.find((item) => item.id === folderId);
    return folder?.name || null;
  };

  const filteredFolders = folders.filter((folder) => {
    if (currentFolder !== null) return false;
    return folder.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const filteredFiles = files.filter((file) => {
    const folderNameValue = getFolderName(file.folder_id);
    return (
      folderNameValue === currentFolder &&
      file.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const isEmpty = filteredFolders.length === 0 && filteredFiles.length === 0;

  const enterFolder = (folderNameValue: string) => {
    setSearchParams({ folder: folderNameValue });
    setSearchQuery("");
  };

  const goToRoot = () => {
    setSearchParams({});
    setSearchQuery("");
  };

  return {
    currentFolder,
    enterFolder,
    filteredFiles,
    filteredFolders,
    goToRoot,
    isEmpty,
    searchQuery,
    setSearchQuery,
    setViewMode,
    viewMode,
  };
}
