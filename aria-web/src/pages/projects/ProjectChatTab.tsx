import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type {
  GeneratedArtifact,
  Project,
  ProjectFile,
  ProjectFolder,
  ProjectMemoryResponse,
  ProjectMemoryStatusResponse,
} from "../../types/api";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatMainPanel } from "./ProjectChatMainPanel";
import { ProjectChatSaveModal } from "./ProjectChatSaveModal";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import { downloadArtifact } from "./downloadArtifact";
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
  onProjectUpdate,
}: {
  project: Project;
  files?: ProjectFile[];
  folders?: ProjectFolder[];
  onProjectUpdate: () => Promise<void> | void;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const quickPrompts = getProjectQuickPrompts(isZh);
  const memoryQuickActions = getProjectMemoryQuickActions(isZh);
  const toast = useToast();
  const [memoryStatus, setMemoryStatus] = useState<ProjectMemoryStatusResponse | null>(null);
  const [isLoadingMemoryStatus, setIsLoadingMemoryStatus] = useState(false);
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);

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

  const handleRebuildMemory = async () => {
    setIsRebuildingMemory(true);
    try {
      const data = await api.post<ProjectMemoryResponse>(`/projects/${project.id}/memory/rebuild`, {});
      setMemoryStatus({
        project_id: project.id,
        has_memory: true,
        memory_stale: data.memory_stale,
        memory_updated_at: data.memory_updated_at,
        memory_version: data.memory_version,
      });
      toast.success(isZh ? "项目记忆已重建" : "Project memory rebuilt");
    } catch (error) {
      console.error("Failed to rebuild project memory:", error);
      toast.error(isZh ? "重建项目记忆失败" : "Failed to rebuild project memory");
    } finally {
      setIsRebuildingMemory(false);
    }
  };

  useEffect(() => {
    resetStreamingContent();
  }, [activeConvId, resetStreamingContent]);

  useEffect(() => {
    if (messages.length > 0 && panel.isNearBottomRef.current) {
      panel.scrollToBottom(false);
    }
  }, [messages.length, panel.scrollToBottom]);

  useEffect(() => {
    if (streamingContent && panel.isNearBottomRef.current) {
      panel.scrollToBottom(false);
    }
  }, [panel.scrollToBottom, streamingContent]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <ProjectChatSidebar
        activeConvId={activeConvId}
        conversations={conversations}
        editTitle={editTitle}
        editingConvId={editingConvId}
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
        isLoadingMemoryStatus={isLoadingMemoryStatus}
        isLoadingMessages={isLoadingMessages}
        isRebuildingMemory={isRebuildingMemory}
        isSidebarOpen={panel.isSidebarOpen}
        knowledgeScope={panel.knowledgeScope}
        memoryQuickActions={memoryQuickActions}
        memoryStatus={memoryStatus}
        messages={messages}
        messagesContainerRef={panel.messagesContainerRef}
        onDownloadArtifact={(artifact) => void handleArtifactDownload(artifact)}
        onInputChange={panel.setInputValue}
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
        onToggleSidebar={() => panel.setIsSidebarOpen(!panel.isSidebarOpen)}
        projectId={project.id}
        quickPrompts={quickPrompts}
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
        onSuccess={() => onProjectUpdate()}
        projectId={project.id}
      />

      <ProjectChatSaveModal
        conversationId={activeConvId}
        files={files || []}
        folders={folders || []}
        isOpen={panel.conversationSaveModalOpen}
        onClose={panel.closeConversationSaveModal}
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
    </div>
  );
}
