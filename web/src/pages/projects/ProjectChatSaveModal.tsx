import { ArrowRight, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectChatSaveForm } from "./ProjectChatSaveForm";
import { getProjectChatCopy } from "./projectChatCopy";
import { useProjectChatSaveModal } from "./useProjectChatSaveModal";

type ProjectChatSaveModalProps = {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  messageId?: number | null;
  conversationId?: number | null;
  files: ProjectFile[];
  folders: ProjectFolder[];
  onSuccess: () => void;
  onOpenProjectMemory?: () => void;
  onRefreshProjectMemory?: () => Promise<void> | void;
};

export function ProjectChatSaveModal({
  isOpen,
  onClose,
  projectId,
  messageId,
  conversationId,
  files,
  folders,
  onOpenProjectMemory,
  onRefreshProjectMemory,
  onSuccess,
}: ProjectChatSaveModalProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const [refreshingMemory, setRefreshingMemory] = useState(false);
  const {
    action,
    fileName,
    filesInSelectedFolder,
    loading,
    selectedFileId,
    selectedFolderId,
    setAction,
    setFileName,
    setLoading,
    setSelectedFileId,
    setSelectedFolderId,
  } = useProjectChatSaveModal({
    defaultFileName: copy.defaultProjectNoteFilename,
    files,
    isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    setSaved(false);
    setRefreshingMemory(false);
  }, [conversationId, isOpen, messageId]);

  if (!isOpen || (!messageId && !conversationId)) {
    return null;
  }

  const handleSubmit = async () => {
    if (action === "merge" && !selectedFileId) {
      toast.error(copy.selectNoteFile);
      return;
    }
    if (action === "new" && !fileName.trim()) {
      toast.error(copy.enterFileName);
      return;
    }

    setLoading(true);
    try {
      if (conversationId) {
        await api.post(`/projects/${projectId}/conversations/${conversationId}/save-markdown`, {
          action,
          file_id: selectedFileId,
          file_name: fileName.trim(),
          folder_id: selectedFolderId,
        });
      } else {
        await api.post(`/projects/${projectId}/messages/${messageId}/save-to-document`, {
          action,
          file_id: selectedFileId,
          file_name: fileName.trim(),
          folder_id: selectedFolderId,
          prepend_header: true,
        });
      }

      toast.success(action === "merge" ? copy.mergedIntoNote : copy.savedAsNewNote);
      await onSuccess();
      setSaved(true);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || copy.saveFailed;
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-codex-line-soft">
          <h3 className="font-semibold text-codex-ink">{copy.saveToNotes}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="border-b border-codex-line-soft bg-codex-accent-bg/70 px-5 py-3 text-sm leading-6 text-codex-good">
          {copy.saveToMemoryHint}
        </div>

        {saved ? (
          <div className="space-y-4 p-5">
            <div className="rounded-2xl border border-codex-line-soft bg-codex-accent-bg p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-codex-good">
                <CheckCircle2 className="h-4 w-4" />
                {copy.saveCompleteTitle}
              </div>
              <p className="mt-2 text-sm leading-6 text-codex-good">{copy.saveCompleteHint}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {onRefreshProjectMemory ? (
                <button
                  type="button"
                  onClick={async () => {
                    setRefreshingMemory(true);
                    try {
                      await onRefreshProjectMemory();
                      toast.success(copy.memoryRefreshStarted);
                    } catch (error) {
                      console.error("Failed to refresh project memory after save:", error);
                      toast.error(copy.memoryRefreshFailed);
                    } finally {
                      setRefreshingMemory(false);
                    }
                  }}
                  disabled={refreshingMemory}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-codex-ink px-4 py-2.5 text-sm font-medium text-white transition hover:bg-codex-accent disabled:opacity-60"
                >
                  {refreshingMemory ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {copy.refreshProjectMemory}
                </button>
              ) : null}
              {onOpenProjectMemory ? (
                <button
                  type="button"
                  onClick={onOpenProjectMemory}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-codex-line px-4 py-2.5 text-sm font-medium text-codex-ink-soft transition hover:bg-codex-bg-tint"
                >
                  {copy.openProjectMemory}
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-codex-line px-4 py-2.5 text-sm font-medium text-codex-ink-soft transition hover:bg-codex-bg-tint"
            >
              {copy.finishSave}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <ProjectChatSaveForm
              action={action}
              copy={copy}
              fileName={fileName}
              filesInSelectedFolder={filesInSelectedFolder}
              folders={folders}
              loading={loading}
              onActionChange={setAction}
              onCancel={onClose}
              onFileNameChange={setFileName}
              onSelectedFileChange={setSelectedFileId}
              onSelectedFolderChange={setSelectedFolderId}
              selectedFileId={selectedFileId}
              selectedFolderId={selectedFolderId}
            />
          </form>
        )}
      </div>
    </div>
  );
}
