import { ArrowDown, BookOpen, Radio } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type {
  Conversation,
  GeneratedArtifact,
  Message,
  ProjectMemoryStatusResponse,
  Reference,
  Skill,
  ToolCallEvent,
} from "../../types/api";
import { ProjectChatExportDropdown } from "./ProjectChatExportDropdown";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
import { ProjectChatMemoryQuickBar } from "./ProjectChatMemoryQuickBar";
import { ProjectChatMessages } from "./ProjectChatMessages";
import { getProjectChatCopy, type ProjectMemoryQuickAction, type ProjectQuickPrompt } from "./projectChatCopy";

interface ProjectChatMainPanelProps {
  activeConversation?: Conversation | null;
  handleScroll: () => void;
  inputValue: string;
  isLoading: boolean;
  isLoadingMessages: boolean;
  isFullscreen: boolean;
  isAutoFollow: boolean;
  showScrollToBottom: boolean;
  isSidebarOpen: boolean;
  knowledgeScope: "project" | "client" | "global";
  memoryStatus: ProjectMemoryStatusResponse | null;
  isLoadingMemoryStatus: boolean;
  isRebuildingMemory: boolean;
  memoryQuickActions: ProjectMemoryQuickAction[];
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onOpenConversationSaveModal: () => void;
  onQuickPrompt: (content: string) => void;
  onRebuildMemory: () => void;
  onSaveMessage: (messageId: number) => void;
  onSend: () => void;
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  onToggleFullscreen: () => void;
  onToggleSidebar: () => void;
  onEnableAutoFollow: () => void;
  onJumpToBottom: () => void;
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
  projectId: number;
  quickPrompts: ProjectQuickPrompt[];
  startConversationLabel: string;
  streamingArtifacts: GeneratedArtifact[];
  streamingContent: string;
  streamingReferences: Reference[];
  streamingToolCalls: ToolCallEvent[];
  subtitle: string;
  thinkingLabel: string;
  title: string;
  choosePromptLabel: string;
  inputPlaceholder: string;
  skills: Skill[];
  selectedSkillId: number | null;
  isLoadingSkills: boolean;
  onSkillChange: (value: number | null) => void;
}

export function ProjectChatMainPanel({
  activeConversation,
  choosePromptLabel,
  handleScroll,
  inputPlaceholder,
  inputValue,
  isLoading,
  isLoadingMessages,
  isFullscreen,
  isAutoFollow,
  showScrollToBottom,
  isSidebarOpen,
  knowledgeScope,
  memoryStatus,
  isLoadingMemoryStatus,
  isRebuildingMemory,
  memoryQuickActions,
  messages,
  messagesContainerRef,
  onInputChange,
  onKnowledgeScopeChange,
  onOpenConversationSaveModal,
  onQuickPrompt,
  onRebuildMemory,
  onSaveMessage,
  onSend,
  onDownloadArtifact,
  onToggleFullscreen,
  onToggleSidebar,
  onEnableAutoFollow,
  onJumpToBottom,
  quickPrompts,
  projectId,
  startConversationLabel,
  streamingArtifacts,
  streamingContent,
  streamingReferences,
  streamingToolCalls,
  subtitle,
  thinkingLabel,
  title,
  skills,
  selectedSkillId,
  isLoadingSkills,
  onSkillChange,
}: ProjectChatMainPanelProps) {
  const { i18n } = useTranslation();
  const copy = getProjectChatCopy(i18n.language.startsWith("zh"));
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ProjectChatHeader
        hasMemory={memoryStatus?.has_memory ?? false}
        isFullscreen={isFullscreen}
        isSidebarOpen={isSidebarOpen}
        isLoadingMemoryStatus={isLoadingMemoryStatus}
        isRebuildingMemory={isRebuildingMemory}
        title={title}
        subtitle={subtitle}
        knowledgeScope={knowledgeScope}
        memoryStale={memoryStatus?.memory_stale ?? false}
        memoryUpdatedAt={memoryStatus?.memory_updated_at}
        memoryVersion={memoryStatus?.memory_version ?? 0}
        onRebuildMemory={onRebuildMemory}
        onToggleFullscreen={onToggleFullscreen}
        onToggleSidebar={onToggleSidebar}
        onKnowledgeScopeChange={onKnowledgeScopeChange}
        skillControl={
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{copy.skillLabel}</span>
            <select
              value={selectedSkillId ?? ""}
              onChange={(event) => onSkillChange(event.target.value ? Number(event.target.value) : null)}
              disabled={isLoadingSkills || skills.length === 0}
              className="max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">{isLoadingSkills ? copy.loadingSkills : copy.noSkill}</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </div>
        }
        skillSaveControl={
          activeConversation?.id && selectedSkillId ? (
            <div className="inline-flex items-center gap-2">
              {latestAssistantMessage ? (
                <button
                  type="button"
                  onClick={() => onSaveMessage(latestAssistantMessage.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <BookOpen className="h-4 w-4" />
                  <span>{copy.saveSkillResult}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onOpenConversationSaveModal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 transition-colors hover:bg-blue-100"
              >
                <BookOpen className="h-4 w-4" />
                <span>{copy.saveSkillConversation}</span>
              </button>
            </div>
          ) : undefined
        }
        exportControl={
          activeConversation?.id ? (
            <ProjectChatExportDropdown
              conversationId={activeConversation.id}
              conversationTitle={activeConversation.title}
              onOpenSaveModal={onOpenConversationSaveModal}
            />
          ) : undefined
        }
      />

      <ProjectChatMemoryQuickBar
        actions={memoryQuickActions}
        onSelect={onQuickPrompt}
      />

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="relative flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
      >
        <ProjectChatMessages
          messages={messages}
          onDownloadArtifact={onDownloadArtifact}
          streamingContent={streamingContent}
          streamingArtifacts={streamingArtifacts}
          streamingReferences={streamingReferences}
          streamingToolCalls={streamingToolCalls}
          isLoading={isLoading}
          isLoadingMessages={isLoadingMessages}
          projectId={projectId}
          startConversationLabel={startConversationLabel}
          choosePromptLabel={choosePromptLabel}
          thinkingLabel={thinkingLabel}
          quickPrompts={quickPrompts}
          onQuickPrompt={onQuickPrompt}
          onSaveMessage={onSaveMessage}
        />

        {showScrollToBottom && !isAutoFollow ? (
          <div className="pointer-events-none sticky bottom-4 z-10 mx-auto flex max-w-5xl justify-end">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={onEnableAutoFollow}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
              >
                <Radio className="h-3.5 w-3.5" />
                <span>{copy.followToBottom}</span>
              </button>
              <button
                type="button"
                onClick={onJumpToBottom}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                <span>{copy.scrollToBottom}</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <ProjectChatInput
        value={inputValue}
        isLoading={isLoading}
        isFullscreen={isFullscreen}
        placeholder={inputPlaceholder}
        onChange={onInputChange}
        onSend={onSend}
      />
    </div>
  );
}
