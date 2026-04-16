import { useState } from "react";
import { api } from "../../api/client";
import { getApiBaseUrl } from "../../config/api";
import type { ProjectFile } from "../../types/api";
import { getProjectNotesCopy } from "./projectNotesCopy";

type DocumentDialogMode = "create" | "rename";
type ApplyMode = "replace" | "append";

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
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

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

  const handleAIGenerate = async () => {
    const draft = aiDraft.trim() || content.trim();
    if (!draft) return;
    setAiLoading(true);
    setAiResult("");
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/projects/${projectId}/notes/ai-polish-stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": localStorage.getItem("authToken") || "",
          },
          body: JSON.stringify({ draft }),
        },
      );
      if (!response.ok) throw new Error("Network response was not ok");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          const line = event
            .split("\n")
            .map((item) => item.trim())
            .find((item) => item.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.replace(/^data:\s*/, ""));
            if (payload.type === "text" && payload.content) {
              setAiResult((current) => current + payload.content);
            } else if (payload.type === "error") {
              throw new Error(payload.message || "AI generation failed");
            }
          } catch (error) {
            console.error("Failed to parse stream event:", error);
          }
        }
      }
    } catch (error: any) {
      console.error("AI generation failed:", error);
      onToastError(error?.message || copy.aiGenerationFailed);
    } finally {
      setAiLoading(false);
    }
  };

  const applyAIResult = (applyMode: ApplyMode) => {
    const currentResult = aiResult.trim();
    if (!currentResult) return;
    const nextContent =
      applyMode === "replace"
        ? currentResult
        : `${content.trim() ? `${content}\n\n---\n\n` : ""}${currentResult}`;
    updateContent(nextContent);
    closeAIModal();
    onToastSuccess(copy.aiApplied);
  };

  const closeAIModal = () => {
    setShowAIModal(false);
    setAiDraft("");
    setAiResult("");
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
    openRenameDialog,
    setAiDraft,
    setDocumentName,
    setShowAIModal,
    setShowDeleteDialog,
    showAIModal,
    showDeleteDialog,
    showDocumentDialog,
    submitDocumentDialog,
  };
}
