import type { RefObject } from "react";
import type { Conversation, Message } from "../../types/api";
import { ProjectChatExportDropdown } from "./ProjectChatExportDropdown";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
import { ProjectChatMessages } from "./ProjectChatMessages";
import type { ProjectQuickPrompt } from "./projectChatCopy";

interface ProjectChatMainPanelProps {
  activeConversation?: Conversation | null;
  handleScroll: () => void;
  inputValue: string;
  isLoading: boolean;
  isLoadingMessages: boolean;
  isSidebarOpen: boolean;
  knowledgeScope: "project" | "client" | "global";
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onOpenConversationSaveModal: () => void;
  onQuickPrompt: (content: string) => void;
  onSaveMessage: (messageId: number) => void;
  onSend: () => void;
  onToggleSidebar: () => void;
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
  quickPrompts: ProjectQuickPrompt[];
  startConversationLabel: string;
  streamingContent: string;
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
  messages,
  messagesContainerRef,
  onInputChange,
  onKnowledgeScopeChange,
  onOpenConversationSaveModal,
  onQuickPrompt,
  onSaveMessage,
  onSend,
  onToggleSidebar,
  quickPrompts,
  startConversationLabel,
  streamingContent,
  subtitle,
  thinkingLabel,
  title,
}: ProjectChatMainPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
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

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
      >
        <ProjectChatMessages
          messages={messages}
          streamingContent={streamingContent}
          isLoading={isLoading}
          isLoadingMessages={isLoadingMessages}
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
