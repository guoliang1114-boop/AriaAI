import { useTranslation } from "react-i18next";
import { useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { downloadProjectFile } from "./downloadProjectFile";
import { ProjectNotesContentPanel } from "./ProjectNotesContentPanel";
import { ProjectNotesDialogs } from "./ProjectNotesDialogs";
import { ProjectNotesSidebar } from "./ProjectNotesSidebar";
import { ProjectNotesToolbar } from "./ProjectNotesToolbar";
import { getProjectNotesCopy } from "./projectNotesCopy";
import { useProjectNotesActions } from "./useProjectNotesActions";
import { useProjectNotesDocuments } from "./useProjectNotesDocuments";
import { useProjectNotesUI } from "./useProjectNotesUI";
import {
  type ProjectFileUploadError,
  uploadProjectFiles,
} from "./uploadProjectFiles";

interface ProjectNotesTabProps {
  projectId: string;
  projectName: string;
  files: ProjectFile[];
  folders: ProjectFolder[];
  onUpdate: () => void;
}

export function ProjectNotesTab({
  projectId,
  projectName,
  files,
  folders,
  onUpdate,
}: ProjectNotesTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectNotesCopy(isZh);
  const toast = useToast();
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isMovingDoc, setIsMovingDoc] = useState(false);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<number | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const {
    mode,
    moreMenuRef,
    setMode,
    setShowMoreMenu,
    showMoreMenu,
  } = useProjectNotesUI();
  const {
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
    spaceFiles,
    toggleFolder,
    updateContent,
    markContentSynced,
    resetDocumentState,
  } = useProjectNotesDocuments({
    projectId,
    files,
    folders,
  });

  const {
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
    handleSave,
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
  } = useProjectNotesActions({
    content,
    isZh,
    markdownFiles,
    onResetDocumentState: resetDocumentState,
    onSelectFile: setSelectedFileId,
    onTemplateUpdated: onUpdate,
    onToastError: toast.error,
    onToastSuccess: toast.success,
    projectId,
    selectedFile,
    updateContent,
  });

  const handleDownloadFile = async (file: ProjectFile) => {
    try {
      await downloadProjectFile({
        fileId: file.id,
        fileName: file.name,
        projectId,
      });
    } catch (error) {
      console.error("Failed to download project file:", error);
      toast.error(isZh ? "下载失败" : "Download failed");
    }
  };

  const handleUploadFiles = async (fileList: FileList, folderId?: number | null) => {
    const selectedFiles = Array.from(fileList);
    if (selectedFiles.length === 0 || isUploadingFile) return;

    setIsUploadingFile(true);
    try {
      await uploadProjectFiles({
        files: selectedFiles,
        folderId,
        projectId,
      });
      toast.success(
        isZh
          ? `已上传 ${selectedFiles.length} 个文件`
          : `Uploaded ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""}`,
      );
      await onUpdate();
    } catch (error) {
      const uploadError = error as ProjectFileUploadError;
      console.error("Failed to upload project files:", error);
      if (uploadError.reason === "too_large") {
        toast.error(
          isZh
            ? `文件过大：${uploadError.fileName ?? ""} 超过 80MB`
            : `File too large: ${uploadError.fileName ?? ""} exceeds 80MB`,
        );
      } else {
        toast.error(isZh ? "上传失败" : "Upload failed");
      }
    } finally {
      setIsUploadingFile(false);
    }
  };

  const openMoveDialog = () => {
    if (!selectedFile) return;
    setMoveTargetFolderId(selectedFile.folder_id ?? null);
    setShowMoveDialog(true);
  };

  const handleMoveDocument = async () => {
    if (!selectedFile) return;
    const nextFolderId = moveTargetFolderId ?? null;
    if ((selectedFile.folder_id ?? null) === nextFolderId) {
      setShowMoveDialog(false);
      return;
    }

    setIsMovingDoc(true);
    try {
      await api.patch<ProjectFile>(`/projects/${projectId}/documents/${selectedFile.id}`, {
        folder_id: nextFolderId,
      });
      toast.success(copy.documentMoved);
      setShowMoveDialog(false);
      await onUpdate();
    } catch (error) {
      console.error("Failed to move project document:", error);
      toast.error(copy.documentMoveFailed);
    } finally {
      setIsMovingDoc(false);
    }
  };

  return (
    <div className="h-full min-h-[calc(100vh-7.5rem)] overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex h-full min-h-[calc(100vh-7.5rem)]">
        <ProjectNotesSidebar
          folderList={folderList}
          groupedFiles={groupedFiles}
          isCreatingDoc={isCreatingDoc}
          isUploadingFile={isUploadingFile}
          isZh={isZh}
          fileCount={spaceFiles.length}
          openFolders={openFolders}
          projectName={projectName}
          selectedFileId={selectedFileId}
          onCreateDocument={openCreateDialog}
          onUploadFiles={(fileList, folderId) => {
            void handleUploadFiles(fileList, folderId);
          }}
          onSelectFile={setSelectedFileId}
          onToggleFolder={toggleFolder}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative" ref={moreMenuRef}>
            <ProjectNotesToolbar
              dirty={dirty}
              isDeletingDoc={isDeletingDoc}
              isRenamingDoc={isRenamingDoc}
              isSaving={isSaving}
              isZh={isZh}
              mode={mode}
              selectedFile={selectedFile}
              showMoreMenu={showMoreMenu}
              onOpenAIModal={openAIModal}
              onOpenMove={() => {
                setShowMoreMenu(false);
                openMoveDialog();
              }}
              onOpenRename={() => {
                setShowMoreMenu(false);
                openRenameDialog();
              }}
              onRequestDelete={() => {
                setShowMoreMenu(false);
                setShowDeleteDialog(true);
              }}
              onDownloadFile={() => selectedFile && void handleDownloadFile(selectedFile)}
              onSave={() => void handleSave(markContentSynced)}
              onSetMode={setMode}
              onToggleMoreMenu={() => setShowMoreMenu((value) => !value)}
            />
          </div>

          <div className="min-h-0 flex-1 bg-white">
            <ProjectNotesContentPanel
              content={content}
              copy={copy}
              isLoadingDoc={isLoadingDoc}
              isZh={isZh}
              mode={mode}
              onDownloadFile={(file) => void handleDownloadFile(file)}
              selectedFile={selectedFile}
              updateContent={updateContent}
            />
          </div>
        </section>
      </div>

      <ProjectNotesDialogs
        aiDraft={aiDraft}
        aiLoading={aiLoading}
        aiResult={aiResult}
        documentDialogMode={documentDialogMode}
        documentName={documentName}
        folderList={folderList}
        isCreatingDoc={isCreatingDoc}
        isDeletingDoc={isDeletingDoc}
        isMovingDoc={isMovingDoc}
        isOpenAIModal={showAIModal}
        isOpenDeleteDialog={showDeleteDialog}
        isOpenDocumentDialog={showDocumentDialog}
        isOpenMoveDialog={showMoveDialog}
        isRenamingDoc={isRenamingDoc}
        isZh={isZh}
        moveTargetFolderId={moveTargetFolderId}
        onApplyAIResult={applyAIResult}
        onChangeAIDraft={setAiDraft}
        onChangeDocumentName={setDocumentName}
        onChangeMoveTargetFolder={setMoveTargetFolderId}
        onCloseAIModal={closeAIModal}
        onCloseDeleteDialog={() => setShowDeleteDialog(false)}
        onCloseDocumentDialog={closeDocumentDialog}
        onCloseMoveDialog={() => setShowMoveDialog(false)}
        onConfirmDelete={() => void handleDeleteDocument()}
        onConfirmMove={() => void handleMoveDocument()}
        onGenerateAI={() => void handleAIGenerate()}
        onSubmitDocumentDialog={() => void submitDocumentDialog()}
        selectedFile={selectedFile}
      />
    </div>
  );
}
