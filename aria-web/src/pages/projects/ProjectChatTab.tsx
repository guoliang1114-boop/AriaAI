import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  FileText,
  FolderKanban,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Flag,
  Wrench,
  X,
  Save,
} from "lucide-react";
import { api } from "../../api/client";
import { exportConversationFile } from "../../api/chatExport";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useToast } from "../../contexts/ToastContext";
import { getApiBaseUrl } from "../../config/api";
import type { Conversation, Message, Project, ProjectFile, ProjectFolder } from "../../types/api";

type ChatMessage = Message;

const QUICK_PROMPTS = [
  { key: "summary", icon: FileText, labelZh: "总结项目", labelEn: "Summarize Project" },
  { key: "milestones", icon: Flag, labelZh: "分析里程碑", labelEn: "Analyze Milestones" },
  { key: "risks", icon: AlertCircle, labelZh: "识别风险", labelEn: "Identify Risks" },
  { key: "documents", icon: FolderKanban, labelZh: "文档问答", labelEn: "Document Q&A" },
];
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
              {t("projects.saveConversationToProject", "沉淀到项目文档")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const MessageCopyButton = memo(({ text }: { text: string }) => {
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
      title="复制内容"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
});

const MessageSaveButton = memo(({ onClick }: { onClick: () => void }) => {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
      title="保存到笔记"
    >
      <Save className="w-3.5 h-3.5" />
    </button>
  );
});

const ChatMessageBubble = memo<{ msg: ChatMessage; onSaveToNotes?: () => void }>(({ msg, onSaveToNotes }) => {
  const { t } = useTranslation();
  const isUser = msg.role === "user";

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
          <span className="text-[10px] font-semibold text-gray-500">{t("chat.you", "你")}</span>
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-white" />
        )}
      </div>

      <div className={`flex-1 flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        <p className="text-[11px] font-medium text-gray-400 mb-1.5 px-0.5">
          {isUser ? t("chat.you", "你") : "Aria"}
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
          {!isUser && <MessageCopyButton text={msg.content} />}
          {!isUser && onSaveToNotes && <MessageSaveButton onClick={onSaveToNotes} />}
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

function buildDefaultTitle(content: string, isZh: boolean) {
  const clean = content.replace(/[#*`\[\]]/g, "").trim();
  if (!clean) return isZh ? "新对话" : "New Chat";
  return clean.slice(0, 15) + (clean.length > 15 ? "..." : "");
}

