import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  ChevronDown,
  Download,
  FileText,
  Loader2,
} from "lucide-react";
import { api } from "../../api/client";
import { exportConversationFile } from "../../api/chatExport";
import { useToast } from "../../contexts/ToastContext";
import type { Project, ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
import { ProjectChatMessages } from "./ProjectChatMessages";
import { ProjectChatSaveModal } from "./ProjectChatSaveModal";
import { ProjectChatSidebar } from "./ProjectChatSidebar";
import {
  DEFAULT_NEW_CHAT_TITLE_EN,
  DEFAULT_NEW_CHAT_TITLE_ZH,
  QUICK_PROMPTS,
  getProjectChatCopy,
} from "./projectChatCopy";
import { useProjectChatComposer } from "./useProjectChatComposer";
import { useProjectChatConversations } from "./useProjectChatConversations";

const ExportDropdown = memo<{
  conversationId: number;
  conversationTitle?: string;
  onOpenSaveModal?: () => void;
}>(({ conversationId, conversationTitle, onOpenSaveModal }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleExport = async (format: "markdown" | "pdf") => {
    setIsExporting(true);
    try {
      await exportConversationFile(conversationId, format, conversationTitle || "conversation");
      setIsOpen(false);
    } catch (err) {
      console.error("Export failed:", err);
      alert(t("chat.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToProject = () => {
    if (!onOpenSaveModal) return;
    onOpenSaveModal();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">{t("chat.export")}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          <button
            onClick={() => handleExport("markdown")}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-4 h-4 text-gray-400" />
            {t("chat.exportMarkdown")}
          </button>
          <button
            onClick={() => handleExport("pdf")}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-4 h-4 text-red-400" />
            {t("chat.exportPDF")}
          </button>
          {onOpenSaveModal && (
            <button
              onClick={handleSaveToProject}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <BookOpen className="w-4 h-4 text-emerald-500" />
              {t("projects.saveConversationToProject", "Save to project")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

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
        newChatLabel={copy.newChatButton}
        emptyLabel={copy.noConversations}
        draftTitleLabel={isZh ? DEFAULT_NEW_CHAT_TITLE_ZH : DEFAULT_NEW_CHAT_TITLE_EN}
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
          knowledgeScopeLabel={copy.knowledgeScope}
          knowledgeScope={knowledgeScope}
          currentProjectLabel={copy.currentProject}
          currentClientLabel={copy.currentClient}
          globalKnowledgeLabel={copy.globalKnowledge}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onKnowledgeScopeChange={setKnowledgeScope}
          exportControl={
            activeConversation?.id ? (
              <ExportDropdown
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
            isZh={isZh}
            startConversationLabel={copy.startConversation}
            choosePromptLabel={copy.choosePromptOrAsk}
            thinkingLabel={copy.thinking}
            quickPrompts={QUICK_PROMPTS}
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
