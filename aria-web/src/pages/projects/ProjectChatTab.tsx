import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type {
  GeneratedArtifact,
  Project,
  ProjectFile,
  ProjectFolder,
} from "../../types/api";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatMainPanel } from "./ProjectChatMainPanel";
import { ProjectChatSaveModal } from "./ProjectChatSaveModal";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import { downloadArtifact } from "./downloadArtifact";
import { getProjectChatCopy, getProjectQuickPrompts } from "./projectChatCopy";
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
  const toast = useToast();

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

  const handleArtifactDownload = async (artifact: GeneratedArtifact) => {
    try {
      await downloadArtifact({ artifact });
    } catch (error) {
      console.error("Failed to download artifact:", error);
      toast.error(isZh ? "生成物下载失败" : "Artifact download failed");
    }
  };

  useEffect(() => {
    resetStreamingContent();
  }, [activeConvId, resetStreamingContent]);

  useEffect(() => {
    if (messages.length > 0 && panel.isNearBottomRef.current) {
      panel.scrollToBottom(true);
    }
  }, [messages.length, panel]);

  useEffect(() => {
    if (streamingContent && panel.isNearBottomRef.current) {
      panel.scrollToBottom(false);
    }
  }, [panel, streamingContent]);

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
        isLoadingMessages={isLoadingMessages}
        isSidebarOpen={panel.isSidebarOpen}
        knowledgeScope={panel.knowledgeScope}
        messages={messages}
        messagesContainerRef={panel.messagesContainerRef}
        onDownloadArtifact={(artifact) => void handleArtifactDownload(artifact)}
        onInputChange={panel.setInputValue}
        onKnowledgeScopeChange={panel.setKnowledgeScope}
        onOpenConversationSaveModal={panel.openConversationSaveModal}
        onQuickPrompt={(content) => {
          void sendMessage(content);
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
