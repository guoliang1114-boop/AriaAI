import { useState } from "react";

import { api } from "../../api/client";
import type { ProjectFile } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";

type DocumentDialogMode = "create" | "rename";

interface UseProjectNotesDocumentActionsOptions {
  isZh: boolean;
  markdownFiles: ProjectFile[];
  onResetDocumentState: () => void;
  onSelectFile: (fileId: number | null) => void;
  onTemplateUpdated: () => void;
  onToastError: (message: string) => void;
  onToastSuccess: (message: string) => void;
  projectId: string;
  selectedFile: ProjectFile | null;
}

export function useProjectNotesDocumentActions({
  isZh,
  markdownFiles,
  onResetDocumentState,
  onSelectFile,
  onTemplateUpdated,
  onToastError,
  onToastSuccess,
  projectId,
  selectedFile,
}: UseProjectNotesDocumentActionsOptions) {
  const copy = getProjectNotesCopy(isZh);
  const [isCreatingDoc, setIsCreatingDoc] = useState(false);
  const [isRenamingDoc, setIsRenamingDoc] = useState(false);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentDialogMode, setDocumentDialogMode] = useState<DocumentDialogMode>("create");
  const [documentName, setDocumentName] = useState("");
  const [pendingFolderId, setPendingFolderId] = useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const openCreateDialog = (folderId?: number | null) => {
    setDocumentDialogMode("create");
    setPendingFolderId(folderId ?? null);
    setDocumentName("");
    setShowDocumentDialog(true);
  };

  const openRenameDialog = () => {
    if (!selectedFile) return;
    setDocumentDialogMode("rename");
    setPendingFolderId(selectedFile.folder_id ?? null);
    setDocumentName(selectedFile.name);
    setShowDocumentDialog(true);
  };

  const closeDocumentDialog = () => {
    if (isCreatingDoc || isRenamingDoc) return;
    setShowDocumentDialog(false);
    setDocumentName("");
    setPendingFolderId(null);
  };

  const submitDocumentDialog = async () => {
    const normalizedName = documentName.trim();
    if (!normalizedName) return;

    if (documentDialogMode === "create") {
      setIsCreatingDoc(true);
      try {
        const created = await api.post<ProjectFile>(`/projects/${projectId}/documents`, {
          folder_id: pendingFolderId,
          name: normalizedName,
          content: `# ${normalizedName.replace(/\.md$/i, "")}\n`,
        });
        onTemplateUpdated();
        onSelectFile(created.id);
        closeDocumentDialog();
        onToastSuccess(copy.documentCreated);
      } catch (error) {
        console.error("Failed to create document:", error);
        onToastError(copy.documentCreateFailed);
      } finally {
        setIsCreatingDoc(false);
      }
      return;
    }

    if (!selectedFile || normalizedName === selectedFile.name) return;

    setIsRenamingDoc(true);
    try {
      await api.patch(`/projects/${projectId}/documents/${selectedFile.id}`, {
        name: normalizedName,
      });
      onTemplateUpdated();
      closeDocumentDialog();
      onToastSuccess(copy.documentRenamed);
    } catch (error) {
      console.error("Failed to rename document:", error);
      onToastError(copy.documentRenameFailed);
    } finally {
      setIsRenamingDoc(false);
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedFile) return;
    setIsDeletingDoc(true);
    try {
      await api.delete(`/projects/${projectId}/files/${selectedFile.id}`);
      const nextFile = markdownFiles.find((file) => file.id !== selectedFile.id) || null;
      onSelectFile(nextFile?.id ?? null);
      onResetDocumentState();
      setShowDeleteDialog(false);
      onTemplateUpdated();
      onToastSuccess(copy.documentDeleted);
    } catch (error) {
      console.error("Failed to delete document:", error);
      onToastError(copy.documentDeleteFailed);
    } finally {
      setIsDeletingDoc(false);
    }
  };

  return {
    closeDocumentDialog,
    documentDialogMode,
    documentName,
    handleDeleteDocument,
    isCreatingDoc,
    isDeletingDoc,
    isRenamingDoc,
    openCreateDialog,
    openRenameDialog,
    setDocumentName,
    setShowDeleteDialog,
    showDeleteDialog,
    showDocumentDialog,
    submitDocumentDialog,
  };
}
