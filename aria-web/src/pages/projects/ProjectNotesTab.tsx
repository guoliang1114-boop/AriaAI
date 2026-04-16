import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2 } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectNotesAIModal } from "./ProjectNotesAIModal";
import { ProjectNotesDeleteDialog } from "./ProjectNotesDeleteDialog";
import { ProjectNotesDocumentDialog } from "./ProjectNotesDocumentDialog";
import { ProjectNotesSidebar } from "./ProjectNotesSidebar";
import { ProjectNotesToolbar } from "./ProjectNotesToolbar";
import { getProjectNotesCopy } from "./projectNotesCopy";
import { useProjectNotesActions } from "./useProjectNotesActions";
import { useProjectNotesDocuments } from "./useProjectNotesDocuments";

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
  const [mode, setMode] = useState<"edit" | "preview" | "split">("preview");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const showEdit = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

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
            {!selectedFile ? (
              <div className="flex h-full items-center justify-center px-8 text-center">
                <div>
                  <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-4 text-base font-medium text-gray-900">
                    {copy.emptyTitle}
                  </p>
                  <p className="mt-2 text-sm text-gray-500">
                    {copy.emptyDescription}
                  </p>
                </div>
              </div>
            ) : isLoadingDoc ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="flex h-full gap-4 p-4">
                {showEdit && (
                  <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
                    <textarea
                      value={content}
                      onChange={(event) => updateContent(event.target.value)}
                      placeholder={copy.editPlaceholder}
                      className="h-full min-h-[calc(100vh-340px)] w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-4 font-mono text-sm leading-7 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      spellCheck={false}
                    />
                  </div>
                )}

                {showPreview && (
                  <div className={`${mode === "split" ? "w-1/2" : "w-full"} min-w-0`}>
                    <div className="h-full min-h-[calc(100vh-340px)] overflow-auto rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
                      {content.trim() ? (
                        <div className="md-root">
                          <MarkdownRenderer content={content} />
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-gray-400">
                          {copy.previewEmpty}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <ProjectNotesDocumentDialog
        isOpen={showDocumentDialog}
        isPending={isCreatingDoc || isRenamingDoc}
        isZh={isZh}
        mode={documentDialogMode}
        value={documentName}
        onChange={setDocumentName}
        onClose={closeDocumentDialog}
        onSubmit={() => void submitDocumentDialog()}
      />

      <ProjectNotesDeleteDialog
        file={selectedFile}
        isDeleting={isDeletingDoc}
        isOpen={showDeleteDialog}
        isZh={isZh}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => void handleDeleteDocument()}
      />

      <ProjectNotesAIModal
        aiDraft={aiDraft}
        aiLoading={aiLoading}
        aiResult={aiResult}
        isOpen={showAIModal}
        isZh={isZh}
        onApply={applyAIResult}
        onChangeDraft={setAiDraft}
        onClose={closeAIModal}
        onGenerate={() => void handleAIGenerate()}
      />
    </div>
  );
}
