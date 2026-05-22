import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Users, X } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type {
  ChatModel,
  ChatPlanResponse,
  GeneratedArtifact,
  Project,
  ProjectFile,
  ProjectFolder,
  ProjectMemory,
  ProjectMemoryResponse,
  ProjectMemoryStatusResponse,
  Message,
  MessageMetadata,
  Skill,
  TaskRun,
} from "../../types/api";
import { downloadArtifact } from "./downloadArtifact";
import { downloadProjectFile } from "./downloadProjectFile";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatFilePreviewPanel } from "./ProjectChatFilePreviewPanel";
import { ProjectChatMainPanel } from "./ProjectChatMainPanel";
import { ProjectChatSaveModal } from "./ProjectChatSaveModal";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import {
  extractSkillTemplateVariables,
  ProjectChatSkillTemplateModal,
} from "./ProjectChatSkillTemplateModal";
import {
  getProjectChatCopy,
  getProjectQuickPrompts,
} from "./projectChatCopy";
import { dispatchProjectMemoryStateUpdated } from "./useProjectDetailData";
import { useProjectChatComposer } from "./useProjectChatComposer";
import { useProjectChatConversations } from "./useProjectChatConversations";
import { useProjectChatPanel } from "./useProjectChatPanel";
import {
  type ProjectFileUploadError,
  uploadProjectFiles,
} from "./uploadProjectFiles";
import {
  useChatStakeholders,
  filterDisplayableStakeholders,
  type StakeholderCandidate,
} from "../../hooks/chat/useChatStakeholders";
import { workflowStepFromTask } from "./projectChatWorkflow";

type ProjectDocumentDetail = {
  id: number;
  project_id: number;
  folder_id?: number | null;
  name: string;
  content: string;
  summary?: string;
  uploaded_at: string;
};

function isMarkdownFile(file: ProjectFile | null) {
  const type = (file?.file_type || "").toLowerCase();
  const ext = file?.name?.split(".").pop()?.toLowerCase() || "";
  return type === "md" || ext === "md" || type.includes("markdown");
}