function SaveToNotesModal({
  isOpen,
  onClose,
  projectId,
  messageId,
  conversationId,
  files,
  folders,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  messageId?: number | null;
  conversationId?: number | null;
  files: ProjectFile[];
  folders: ProjectFolder[];
  onSuccess: () => void;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [action, setAction] = useState<"merge" | "new">("merge");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);

  const mdFiles = useMemo(() => files.filter((f) => f.file_type?.toLowerCase() === "md"), [files]);
  const isConversationMode = !!conversationId;

  const filesInSelectedFolder = useMemo(() => {
    return mdFiles.filter((f) => (selectedFolderId == null ? f.folder_id == null : f.folder_id === selectedFolderId));
  }, [mdFiles, selectedFolderId]);

  useEffect(() => {
    if (isOpen) {
      setAction("merge");
      setSelectedFolderId(null);
      setSelectedFileId(null);
      setFileName(isZh ? "对话沉淀.md" : "chat-note.md");
      setLoading(false);
    }
  }, [isOpen, isZh]);

  // Auto-select first file when folder changes in merge mode
  useEffect(() => {
    if (action === "merge") {
      setSelectedFileId(filesInSelectedFolder[0]?.id ?? null);
    }
  }, [filesInSelectedFolder, action]);

  if (!isOpen) return null;
  if (!messageId && !conversationId) return null;

  const handleSubmit = async () => {
    if (action === "merge" && !selectedFileId) {
      toast.error(isZh ? "请选择一个笔记文件" : "Please select a note file");
      return;
    }
    if (action === "new" && !fileName.trim()) {
      toast.error(isZh ? "请输入文件名" : "Please enter a file name");
      return;
    }
    setLoading(true);
    try {
      if (conversationId) {
        await api.post(`/projects/${projectId}/conversations/${conversationId}/save-markdown`, {
          action,
          file_id: selectedFileId,
          file_name: fileName.trim(),
          folder_id: selectedFolderId,
        });
      } else {
        await api.post(`/projects/${projectId}/messages/${messageId}/save-to-document`, {
          action,
          file_id: selectedFileId,
          file_name: fileName.trim(),
          folder_id: selectedFolderId,
          prepend_header: true,
        });
      }
      toast.success(action === "merge" ? (isZh ? "已合并到笔记" : "Merged into note") : (isZh ? "已保存为新笔记" : "Saved as new note"));
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || (isZh ? "保存失败" : "Failed to save");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{isZh ? "保存到笔记" : "Save to Notes"}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Action tabs */}
          <div className="flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => setAction("merge")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                action === "merge" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {isZh ? "合并到现有笔记" : "Merge into existing"}
            </button>
            <button
              onClick={() => setAction("new")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                action === "new" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {isZh ? "另存为新笔记" : "Save as new"}
            </button>
          </div>

          {/* Folder selection (shared) */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {isZh ? "选择文件夹" : "Select folder"}
            </label>
            <div className="max-h-32 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              <label
                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedFolderId === null ? "bg-primary/5" : ""
                }`}
              >
                <input
                  type="radio"
                  name="folder"
                  checked={selectedFolderId === null}
                  onChange={() => setSelectedFolderId(null)}
                  className="accent-primary"
                />
                <FolderKanban className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-800">{isZh ? "根目录" : "Root"}</span>
              </label>
              {folders.map((folder) => (
                <label
                  key={folder.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedFolderId === folder.id ? "bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="folder"
                    checked={selectedFolderId === folder.id}
                    onChange={() => setSelectedFolderId(folder.id)}
                    className="accent-primary"
                  />
                  <FolderKanban className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <span className="text-sm text-gray-800 truncate">{folder.name}</span>
                </label>
              ))}
            </div>
          </div>

          {action === "merge" ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                {isZh ? "选择要合并的笔记文件" : "Select note file to merge into"}
              </label>
              {filesInSelectedFolder.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">
                  {isZh ? "该文件夹下暂无可用的笔记文件" : "No note files in this folder"}
                </p>
              ) : (
                <div className="max-h-40 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {filesInSelectedFolder.map((file) => (
                    <label
                      key={file.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedFileId === file.id ? "bg-primary/5" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="file"
                        checked={selectedFileId === file.id}
                        onChange={() => setSelectedFileId(file.id)}
                        className="accent-primary"
                      />
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-gray-800 truncate">{file.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                {isZh ? "新笔记文件名" : "New note file name"}
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder={isZh ? "例如：需求分析.md" : "e.g. requirements.md"}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-gray-400">{isZh ? "将自动补充 .md 后缀" : ".md extension will be added automatically"}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (action === "merge" && filesInSelectedFolder.length === 0)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isZh ? "确认保存" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const toast = useToast();
  const [knowledgeScope, setKnowledgeScope] = useState<"project" | "client" | "global">("project");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [streamingContent, setStreamingContent] = useState("");
  const [editingConvId, setEditingConvId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveMessageId, setSaveMessageId] = useState<number | null>(null);
  const [conversationSaveModalOpen, setConversationSaveModalOpen] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const skipNextFetchRef = useRef(false);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    void fetchConversations();
  }, [project.id]);

  useEffect(() => {
    if (activeConvId) {
      if (skipNextFetchRef.current) {
        skipNextFetchRef.current = false;
        return;
      }
      setMessages([]);
      setStreamingContent("");
      void fetchMessages(activeConvId);
    } else {
      setMessages([]);
      setStreamingContent("");
    }
  }, [activeConvId]);

  useEffect(() => {
    if (messages.length > 0 && isNearBottomRef.current) scrollToBottom(true);
  }, [messages]);

  useEffect(() => {
    if (streamingContent && isNearBottomRef.current) scrollToBottom(false);
  }, [streamingContent]);

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

  const fetchConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const data = await api.get<Conversation[]>(`/chat/conversations?project_id=${project.id}`);
      setConversations(data);
      if (data.length > 0 && !activeConvId) setActiveConvId(data[0].id);
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const fetchMessages = async (convId: number) => {
    setIsLoadingMessages(true);
    try {
      const data = await api.get<ChatMessage[]>(`/chat/conversations/${convId}/messages`);
      setMessages(data);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const createConversation = async (firstMessage?: string) => {
    try {
      const title = buildDefaultTitle(firstMessage || "", isZh);
      const newConv = await api.post<Conversation>("/chat/conversations", {
        project_id: project.id,
        title,
      });
      setConversations((prev) => [newConv, ...prev]);
      skipNextFetchRef.current = true;
      setActiveConvId(newConv.id);
      return newConv.id;
    } catch (error) {
      console.error("Failed to create conversation:", error);
      toast.error(isZh ? "创建对话失败" : "Failed to create conversation");
      return null;
    }
  };

  const deleteConversation = async (convId: number) => {
    if (!confirm(isZh ? "确定要删除这个对话吗？" : "Are you sure you want to delete this conversation?")) return;
    try {
      await api.delete(`/chat/conversations/${convId}`);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
        setStreamingContent("");
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      toast.error(isZh ? "删除失败" : "Failed to delete");
    }
  };

  const renameConversation = async (convId: number, newTitle: string) => {
    const title = newTitle.trim();
    if (!title) {
      setEditingConvId(null);
      return;
    }
    try {
      await api.patch(`/chat/conversations/${convId}`, { title });
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)));
      setEditingConvId(null);
    } catch (error) {
      console.error("Failed to rename conversation:", error);
      toast.error(isZh ? "重命名失败" : "Failed to rename");
    }
  };

  const saveConversationToProject = async () => {
    if (!activeConvId) return;
    try {
      await api.post(`/projects/${project.id}/conversations/${activeConvId}/save-markdown`, {});
      await onProjectUpdate();
      toast.success(isZh ? "已沉淀到项目文档根目录" : "Saved to project documents (root)");
    } catch (error: any) {
      console.error("Failed to save conversation to project:", error);
      const detail = error?.response?.data?.detail;
      toast.error(detail || (isZh ? "沉淀失败" : "Failed to save to project"));
      throw error;
    }
  };

  const openSaveModal = (messageId: number) => {
    setSaveMessageId(messageId);
    setSaveModalOpen(true);
  };

  const openConversationSaveModal = () => {
    setConversationSaveModalOpen(true);
  };

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    let convId = activeConvId;
    setInputValue("");
    setIsLoading(true);
    setStreamingContent("");

    if (!convId) {
      convId = await createConversation(trimmed);
      if (!convId) {
        setIsLoading(false);
        return;
      }
    }

    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      conversation_id: convId,
      role: "user",
      content: trimmed,
      metadata_json: "{}",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    isNearBottomRef.current = true;
    setTimeout(() => scrollToBottom(true), 0);

    try {
      const response = await fetch(`${getApiBaseUrl()}/chat/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": localStorage.getItem("authToken") || "",
        },
        body: JSON.stringify({
          conversation_id: convId,
          content: trimmed,
          project_id: project.id,
          knowledge_scope: knowledgeScope,
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const line = event
            .split("\n")
            .map((item) => item.trim())
            .find((item) => item.startsWith("data: "));
          if (!line) continue;

          try {
            const payload = JSON.parse(line.replace(/^data:\s*/, ""));
            if ((payload.type === "text" || payload.type === "chunk") && payload.content) {
              fullContent += payload.content;
              setStreamingContent(fullContent);
            } else if (payload.type === "error") {
              throw new Error(payload.message || payload.error || "Chat failed");
            }
          } catch (error) {
            console.error("Failed to parse stream event:", error);
          }
        }
      }

      setStreamingContent("");
      await fetchMessages(convId);
      await fetchConversations();
    } catch (error) {
      console.error("Failed to send message:", error);
      setStreamingContent("");
      toast.error(isZh ? "发送失败，请重试" : "Failed to send message");
      await fetchMessages(convId);
    } finally {
      setIsLoading(false);
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="h-full bg-white rounded-xl border border-gray-200 flex overflow-hidden">
      <div
        className={`${isSidebarOpen ? "w-64" : "w-0"} border-r border-gray-200 bg-gray-50/50 flex flex-col transition-all duration-300 ${isSidebarOpen ? "" : "overflow-hidden"}`}
      >
        <div className="p-4 border-b border-gray-100 bg-white">
          <button
            onClick={() => {
              setActiveConvId(null);
              setMessages([]);
              setStreamingContent("");
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {isZh ? "新建对话" : "New Chat"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {activeConvId === null && (
            <div className="flex items-center gap-2 p-2.5 bg-white rounded-lg border border-primary/20 shadow-sm">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              </div>
              <p className="text-sm font-medium text-gray-900 truncate">{isZh ? "新对话" : "New Chat"}</p>
            </div>
          )}

          {isLoadingConversations ? (
            <div className="p-2 space-y-2 animate-pulse">
              {[80, 60, 70, 55].map((w, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5">
                  <div className="w-6 h-6 rounded bg-gray-200 flex-shrink-0" />
                  <div className="h-3 bg-gray-200 rounded-full" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          ) : conversations.length === 0 && activeConvId !== null ? (
            <div className="p-4 text-center text-gray-400 text-sm">{isZh ? "暂无对话" : "No conversations yet"}</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`group flex items-center gap-2 p-2.5 cursor-pointer rounded-lg transition-all ${
                  activeConvId === conv.id
                    ? "bg-white shadow-sm border border-gray-200"
                    : "hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200"
                }`}
              >
                <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${activeConvId === conv.id ? "bg-primary/10" : "bg-gray-100 group-hover:bg-primary/5"}`}>
                  <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${activeConvId === conv.id ? "text-primary" : "text-gray-400 group-hover:text-primary/60"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  {editingConvId === conv.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameConversation(conv.id, editTitle);
                        else if (e.key === "Escape") setEditingConvId(null);
                      }}
                      onBlur={() => renameConversation(conv.id, editTitle)}
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary/20"
                      autoFocus
                    />
                  ) : (
                    <p className={`text-sm truncate ${activeConvId === conv.id ? "font-medium text-gray-900" : "text-gray-600"}`}>
                      {conv.title}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingConvId(conv.id);
                      setEditTitle(conv.title);
                    }}
                    className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConversation(conv.id);
                    }}
                    className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Bot className="w-5 h-5 text-primary" />
            </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-base">
              {activeConversation?.title || (isZh ? "项目 AI 助手" : "Project AI Assistant")}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {isZh ? "基于项目上下文提供智能建议" : "Smart suggestions based on project context"}
            </p>
          </div>
        </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2">
              <span className="text-xs text-gray-400">{isZh ? "知识范围" : "Knowledge Scope"}</span>
              <select
                value={knowledgeScope}
                onChange={(event) => setKnowledgeScope(event.target.value as "project" | "client" | "global")}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="project">{isZh ? "仅当前项目" : "Current Project"}</option>
                <option value="client">{isZh ? "当前客户" : "Current Client"}</option>
                <option value="global">{isZh ? "全局知识库" : "Global Knowledge"}</option>
              </select>
            </div>
            {activeConversation?.id && (
              <ExportDropdown
                conversationId={activeConversation.id}
                conversationTitle={activeConversation.title}
                onOpenSaveModal={openConversationSaveModal}
              />
            )}
          </div>
        </div>

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
              <p className="text-base font-semibold text-gray-900 mb-2">{isZh ? "开始对话" : "Start a conversation"}</p>
              <p className="text-sm text-gray-500 mb-6 max-w-xs text-center">
                {isZh ? "选择下方快捷场景或直接输入问题" : "Choose a quick prompt below or type your question"}
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt.key}
                    onClick={() => void sendMessage(isZh ? prompt.labelZh : prompt.labelEn)}
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
                      <span className="text-sm text-gray-500">{isZh ? "思考中..." : "Thinking..."}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 bg-white">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(inputValue);
                  }
                }}
                placeholder={isZh ? "输入消息... (Shift+Enter 换行)" : "Type a message... (Shift+Enter for new line)"}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 resize-none min-h-[48px] max-h-[120px] transition-all"
                rows={1}
                style={{ height: "auto" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${target.scrollHeight}px`;
                }}
              />
            </div>
            <button
              onClick={() => void sendMessage(inputValue)}
              disabled={!inputValue.trim() || isLoading}
              className="p-3 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      <SaveToNotesModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        projectId={project.id}
        messageId={saveMessageId}
        files={files || []}
        folders={folders || []}
        onSuccess={() => onProjectUpdate()}
      />

      <SaveToNotesModal
        isOpen={conversationSaveModalOpen}
        onClose={() => setConversationSaveModalOpen(false)}
        projectId={project.id}
        conversationId={activeConvId}
        files={files || []}
        folders={folders || []}
        onSuccess={() => onProjectUpdate()}
      />
    </div>
  );
}
