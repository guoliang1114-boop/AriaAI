import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectDocumentsBrowser } from "./ProjectDocumentsBrowser";
import { ProjectDocumentsContextMenu } from "./ProjectDocumentsContextMenu";
import { ProjectDocumentsCreateFolderModal } from "./ProjectDocumentsCreateFolderModal";
import { ProjectDocumentsDeleteDialog } from "./ProjectDocumentsDeleteDialog";
import { ProjectDocumentsToolbar } from "./ProjectDocumentsToolbar";
import { ProjectDocumentsUploadPanel } from "./ProjectDocumentsUploadPanel";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { useProjectDocumentsManager } from "./useProjectDocumentsManager";
import { useProjectDocumentsView } from "./useProjectDocumentsView";
import { useProjectMemorySummary } from "./useProjectMemorySummary";

interface ProjectDocumentsTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

export function ProjectDocumentsTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectDocumentsTabProps) {
  const { folders, project } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const documentInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成文档洞察失败，请稍后重试" : "Failed to generate document insight",
    language: i18n.language,
    memoryVersion: project.memory_version ?? 0,
    projectId,
    summaryType: "documents",
  });
  const {
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
  } = useProjectDocumentsView({
    files: projectDetail.files,
    folders,
  });

  const {
    confirmDelete,
    contextMenu,
    creatingFolder,
    deleting,
    fileInputRef,
    fileToDelete,
    folderInputRef,
    folderName,
    handleContextMenu,
    handleCreateFolder,
    handleDeleteFile,
    handleDownload,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    isDragging,
    localFiles,
    newMenuRef,
    setContextMenu,
    setFileToDelete,
    setFolderName,
    setShowDeleteModal,
    setShowFolderModal,
    setShowNewMenu,
    setShowUploadPanel,
    setUploadProgress,
    showDeleteModal,
    showFolderModal,
    showNewMenu,
    showUploadPanel,
    uploadProgress,
    uploading,
  } = useProjectDocumentsManager({
    currentFolder,
    files: projectDetail.files,
    folders,
    isZh,
    onUpdate,
    projectId,
    toast,
  });

  const visibleFiles = filteredFiles.length === 0 ? localFiles.filter((file) => {
    const folder = folders.find((item) => item.id === file.folder_id);
    return (
      (folder?.name || null) === currentFolder &&
      file.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }) : filteredFiles;

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4">
        <ProjectMemoryInsightCard
          content={documentInsight.content}
          error={documentInsight.error}
          hint={
            isZh
              ? "基于项目记忆整理当前重要文档、交付线索和最值得优先查看的材料"
              : "Structured-memory document insight for important files, delivery signals, and what to review next"
          }
          isZh={isZh}
          loading={documentInsight.loading}
          onRefresh={() => {
            void documentInsight.refresh(true);
          }}
          title={isZh ? "AI 文档洞察" : "AI Document Insight"}
        />
      </div>

      <ProjectDocumentsToolbar
        currentFolder={currentFolder}
        fileInputRef={fileInputRef}
        goToRoot={goToRoot}
        isZh={isZh}
        newMenuRef={newMenuRef}
        onFileSelect={handleFileSelect}
        onOpenFolderModal={() => setShowFolderModal(true)}
        onSearchQueryChange={setSearchQuery}
        onToggleNewMenu={() => setShowNewMenu((value) => !value)}
        onViewModeChange={setViewMode}
        searchQuery={searchQuery}
        setShowNewMenu={setShowNewMenu}
        showNewMenu={showNewMenu}
        viewMode={viewMode}
      />

      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <ProjectDocumentsBrowser
          currentFolder={currentFolder}
          enterFolder={enterFolder}
          filteredFiles={visibleFiles}
          filteredFolders={filteredFolders}
          goToRoot={goToRoot}
          handleContextMenu={handleContextMenu}
          handleDeleteFile={handleDeleteFile}
          handleDownload={handleDownload}
          isDragging={isDragging}
          isEmpty={isEmpty}
          isZh={isZh}
          uploading={uploading}
          viewMode={viewMode}
        />
      </div>

      <ProjectDocumentsContextMenu
        contextMenu={contextMenu}
        enterFolder={enterFolder}
        handleDeleteFile={handleDeleteFile}
        handleDownload={handleDownload}
        isZh={isZh}
        onClose={() => setContextMenu(null)}
      />

      {showFolderModal && (
        <ProjectDocumentsCreateFolderModal
          creatingFolder={creatingFolder}
          folderInputRef={folderInputRef}
          folderName={folderName}
          isZh={isZh}
          onClose={() => {
            setShowFolderModal(false);
            setFolderName("");
          }}
          onCreate={() => void handleCreateFolder()}
          onFolderNameChange={setFolderName}
        />
      )}

      {showDeleteModal && fileToDelete && (
        <ProjectDocumentsDeleteDialog
          deleting={deleting}
          fileToDelete={fileToDelete}
          isZh={isZh}
          onClose={() => {
            setShowDeleteModal(false);
            setFileToDelete(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {showUploadPanel && uploadProgress.length > 0 && (
        <ProjectDocumentsUploadPanel
          isZh={isZh}
          uploadProgress={uploadProgress}
          onClose={() => {
            setShowUploadPanel(false);
            setUploadProgress([]);
          }}
        />
      )}
    </div>
  );
}
