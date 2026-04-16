import { AlertCircle, FileText, Flag, FolderKanban, type LucideIcon } from "lucide-react";

export const DEFAULT_NEW_CHAT_TITLE_ZH = "新对话";
export const DEFAULT_NEW_CHAT_TITLE_EN = "New Chat";
export const DEFAULT_PROJECT_NOTE_FILENAME_ZH = "对话沉淀.md";
export const DEFAULT_PROJECT_NOTE_FILENAME_EN = "chat-note.md";

export const PROJECT_CHAT_COPY = {
  zh: {
    saveToProject: "沉淀到项目文档",
    copyContent: "复制内容",
    saveToNotes: "保存到笔记",
    selectNoteFile: "请选择一个笔记文件",
    enterFileName: "请输入文件名",
    mergedIntoNote: "已合并到笔记",
    savedAsNewNote: "已保存为新笔记",
    saveFailed: "保存失败",
    mergeIntoExisting: "合并到现有笔记",
    saveAsNew: "另存为新笔记",
    selectFolder: "选择文件夹",
    rootFolder: "根目录",
    selectMergeTarget: "选择要合并的笔记文件",
    noNoteFiles: "该文件夹下暂无可用的笔记文件",
    newNoteFileName: "新笔记文件名",
    newNoteFilePlaceholder: "例如：需求分析.md",
    autoAppendMd: "将自动补全 .md 后缀",
    cancel: "取消",
    confirmSave: "确认保存",
    createConversationFailed: "创建对话失败",
    deleteConversationConfirm: "确定要删除这个对话吗？",
    deleteConversationFailed: "删除失败",
    renameConversationFailed: "重命名失败",
    savedToProjectRoot: "已沉淀到项目文档根目录",
    saveToProjectFailed: "沉淀失败",
    sendFailed: "发送失败，请重试",
    newChatButton: "新建对话",
    noConversations: "暂无对话",
    projectAssistantTitle: "项目 AI 助手",
    projectAssistantSubtitle: "基于项目上下文提供智能建议",
    knowledgeScope: "知识范围",
    currentProject: "仅当前项目",
    currentClient: "当前客户",
    globalKnowledge: "全局知识库",
    startConversation: "开始对话",
    choosePromptOrAsk: "选择下方快捷场景或直接输入问题",
    thinking: "思考中...",
    inputPlaceholder: "输入消息... (Shift+Enter 换行)",
  },
  en: {
    saveToProject: "Save to project docs",
    copyContent: "Copy content",
    saveToNotes: "Save to Notes",
    selectNoteFile: "Please select a note file",
    enterFileName: "Please enter a file name",
    mergedIntoNote: "Merged into note",
    savedAsNewNote: "Saved as new note",
    saveFailed: "Failed to save",
    mergeIntoExisting: "Merge into existing",
    saveAsNew: "Save as new",
    selectFolder: "Select folder",
    rootFolder: "Root",
    selectMergeTarget: "Select note file to merge into",
    noNoteFiles: "No note files in this folder",
    newNoteFileName: "New note file name",
    newNoteFilePlaceholder: "e.g. requirements.md",
    autoAppendMd: ".md extension will be added automatically",
    cancel: "Cancel",
    confirmSave: "Save",
    createConversationFailed: "Failed to create conversation",
    deleteConversationConfirm: "Are you sure you want to delete this conversation?",
    deleteConversationFailed: "Failed to delete",
    renameConversationFailed: "Failed to rename",
    savedToProjectRoot: "Saved to project documents (root)",
    saveToProjectFailed: "Failed to save to project",
    sendFailed: "Failed to send message",
    newChatButton: "New Chat",
    noConversations: "No conversations yet",
    projectAssistantTitle: "Project AI Assistant",
    projectAssistantSubtitle: "Smart suggestions based on project context",
    knowledgeScope: "Knowledge Scope",
    currentProject: "Current Project",
    currentClient: "Current Client",
    globalKnowledge: "Global Knowledge",
    startConversation: "Start a conversation",
    choosePromptOrAsk: "Choose a quick prompt below or type your question",
    thinking: "Thinking...",
    inputPlaceholder: "Type a message... (Shift+Enter for new line)",
  },
} as const;

export type ProjectQuickPrompt = {
  key: string;
  icon: LucideIcon;
  labelZh: string;
  labelEn: string;
};

export const QUICK_PROMPTS: ProjectQuickPrompt[] = [
  { key: "summary", icon: FileText, labelZh: "总结项目", labelEn: "Summarize Project" },
  { key: "milestones", icon: Flag, labelZh: "分析里程碑", labelEn: "Analyze Milestones" },
  { key: "risks", icon: AlertCircle, labelZh: "识别风险", labelEn: "Identify Risks" },
  { key: "documents", icon: FolderKanban, labelZh: "文档问答", labelEn: "Document Q&A" },
];

export function getProjectChatCopy(isZh: boolean) {
  return isZh ? PROJECT_CHAT_COPY.zh : PROJECT_CHAT_COPY.en;
}

export function buildDefaultChatTitle(content: string, isZh: boolean) {
  const clean = content.replace(/[#*`\[\]]/g, "").trim();
  if (!clean) return isZh ? DEFAULT_NEW_CHAT_TITLE_ZH : DEFAULT_NEW_CHAT_TITLE_EN;
  return clean.slice(0, 15) + (clean.length > 15 ? "..." : "");
}
