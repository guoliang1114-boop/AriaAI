import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectSettingsDangerZone } from "./ProjectSettingsDangerZone";
import { ProjectSettingsDeleteDialog } from "./ProjectSettingsDeleteDialog";
import { ProjectSettingsFormCard } from "./ProjectSettingsFormCard";
import { ProjectSettingsMembersCard } from "./ProjectSettingsMembersCard";
import { useProjectSettingsEditor } from "./useProjectSettingsEditor";
import { useProjectSettingsMembers } from "./useProjectSettingsMembers";

interface ProjectSettingsTabProps {
  onUpdate: () => void;
  projectDetail: ProjectDetailType;
}

export function ProjectSettingsTab({
  onUpdate,
  projectDetail,
}: ProjectSettingsTabProps) {
  const { project } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const {
    aiError,
    applySuggestion,
    clients,
    deleteConfirmText,
    formData,
    handleArchive,
    handleCancel,
    handleChange,
    handleDelete,
    handleSave,
    isAILoading,
    isDeleting,
    isEditing,
    isLoadingClients,
    isSaving,
    openDeleteDialog,
    runAIPolish,
    runAISuggest,
    setDeleteConfirmText,
    setIsEditing,
    setShowDeleteDialog,
    showDeleteDialog,
    showSuggestions,
    stageRef,
    suggestions,
  } = useProjectSettingsEditor({
    isZh,
    onUpdate,
    project,
  });
  const {
    availableUsers,
    handleAddMember,
    handleRemoveMember,
    isAddingMember,
    isLoadingUsers,
    members,
    removingUserId,
    selectedUserId,
    setSelectedUserId,
  } = useProjectSettingsMembers({
    isZh,
    members: projectDetail.members || [],
    onUpdate,
    projectId: project.id,
    toast,
  });

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProjectSettingsFormCard
            aiError={aiError}
            clients={clients}
            formData={formData}
            isAILoading={isAILoading}
            isEditing={isEditing}
            isLoadingClients={isLoadingClients}
            isSaving={isSaving}
            isZh={isZh}
            onApplySuggestion={applySuggestion}
            onCancel={handleCancel}
            onChange={handleChange}
            onEdit={() => setIsEditing(true)}
            onPolish={runAIPolish}
            onSave={handleSave}
            onSuggest={runAISuggest}
            showSuggestions={showSuggestions}
            stageRef={stageRef}
            suggestions={suggestions}
          />
        </div>

        <div className="space-y-6 lg:col-span-1">
          <ProjectSettingsMembersCard
            availableUsers={availableUsers}
            handleAddMember={handleAddMember}
            handleRemoveMember={handleRemoveMember}
            isAddingMember={isAddingMember}
            isLoadingUsers={isLoadingUsers}
            isZh={isZh}
            members={members}
            removingUserId={removingUserId}
            selectedUserId={selectedUserId}
            setSelectedUserId={setSelectedUserId}
          />

          <ProjectSettingsDangerZone
            isArchived={project.status === "archived"}
            isZh={isZh}
            onArchive={handleArchive}
            onDelete={openDeleteDialog}
          />
        </div>
      </div>

      {showDeleteDialog && (
        <ProjectSettingsDeleteDialog
          deleteConfirmText={deleteConfirmText}
          isDeleting={isDeleting}
          isZh={isZh}
          projectName={project.name}
          onCancel={() => setShowDeleteDialog(false)}
          onChangeDeleteConfirmText={setDeleteConfirmText}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
