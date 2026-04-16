import { useState } from "react";
import { api } from "../../api/client";
import type { ProjectFile } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";
import { useProjectNotesAI } from "./useProjectNotesAI";

type DocumentDialogMode = "create" | "rename";

interface UseProjectNotesActionsOptions {
  content: string;
  isZh: boolean;
  markdownFiles: ProjectFile[];
  onResetDocumentState: () => void;
  onSelectFile: (fileId: number | null) => void;
  onTemplateUpdated: () => void;
  onToastError: (message: string) => void;
  onToastSuccess: (message: string) => void;
  projectId: string;
  selectedFile: ProjectFile | null;
  updateContent: (value: string) => void;
}

export function useProjectNotesActions({
  content,
  isZh,
  markdownFiles,
  onResetDocumentState,
  onSelectFile,
  onTemplateUpdated,
  onToastError,
  onToastSuccess,
  projectId,
  selectedFile,
  updateContent,
}: UseProjectNotesActionsOptions) {
  const copy = getProjectNotesCopy(isZh);
  const [isSaving, setIsSaving] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isCreatingDoc, setIsCreatingDoc] = useState(false);
  const [isRenamingDoc, setIsRenamingDoc] = useState(false);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentDialogMode, setDocumentDialogMode] =
    useState<DocumentDialogMode>("create");
  const [documentName, setDocumentName] = useState("");
  const [pendingFolderId, setPendingFolderId] = useState<number | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const {
    aiDraft,
    aiLoading,
    aiResult,
    applyAIResult,
    closeAIModal,
    handleAIGenerate,
    openAIModal,
    setAiDraft,
    showAIModal,
  } = useProjectNotesAI({
    content,
    isZh,
    onToastError,
    onToastSuccess,
    projectId,
    updateContent,
  });

  const handleSave = async (markContentSynced: (value: string) => void) => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await api.patch(`/projects/${projectId}/documents/${selectedFile.id}`, {
        content,
      });
      markContentSynced(content);
      onTemplateUpdated();
      onToastSuccess(copy.saved);
    } catch (error) {
      console.error("Failed to save document:", error);
      onToastError(copy.saveFailed);
    } finally {
      setIsSaving(false);
    }
  };

  const handleInitTemplate = async () => {
    setIsBootstrapping(true);
    try {
      const result = await api.post<{ cleaned_folder_count?: number }>(
        `/projects/${projectId}/notes/templates/presales`,
        {},
      );
      onTemplateUpdated();
      onToastSuccess(
        result.cleaned_folder_count
          ? copy.templateCreatedAndCleaned
          : copy.templateCreated,
      );
    } catch (error) {
      console.error("Failed to initialize template:", error);
      onToastError(copy.templateCreateFailed);
    } finally {
      setIsBootstrapping(false);
    }
  };

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
        const created = await api.post<ProjectFile>(
          `/projects/${projectId}/documents`,
          {
            folder_id: pendingFolderId,
            name: normalizedName,
            content: `# ${normalizedName.replace(/\.md$/i, "")}\n`,
          },
        );
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
      const nextFile =
        markdownFiles.find((file) => file.id !== selectedFile.id) || null;
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
    aiDraft,
    aiLoading,
    aiResult,
    applyAIResult,
    closeAIModal,
    closeDocumentDialog,
    documentDialogMode,
    documentName,
    handleAIGenerate,
    handleDeleteDocument,
    handleInitTemplate,
    handleSave,
    isBootstrapping,
    isCreatingDoc,
    isDeletingDoc,
    isRenamingDoc,
    isSaving,
    openCreateDialog,
    openAIModal,
    openRenameDialog,
    setAiDraft,
    setDocumentName,
    setShowDeleteDialog,
    showAIModal,
    showDeleteDialog,
    showDocumentDialog,
    submitDocumentDialog,
  };
}
