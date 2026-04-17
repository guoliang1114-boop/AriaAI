import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { ProjectSettingsDangerZone } from "./ProjectSettingsDangerZone";
import { ProjectSettingsDeleteDialog } from "./ProjectSettingsDeleteDialog";
import { ProjectSettingsFormCard } from "./ProjectSettingsFormCard";
import { ProjectSettingsMembersCard } from "./ProjectSettingsMembersCard";
import { ProjectSettingsMemoryManagementCard } from "./ProjectSettingsMemoryManagementCard";
import { useProjectMemorySummary } from "./useProjectMemorySummary";
import { useProjectSettingsEditor } from "./useProjectSettingsEditor";
import { useProjectSettingsMembers } from "./useProjectSettingsMembers";

interface ProjectSettingsTabProps {
  onUpdate: () => void;
  projectDetail: ProjectDetailType;
}

export function ProjectSettingsTab({ onUpdate, projectDetail }: ProjectSettingsTabProps) {
  const { files, financials, members: projectMembers, milestones, project, todos } = projectDetail;
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);

  const settingsInsight = useProjectMemorySummary({
    errorMessage: isZh
      ? "生成项目设置摘要失败，请稍后重试"
      : "Failed to generate project settings summary",
    language: i18n.language,
    projectId: String(project.id),
    summaryType: "overview",
  });

  const coverageItems = useMemo(
    () => [
      { label: isZh ? "文档" : "Docs", value: files.length },
      { label: isZh ? "里程碑" : "Milestones", value: milestones.length },
      { label: isZh ? "待办" : "Todos", value: todos.length },
      { label: isZh ? "成员" : "Members", value: projectMembers.length },
      { label: isZh ? "财务" : "Payments", value: financials.payments.length },
    ],
    [files.length, financials.payments.length, isZh, milestones.length, projectMembers.length, todos.length],
  );

  const rebuildMemory = async () => {
    setIsRebuildingMemory(true);
    try {
      await api.post(`/projects/${project.id}/memory/rebuild`, {}, { timeout: 60000 });
      await settingsInsight.refresh();
      onUpdate();
      toast.success(isZh ? "项目记忆已重建" : "Project memory rebuilt");
    } catch (error) {
      console.error("Failed to rebuild project memory:", error);
      toast.error(isZh ? "项目记忆重建失败" : "Failed to rebuild project memory");
    } finally {
      setIsRebuildingMemory(false);
    }
  };

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
    members: projectMembers || [],
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
                ? "基于项目记忆快速查看当前状态、关键风险和下一步动作，方便在修改设置前先校准全局认知。"
                : "Structured-memory overview to align on status, risks, and next actions before editing settings."
            }
            isZh={isZh}
            loading={settingsInsight.loading}
            onRefresh={() => {
              void settingsInsight.refresh();
            }}
            title={isZh ? "AI 项目状态摘要" : "AI Project State Summary"}
          />

          <ProjectSettingsMemoryManagementCard
            coverageItems={coverageItems}
            isRebuilding={isRebuildingMemory}
            isZh={isZh}
            onOpenMemory={() => navigate(`/projects/${project.id}/memory`)}
            onRebuild={() => {
              void rebuildMemory();
            }}
            project={project}
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

      {showDeleteDialog ? (
        <ProjectSettingsDeleteDialog
          deleteConfirmText={deleteConfirmText}
          isDeleting={isDeleting}
          isZh={isZh}
          projectName={project.name}
          onCancel={() => setShowDeleteDialog(false)}
          onChangeDeleteConfirmText={setDeleteConfirmText}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}
