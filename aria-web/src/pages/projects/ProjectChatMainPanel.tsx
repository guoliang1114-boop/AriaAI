import type { RefObject } from "react";
import type { Conversation, GeneratedArtifact, Message, Reference, ToolCallEvent } from "../../types/api";
import { ProjectChatExportDropdown } from "./ProjectChatExportDropdown";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
import { ProjectChatMemoryQuickBar } from "./ProjectChatMemoryQuickBar";
import { ProjectChatMessages } from "./ProjectChatMessages";
import type { ProjectMemoryQuickAction, ProjectQuickPrompt } from "./projectChatCopy";

interface ProjectChatMainPanelProps {
  activeConversation?: Conversation | null;
  handleScroll: () => void;
  inputValue: string;
  isLoading: boolean;
  isLoadingMessages: boolean;
  isSidebarOpen: boolean;
  knowledgeScope: "project" | "client" | "global";
  memoryQuickActions: ProjectMemoryQuickAction[];
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onOpenConversationSaveModal: () => void;
  onQuickPrompt: (content: string) => void;
  onSaveMessage: (messageId: number) => void;
  onSend: () => void;
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  onToggleSidebar: () => void;
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
}

export function ProjectChatMainPanel({
  activeConversation,
  choosePromptLabel,
  handleScroll,
  inputPlaceholder,
  inputValue,
  isLoading,
  isLoadingMessages,
  isSidebarOpen,
  knowledgeScope,
  memoryQuickActions,
  messages,
  messagesContainerRef,
  onInputChange,
  onKnowledgeScopeChange,
  onOpenConversationSaveModal,
  onQuickPrompt,
  onSaveMessage,
  onSend,
  onDownloadArtifact,
  onToggleSidebar,
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
}: ProjectChatMainPanelProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ProjectChatHeader
        isSidebarOpen={isSidebarOpen}
        title={title}
        subtitle={subtitle}
        knowledgeScope={knowledgeScope}
        onToggleSidebar={onToggleSidebar}
        onKnowledgeScopeChange={onKnowledgeScopeChange}
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
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
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
      </div>

      <ProjectChatInput
        value={inputValue}
        isLoading={isLoading}
        placeholder={inputPlaceholder}
        onChange={onInputChange}
        onSend={onSend}
      />
    </div>
  );
}
