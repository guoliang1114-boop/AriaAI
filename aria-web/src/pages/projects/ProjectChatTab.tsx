import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext";
import type { Project, ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatExportDropdown } from "./ProjectChatExportDropdown";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
import { ProjectChatMessages } from "./ProjectChatMessages";
import { ProjectChatSaveModal } from "./ProjectChatSaveModal";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import {
  getProjectChatCopy,
  getProjectQuickPrompts,
} from "./projectChatCopy";
import { useProjectChatComposer } from "./useProjectChatComposer";
import { useProjectChatConversations } from "./useProjectChatConversations";

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
  const [knowledgeScope, setKnowledgeScope] = useState<"project" | "client" | "global">("project");
  const [inputValue, setInputValue] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveMessageId, setSaveMessageId] = useState<number | null>(null);
  const [conversationSaveModalOpen, setConversationSaveModalOpen] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = (smooth = true) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

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
  const { isLoading, streamingContent, resetStreamingContent, sendMessage } = useProjectChatComposer({
    projectId: project.id,
    activeConvId,
    knowledgeScope,
    setMessages,
    createConversation,
    fetchMessages,
    fetchConversations,
    isNearBottomRef,
    scrollToBottom,
    onSendError: () => toast.error(copy.sendFailed),
  });

  useEffect(() => {
    resetStreamingContent();
  }, [activeConvId]);

  useEffect(() => {
    if (messages.length > 0 && isNearBottomRef.current) scrollToBottom(true);
  }, [messages]);

  useEffect(() => {
    if (streamingContent && isNearBottomRef.current) scrollToBottom(false);
  }, [streamingContent]);

  const openSaveModal = (messageId: number) => {
    setSaveMessageId(messageId);
    setSaveModalOpen(true);
  };

  const openConversationSaveModal = () => {
    setConversationSaveModalOpen(true);
  };

  return (
    <div className="h-full bg-white rounded-xl border border-gray-200 flex overflow-hidden">
      <ProjectChatSidebar
        isOpen={isSidebarOpen}
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

      <div className="flex-1 flex flex-col min-w-0">
        <ProjectChatHeader
          isSidebarOpen={isSidebarOpen}
          title={activeConversation?.title || copy.projectAssistantTitle}
          subtitle={copy.projectAssistantSubtitle}
          knowledgeScope={knowledgeScope}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onKnowledgeScopeChange={setKnowledgeScope}
          exportControl={
            activeConversation?.id ? (
              <ProjectChatExportDropdown
                conversationId={activeConversation.id}
                conversationTitle={activeConversation.title}
                onOpenSaveModal={openConversationSaveModal}
              />
            ) : undefined
          }
        />

        <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
          <ProjectChatMessages
            messages={messages}
            streamingContent={streamingContent}
            isLoading={isLoading}
            isLoadingMessages={isLoadingMessages}
            startConversationLabel={copy.startConversation}
            choosePromptLabel={copy.choosePromptOrAsk}
            thinkingLabel={copy.thinking}
            quickPrompts={quickPrompts}
            onQuickPrompt={(content) => {
              void sendMessage(content);
            }}
            onSaveMessage={openSaveModal}
          />
        </div>

        <ProjectChatInput
          value={inputValue}
          isLoading={isLoading}
          placeholder={copy.inputPlaceholder}
          onChange={setInputValue}
          onSend={() => {
            const content = inputValue;
            setInputValue("");
            void sendMessage(content);
          }}
        />
      </div>

      <ProjectChatSaveModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        projectId={project.id}
        messageId={saveMessageId}
        files={files || []}
        folders={folders || []}
        onSuccess={() => onProjectUpdate()}
      />

      <ProjectChatSaveModal
        isOpen={conversationSaveModalOpen}
        onClose={() => setConversationSaveModalOpen(false)}
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
