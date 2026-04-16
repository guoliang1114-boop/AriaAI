import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import {
  resolveProjectStage,
  toBackendStatus,
  type ProjectStage,
} from "../../types/enums";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

interface EditLocationState {
  edit?: boolean;
}

interface ProjectWithDates {
  end_date?: string;
  start_date?: string;
}

export interface ProjectSettingsFormData {
  client: string;
  contract_amount: number | string;
  description: string;
  end_date: string;
  name: string;
  notes: string;
  start_date: string;
  status: ProjectStage;
}

export interface SuggestionItem {
  description: string;
  name: string;
}

interface UseProjectSettingsEditorOptions {
  isZh: boolean;
  onUpdate: () => void;
  project: ProjectDetailType["project"];
}

export function useProjectSettingsEditor({
  isZh,
  onUpdate,
  project,
}: UseProjectSettingsEditorOptions) {
  const projectWithDates = project as typeof project & ProjectWithDates;
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
  const [formData, setFormData] = useState<ProjectSettingsFormData>({
    name: project.name,
    client: project.client,
    description: project.description || "",
    notes: project.notes || "",
    status: resolveProjectStage(project.status).id,
    contract_amount: project.contract_amount || 0,
    start_date: projectWithDates.start_date || "",
    end_date: projectWithDates.end_date || "",
  });

  const stageRef = useRef<HTMLDivElement>(null);

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

  const resetForm = () => {
    setFormData({
      name: project.name,
      client: project.client,
      description: project.description || "",
      notes: project.notes || "",
      status: resolveProjectStage(project.status).id,
      contract_amount: project.contract_amount || 0,
      start_date: projectWithDates.start_date || "",
      end_date: projectWithDates.end_date || "",
    });
  };

  const handleChange = (field: keyof ProjectSettingsFormData, value: string | number) => {
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
        isZh ? `项目 "${project.name}" 已删除` : `Project "${project.name}" deleted`,
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
    resetForm();
    setIsEditing(false);
    setShowSuggestions(false);
    setAiError("");
  };

  const openDeleteDialog = () => {
    setShowDeleteDialog(true);
    setDeleteConfirmText("");
  };

  return {
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
  };
}
