import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CxDialog } from "../../components/codex/CxDialog";
import { useToast } from "../../contexts/ToastContext";
import type {
  Project,
  ProjectDetail as ProjectDetailType,
} from "../../types/api";
import { PersistentProjectPanels } from "./PersistentProjectPanels";
import { ProjectDetailActionsProvider } from "./ProjectDetailActionsContext";
import { ProjectDetailHeader } from "./ProjectDetailHeader";
import { ProjectSettingsDeleteDialog } from "./ProjectSettingsDeleteDialog";
import { ProjectSettingsFormCard } from "./ProjectSettingsFormCard";
import { ProjectSettingsMembersCard } from "./ProjectSettingsMembersCard";
import type { ProjectDetailTabId } from "./projectDetailTabs";
import { useProjectAccess } from "./useProjectAccess";
import { useProjectSettingsEditor } from "./useProjectSettingsEditor";
import { useProjectSettingsMembers } from "./useProjectSettingsMembers";

export function ProjectDetailLayout({
  projectId,
  project,
  projectDetail,
  activeTabId,
  onBack,
  onRefresh,
  children,
}: {
  projectId: string;
  project: Project;
  projectDetail: ProjectDetailType;
  activeTabId: ProjectDetailTabId;
  onBack: () => void;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const access = useProjectAccess(project.id);

  const [isChatFocusMode, setIsChatFocusMode] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("aria-project-chat-fullscreen") === "true";
  });
  const isPersistentTab = activeTabId === "chat" || activeTabId === "documents";
  const isChatFullscreen = activeTabId === "chat" && isChatFocusMode;

  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  // The Settings tab is gone; project-level edit / members / delete now
  // hang off the header utility area as modal overlays. We reuse the
  // existing editor + members hooks so the save/delete/member flows
  // stay identical to V0.0.5 — only the chrome changes.
  const editor = useProjectSettingsEditor({
    isZh,
    onUpdate: onRefresh,
    project,
  });
  const membersHook = useProjectSettingsMembers({
    isZh,
    members: projectDetail.members,
    onUpdate: onRefresh,
    projectId: project.id,
    toast,
  });

  useEffect(() => {
    if (editOpen) {
      editor.setIsEditing(true);
    }
  }, [editOpen, editor]);

  const closeEditModal = () => {
    setEditOpen(false);
    editor.handleCancel();
  };

  return (
    <div
      className={`project-ui theme-codex ${isChatFullscreen ? "h-screen overflow-hidden" : "min-h-full"}`}
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
      }}
    >
      {!isChatFullscreen ? (
        <ProjectDetailHeader
          project={project}
          onBack={onBack}
          projectId={projectId}
          onEdit={() => setEditOpen(true)}
          onOpenMembers={() => setMembersOpen(true)}
          onDelete={editor.openDeleteDialog}
          canEdit={access.canEdit}
          canDelete={access.canDelete}
        />
      ) : null}

      <PersistentProjectPanels
        projectId={projectId}
        project={project}
        projectDetail={projectDetail}
        activeTabId={activeTabId}
        isChatFocusMode={isChatFocusMode}
        onChatFocusModeChange={setIsChatFocusMode}
        onRefresh={onRefresh}
      />

      <div
        className={`mx-auto min-h-[calc(100vh-3.5rem)] max-w-full px-4 py-4 ${isPersistentTab ? "hidden" : ""}`}
      >
        <ProjectDetailActionsProvider
          value={{
            openEdit: () => setEditOpen(true),
            openMembers: () => setMembersOpen(true),
            openDelete: editor.openDeleteDialog,
          }}
        >
          {children}
        </ProjectDetailActionsProvider>
      </div>

      <CxDialog
        open={editOpen}
        onClose={closeEditModal}
        title={isZh ? "编辑项目" : "Edit project"}
        size="lg"
        busy={editor.isSaving}
      >
        <ProjectSettingsFormCard
          aiError={editor.aiError}
          clients={editor.clients}
          formData={editor.formData}
          isAILoading={editor.isAILoading}
          isEditing={editor.isEditing}
          isLoadingClients={editor.isLoadingClients}
          isSaving={editor.isSaving}
          isZh={isZh}
          onApplySuggestion={editor.applySuggestion}
          onCancel={closeEditModal}
          onChange={editor.handleChange}
          onEdit={() => editor.setIsEditing(true)}
          onPolish={editor.runAIPolish}
          onSave={async () => {
            await editor.handleSave();
            setEditOpen(false);
          }}
          onSuggest={editor.runAISuggest}
          showSuggestions={editor.showSuggestions}
          stageRef={editor.stageRef}
          suggestions={editor.suggestions}
        />
      </CxDialog>

      <CxDialog
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        title={isZh ? "项目成员" : "Project members"}
        description={
          isZh
            ? "管理可以查看 / 编辑这个项目的成员。"
            : "Control who can view or edit this project."
        }
        size="md"
      >
        <ProjectSettingsMembersCard
          availableUsers={membersHook.availableUsers}
          handleAddMember={membersHook.handleAddMember}
          handleRemoveMember={membersHook.handleRemoveMember}
          isAddingMember={membersHook.isAddingMember}
          isLoadingUsers={membersHook.isLoadingUsers}
          isZh={isZh}
          members={membersHook.members}
          removingUserId={membersHook.removingUserId}
          selectedUserId={membersHook.selectedUserId}
          setSelectedUserId={membersHook.setSelectedUserId}
        />
      </CxDialog>

      {editor.showDeleteDialog ? (
        <ProjectSettingsDeleteDialog
          deleteConfirmText={editor.deleteConfirmText}
          isDeleting={editor.isDeleting}
          isZh={isZh}
          projectName={project.name}
          onCancel={() => editor.setShowDeleteDialog(false)}
          onChangeDeleteConfirmText={editor.setDeleteConfirmText}
          onConfirm={editor.handleDelete}
        />
      ) : null}
    </div>
  );
}
