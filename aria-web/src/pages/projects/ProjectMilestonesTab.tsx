import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type { Milestone, ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { ProjectMilestoneModal } from "./ProjectMilestoneModal";
import { ProjectMilestonesList } from "./ProjectMilestonesList";
import { ProjectMilestonesProgressCard } from "./ProjectMilestonesProgressCard";
import { useProjectMemorySummary } from "./useProjectMemorySummary";

interface RequestErrorPayload {
  detail?: string;
}

interface RequestError {
  message?: string;
  response?: {
    data?: RequestErrorPayload;
  };
}

interface ProjectMilestonesTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

export function ProjectMilestonesTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectMilestonesTabProps) {
  const { milestones } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const deliveryInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成交付摘要失败，请稍后重试" : "Failed to generate delivery summary",
    language: i18n.language,
    projectId,
    summaryType: "delivery",
  });
  const [showModal, setShowModal] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    due_date: "",
    priority: "medium" as "low" | "medium" | "high",
    is_done: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const completedCount = milestones.filter((milestone) => milestone.is_done).length;
  const progress = milestones.length > 0 ? (completedCount / milestones.length) * 100 : 0;

  const handleAdd = () => {
    setEditingMilestone(null);
    setFormData({
      title: "",
      due_date: "",
      priority: "medium",
      is_done: false,
    });
    setShowModal(true);
  };

  const handleEdit = (milestone: Milestone) => {
    setEditingMilestone(milestone);
    setFormData({
      title: milestone.title,
      due_date: milestone.due_date || "",
      priority: milestone.priority,
      is_done: milestone.is_done,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.warning(isZh ? "请输入里程碑名称" : "Please enter milestone title");
      return;
    }

    setIsSaving(true);
    try {
      if (editingMilestone) {
        await api.patch(`/projects/${projectId}/milestones/${editingMilestone.id}`, formData);
      } else {
        await api.post(`/projects/${projectId}/milestones`, formData);
      }
      await onUpdate();
      setShowModal(false);
    } catch (error) {
      const requestError = error as RequestError;
      const errorMsg = requestError.response?.data?.detail || requestError.message || "";
      console.error("Failed to save milestone:", error);
      toast.error(
        isZh ? `保存失败: ${errorMsg}` : `Failed to save: ${errorMsg}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDone = async (milestone: Milestone) => {
    try {
      await api.patch(`/projects/${projectId}/milestones/${milestone.id}`, {
        is_done: !milestone.is_done,
      });
      await onUpdate();
    } catch (error) {
      const requestError = error as RequestError;
      const errorMsg = requestError.response?.data?.detail || requestError.message || "";
      console.error("Failed to toggle milestone:", error);
      toast.error(
        isZh ? `更新失败: ${errorMsg}` : `Failed to update: ${errorMsg}`,
      );
    }
  };

  const handleDelete = async (milestone: Milestone) => {
    const confirmed = confirm(
      isZh
        ? "确定要删除这个里程碑吗？"
        : "Are you sure you want to delete this milestone?",
    );
    if (!confirmed) return;

    try {
      await api.delete(`/projects/${projectId}/milestones/${milestone.id}`);
      await onUpdate();
    } catch (error) {
      const requestError = error as RequestError;
      const errorMsg = requestError.response?.data?.detail || requestError.message || "";
      console.error("Failed to delete milestone:", error);
      toast.error(
        isZh ? `删除失败: ${errorMsg}` : `Failed to delete: ${errorMsg}`,
      );
    }
  };

  return (
    <div className="space-y-6">
      <ProjectMemoryInsightCard
        content={deliveryInsight.content}
        error={deliveryInsight.error}
        hint={
          isZh
            ? "基于项目记忆整理当前交付节奏、里程碑推进和下一步执行动作"
            : "Structured-memory delivery view for milestone momentum and next execution steps"
        }
        isZh={isZh}
        loading={deliveryInsight.loading}
        onRefresh={() => {
          void deliveryInsight.refresh();
        }}
        title={isZh ? "AI 交付摘要" : "AI Delivery Summary"}
      />

      <ProjectMilestonesProgressCard
        completedCount={completedCount}
        isZh={isZh}
        progress={progress}
        totalCount={milestones.length}
      />

      <ProjectMilestonesList
        isZh={isZh}
        milestones={milestones}
        onAdd={handleAdd}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onToggleDone={handleToggleDone}
      />

      {showModal && (
        <ProjectMilestoneModal
          formData={formData}
          isEditing={Boolean(editingMilestone)}
          isSaving={isSaving}
          isZh={isZh}
          onChange={setFormData}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
