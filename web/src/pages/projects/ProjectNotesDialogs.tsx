import type { ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectNotesAIModal } from "./ProjectNotesAIModal";
import { ProjectNotesDeleteDialog } from "./ProjectNotesDeleteDialog";
import { ProjectNotesDocumentDialog } from "./ProjectNotesDocumentDialog";
import { ProjectNotesMoveDialog } from "./ProjectNotesMoveDialog";

interface ProjectNotesDialogsProps {
  aiDraft: string;
  aiLoading: boolean;
  aiResult: string;
  documentDialogMode: "create" | "rename";
  documentName: string;
  folderList: ProjectFolder[];
  isCreatingDoc: boolean;
  isDeletingDoc: boolean;
  isMovingDoc: boolean;
  isOpenAIModal: boolean;
  isOpenDeleteDialog: boolean;
  isOpenDocumentDialog: boolean;
  isOpenMoveDialog: boolean;
  isRenamingDoc: boolean;
  isZh: boolean;
  moveTargetFolderId: number | null;
  onApplyAIResult: (mode: "replace" | "append") => void;
  onChangeAIDraft: (value: string) => void;
  onChangeDocumentName: (value: string) => void;
  onChangeMoveTargetFolder: (folderId: number | null) => void;
  onCloseAIModal: () => void;
  onCloseDeleteDialog: () => void;
  onCloseDocumentDialog: () => void;
  onCloseMoveDialog: () => void;
  onConfirmDelete: () => void;
  onConfirmMove: () => void;
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
  folderList,
  isCreatingDoc,
  isDeletingDoc,
  isMovingDoc,
  isOpenAIModal,
  isOpenDeleteDialog,
  isOpenDocumentDialog,
  isOpenMoveDialog,
  isRenamingDoc,
  isZh,
  moveTargetFolderId,
  onApplyAIResult,
  onChangeAIDraft,
  onChangeDocumentName,
  onChangeMoveTargetFolder,
  onCloseAIModal,
  onCloseDeleteDialog,
  onCloseDocumentDialog,
  onCloseMoveDialog,
  onConfirmDelete,
  onConfirmMove,
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

      <ProjectNotesMoveDialog
        file={selectedFile}
        folderList={folderList}
        isMoving={isMovingDoc}
        isOpen={isOpenMoveDialog}
        isZh={isZh}
        targetFolderId={moveTargetFolderId}
        onChangeTargetFolder={onChangeMoveTargetFolder}
        onClose={onCloseMoveDialog}
        onConfirm={onConfirmMove}
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
