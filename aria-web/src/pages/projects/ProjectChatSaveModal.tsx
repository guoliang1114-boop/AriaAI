import { useEffect, useMemo, useState } from "react";
import { FileText, FolderKanban, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import {
  DEFAULT_PROJECT_NOTE_FILENAME_EN,
  DEFAULT_PROJECT_NOTE_FILENAME_ZH,
  getProjectChatCopy,
} from "./projectChatCopy";

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
  const [action, setAction] = useState<"merge" | "new">("merge");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);

  const mdFiles = useMemo(() => files.filter((file) => file.file_type?.toLowerCase() === "md"), [files]);

  const filesInSelectedFolder = useMemo(() => {
    return mdFiles.filter((file) => (selectedFolderId == null ? file.folder_id == null : file.folder_id === selectedFolderId));
  }, [mdFiles, selectedFolderId]);

  useEffect(() => {
    if (!isOpen) return;
    setAction("merge");
    setSelectedFolderId(null);
    setSelectedFileId(null);
    setFileName(isZh ? DEFAULT_PROJECT_NOTE_FILENAME_ZH : DEFAULT_PROJECT_NOTE_FILENAME_EN);
    setLoading(false);
  }, [isOpen, isZh]);

  useEffect(() => {
    if (action === "merge") {
      setSelectedFileId(filesInSelectedFolder[0]?.id ?? null);
    }
  }, [action, filesInSelectedFolder]);

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

        <div className="p-5 space-y-4">
          <div className="flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => setAction("merge")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                action === "merge" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {copy.mergeIntoExisting}
            </button>
            <button
              onClick={() => setAction("new")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                action === "new" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {copy.saveAsNew}
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">{copy.selectFolder}</label>
            <div className="max-h-32 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              <label
                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedFolderId === null ? "bg-primary/5" : ""
                }`}
              >
                <input
                  type="radio"
                  name="folder"
                  checked={selectedFolderId === null}
                  onChange={() => setSelectedFolderId(null)}
                  className="accent-primary"
                />
                <FolderKanban className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-800">{copy.rootFolder}</span>
              </label>
              {folders.map((folder) => (
                <label
                  key={folder.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedFolderId === folder.id ? "bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="folder"
                    checked={selectedFolderId === folder.id}
                    onChange={() => setSelectedFolderId(folder.id)}
                    className="accent-primary"
                  />
                  <FolderKanban className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <span className="text-sm text-gray-800 truncate">{folder.name}</span>
                </label>
              ))}
            </div>
          </div>

          {action === "merge" ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">{copy.selectMergeTarget}</label>
              {filesInSelectedFolder.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">{copy.noNoteFiles}</p>
              ) : (
                <div className="max-h-40 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {filesInSelectedFolder.map((file) => (
                    <label
                      key={file.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedFileId === file.id ? "bg-primary/5" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="file"
                        checked={selectedFileId === file.id}
                        onChange={() => setSelectedFileId(file.id)}
                        className="accent-primary"
                      />
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-gray-800 truncate">{file.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">{copy.newNoteFileName}</label>
              <input
                type="text"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder={copy.newNoteFilePlaceholder}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-gray-400">{copy.autoAppendMd}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {copy.cancel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (action === "merge" && filesInSelectedFolder.length === 0)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {copy.confirmSave}
          </button>
        </div>
      </div>
    </div>
  );
}
