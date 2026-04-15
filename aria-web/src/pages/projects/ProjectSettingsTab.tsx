import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronRight,
  Edit3,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import {
  PROJECT_STAGE_CONFIGS,
  resolveProjectStage,
  toBackendStatus,
} from "../../types/enums";
import type { ProjectDetail as ProjectDetailType, ProjectMember } from "../../types/api";
import { UserPicker } from "./ProjectTodosTab";

interface UserItem {
  id: number;
  display_name: string;
}

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

interface ApiErrorLike {
  response?: {
    data?: {
      detail?: string;
    };
  };
}

interface ProjectSettingsTabProps {
  projectDetail: ProjectDetailType;
  onUpdate: () => void;
}

const getApiErrorMessage = (error: unknown): string | undefined =>
  (error as ApiErrorLike | undefined)?.response?.data?.detail;

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

  const [members, setMembers] = useState<ProjectMember[]>(projectDetail.members || []);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMembers(projectDetail.members || []);
  }, [projectDetail.members]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingUsers(true);
    api
      .get<UserItem[]>("/auth/users/simple")
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((error) => {
        console.error("Failed to load users:", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    setIsAddingMember(true);
    try {
      await api.post(`/projects/${project.id}/members`, { user_id: selectedUserId });
      toast.success(isZh ? "成员已添加" : "Member added");
      setSelectedUserId(null);
      onUpdate();
    } catch (error) {
      toast.error(getApiErrorMessage(error) || (isZh ? "添加成员失败" : "Failed to add member"));
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    setRemovingUserId(userId);
    try {
      await api.delete(`/projects/${project.id}/members/${userId}`);
      toast.success(isZh ? "成员已移除" : "Member removed");
      onUpdate();
    } catch (error) {
      toast.error(getApiErrorMessage(error) || (isZh ? "移除成员失败" : "Failed to remove member"));
    } finally {
      setRemovingUserId(null);
    }
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

  const availableUsers = users.filter(
    (user) => !members.some((member) => member.user_id === user.id),
  );

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
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {isZh ? "项目阶段" : "Project Stage"}
                </label>
                {isEditing ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      {isZh ? "商机阶段" : "Business Phase"}
                    </p>
                    <div className="mb-3 grid grid-cols-5 gap-1.5">
                      {PROJECT_STAGE_CONFIGS.filter((stage) => stage.phase === "business").map(
                        (stage) => {
                          const Icon = stage.icon;
                          const isActive =
                            resolveProjectStage(formData.status).id === stage.id;
                          return (
                            <button
                              key={stage.id}
                              type="button"
                              onClick={() => handleChange("status", stage.id)}
                              className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all ${
                                isActive
                                  ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm`
                                  : "bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100"
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                              <span className="text-xs leading-tight">
                                {isZh ? stage.labelZh : stage.label}
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>

                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      {isZh ? "交付阶段" : "Delivery Phase"}
                    </p>
                    <div className="mb-3 grid grid-cols-4 gap-1.5">
                      {PROJECT_STAGE_CONFIGS.filter((stage) => stage.phase === "delivery").map(
                        (stage) => {
                          const Icon = stage.icon;
                          const isActive =
                            resolveProjectStage(formData.status).id === stage.id;
                          return (
                            <button
                              key={stage.id}
                              type="button"
                              onClick={() => handleChange("status", stage.id)}
                              className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all ${
                                isActive
                                  ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm`
                                  : "bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100"
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                              <span className="text-xs leading-tight">
                                {isZh ? stage.labelZh : stage.label}
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>

                    {(() => {
                      const archivedStage =
                        PROJECT_STAGE_CONFIGS.find((stage) => stage.id === "archived") ||
                        PROJECT_STAGE_CONFIGS[0];
                      const Icon = archivedStage.icon;
                      const isActive =
                        resolveProjectStage(formData.status).id === "archived";
                      return (
                        <button
                          type="button"
                          onClick={() => handleChange("status", "archived")}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                            isActive
                              ? `${archivedStage.bgColor} ${archivedStage.color} ${archivedStage.borderColor} shadow-sm`
                              : "bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {isZh ? archivedStage.labelZh : archivedStage.label}
                        </button>
                      );
                    })()}
                  </div>
                ) : (
                  (() => {
                    const stage = resolveProjectStage(formData.status);
                    const Icon = stage.icon;
                    return (
                      <div
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${stage.bgColor} ${stage.color} ${stage.borderColor}`}
                      >
                        <Icon className="h-4 w-4" />
                        {isZh ? stage.labelZh : stage.label}
                      </div>
                    );
                  })()
                )}
              </div>

              {isEditing && (
                <div className="rounded-xl border border-primary/10 bg-gradient-to-r from-primary/5 to-purple-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-gray-700">
                      {isZh ? "AI 助手" : "AI Assistant"}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={runAISuggest}
                      disabled={isAILoading}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isAILoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="h-3.5 w-3.5" />
                      )}
                      {isZh ? "生成建议" : "Generate"}
                    </button>

                    {formData.description && (
                      <button
                        type="button"
                        onClick={runAIPolish}
                        disabled={isAILoading}
                        className="flex items-center gap-1.5 rounded-lg border border-primary bg-white px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {isZh ? "优化描述" : "Polish"}
                      </button>
                    )}
                  </div>

                  {aiError && (
                    <div className="mt-2 text-xs text-amber-600">{aiError}</div>
                  )}

                  {showSuggestions && suggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-500">
                        {isZh
                          ? "AI 建议，点击即可应用"
                          : "AI suggestions, click to apply"}
                      </p>
                      {suggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.name}-${index}`}
                          type="button"
                          onClick={() => applySuggestion(suggestion)}
                          className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition-all hover:border-primary/50 hover:shadow-sm"
                        >
                          <p className="text-sm font-medium text-gray-900">
                            {suggestion.name}
                          </p>
                          <p className="line-clamp-2 text-xs text-gray-500">
                            {suggestion.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
                            {member.user?.display_name || "Unknown"}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {isZh ? "确认删除项目" : "Delete Project"}
                </h3>
                <p className="text-sm text-gray-500">
                  {isZh ? "此操作不可恢复" : "This action cannot be undone"}
                </p>
              </div>
            </div>

            <p className="mb-4 text-sm text-gray-600">
              {isZh ? "请输入项目名称" : "Please type the project name"}{" "}
              <span className="font-semibold text-gray-900">"{project.name}"</span>{" "}
              {isZh ? "以确认删除。" : "to confirm deletion."}
            </p>

            <input
              type="text"
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              placeholder={project.name}
              className="mb-4 w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-red-300 focus:ring-2 focus:ring-red-100"
              autoFocus
            />

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== project.name || isDeleting}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isZh ? "确认删除" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
