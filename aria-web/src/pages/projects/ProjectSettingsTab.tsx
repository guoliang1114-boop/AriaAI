import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectSettingsDangerZone } from "./ProjectSettingsDangerZone";
import { ProjectSettingsDeleteDialog } from "./ProjectSettingsDeleteDialog";
import { ProjectSettingsFormCard } from "./ProjectSettingsFormCard";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { ProjectSettingsMembersCard } from "./ProjectSettingsMembersCard";
import { useProjectMemorySummary } from "./useProjectMemorySummary";
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
  const settingsInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成项目设置摘要失败，请稍后重试" : "Failed to generate project settings summary",
    language: i18n.language,
    projectId: String(project.id),
    summaryType: "overview",
  });
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
          <ProjectMemoryInsightCard
            content={settingsInsight.content}
            error={settingsInsight.error}
            hint={
              isZh
                ? "基于项目记忆快速查看当前项目状态、关键风险和下一步动作，便于在修改设置前先校准全局认知"
                : "Structured-memory overview to align on status, risks, and next actions before editing settings"
            }
            isZh={isZh}
            loading={settingsInsight.loading}
            onRefresh={() => {
              void settingsInsight.refresh();
            }}
            title={isZh ? "AI 项目状态摘要" : "AI Project State Summary"}
          />

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
