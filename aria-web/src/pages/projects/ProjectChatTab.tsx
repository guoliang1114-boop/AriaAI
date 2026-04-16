import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Loader2,
  Send,
  Sparkles,
  Wrench,
  Save,
} from "lucide-react";
import { api } from "../../api/client";
import { exportConversationFile } from "../../api/chatExport";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useToast } from "../../contexts/ToastContext";
import type { Message, Project, ProjectFile, ProjectFolder } from "../../types/api";
import { ProjectChatDeleteDialog } from "./ProjectChatDeleteDialog";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
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

type ChatMessage = Message;

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

const MessageCopyButton = memo(({ text, title }: { text: string; title: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
      title={title}
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
});

const MessageSaveButton = memo(({ onClick, title }: { onClick: () => void; title: string }) => {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
      title={title}
    >
      <Save className="w-3.5 h-3.5" />
    </button>
  );
});

const ChatMessageBubble = memo<{ msg: ChatMessage; onSaveToNotes?: () => void }>(({ msg, onSaveToNotes }) => {
  const { t, i18n } = useTranslation();
  const isUser = msg.role === "user";
  const copy = getProjectChatCopy(i18n.language.startsWith("zh"));

  let references: Array<{ type: string; id: number; title: string }> = [];
  try {
    references = JSON.parse(msg.metadata_json || "{}").references || [];
  } catch {
    references = [];
  }

  return (
    <div className={`flex items-start gap-3.5 group ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
          isUser ? "bg-gray-200" : "bg-gradient-to-br from-primary to-indigo-500 shadow-sm shadow-primary/20"
        }`}
      >
        {isUser ? (
          <span className="text-[10px] font-semibold text-gray-500">{t("chat.you", "You")}</span>
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-white" />
        )}
      </div>

      <div className={`flex-1 flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        <p className="text-[11px] font-medium text-gray-400 mb-1.5 px-0.5">
          {isUser ? t("chat.you", "You") : "Aria"}
        </p>

        <div
          className={`max-w-[85%] ${
            isUser
              ? "px-4 py-2.5 bg-gray-900 text-white rounded-2xl rounded-tr-sm text-[15px] leading-[1.7]"
              : "text-[15px] leading-[1.8] text-gray-700"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <div className="md-root">
              <MarkdownRenderer content={msg.content} />
            </div>
          )}
        </div>

        {!isUser && references.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {references.map((ref, i) => (
              <span
                key={`${ref.type}-${ref.id}-${i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-[11px] text-gray-500 border border-gray-200"
              >
                {ref.type === "skill" && <Wrench className="w-3 h-3" />}
                {ref.type === "doc" && <BookOpen className="w-3 h-3" />}
                {ref.type === "file" && <FileText className="w-3 h-3" />}
                {ref.title}
              </span>
            ))}
          </div>
        )}

        <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 ${isUser ? "flex-row-reverse" : ""}`}>
          <span className="text-[11px] text-gray-300 px-0.5">
            {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isUser && <MessageCopyButton text={msg.content} title={copy.copyContent} />}
          {!isUser && onSaveToNotes && <MessageSaveButton onClick={onSaveToNotes} title={copy.saveToNotes} />}
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.msg.id === next.msg.id && prev.msg.content === next.msg.content && prev.onSaveToNotes === next.onSaveToNotes);

const ChatStreamingMessage = memo<{ content: string }>(({ content }) => {
  const renderedContent = useMemo(() => <MarkdownRenderer content={content} />, [content]);

  return (
    <div className="flex items-start gap-3.5">
      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-gradient-to-br from-primary to-indigo-500 shadow-sm shadow-primary/20">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 flex flex-col items-start">
        <p className="text-[11px] font-medium text-gray-400 mb-1.5 px-0.5">Aria</p>
        <div className="max-w-[85%] text-[15px] leading-[1.8] text-gray-700">
          <div className="md-root">
            {renderedContent}
            <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse rounded-sm" />
          </div>
        </div>
      </div>
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
          {isLoadingMessages && (
            <div className="space-y-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded-full w-3/4" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/2" />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <div className="flex-1 space-y-2 flex flex-col items-end">
                  <div className="h-3 bg-gray-200 rounded-full w-2/3" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/3" />
                </div>
                <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
              </div>
            </div>
          )}

          {messages.length === 0 && !streamingContent && !isLoading && !isLoadingMessages && (
            <div className="h-full flex flex-col items-center justify-center text-gray-500">
              <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center mb-4 border border-primary/10">
                <Bot className="w-8 h-8 text-primary/40" />
              </div>
              <p className="text-base font-semibold text-gray-900 mb-2">{copy.startConversation}</p>
              <p className="text-sm text-gray-500 mb-6 max-w-xs text-center">
                {copy.choosePromptOrAsk}
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt.key}
                    onClick={() => {
                      void sendMessage(isZh ? prompt.labelZh : prompt.labelEn);
                    }}
                    className="flex items-center gap-2 p-3 bg-white border border-gray-200 hover:border-primary/30 hover:bg-primary/5 rounded-xl text-left transition-all shadow-sm hover:shadow"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <prompt.icon className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-gray-700">{isZh ? prompt.labelZh : prompt.labelEn}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isLoadingMessages && (messages.length > 0 || streamingContent || isLoading) && (
            <>
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  msg={msg}
                  onSaveToNotes={msg.role === "assistant" ? () => openSaveModal(msg.id) : undefined}
                />
              ))}
              {streamingContent && <ChatStreamingMessage content={streamingContent} />}
              {isLoading && !streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-sm text-gray-500">{copy.thinking}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
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
