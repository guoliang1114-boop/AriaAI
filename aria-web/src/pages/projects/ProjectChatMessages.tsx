import { memo, useMemo } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { Message } from "../../types/api";
import type { ProjectQuickPrompt } from "./projectChatCopy";
import { ProjectChatEmptyState } from "./ProjectChatEmptyState";
import { ProjectChatMessageBubble } from "./ProjectChatMessageBubble";

type ChatMessage = Message;

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

type ProjectChatMessagesProps = {
  messages: ChatMessage[];
  streamingContent: string;
  isLoading: boolean;
  isLoadingMessages: boolean;
  startConversationLabel: string;
  choosePromptLabel: string;
  thinkingLabel: string;
  quickPrompts: ProjectQuickPrompt[];
  onQuickPrompt: (content: string) => void;
  onSaveMessage: (messageId: number) => void;
};

export function ProjectChatMessages({
  messages,
  streamingContent,
  isLoading,
  isLoadingMessages,
  startConversationLabel,
  choosePromptLabel,
  thinkingLabel,
  quickPrompts,
  onQuickPrompt,
  onSaveMessage,
}: ProjectChatMessagesProps) {
  return (
    <>
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
        <ProjectChatEmptyState
          choosePromptLabel={choosePromptLabel}
          onQuickPrompt={onQuickPrompt}
          quickPrompts={quickPrompts}
          startConversationLabel={startConversationLabel}
        />
      )}

      {!isLoadingMessages && (messages.length > 0 || streamingContent || isLoading) && (
        <>
          {messages.map((msg) => (
            <ProjectChatMessageBubble
              key={msg.id}
              msg={msg}
              onSaveToNotes={msg.role === "assistant" ? () => onSaveMessage(msg.id) : undefined}
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
                  <span className="text-sm text-gray-500">{thinkingLabel}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
