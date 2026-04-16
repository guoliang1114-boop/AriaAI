import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronRight,
  Edit3,
  Loader2,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import {
  toBackendStatus,
  type ProjectStage,
} from "../../types/enums";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";
import { ProjectSettingsAIAssistant } from "./ProjectSettingsAIAssistant";
import { UserPicker } from "./ProjectUserPicker";
import { ProjectSettingsDeleteDialog } from "./ProjectSettingsDeleteDialog";
import { ProjectSettingsStageField } from "./ProjectSettingsStageField";
import { useProjectSettingsMembers } from "./useProjectSettingsMembers";

interface SuggestionItem {
  name: string;
  description: string;
}

interface EditLocationState {
  edit?: boolean;
}

interface ProjectWithDates {
  start_date?: string;
  end_date?: string;
}

interface ProjectSettingsTabProps {
  projectDetail: ProjectDetailType;
  onUpdate: () => void;
}

export function ProjectSettingsTab({
  projectDetail,
  onUpdate,
}: ProjectSettingsTabProps) {
  const { project } = projectDetail;
  const projectWithDates = project as typeof project & ProjectWithDates;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const locationState = (location.state as EditLocationState | null) ?? null;

  const [isEditing, setIsEditing] = useState(() => Boolean(locationState?.edit));
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [formData, setFormData] = useState({
    name: project.name,
    client: project.client,
    description: project.description || "",
    notes: project.notes || "",
    status: project.status,
    contract_amount: project.contract_amount || 0,
    start_date: projectWithDates.start_date || "",
    end_date: projectWithDates.end_date || "",
  });

  const stageRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!isEditing) return;

    let cancelled = false;

    const loadClients = async () => {
      setIsLoadingClients(true);
      try {
        const response = await api.get<{ projects: Array<{ client: string }> }>(
          "/projects?limit=1000",
        );
        const uniqueClients = Array.from(
          new Set(
            (response.projects || [])
              .map((item) => item.client)
              .filter((item) => item?.trim()),
          ),
        ).sort();
        if (project.client && !uniqueClients.includes(project.client)) {
          uniqueClients.unshift(project.client);
        }
        if (!cancelled) {
          setClients(uniqueClients);
        }
      } catch (error) {
        console.error("Failed to fetch clients:", error);
        if (!cancelled) {
          setClients(project.client ? [project.client] : []);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingClients(false);
        }
      }
    };

    void loadClients();

    if (locationState?.edit) {
      window.setTimeout(() => {
        stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }

    return () => {
      cancelled = true;
    };
  }, [isEditing, locationState?.edit, project.client]);

  const handleChange = (field: keyof typeof formData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleArchive = async () => {
    try {
      await api.patch(`/projects/${project.id}`, { status: "archived" });
      onUpdate();
    } catch (error) {
      console.error("Archive failed:", error);
      toast.error(isZh ? "归档失败，请重试" : "Failed to archive, please try again");
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmText !== project.name) return;
    setIsDeleting(true);
    try {
      await api.delete(`/projects/${project.id}`);
      toast.success(
        isZh ? `项目“${project.name}”已删除` : `Project "${project.name}" deleted`,
      );
      navigate("/projects", { replace: true });
    } catch (error) {
      console.error("Delete failed:", error);
      toast.error(isZh ? "删除失败，请重试" : "Delete failed, please try again");
      setIsDeleting(false);
    }
  };

  const runAISuggest = async () => {
    if (!formData.client.trim()) {
      setAiError(isZh ? "请先填写客户名称" : "Please fill in client name first");
      return;
    }
    setIsAILoading(true);
    setAiError("");
    try {
      const response = await api.post<{ suggestions: SuggestionItem[] }>(
        "/ai/suggest-project",
        {
          client: formData.client,
          current_name: formData.name,
          current_description: formData.description,
        },
      );
      setSuggestions(response.suggestions || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error("AI suggest failed:", error);
      setAiError(isZh ? "AI 建议生成失败" : "AI suggestion failed");
    } finally {
      setIsAILoading(false);
    }
  };

  const runAIPolish = async () => {
    if (!formData.description.trim()) {
      setAiError(isZh ? "请先填写项目描述" : "Please fill in description first");
      return;
    }
    setIsAILoading(true);
    setAiError("");
    try {
      const response = await api.post<{ improved: string }>("/ai/polish", {
        text: formData.description,
        type: "project_description",
      });
      if (response.improved) {
        setFormData((prev) => ({ ...prev, description: response.improved }));
      }
    } catch (error) {
      console.error("AI polish failed:", error);
      setAiError(isZh ? "AI 优化失败" : "AI polish failed");
    } finally {
      setIsAILoading(false);
    }
  };

  const applySuggestion = (suggestion: SuggestionItem) => {
    setFormData((prev) => ({
      ...prev,
      name: suggestion.name,
      description: suggestion.description,
    }));
    setShowSuggestions(false);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.client.trim()) {
      toast.warning(
        isZh
          ? "项目名称和客户名称不能为空"
          : "Project name and client name are required",
      );
      return;
    }
    setIsSaving(true);
    try {
      await api.patch(`/projects/${project.id}`, {
        name: formData.name,
        client: formData.client,
        description: formData.description,
        notes: formData.notes,
        status: toBackendStatus(formData.status),
        contract_amount: Number(formData.contract_amount) || 0,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
      });
      onUpdate();
      setIsEditing(false);
      setShowSuggestions(false);
      toast.success(isZh ? "项目信息已保存" : "Project saved");
    } catch (error) {
      console.error("Failed to update project:", error);
      toast.error(isZh ? "保存失败，请重试" : "Failed to save, please try again");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      name: project.name,
      client: project.client,
      description: project.description || "",
      notes: project.notes || "",
      status: project.status,
      contract_amount: project.contract_amount || 0,
      start_date: projectWithDates.start_date || "",
      end_date: projectWithDates.end_date || "",
    });
    setIsEditing(false);
    setShowSuggestions(false);
    setAiError("");
  };


  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                {isZh ? "项目信息" : "Project Information"}
              </h3>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                >
                  <Edit3 className="h-4 w-4" />
                  {isZh ? "编辑" : "Edit"}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isZh ? "取消" : "Cancel"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {isZh ? "保存" : "Save"}
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {isZh ? "项目名称" : "Project Name"}
                  {isEditing && <span className="ml-1 text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => handleChange("name", event.target.value)}
                  disabled={!isEditing}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {isZh ? "客户名称" : "Client Name"}
                  {isEditing && <span className="ml-1 text-red-500">*</span>}
                </label>
                {isEditing ? (
                  <div className="relative">
                    <select
                      value={formData.client}
                      onChange={(event) => handleChange("client", event.target.value)}
                      disabled={isLoadingClients}
                      className="w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                    >
                      <option value="">
                        {isZh ? "请选择客户" : "Select a client"}
                      </option>
                      {clients.map((client) => (
                        <option key={client} value={client}>
                          {client}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                      {isLoadingClients ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 rotate-90 text-gray-400" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm text-gray-500">
                    {formData.client || (isZh ? "未设置" : "Not set")}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {isZh ? "开始日期" : "Start Date"}
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(event) => handleChange("start_date", event.target.value)}
                    disabled={!isEditing}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    {isZh ? "结束日期" : "End Date"}
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(event) => handleChange("end_date", event.target.value)}
                    disabled={!isEditing}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {isZh ? "合同金额（万元）" : "Contract Amount (10k CNY)"}
                </label>
                <input
                  type="number"
                  value={formData.contract_amount}
                  onChange={(event) =>
                    handleChange("contract_amount", event.target.value)
                  }
                  disabled={!isEditing}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>

              <div ref={stageRef}>
                <ProjectSettingsStageField
                  isEditing={isEditing}
                  isZh={isZh}
                  onChange={(value) => handleChange("status", value)}
                  value={formData.status}
                />
              </div>

              {isEditing && (
                <ProjectSettingsAIAssistant
                  aiError={aiError}
                  description={formData.description}
                  isAILoading={isAILoading}
                  isZh={isZh}
                  onApplySuggestion={applySuggestion}
                  onPolish={runAIPolish}
                  onSuggest={runAISuggest}
                  showSuggestions={showSuggestions}
                  suggestions={suggestions}
                />
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {isZh ? "项目描述" : "Description"}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(event) =>
                    handleChange("description", event.target.value)
                  }
                  disabled={!isEditing}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {isZh ? "备注" : "Notes"}
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(event) => handleChange("notes", event.target.value)}
                  disabled={!isEditing}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 font-semibold text-gray-900">
              {isZh ? "项目成员" : "Project Members"}
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <UserPicker
                    users={availableUsers}
                    value={selectedUserId}
                    onChange={setSelectedUserId}
                    placeholder={isZh ? "选择成员并添加" : "Select user to add"}
                    disabled={isLoadingUsers || isAddingMember}
                  />
                </div>
                <button
                  onClick={handleAddMember}
                  disabled={!selectedUserId || isAddingMember}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isAddingMember ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isZh ? (
                    "添加"
                  ) : (
                    "Add"
                  )}
                </button>
              </div>

              <div className="pt-2">
                {members.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    {isZh ? "暂无成员" : "No members yet"}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {members.map((member) => (
                      <li
                        key={member.user_id}
                        className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {(member.user?.display_name || "?").charAt(0)}
                          </div>
                          <span className="truncate text-sm text-gray-800">
                            {member.user?.display_name || (isZh ? "未知成员" : "Unknown")}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveMember(member.user_id)}
                          disabled={removingUserId === member.user_id}
                          title={isZh ? "移除成员" : "Remove"}
                          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          {removingUserId === member.user_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-red-200 bg-white p-6">
            <h3 className="mb-4 font-semibold text-red-600">
              {isZh ? "风险操作" : "Danger Zone"}
            </h3>
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {isZh ? "归档项目" : "Archive Project"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {isZh
                      ? "将项目标记为已完成并归档。"
                      : "Mark project as completed and archive it."}
                  </p>
                </div>
                <button
                  onClick={handleArchive}
                  disabled={project.status === "archived"}
                  className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {project.status === "archived"
                    ? isZh
                      ? "已归档"
                      : "Archived"
                    : isZh
                      ? "归档项目"
                      : "Archive Project"}
                </button>
              </div>

              <div className="h-px bg-red-100" />

              <div className="flex flex-col gap-3">
                <div>
                  <p className="font-medium text-red-600">
                    {isZh ? "删除项目" : "Delete Project"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {isZh
                      ? "永久删除当前项目及其所有数据，此操作不可恢复。"
                      : "Permanently delete this project and all its data. This cannot be undone."}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowDeleteDialog(true);
                    setDeleteConfirmText("");
                  }}
                  className="w-full rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
                >
                  {isZh ? "删除项目" : "Delete Project"}
                </button>
              </div>
            </div>
          </div>
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
