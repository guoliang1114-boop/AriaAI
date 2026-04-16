import { useState } from "react";
import { api } from "../../api/client";
import type { ProjectFile } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";
import { useProjectNotesAI } from "./useProjectNotesAI";
import { useProjectNotesDocumentActions } from "./useProjectNotesDocumentActions";

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
  const {
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
  } = useProjectNotesDocumentActions({
    isZh,
    markdownFiles,
    onResetDocumentState,
    onSelectFile,
    onTemplateUpdated,
    onToastError,
    onToastSuccess,
    projectId,
    selectedFile,
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
