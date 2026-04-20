import {
  AlertCircle,
  FileText,
  Flag,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";

export const PROJECT_CHAT_COPY = {
  zh: {
    defaultNewChatTitle: "新对话",
    defaultProjectNoteFilename: "对话沉淀.md",
    saveToProject: "保存到项目文档",
    copyContent: "复制内容",
    saveToNotes: "保存到笔记",
    saveToMemoryHint: "保存后会标记项目记忆待刷新；如需沉淀到客户记忆，可在项目记忆页继续提升。",
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
    deleteConversationTitle: "删除对话",
    deleteConversationConfirm: "确定要删除这段对话吗？",
    deleteConversationAction: "删除",
    deleteConversationFailed: "删除失败",
    renameConversationFailed: "重命名失败",
    savedToProjectRoot: "已保存到项目文档根目录",
    saveToProjectFailed: "保存到项目失败",
    sendFailed: "发送失败，请重试",
    newChatButton: "新建对话",
    noConversations: "暂无对话",
    projectAssistantTitle: "项目 AI 助手",
    projectAssistantSubtitle: "基于项目上下文提供智能建议",
    knowledgeScope: "知识范围",
    currentProject: "当前项目",
    currentClient: "当前客户",
    globalKnowledge: "全局知识库",
    startConversation: "开始对话",
    choosePromptOrAsk: "选择下方快捷场景，或直接输入你的问题",
    thinking: "思考中...",
    inputPlaceholder: "输入消息...（Shift+Enter 换行）",
    export: "导出",
    exportMarkdown: "导出 Markdown",
    exportPDF: "导出 PDF",
    exportFailed: "导出失败",
    saveConversationToProject: "保存到项目",
    skillLabel: "Skill",
    noSkill: "不使用 Skill",
    loadingSkills: "加载 Skill 中...",
    saveSkillResult: "沉淀结果",
    saveSkillConversation: "沉淀对话",
    enterFullscreen: "全屏",
    exitFullscreen: "退出全屏",
    scrollToBottom: "回到底部",
    followToBottom: "跟随到底部",
    followingBottom: "已跟随",
    quickPromptSummary: "项目概览",
    quickPromptMilestones: "里程碑推进",
    quickPromptRisks: "项目风险",
    quickPromptDocuments: "文档洞察",
  },
  en: {
    defaultNewChatTitle: "New Chat",
    defaultProjectNoteFilename: "chat-note.md",
    saveToProject: "Save to project docs",
    copyContent: "Copy content",
    saveToNotes: "Save to Notes",
    saveToMemoryHint: "Saving marks project memory as stale. Promote it into client memory later from the project memory page if needed.",
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
    deleteConversationTitle: "Delete conversation",
    deleteConversationConfirm: "Are you sure you want to delete this conversation?",
    deleteConversationAction: "Delete",
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
    choosePromptOrAsk: "Choose a quick scenario below or type your question",
    thinking: "Thinking...",
    inputPlaceholder: "Type a message... (Shift+Enter for new line)",
    export: "Export",
    exportMarkdown: "Export Markdown",
    exportPDF: "Export PDF",
    exportFailed: "Export failed",
    saveConversationToProject: "Save to project",
    skillLabel: "Skill",
    noSkill: "No skill",
    loadingSkills: "Loading skills...",
    saveSkillResult: "Save result",
    saveSkillConversation: "Save chat",
    enterFullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    scrollToBottom: "Jump to bottom",
    followToBottom: "Follow bottom",
    followingBottom: "Following",
    quickPromptSummary: "Project Overview",
    quickPromptMilestones: "Milestone Review",
    quickPromptRisks: "Risk Review",
    quickPromptDocuments: "Document Insights",
  },
} as const;

export type ProjectChatCopy =
  (typeof PROJECT_CHAT_COPY)[keyof typeof PROJECT_CHAT_COPY];

export type ProjectQuickPrompt = {
  key: string;
  icon: LucideIcon;
  label: string;
  prompt: string;
};

export type ProjectMemoryQuickAction = {
  key: "overview" | "risk" | "delivery" | "stakeholder";
  label: string;
  prompt: string;
};

export function getProjectChatCopy(isZh: boolean) {
  return isZh ? PROJECT_CHAT_COPY.zh : PROJECT_CHAT_COPY.en;
}

export function getProjectQuickPrompts(isZh: boolean): ProjectQuickPrompt[] {
  const copy = getProjectChatCopy(isZh);
  if (isZh) {
    return [
      {
        key: "summary",
        icon: FileText,
        label: copy.quickPromptSummary,
        prompt:
          "请基于当前项目的结构化记忆，给我一个 5 条以内的项目概览摘要，覆盖当前阶段、关键进展、风险和下一步动作。",
      },
      {
        key: "milestones",
        icon: Flag,
        label: copy.quickPromptMilestones,
        prompt:
          "请基于当前项目的结构化记忆，分析当前里程碑推进情况，指出已经完成的进展、可能延迟的事项，以及接下来最需要推进的里程碑。",
      },
      {
        key: "risks",
        icon: AlertCircle,
        label: copy.quickPromptRisks,
        prompt:
          "请基于当前项目的结构化记忆，识别最重要的项目风险和阻塞点，并给出建议的缓解动作。",
      },
      {
        key: "documents",
        icon: FolderKanban,
        label: copy.quickPromptDocuments,
        prompt:
          "请基于当前项目的结构化记忆和重要文档线索，总结最值得关注的文档洞察，并说明这些文档分别支持了什么判断。",
      },
    ];
  }

  return [
    {
      key: "summary",
      icon: FileText,
      label: copy.quickPromptSummary,
      prompt:
        "Based on the current project's structured memory, give me an overview in no more than 5 bullet points covering stage, progress, risks, and next actions.",
    },
    {
      key: "milestones",
      icon: Flag,
      label: copy.quickPromptMilestones,
      prompt:
        "Based on the current project's structured memory, review milestone progress, call out completed progress, likely delays, and the next milestone that needs attention.",
    },
    {
      key: "risks",
      icon: AlertCircle,
      label: copy.quickPromptRisks,
      prompt:
        "Based on the current project's structured memory, identify the most important project risks and blockers, then suggest practical mitigation actions.",
    },
    {
      key: "documents",
      icon: FolderKanban,
      label: copy.quickPromptDocuments,
      prompt:
        "Based on the current project's structured memory and important document signals, summarize the document insights that matter most and explain what each document supports.",
    },
  ];
}

export function getProjectMemoryQuickActions(isZh: boolean): ProjectMemoryQuickAction[] {
  if (isZh) {
    return [
      {
        key: "overview",
        label: "记忆概览",
        prompt:
          "请基于当前项目的结构化记忆，给我一个简明项目概览，覆盖阶段、核心进展、关键风险和下一步动作。",
      },
      {
        key: "risk",
        label: "风险视角",
        prompt:
          "请基于当前项目的结构化记忆，从风险视角总结最需要管理层注意的问题、潜在阻塞和建议动作。",
      },
      {
        key: "delivery",
        label: "交付视角",
        prompt:
          "请基于当前项目的结构化记忆，从交付视角总结当前推进状态、关键里程碑和最近需要执行的动作。",
      },
      {
        key: "stakeholder",
        label: "干系人视角",
        prompt:
          "请基于当前项目的结构化记忆，从干系人视角总结关键关注方、对齐状态、未决问题和建议跟进。",
      },
    ];
  }

  return [
    {
      key: "overview",
      label: "Memory Overview",
      prompt:
        "Based on the current project's structured memory, give me a concise project overview covering stage, progress, key risks, and next actions.",
    },
    {
      key: "risk",
      label: "Risk View",
      prompt:
        "Based on the current project's structured memory, summarize the risks, blockers, and the actions that need the most attention.",
    },
    {
      key: "delivery",
      label: "Delivery View",
      prompt:
        "Based on the current project's structured memory, summarize the delivery status, milestone momentum, and the next execution steps.",
    },
    {
      key: "stakeholder",
      label: "Stakeholder View",
      prompt:
        "Based on the current project's structured memory, summarize the key stakeholders, alignment status, unresolved questions, and suggested follow-ups.",
    },
  ];
}

export function buildDefaultChatTitle(content: string, isZh: boolean) {
  const clean = content.replace(/[#*`\[\]]/g, "").trim();
  if (!clean) return getProjectChatCopy(isZh).defaultNewChatTitle;
  return clean.slice(0, 15) + (clean.length > 15 ? "..." : "");
}
