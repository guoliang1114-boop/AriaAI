import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { ProjectFile, ProjectFolder } from "../../types/api";

interface ProjectDocumentDetail {
  id: number;
  project_id: number;
  folder_id?: number | null;
  name: string;
  content: string;
  summary?: string;
  uploaded_at: string;
}

export function useProjectNotesDocuments({
  projectId,
  files,
  folders,
}: {
  projectId: string;
  files: ProjectFile[];
  folders: ProjectFolder[];
}) {
  const markdownFiles = useMemo(
    () =>
      files
        .filter((file) => file.file_type?.toLowerCase() === "md")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );
  const folderList = useMemo(
    () =>
      [...folders].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      ),
    [folders],
  );
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const lastLoadedContentRef = useRef("");

  useEffect(() => {
    setOpenFolders((current) => {
      const next = { ...current };
      for (const folder of folderList) {
        if (!(folder.id in next)) {
          next[folder.id] = true;
        }
      }
      if (!("uncategorized" in next)) {
        next.uncategorized = true;
      }
      return next;
    });
  }, [folderList]);

  useEffect(() => {
    if (markdownFiles.length === 0) {
      setSelectedFileId(null);
      setContent("");
      setDirty(false);
      lastLoadedContentRef.current = "";
      return;
    }

    if (!selectedFileId || !markdownFiles.some((file) => file.id === selectedFileId)) {
      setSelectedFileId(markdownFiles[0].id);
    }
  }, [markdownFiles, selectedFileId]);

  useEffect(() => {
    if (!selectedFileId) {
      return;
    }

    let cancelled = false;

    const loadDocument = async () => {
      setIsLoadingDoc(true);
      try {
        const data = await api.get<ProjectDocumentDetail>(
          `/projects/${projectId}/documents/${selectedFileId}`,
        );
        if (cancelled) {
          return;
        }
        setContent(data.content || "");
        setDirty(false);
        lastLoadedContentRef.current = data.content || "";
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load project document:", error);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDoc(false);
        }
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedFileId]);

  const selectedFile =
    markdownFiles.find((file) => file.id === selectedFileId) || null;

  const groupedFiles = useMemo(() => {
    const map = new Map<number | "uncategorized", ProjectFile[]>();
    for (const folder of folderList) {
      map.set(folder.id, []);
    }
    map.set("uncategorized", []);
    for (const file of markdownFiles) {
      const key = file.folder_id ?? "uncategorized";
      const bucket = map.get(key) || [];
      bucket.push(file);
      map.set(key, bucket);
    }
    return map;
  }, [folderList, markdownFiles]);

  const toggleFolder = (key: string | number) => {
    setOpenFolders((current) => ({ ...current, [key]: !current[key] }));
  };

  const markContentSynced = (nextContent: string) => {
    lastLoadedContentRef.current = nextContent;
    setDirty(false);
  };

  const updateContent = (nextContent: string) => {
    setContent(nextContent);
    setDirty(nextContent !== lastLoadedContentRef.current);
  };

  const resetDocumentState = () => {
    setContent("");
    setDirty(false);
    lastLoadedContentRef.current = "";
  };

  return {
    content,
    dirty,
    folderList,
    groupedFiles,
    isLoadingDoc,
    markdownFiles,
    openFolders,
    selectedFile,
    selectedFileId,
    setSelectedFileId,
    toggleFolder,
    updateContent,
    markContentSynced,
    resetDocumentState,
  };
}
