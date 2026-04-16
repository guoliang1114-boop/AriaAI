import { X } from "lucide-react";
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
};

export function ProjectChatSaveModal({
  isOpen,
  onClose,
  projectId,
  messageId,
  conversationId,
  files,
  folders,
  onSuccess,
}: ProjectChatSaveModalProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const toast = useToast();
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
      onSuccess();
      onClose();
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{copy.saveToNotes}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

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
            onFileNameChange={setFileName}
            onSelectedFileChange={setSelectedFileId}
            onSelectedFolderChange={setSelectedFolderId}
            selectedFileId={selectedFileId}
            selectedFolderId={selectedFolderId}
          />
        </form>
      </div>
    </div>
  );
}
