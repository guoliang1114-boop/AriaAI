import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectNotesContentPanel } from "./ProjectNotesContentPanel";
import { ProjectNotesDialogs } from "./ProjectNotesDialogs";
import { ProjectNotesSidebar } from "./ProjectNotesSidebar";
import { ProjectNotesToolbar } from "./ProjectNotesToolbar";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { getProjectNotesCopy } from "./projectNotesCopy";
import { useProjectMemorySummary } from "./useProjectMemorySummary";
import { useProjectNotesActions } from "./useProjectNotesActions";
import { useProjectNotesDocuments } from "./useProjectNotesDocuments";
import { useProjectNotesUI } from "./useProjectNotesUI";

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
  const stakeholderInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成干系人摘要失败，请稍后重试" : "Failed to generate stakeholder summary",
    language: i18n.language,
    projectId,
    summaryType: "stakeholder",
  });
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

  return (
    <div className="h-full min-h-[calc(100vh-220px)] overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="flex h-full min-h-[calc(100vh-220px)]">
        <ProjectNotesSidebar
          folderList={folderList}
          groupedFiles={groupedFiles}
          isBootstrapping={isBootstrapping}
          isCreatingDoc={isCreatingDoc}
          isZh={isZh}
          markdownFiles={markdownFiles}
          openFolders={openFolders}
          projectName={projectName}
          selectedFileId={selectedFileId}
          onCreateDocument={openCreateDialog}
          onInitTemplate={() => void handleInitTemplate()}
          onSelectFile={setSelectedFileId}
          onToggleFolder={toggleFolder}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-gray-100 p-4">
            <ProjectMemoryInsightCard
              content={stakeholderInsight.content}
              error={stakeholderInsight.error}
              hint={
                isZh
                  ? "基于项目记忆整理当前干系人关注点、对齐状态和建议跟进动作"
                  : "Structured-memory stakeholder view for alignment status and follow-ups"
              }
              isZh={isZh}
              loading={stakeholderInsight.loading}
              onRefresh={() => {
                void stakeholderInsight.refresh();
              }}
              title={isZh ? "AI 干系人摘要" : "AI Stakeholder Summary"}
            />
          </div>

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
              onOpenRename={() => {
                setShowMoreMenu(false);
                openRenameDialog();
              }}
              onRequestDelete={() => {
                setShowMoreMenu(false);
                setShowDeleteDialog(true);
              }}
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
              mode={mode}
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
        isCreatingDoc={isCreatingDoc}
        isDeletingDoc={isDeletingDoc}
        isOpenAIModal={showAIModal}
        isOpenDeleteDialog={showDeleteDialog}
        isOpenDocumentDialog={showDocumentDialog}
        isRenamingDoc={isRenamingDoc}
        isZh={isZh}
        onApplyAIResult={applyAIResult}
        onChangeAIDraft={setAiDraft}
        onChangeDocumentName={setDocumentName}
        onCloseAIModal={closeAIModal}
        onCloseDeleteDialog={() => setShowDeleteDialog(false)}
        onCloseDocumentDialog={closeDocumentDialog}
        onConfirmDelete={() => void handleDeleteDocument()}
        onGenerateAI={() => void handleAIGenerate()}
        onSubmitDocumentDialog={() => void submitDocumentDialog()}
        selectedFile={selectedFile}
      />
    </div>
  );
}
