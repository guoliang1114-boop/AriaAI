import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type {
  GeneratedArtifact,
  Project,
  ProjectFile,
  ProjectFolder,
  ProjectMemoryResponse,
  ProjectMemoryStatusResponse,
  Skill,
} from "../../types/api";
import { downloadArtifact } from "./downloadArtifact";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatMainPanel } from "./ProjectChatMainPanel";
import { ProjectChatSaveModal } from "./ProjectChatSaveModal";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import {
  extractSkillTemplateVariables,
  ProjectChatSkillTemplateModal,
} from "./ProjectChatSkillTemplateModal";
import {
  getProjectChatCopy,
  getProjectMemoryQuickActions,
  getProjectQuickPrompts,
} from "./projectChatCopy";
import { useProjectChatComposer } from "./useProjectChatComposer";
import { useProjectChatConversations } from "./useProjectChatConversations";
import { useProjectChatPanel } from "./useProjectChatPanel";

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
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const quickPrompts = getProjectQuickPrompts(isZh);
  const memoryQuickActions = getProjectMemoryQuickActions(isZh);
  const toast = useToast();
  const [memoryStatus, setMemoryStatus] = useState<ProjectMemoryStatusResponse | null>(null);
  const [isLoadingMemoryStatus, setIsLoadingMemoryStatus] = useState(false);
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
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
  const autoRefreshAttemptedRef = useRef("");
  const processedSkillRef = useRef<string | null>(null);

  const {
    conversations,
    activeConvId,
    setActiveConvId,
    messages,
    setMessages,
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
    createConversation,
    deleteConversation,
    renameConversation,
    beginRenameConversation,
    startNewChat,
    openDeleteConversationDialog,
    closeDeleteConversationDialog,
  } = useProjectChatConversations({
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
    streamingReferences,
    streamingToolCalls,
    resetStreamingContent,
    sendMessage,
  } = useProjectChatComposer({
    projectId: project.id,
    activeConvId,
    selectedSkillId,
    knowledgeScope: panel.knowledgeScope,
    setMessages,
    createConversation,
    fetchMessages,
    fetchConversations,
    isNearBottomRef: panel.isNearBottomRef,
    scrollToBottom: panel.scrollToBottom,
    onSendError: () => toast.error(copy.sendFailed),
  });

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
    if (activeConvId && activeConversation) {
      setSelectedSkillId(activeConversation.skill_id ?? null);
      return;
    }
    if (!activeConvId) {
      setSelectedSkillId(null);
      processedSkillRef.current = null;
    }
  }, [activeConvId, activeConversation]);

  useEffect(() => {
    if (!selectedSkillId || showSkillTemplateModal || messages.length > 0) {
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
  }, [activeConvId, messages.length, selectedSkillId, showSkillTemplateModal, skills]);

  useEffect(() => {
    let cancelled = false;

    const loadMemoryStatus = async () => {
      setIsLoadingMemoryStatus(true);
      try {
        const data = await api.get<ProjectMemoryStatusResponse>(`/projects/${project.id}/memory/status`);
        if (!cancelled) {
          setMemoryStatus(data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load project memory status:", error);
          setMemoryStatus(null);
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
    if (streamingContent && panel.isAutoFollow) {
      panel.scrollToBottom(false);
    }
  }, [panel.isAutoFollow, panel.scrollToBottom, streamingContent]);

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
    await sendMessage(filledTemplate);
  };

  const handleCancelSkillTemplate = () => {
    setShowSkillTemplateModal(false);
    setSkillTemplateData(null);
  };

  return (
    <div
      className={
        isFullscreen
          ? "flex h-screen w-screen min-h-0 overflow-hidden border-0 bg-white shadow-none"
          : "flex h-full min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
      }
    >
      <ProjectChatSidebar
        activeConvId={activeConvId}
        conversations={conversations}
        editTitle={editTitle}
        editingConvId={editingConvId}
        isFullscreen={isFullscreen}
        isLoadingConversations={isLoadingConversations}
        isOpen={panel.isSidebarOpen}
        onBeginRename={beginRenameConversation}
        onCancelRename={() => setEditingConvId(null)}
        onDeleteConversation={openDeleteConversationDialog}
        onRenameSubmit={renameConversation}
        onRenameTitleChange={setEditTitle}
        onSelectConversation={setActiveConvId}
        onStartNewChat={startNewChat}
      />

      <ProjectChatMainPanel
        activeConversation={activeConversation}
        choosePromptLabel={copy.choosePromptOrAsk}
        handleScroll={panel.handleScroll}
        inputPlaceholder={copy.inputPlaceholder}
        inputValue={panel.inputValue}
        isLoading={isLoading}
        isFullscreen={isFullscreen}
        isAutoFollow={panel.isAutoFollow}
        isLoadingMemoryStatus={isLoadingMemoryStatus}
        isLoadingMessages={isLoadingMessages}
        showScrollToBottom={panel.showScrollToBottom}
        isRebuildingMemory={isRebuildingMemory}
        isSidebarOpen={panel.isSidebarOpen}
        knowledgeScope={panel.knowledgeScope}
        memoryQuickActions={memoryQuickActions}
        memoryStatus={memoryStatus}
        messages={messages}
        messagesContainerRef={panel.messagesContainerRef}
        onDownloadArtifact={(artifact) => void handleArtifactDownload(artifact)}
        onEnableAutoFollow={panel.enableAutoFollow}
        onInputChange={panel.setInputValue}
        onJumpToBottom={() => panel.scrollToBottom(true)}
        onKnowledgeScopeChange={panel.setKnowledgeScope}
        onOpenConversationSaveModal={panel.openConversationSaveModal}
        onQuickPrompt={(content) => {
          void sendMessage(content);
        }}
        onRebuildMemory={() => {
          void handleRebuildMemory();
        }}
        onSaveMessage={panel.openSaveModal}
        onSend={() => panel.handleSend(sendMessage)}
        onSkillChange={setSelectedSkillId}
        onToggleFullscreen={() => setIsFullscreen((current) => !current)}
        onToggleSidebar={() => panel.setIsSidebarOpen(!panel.isSidebarOpen)}
        projectClientName={project.client}
        projectId={project.id}
        quickPrompts={quickPrompts}
        skills={skills}
        selectedSkillId={selectedSkillId}
        isLoadingSkills={isLoadingSkills}
        startConversationLabel={copy.startConversation}
        streamingArtifacts={streamingArtifacts}
        streamingContent={streamingContent}
        streamingReferences={streamingReferences}
        streamingToolCalls={streamingToolCalls}
        subtitle={copy.projectAssistantSubtitle}
        thinkingLabel={copy.thinking}
        title={activeConversation?.title || copy.projectAssistantTitle}
      />

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