export function ProjectChatTab({
  project,
  files,
  folders,
  isFullscreen: controlledFullscreen,
  onFullscreenChange,
  onProjectUpdate,
}: {
  project: Project;
  files?: ProjectFile[];
  folders?: ProjectFolder[];
  isFullscreen?: boolean;
  onFullscreenChange?: (value: boolean) => void;
  onProjectUpdate: () => Promise<void> | void;
}) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const quickPrompts = getProjectQuickPrompts(isZh);
  const toast = useToast();
  const [memoryStatus, setMemoryStatus] = useState<ProjectMemoryStatusResponse | null>(null);
  const [, setProjectMemory] = useState<ProjectMemory | null>(null);
  const [isLoadingMemoryStatus, setIsLoadingMemoryStatus] = useState(false);
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [, setIsLoadingSkills] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("aria-project-chat-fullscreen") === "true";
  });
  const [showSkillTemplateModal, setShowSkillTemplateModal] = useState(false);
  const [skillTemplateData, setSkillTemplateData] = useState<{
    skill: Skill;
    variables: { name: string; value: string }[];
  } | null>(null);
  const [stakeholderCapture, setStakeholderCapture] = useState<{
    candidates: StakeholderCandidate[];
    clientName: string;
    message: Message;
  } | null>(null);
  const [isCapturingStakeholders, setIsCapturingStakeholders] = useState(false);
  const [isApplyingStakeholders, setIsApplyingStakeholders] = useState(false);
  const [isQuickApplyingStakeholders, setIsQuickApplyingStakeholders] = useState(false);
  const [previewFile, setPreviewFile] = useState<ProjectFile | null>(null);
  const [isUploadingProjectFile, setIsUploadingProjectFile] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window === "undefined") {
      return 440;
    }
    const stored = Number(window.localStorage.getItem("aria-project-chat-preview-width"));
    return Number.isFinite(stored) && stored >= 320 ? stored : 440;
  });
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [chatModels, setChatModels] = useState<ChatModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("aria-preferred-model") || "";
  });
  const [isBackgroundMode, setIsBackgroundMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("aria-chat-background-mode") === "true";
  });
  const [isPlanMode, setIsPlanMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("aria-chat-plan-mode") === "true";
  });
  const [planResult, setPlanResult] = useState<ChatPlanResponse | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planPendingContent, setPlanPendingContent] = useState("");
  const autoRefreshAttemptedRef = useRef("");
  const processedSkillRef = useRef<string | null>(null);
  const processedLaunchRef = useRef<string | null>(null);
  const preserveLaunchSkillRef = useRef(false);
  const skillArmedRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, width: 440 });
  const ignoreConversationParamRef = useRef(false);
  const projectChatBasePath = `/projects/${project.id}/chat`;
  const isCurrentProjectChatPath =
    location.pathname === projectChatBasePath || location.pathname.startsWith(`${projectChatBasePath}/`);
  const launchSkillParam = searchParams.get("skill");
  const launchPrompt = searchParams.get("q");
  const briefingLaunch = searchParams.get("briefing");
  const sourceConversationParam = searchParams.get("conversation");
  const pathConversationParam = isCurrentProjectChatPath ? location.pathname.match(/\/chat\/(\d+)$/)?.[1] || "" : "";
  const sourceMessageParam = searchParams.get("message");
  const parsedSourceMessageId = sourceMessageParam ? Number(sourceMessageParam) : null;
  const highlightedMessageId = parsedSourceMessageId && Number.isFinite(parsedSourceMessageId) ? parsedSourceMessageId : null;

  const {
    conversations,
    activeConvId,
    setActiveConvId,
    messages,
    setMessages,
    serverPendingAction,
    pendingToolActions,
    activeConversation,
    isLoadingMessages,
    isLoadingConversations,
    editingConvId,
    setEditingConvId,
    editTitle,
    setEditTitle,
    conversationPendingDelete,
    isDeletingConversation,
    fetchConversations,
    fetchMessages,
    refreshPendingAction,
    clearPendingAction,
    confirmToolAction,
    rejectToolAction,
    createConversation,
    deleteConversation,
    renameConversation,
    beginRenameConversation,
    startNewChat,
    openDeleteConversationDialog,
    closeDeleteConversationDialog,
  } = useProjectChatConversations({
    autoSelectFirstConversation: Boolean(pathConversationParam || sourceConversationParam),
    projectId: project.id,
    isZh,
    onCreateConversationError: () => toast.error(copy.createConversationFailed),
    onDeleteConversationError: () => toast.error(copy.deleteConversationFailed),
    onRenameConversationError: () => toast.error(copy.renameConversationFailed),
  });

  const panel = useProjectChatPanel();

  const {
    isLoading,
    streamingArtifacts,
    streamingContent,
    streamingStatus,
    streamingReferences,
    streamingToolCalls,
    streamingTruncated,
    resetStreamingContent,
    sendMessage,
    sendMessageAsync,
    stopGeneration,
  } = useProjectChatComposer({
    projectId: project.id,
    activeConvId,
    selectedSkillId,
    forceSkill: !!selectedSkillId && skillArmedRef.current,
    knowledgeScope: panel.knowledgeScope,
    selectedModel,
    setMessages,
    createConversation,
    fetchMessages,
    fetchConversations,
    isNearBottomRef: panel.isNearBottomRef,
    scrollToBottom: panel.scrollToBottom,
    onSendError: () => toast.error(copy.sendFailed),
  });

  const {
    autoStakeholderBanner,
    dismissedAutoDetectRef,
    setAutoStakeholderBanner,
  } = useChatStakeholders(project.id, messages, isLoading);

  const handleTaskRunUpdated = (task: TaskRun) => {
    const toolCalls = (task.steps || []).map((step) => workflowStepFromTask(step, task.steps?.length || 1, task.events || []));
    setMessages((current) =>
      current.map((message) => {
        if (message.role !== "assistant") return message;
        let metadata: MessageMetadata = {};
        try {
          metadata = JSON.parse(message.metadata_json || "{}") as MessageMetadata;
        } catch {
          metadata = {};
        }
        const metadataTaskId = metadata.task_run_id || metadata.task_run?.id;
        if (metadataTaskId !== task.id) return message;
        return {
          ...message,
          metadata_json: JSON.stringify({
            ...metadata,
            task_run: task,
            task_run_id: task.id,
            task_type: task.task_type,
            tool_calls: toolCalls,
          }),
        };
      }),
    );
  };

  const handleQuickApplyStakeholders = async () => {
    if (!autoStakeholderBanner) return;
    try {
      setIsQuickApplyingStakeholders(true);
      const result = await api.post<{ created: Array<{ name: string }>; skipped: Array<{ name: string }> }>(
        `/projects/${project.id}/stakeholder-candidates/apply`,
        { text: autoStakeholderBanner.sourceText },
      );
      if (result.created.length > 0) {
        toast.success(isZh ? `已加入 ${result.created.length} 个客户干系人` : `Added ${result.created.length} client stakeholder(s)`);
      } else {
        toast.info(isZh ? "候选干系人已存在，无需重复加入" : "Stakeholder candidates already exist");
      }
      setAutoStakeholderBanner(null);
    } catch {
      toast.error(isZh ? "加入客户干系人失败" : "Failed to add client stakeholders");
    } finally {
      setIsQuickApplyingStakeholders(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadSkills = async () => {
      setIsLoadingSkills(true);
      try {
        const data = await api.get<Skill[]>("/skills");
        if (!cancelled) {
          setSkills(data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load skills:", error);
          setSkills([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSkills(false);
        }
      }
    };

    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeConvId) {
      if (preserveLaunchSkillRef.current) {
        preserveLaunchSkillRef.current = false;
        return;
      }
      setSelectedSkillId(null);
      skillArmedRef.current = false;
      processedSkillRef.current = null;
    }
  }, [activeConvId, activeConversation]);

  useEffect(() => {
    if (!selectedSkillId || showSkillTemplateModal || messages.length > 0) {
      return;
    }
    if (panel.inputValue.trim()) {
      return;
    }

    const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
    if (!selectedSkill?.user_template) {
      return;
    }

    const skillKey = `${activeConvId ?? "new"}:${selectedSkillId}`;
    if (processedSkillRef.current === skillKey) {
      return;
    }

    setSkillTemplateData({
      skill: selectedSkill,
      variables: extractSkillTemplateVariables(selectedSkill.user_template),
    });
    setShowSkillTemplateModal(true);
    processedSkillRef.current = skillKey;
  }, [activeConvId, messages.length, panel.inputValue, selectedSkillId, showSkillTemplateModal, skills]);

  useEffect(() => {
    if ((!launchSkillParam && !launchPrompt) || isLoadingConversations) {
      return;
    }

    const launchKey = `${launchSkillParam || ""}:${launchPrompt || ""}`;
    if (processedLaunchRef.current === launchKey) {
      return;
    }
    processedLaunchRef.current = launchKey;

    const skillId = launchSkillParam ? Number(launchSkillParam) : null;
    if (skillId && Number.isFinite(skillId)) {
      preserveLaunchSkillRef.current = true;
      skillArmedRef.current = true;
    }
    startNewChat();
    panel.setKnowledgeScope("project");
    if (skillId && Number.isFinite(skillId)) {
      setSelectedSkillId(skillId);
    }
    if (launchPrompt) {
      panel.setInputValue(launchPrompt);
    }
    setSearchParams({}, { replace: true });
  }, [isLoadingConversations, launchPrompt, launchSkillParam, panel, setSearchParams, startNewChat]);

  useEffect(() => {
    if (!briefingLaunch || isLoadingConversations) return;
    const storedPrompt = sessionStorage.getItem("briefing_prompt");
    const autoSend = sessionStorage.getItem("briefing_auto_send");
    if (!storedPrompt) return;
    sessionStorage.removeItem("briefing_prompt");
    sessionStorage.removeItem("briefing_auto_send");
    setSearchParams({}, { replace: true });
    startNewChat();
    panel.setKnowledgeScope("project");
    if (autoSend === "1") {
      void sendMessage(storedPrompt);
    } else {
      panel.setInputValue(storedPrompt);
    }
  }, [briefingLaunch, isLoadingConversations, panel, sendMessage, setSearchParams, startNewChat]);

  useEffect(() => {
    if (!isCurrentProjectChatPath) {
      return;
    }
    const conversationParam = pathConversationParam || sourceConversationParam;
    if (!conversationParam || isLoadingConversations) {
      if (!conversationParam) {
        ignoreConversationParamRef.current = false;
      }
      return;
    }
    if (ignoreConversationParamRef.current) {
      return;
    }
    const conversationId = Number(conversationParam);
    if (!Number.isFinite(conversationId)) {
      return;
    }
    if (activeConvId !== conversationId) {
      setActiveConvId(conversationId);
    }
  }, [activeConvId, isCurrentProjectChatPath, isLoadingConversations, pathConversationParam, setActiveConvId, sourceConversationParam]);

  useEffect(() => {
    if (!isCurrentProjectChatPath) {
      return;
    }
    if (!activeConvId) {
      if (pathConversationParam && location.pathname !== projectChatBasePath) {
        navigate(`${projectChatBasePath}${location.search}`, { replace: true });
      }
      return;
    }
    const currentPathConversationId = pathConversationParam ? Number(pathConversationParam) : null;
    if (
      currentPathConversationId
      && Number.isFinite(currentPathConversationId)
      && currentPathConversationId !== activeConvId
    ) {
      return;
    }
    const nextPath = `${projectChatBasePath}/${activeConvId}`;
    if (location.pathname !== nextPath) {
      navigate(`${nextPath}${location.search}`, { replace: true });
    }
  }, [activeConvId, isCurrentProjectChatPath, location.pathname, location.search, navigate, pathConversationParam, projectChatBasePath]);

  useEffect(() => {
    if (!highlightedMessageId || isLoadingMessages) {
      return;
    }
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`message-${highlightedMessageId}`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId, isLoadingMessages, messages.length]);

  useEffect(() => {
    let cancelled = false;

    const loadMemoryStatus = async () => {
      setIsLoadingMemoryStatus(true);
      try {
        const [statusData, memoryData] = await Promise.all([
          api.get<ProjectMemoryStatusResponse>(`/projects/${project.id}/memory/status`),
          api.get<ProjectMemoryResponse>(`/projects/${project.id}/memory`),
        ]);
        if (!cancelled) {
          setMemoryStatus(statusData);
          setProjectMemory(memoryData.memory);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load project memory status:", error);
          setMemoryStatus(null);
          setProjectMemory(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMemoryStatus(false);
        }
      }
    };

    void loadMemoryStatus();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const handleArtifactDownload = async (artifact: GeneratedArtifact) => {
    try {
      await downloadArtifact({ artifact });
    } catch (error) {
      console.error("Failed to download artifact:", error);
      toast.error(isZh ? "生成物下载失败" : "Artifact download failed");
    }
  };

  const handleOpenArtifact = async (artifact: GeneratedArtifact) => {
    const projectFileId = artifact.project_file_id;
    if (!projectFileId) {
      await handleArtifactDownload(artifact);
      return;
    }

    const existingFile = files?.find((file) => file.id === projectFileId);
    if (existingFile) {
      setPreviewFile(existingFile);
      return;
    }

    try {
      const latestFiles = await api.get<ProjectFile[]>(`/projects/${project.id}/files`);
      const matchedFile = latestFiles.find((file) => file.id === projectFileId);
      if (matchedFile) {
        setPreviewFile(matchedFile);
        void onProjectUpdate();
        return;
      }
    } catch (error) {
      console.error("Failed to open generated project file:", error);
    }

    await handleArtifactDownload(artifact);
  };

  const handleDownloadProjectFile = async (file: ProjectFile) => {
    try {
      await downloadProjectFile({
        fileId: file.id,
        fileName: file.name,
        projectId: String(project.id),
      });
    } catch (error) {
      console.error("Failed to download project file:", error);
      toast.error(isZh ? "文件下载失败" : "File download failed");
    }
  };

  const handleUploadProjectFiles = async (
    fileList: FileList,
    folderId?: number | null,
  ) => {
    const selectedFiles = Array.from(fileList);
    if (selectedFiles.length === 0 || isUploadingProjectFile) return;

    setIsUploadingProjectFile(true);
    try {
      await uploadProjectFiles({
        files: selectedFiles,
        folderId,
        projectId: String(project.id),
      });
      toast.success(
        isZh
          ? `已上传 ${selectedFiles.length} 个文件`
          : `Uploaded ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""}`,
      );
      await onProjectUpdate();
    } catch (error) {
      const uploadError = error as ProjectFileUploadError;
      console.error("Failed to upload project files:", error);
      if (uploadError.reason === "too_large") {
        toast.error(
          isZh
            ? `文件过大：${uploadError.fileName ?? ""} 超过 80MB`
            : `File too large: ${uploadError.fileName ?? ""} exceeds 80MB`,
        );
      } else {
        toast.error(isZh ? "上传失败" : "Upload failed");
      }
    } finally {
      setIsUploadingProjectFile(false);
    }
  };

  const handleApplyStakeholders = async (message: Message) => {
    try {
      setIsCapturingStakeholders(true);
      const result = await api.post<{ client_name: string; candidates: StakeholderCandidate[] }>(
        `/projects/${project.id}/stakeholder-candidates`,
        { text: message.content },
      );
      const displayableCandidates = filterDisplayableStakeholders(result.candidates);
      if (displayableCandidates.length > 0) {
        setStakeholderCapture({
          candidates: displayableCandidates,
          clientName: result.client_name,
          message,
        });
        return;
      }
      toast.info(isZh ? "这条消息里暂未识别到明确的客户干系人" : "No clear client stakeholders detected in this message");
    } catch (error) {
      console.error("Failed to detect stakeholder candidates:", error);
      toast.error(isZh ? "识别客户干系人失败" : "Failed to detect client stakeholders");
    } finally {
      setIsCapturingStakeholders(false);
    }
  };

  const confirmApplyStakeholders = async () => {
    if (!stakeholderCapture) return;
    try {
      setIsApplyingStakeholders(true);
      const result = await api.post<{ created: Array<{ name: string }>; skipped: Array<{ name: string }> }>(
        `/projects/${project.id}/stakeholder-candidates/apply`,
        { text: stakeholderCapture.message.content },
      );
      if (result.created.length > 0) {
        toast.success(isZh ? `已加入 ${result.created.length} 个客户干系人` : `Added ${result.created.length} client stakeholder(s)`);
      } else {
        toast.info(isZh ? "候选干系人已存在，无需重复加入" : "Stakeholder candidates already exist");
      }
      setStakeholderCapture(null);
    } catch (error) {
      console.error("Failed to apply stakeholder candidates:", error);
      toast.error(isZh ? "加入客户干系人失败" : "Failed to add client stakeholders");
    } finally {
      setIsApplyingStakeholders(false);
    }
  };

  const handleRebuildMemory = async (silent = false) => {
    setIsRebuildingMemory(true);
    try {
      const data = await api.post<ProjectMemoryResponse>(
        `/projects/${project.id}/memory/rebuild`,
        {},
        { timeout: 60000 },
      );
      setMemoryStatus({
        project_id: project.id,
        has_memory: true,
        memory_stale: data.memory_stale,
        memory_updated_at: data.memory_updated_at,
        memory_version: data.memory_version,
        memory_rebuild_status: data.memory_rebuild_status,
        memory_rebuild_failed_at: data.memory_rebuild_failed_at,
      });
      setProjectMemory(data.memory);
      dispatchProjectMemoryStateUpdated({
        projectId: project.id,
        memory_stale: data.memory_stale,
        memory_updated_at: data.memory_updated_at,
        memory_version: data.memory_version,
        memory_rebuild_status: data.memory_rebuild_status ?? "idle",
        memory_rebuild_failed_at: data.memory_rebuild_failed_at ?? null,
        project_brief: data.memory.project_brief,
      });
      if (!silent) {
        toast.success(isZh ? "项目记忆已重建" : "Project memory rebuilt");
      }
    } catch (error) {
      console.error("Failed to rebuild project memory:", error);
      if (!silent) {
        toast.error(isZh ? "重建项目记忆失败" : "Failed to rebuild project memory");
      }
    } finally {
      setIsRebuildingMemory(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        const data = await api.get<ChatModel[]>("/chat/models");
        if (!cancelled) {
          setChatModels(data);
          // Auto-select first available if none selected
          if (!selectedModel) {
            const firstAvailable = data.find((m) => m.available);
            if (firstAvailable) {
              setSelectedModel(firstAvailable.id);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load chat models:", error);
      }
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedModel && typeof window !== "undefined") {
      window.localStorage.setItem("aria-preferred-model", selectedModel);
    }
  }, [selectedModel]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aria-chat-background-mode", String(isBackgroundMode));
    }
  }, [isBackgroundMode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aria-chat-plan-mode", String(isPlanMode));
    }
  }, [isPlanMode]);

  useEffect(() => {
    if (!memoryStatus?.memory_stale || isLoadingMemoryStatus || isRebuildingMemory) {
      return;
    }

    const attemptKey = `${project.id}:${memoryStatus.memory_version ?? 0}`;
    if (autoRefreshAttemptedRef.current === attemptKey) {
      return;
    }
    autoRefreshAttemptedRef.current = attemptKey;

    const timer = window.setTimeout(() => {
      void handleRebuildMemory(true);
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isLoadingMemoryStatus,
    isRebuildingMemory,
    memoryStatus?.memory_stale,
    memoryStatus?.memory_version,
    project.id,
  ]);

  useEffect(() => {
    resetStreamingContent();
  }, [activeConvId, resetStreamingContent]);

  useEffect(() => {
    if (messages.length > 0 && panel.isAutoFollow) {
      panel.scrollToBottom(false);
    }
  }, [messages.length, panel.isAutoFollow, panel.scrollToBottom]);

  useEffect(() => {
    if (!activeConvId || isLoading || isLoadingMessages) {
      return;
    }
    void refreshPendingAction(activeConvId);
  }, [activeConvId, isLoading, isLoadingMessages, messages.length]);

  useEffect(() => {
    if ((streamingContent || streamingStatus || streamingToolCalls.length > 0) && panel.isAutoFollow) {
      panel.scrollToBottom(false);
    }
  }, [panel.isAutoFollow, panel.scrollToBottom, streamingContent, streamingStatus, streamingToolCalls.length]);

  useEffect(() => {
    if (controlledFullscreen === undefined) {
      return;
    }
    setIsFullscreen(controlledFullscreen);
  }, [controlledFullscreen]);

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aria-project-chat-fullscreen", String(isFullscreen));
    }
    onFullscreenChange?.(isFullscreen);
  }, [isFullscreen, onFullscreenChange]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewContent("");
      setIsLoadingPreview(false);
      return;
    }

    if (!isMarkdownFile(previewFile)) {
      setPreviewContent("");
      setIsLoadingPreview(false);
      return;
    }

    let cancelled = false;
    const loadPreview = async () => {
      setIsLoadingPreview(true);
      try {
        const data = await api.get<ProjectDocumentDetail>(
          `/projects/${project.id}/documents/${previewFile.id}`,
        );
        if (!cancelled) {
          setPreviewContent(data.content || "");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load project chat preview:", error);
          setPreviewContent("");
          toast.error(isZh ? "文件预览加载失败" : "Failed to load file preview");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [isZh, previewFile, project.id, toast]);

  useEffect(() => {
    if (!isResizingPreview) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const delta = resizeStartRef.current.x - event.clientX;
      const maxWidth = Math.min(760, Math.max(360, window.innerWidth - 720));
      const nextWidth = Math.min(maxWidth, Math.max(320, resizeStartRef.current.width + delta));
      setPreviewWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingPreview(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingPreview]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aria-project-chat-preview-width", String(Math.round(previewWidth)));
    }
  }, [previewWidth]);

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const handleApplySkillTemplate = async (filledTemplate: string) => {
    setShowSkillTemplateModal(false);
    setSkillTemplateData(null);
    skillArmedRef.current = true;
    const sent = await sendMessage(filledTemplate);
    if (sent) {
      setSelectedSkillId(null);
      skillArmedRef.current = false;
      processedSkillRef.current = null;
    }
  };

  const handleSendMessage = async (content: string, options: { actionConfirmations?: string[] } = {}) => {
    if (isPlanMode && !planResult) {
      // Generate plan instead of sending
      setIsGeneratingPlan(true);
      setPlanPendingContent(content);
      let conversationId = activeConvId;
      const skillId = !!selectedSkillId && skillArmedRef.current ? selectedSkillId || undefined : undefined;
      if (!conversationId) {
        conversationId = await createConversation(content, skillId || null);
        if (!conversationId) {
          setIsGeneratingPlan(false);
          return false;
        }
      }
      const mentions = (await import("./projectChatMentions")).parseMentions(content);
      const mentionContext = mentions.length > 0 ? {
        file_ids: mentions.filter((m: { type: string }) => m.type === "file").map((m: { id: number }) => m.id),
        stakeholder_ids: mentions.filter((m: { type: string }) => m.type === "stakeholder").map((m: { id: number }) => m.id),
        milestone_ids: mentions.filter((m: { type: string }) => m.type === "milestone").map((m: { id: number }) => m.id),
      } : undefined;
      try {
        const res = await api.post<ChatPlanResponse>("/chat/plan", {
          conversation_id: conversationId,
          content,
          project_id: project.id,
          skill_id: skillId,
          force_skill: !!skillId,
          knowledge_scope: panel.knowledgeScope,
          model: selectedModel || undefined,
          mention_context: mentionContext,
        });
        setPlanResult(res);
      } catch (error) {
        console.error("Failed to generate plan:", error);
        toast.error(isZh ? "制定计划失败" : "Failed to generate plan");
      } finally {
        setIsGeneratingPlan(false);
      }
      return true;
    }
    const sent = isBackgroundMode
      ? await sendMessageAsync(content, options)
      : await sendMessage(content, options);
    if (sent && selectedSkillId && skillArmedRef.current) {
      setSelectedSkillId(null);
      skillArmedRef.current = false;
      processedSkillRef.current = null;
    }
    return sent;
  };

  const handleSkillChange = (skillId: number | null) => {
    setSelectedSkillId(skillId);
    skillArmedRef.current = !!skillId;
    if (!skillId) {
      processedSkillRef.current = null;
    }
  };

  const handleStartNewChat = () => {
    setSelectedSkillId(null);
    skillArmedRef.current = false;
    processedSkillRef.current = null;
    setPlanResult(null);
    setPlanPendingContent("");
    ignoreConversationParamRef.current = true;
    startNewChat();
    navigate(projectChatBasePath);
  };

  const handleSelectConversation = (conversationId: number) => {
    setSelectedSkillId(null);
    skillArmedRef.current = false;
    processedSkillRef.current = null;
    setPlanResult(null);
    setPlanPendingContent("");
    setActiveConvId(conversationId);
    navigate(`/projects/${project.id}/chat/${conversationId}`);
  };

  const handleCancelSkillTemplate = () => {
    setShowSkillTemplateModal(false);
    setSkillTemplateData(null);
    setSelectedSkillId(null);
    skillArmedRef.current = false;
    processedSkillRef.current = null;
  };

  return (
    <div
      className={
        isFullscreen
          ? "flex h-screen w-screen min-h-0 overflow-hidden border-0 bg-white shadow-none"
          : "flex h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      }
    >
      <ProjectChatSidebar
        activeConvId={activeConvId}
        conversations={conversations}
        editTitle={editTitle}
        editingConvId={editingConvId}
        files={files}
        folders={folders}
        isFullscreen={isFullscreen}
        isUploadingFile={isUploadingProjectFile}
        isLoadingConversations={isLoadingConversations}
        isOpen={panel.isSidebarOpen}
        selectedFileId={previewFile?.id ?? null}
        onBeginRename={beginRenameConversation}
        onCancelRename={() => setEditingConvId(null)}
        onDeleteConversation={openDeleteConversationDialog}
        onRenameSubmit={renameConversation}
        onRenameTitleChange={setEditTitle}
        onSelectFile={(file) => setPreviewFile(file)}
        onSelectConversation={handleSelectConversation}
        getConversationHref={(conversationId) => `/projects/${project.id}/chat/${conversationId}`}
        onStartNewChat={handleStartNewChat}
        onUploadFiles={(fileList, folderId) => {
          void handleUploadProjectFiles(fileList, folderId);
        }}
        onToggleFullscreen={() => setIsFullscreen((current) => !current)}
      />

      <div className="flex min-w-0 flex-1 bg-slate-50">
        <div className="flex min-w-0 flex-1">
          <ProjectChatMainPanel
            activeConversation={activeConversation}
            choosePromptLabel={copy.choosePromptOrAsk}
            handleScroll={panel.handleScroll}
            inputPlaceholder={copy.inputPlaceholder}
            inputValue={panel.inputValue}
            isLoading={isLoading}
            isFullscreen={isFullscreen}
            highlightedMessageId={highlightedMessageId}
            isLoadingMemoryStatus={isLoadingMemoryStatus}
            isLoadingMessages={isLoadingMessages}
            isRebuildingMemory={isRebuildingMemory}
            isSidebarOpen={panel.isSidebarOpen}
            knowledgeScope={panel.knowledgeScope}
            memoryStatus={memoryStatus}
            messages={messages}
            messagesContainerRef={panel.messagesContainerRef}
            onDownloadArtifact={(artifact) => void handleArtifactDownload(artifact)}
            onOpenArtifact={(artifact) => void handleOpenArtifact(artifact)}
            onConfirmToolAction={(content, confirmationToken) => {
              clearPendingAction();
              void handleSendMessage(content, { actionConfirmations: [confirmationToken] }).finally(() => {
                if (activeConvId) void refreshPendingAction(activeConvId);
              });
            }}
            onConfirmHitasAction={async (actionId) => {
              const result = await confirmToolAction(actionId);
              if (activeConvId) {
                void fetchMessages(activeConvId);
              }
              return result;
            }}
            onRejectHitasAction={async (actionId) => {
              await rejectToolAction(actionId);
              if (activeConvId) {
                void fetchMessages(activeConvId);
              }
            }}
            pendingToolActions={pendingToolActions}
            serverPendingAction={serverPendingAction}
            onApplyStakeholders={(message) => void handleApplyStakeholders(message)}
            onTaskRunUpdated={handleTaskRunUpdated}
            onInputChange={panel.setInputValue}
            onKnowledgeScopeChange={panel.setKnowledgeScope}
            onOpenConversationSaveModal={panel.openConversationSaveModal}
            onQuickPrompt={(content) => {
              void handleSendMessage(content);
            }}
            onRebuildMemory={() => {
              void handleRebuildMemory();
            }}
            onSaveMessage={panel.openSaveModal}
            onSend={() => panel.handleSend(handleSendMessage)}
            onStop={stopGeneration}
            onSkillChange={handleSkillChange}
            onToggleSidebar={() => panel.setIsSidebarOpen(!panel.isSidebarOpen)}
            models={chatModels}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            isBackgroundMode={isBackgroundMode}
            onToggleBackgroundMode={() => setIsBackgroundMode((v) => !v)}
            isStreamingTruncated={streamingTruncated}
            onContinue={() => void sendMessage(isZh ? "继续" : "Continue")}
            planResult={planResult}
            isGeneratingPlan={isGeneratingPlan}
            onExecutePlan={() => {
              const content = planPendingContent;
              setPlanResult(null);
              setPlanPendingContent("");
              setIsPlanMode(false);
              void handleSendMessage(content);
            }}
            onCancelPlan={() => {
              setPlanResult(null);
              setPlanPendingContent("");
            }}
            projectClientName={project.client}
            projectId={project.id}
            quickPrompts={quickPrompts}
            skills={skills}
            selectedSkillId={selectedSkillId}
            startConversationLabel={copy.startConversation}
            streamingArtifacts={streamingArtifacts}
            streamingContent={streamingContent}
            streamingStatus={streamingStatus}
            streamingReferences={streamingReferences}
            streamingToolCalls={streamingToolCalls}
            subtitle={copy.projectAssistantSubtitle}
            thinkingLabel={copy.thinking}
            title={activeConversation?.title || copy.projectAssistantTitle}
          />
        </div>

        {previewFile ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                resizeStartRef.current = { x: event.clientX, width: previewWidth };
                setIsResizingPreview(true);
              }}
              className={`group hidden w-2 shrink-0 cursor-col-resize items-center justify-center border-x border-transparent transition-colors xl:flex ${
                isResizingPreview ? "bg-primary/10" : "hover:bg-primary/5"
              }`}
            >
              <div className="h-12 w-0.5 rounded-full bg-gray-200 transition-colors group-hover:bg-primary/50" />
            </div>
            <div className="hidden min-h-0 shrink-0 xl:block" style={{ width: previewWidth }}>
              <ProjectChatFilePreviewPanel
                content={previewContent}
                file={previewFile}
                isLoading={isLoadingPreview}
                isZh={isZh}
                onClose={() => setPreviewFile(null)}
                onDownload={(file) => void handleDownloadProjectFile(file)}
              />
            </div>
          </>
        ) : null}
      </div>

      <ProjectChatSaveModal
        files={files || []}
        folders={folders || []}
        isOpen={panel.saveModalOpen}
        messageId={panel.saveMessageId}
        onClose={panel.closeSaveModal}
        onOpenProjectMemory={() => navigate(`/projects/${project.id}/memory`)}
        onRefreshProjectMemory={() => handleRebuildMemory()}
        onSuccess={() => onProjectUpdate()}
        projectId={project.id}
      />

      <ProjectChatSaveModal
        conversationId={activeConvId}
        files={files || []}
        folders={folders || []}
        isOpen={panel.conversationSaveModalOpen}
        onClose={panel.closeConversationSaveModal}
        onOpenProjectMemory={() => navigate(`/projects/${project.id}/memory`)}
        onRefreshProjectMemory={() => handleRebuildMemory()}
        onSuccess={() => onProjectUpdate()}
        projectId={project.id}
      />

      <ProjectChatDeleteDialog
        conversationTitle={conversationPendingDelete?.title}
        isDeleting={isDeletingConversation}
        isOpen={!!conversationPendingDelete}
        onCancel={closeDeleteConversationDialog}
        onConfirm={() => {
          if (!conversationPendingDelete) return;
          void deleteConversation(conversationPendingDelete.id);
        }}
      />

      {stakeholderCapture ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold text-gray-950">
                  <Users className="h-5 w-5 text-emerald-600" />
                  {isZh ? "确认加入客户干系人" : "Confirm client stakeholders"}
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {isZh
                    ? `只把明确的人名和职务加入「${stakeholderCapture.clientName}」客户卡片；部门、议题和材料名已经过滤。确认后会标记客户记忆待刷新。`
                    : `Only clear people with roles will be added to ${stakeholderCapture.clientName}'s client card. Departments, topics, and document terms are filtered out.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStakeholderCapture(null)}
                className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label={isZh ? "关闭" : "Close"}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {stakeholderCapture.candidates.map((candidate, index) => (
                <div key={`${candidate.name}-${candidate.role}-${index}`} className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-950">{candidate.name}</div>
                      <div className="mt-1 text-xs text-emerald-700">
                        {[candidate.role, candidate.influence_type, candidate.relationship_status].filter(Boolean).join(" / ") || "-"}
                      </div>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-xs text-emerald-700">
                      {isZh ? "候选" : "Candidate"}
                    </span>
                  </div>
                  {candidate.note ? <p className="mt-3 line-clamp-3 text-xs leading-5 text-gray-600">{candidate.note}</p> : null}
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setStakeholderCapture(null)}
                disabled={isApplyingStakeholders}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {isZh ? "先不加入" : "Not now"}
              </button>
              <button
                type="button"
                onClick={() => void confirmApplyStakeholders()}
                disabled={isApplyingStakeholders}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {isApplyingStakeholders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                {isZh ? "确认加入" : "Confirm add"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCapturingStakeholders ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm text-emerald-700 shadow-lg">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isZh ? "正在识别客户干系人..." : "Detecting client stakeholders..."}
          </span>
        </div>
      ) : null}

      {autoStakeholderBanner ? (
        <div className="fixed bottom-6 left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">
                {isZh
                  ? "发现可能的客户联系人"
                  : "Possible client contacts found"
                }
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {autoStakeholderBanner.candidates.map((candidate) => (
                  <span
                    key={`${candidate.name}-${candidate.role}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    <span className="truncate">{candidate.name}</span>
                    <span className="text-slate-400">/</span>
                    <span className="truncate text-slate-500">{candidate.role}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                {isZh ? "只会加入明确的人名和职务；部门、议题和材料名会自动忽略。" : "Only clear people with roles are added; departments, topics, and document terms are ignored."}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleQuickApplyStakeholders()}
                  disabled={isQuickApplyingStakeholders}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {isQuickApplyingStakeholders ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {isZh ? "添加" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dismissedAutoDetectRef.current = autoStakeholderBanner.sourceText;
                    setAutoStakeholderBanner(null);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                >
                  {isZh ? "忽略" : "Dismiss"}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                dismissedAutoDetectRef.current = autoStakeholderBanner.sourceText;
                setAutoStakeholderBanner(null);
              }}
              className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label={isZh ? "关闭" : "Close"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {showSkillTemplateModal && skillTemplateData ? (
        <ProjectChatSkillTemplateModal
          skill={skillTemplateData.skill}
          variables={skillTemplateData.variables}
          onApply={handleApplySkillTemplate}
          onCancel={handleCancelSkillTemplate}
        />
      ) : null}
    </div>
  );
}
