import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  CheckCircle2,
  Edit3,
  Flag,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type { Milestone, ProjectDetail as ProjectDetailType } from "../../types/api";

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
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">
              {isZh ? "项目进度" : "Project Progress"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {completedCount} {isZh ? "已完成，共" : "completed of"} {milestones.length}{" "}
              {isZh ? "个里程碑" : "milestones"}
            </p>
          </div>
          <span className="text-2xl font-bold text-gray-900">
            {progress.toFixed(0)}%
          </span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {isZh ? "里程碑列表" : "Milestones"}
          </h3>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            {isZh ? "添加" : "Add"}
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {milestones.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Flag className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{isZh ? "暂无里程碑" : "No milestones yet"}</p>
            </div>
          ) : (
            milestones.map((milestone, index) => (
              <div
                key={milestone.id}
                className="flex items-start gap-4 p-5 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => handleToggleDone(milestone)}
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      milestone.is_done
                        ? "bg-emerald-500 border-emerald-500"
                        : "border-gray-300 hover:border-primary"
                    }`}
                  >
                    {milestone.is_done && (
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    )}
                  </button>
                  {index < milestones.length - 1 && (
                    <div className="w-0.5 h-full bg-gray-200 my-2" />
                  )}
                </div>
                <div className="flex-1 pb-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4
                        className={`font-medium ${
                          milestone.is_done
                            ? "text-gray-400 line-through"
                            : "text-gray-900"
                        }`}
                      >
                        {milestone.title}
                      </h4>
                      {milestone.due_date && (
                        <div className="flex items-center gap-2 mt-2">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          <span
                            className={`text-xs ${
                              !milestone.is_done &&
                              new Date(milestone.due_date) < new Date()
                                ? "text-red-500"
                                : "text-gray-500"
                            }`}
                          >
                            {isZh ? "截止: " : "Due: "}
                            {new Date(milestone.due_date).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                          milestone.priority === "high"
                            ? "bg-red-50 text-red-600"
                            : milestone.priority === "medium"
                              ? "bg-amber-50 text-amber-600"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {milestone.priority}
                      </span>
                      <button
                        onClick={() => handleEdit(milestone)}
                        className="p-2 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-primary"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(milestone)}
                        className="p-2 rounded-lg hover:bg-red-100 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingMilestone
                  ? isZh
                    ? "编辑里程碑"
                    : "Edit Milestone"
                  : isZh
                    ? "添加里程碑"
                    : "Add Milestone"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? "里程碑名称" : "Title"}
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, title: event.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder={isZh ? "请输入里程碑名称" : "Enter milestone title"}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? "截止日期" : "Due Date"}
                </label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, due_date: event.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? "优先级" : "Priority"}
                </label>
                <select
                  value={formData.priority}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      priority: event.target.value as "low" | "medium" | "high",
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="low">{isZh ? "低" : "Low"}</option>
                  <option value="medium">{isZh ? "中" : "Medium"}</option>
                  <option value="high">{isZh ? "高" : "High"}</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="milestone_is_done"
                  checked={formData.is_done}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, is_done: event.target.checked }))
                  }
                  className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                />
                <label htmlFor="milestone_is_done" className="text-sm text-gray-700">
                  {isZh ? "已完成" : "Completed"}
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 border-t border-gray-100">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isZh ? "保存" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
