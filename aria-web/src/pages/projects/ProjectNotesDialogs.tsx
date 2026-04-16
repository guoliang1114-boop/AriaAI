import type { ProjectFile } from "../../types/api";
import { ProjectNotesAIModal } from "./ProjectNotesAIModal";
import { ProjectNotesDeleteDialog } from "./ProjectNotesDeleteDialog";
import { ProjectNotesDocumentDialog } from "./ProjectNotesDocumentDialog";

interface ProjectNotesDialogsProps {
  aiDraft: string;
  aiLoading: boolean;
  aiResult: string;
  documentDialogMode: "create" | "rename";
  documentName: string;
  isCreatingDoc: boolean;
  isDeletingDoc: boolean;
  isOpenAIModal: boolean;
  isOpenDeleteDialog: boolean;
  isOpenDocumentDialog: boolean;
  isRenamingDoc: boolean;
  isZh: boolean;
  onApplyAIResult: (mode: "replace" | "append") => void;
  onChangeAIDraft: (value: string) => void;
  onChangeDocumentName: (value: string) => void;
  onCloseAIModal: () => void;
  onCloseDeleteDialog: () => void;
  onCloseDocumentDialog: () => void;
  onConfirmDelete: () => void;
  onGenerateAI: () => void;
  onSubmitDocumentDialog: () => void;
  selectedFile: ProjectFile | null;
}

export function ProjectNotesDialogs({
  aiDraft,
  aiLoading,
  aiResult,
  documentDialogMode,
  documentName,
  isCreatingDoc,
  isDeletingDoc,
  isOpenAIModal,
  isOpenDeleteDialog,
  isOpenDocumentDialog,
  isRenamingDoc,
  isZh,
  onApplyAIResult,
  onChangeAIDraft,
  onChangeDocumentName,
  onCloseAIModal,
  onCloseDeleteDialog,
  onCloseDocumentDialog,
  onConfirmDelete,
  onGenerateAI,
  onSubmitDocumentDialog,
  selectedFile,
}: ProjectNotesDialogsProps) {
  return (
    <>
      <ProjectNotesDocumentDialog
        isOpen={isOpenDocumentDialog}
        isPending={isCreatingDoc || isRenamingDoc}
        isZh={isZh}
        mode={documentDialogMode}
        value={documentName}
        onChange={onChangeDocumentName}
        onClose={onCloseDocumentDialog}
        onSubmit={onSubmitDocumentDialog}
      />

      <ProjectNotesDeleteDialog
        file={selectedFile}
        isDeleting={isDeletingDoc}
        isOpen={isOpenDeleteDialog}
        isZh={isZh}
        onClose={onCloseDeleteDialog}
        onConfirm={onConfirmDelete}
      />

      <ProjectNotesAIModal
        aiDraft={aiDraft}
        aiLoading={aiLoading}
        aiResult={aiResult}
        isOpen={isOpenAIModal}
        isZh={isZh}
        onApply={onApplyAIResult}
        onChangeDraft={onChangeAIDraft}
        onClose={onCloseAIModal}
        onGenerate={onGenerateAI}
      />
    </>
  );
}
