import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { Project, ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatMainPanel } from "./ProjectChatMainPanel";
import { ProjectChatSaveModal } from "./ProjectChatSaveModal";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import {
  getProjectChatCopy,
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

  const { isLoading, streamingContent, resetStreamingContent, sendMessage } = useProjectChatComposer({
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
    <div className="h-full bg-white rounded-xl border border-gray-200 flex overflow-hidden">
      <ProjectChatSidebar
        isOpen={panel.isSidebarOpen}
        activeConvId={activeConvId}
        conversations={conversations}
        isLoadingConversations={isLoadingConversations}
        editingConvId={editingConvId}
        editTitle={editTitle}
        onStartNewChat={startNewChat}
        onSelectConversation={setActiveConvId}
        onBeginRename={beginRenameConversation}
        onRenameTitleChange={setEditTitle}
        onRenameSubmit={renameConversation}
        onCancelRename={() => setEditingConvId(null)}
        onDeleteConversation={openDeleteConversationDialog}
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
        onInputChange={panel.setInputValue}
        onKnowledgeScopeChange={panel.setKnowledgeScope}
        onOpenConversationSaveModal={panel.openConversationSaveModal}
        onQuickPrompt={(content) => {
          void sendMessage(content);
        }}
        onSaveMessage={panel.openSaveModal}
        onSend={() => panel.handleSend(sendMessage)}
        onToggleSidebar={() => panel.setIsSidebarOpen(!panel.isSidebarOpen)}
        quickPrompts={quickPrompts}
        startConversationLabel={copy.startConversation}
        streamingContent={streamingContent}
        subtitle={copy.projectAssistantSubtitle}
        thinkingLabel={copy.thinking}
        title={activeConversation?.title || copy.projectAssistantTitle}
      />

      <ProjectChatSaveModal
        isOpen={panel.saveModalOpen}
        onClose={panel.closeSaveModal}
        projectId={project.id}
        messageId={panel.saveMessageId}
        files={files || []}
        folders={folders || []}
        onSuccess={() => onProjectUpdate()}
      />

      <ProjectChatSaveModal
        isOpen={panel.conversationSaveModalOpen}
        onClose={panel.closeConversationSaveModal}
        projectId={project.id}
        conversationId={activeConvId}
        files={files || []}
        folders={folders || []}
        onSuccess={() => onProjectUpdate()}
      />

      <ProjectChatDeleteDialog
        isOpen={!!conversationPendingDelete}
        conversationTitle={conversationPendingDelete?.title}
        isDeleting={isDeletingConversation}
        onCancel={closeDeleteConversationDialog}
        onConfirm={() => {
          if (!conversationPendingDelete) return;
          void deleteConversation(conversationPendingDelete.id);
        }}
      />
    </div>
  );
}
