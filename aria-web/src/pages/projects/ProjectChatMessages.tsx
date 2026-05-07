import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { BookOpen, FileText, Loader2, Sparkles, Wrench } from "lucide-react";

import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { GeneratedArtifact, Message, Reference, ToolCallEvent } from "../../types/api";
import type { ProjectQuickPrompt } from "./projectChatCopy";
import { ProjectChatArtifactCard } from "./ProjectChatArtifactCard";
import { ProjectChatEmptyState } from "./ProjectChatEmptyState";
import { ProjectChatMessageBubble } from "./ProjectChatMessageBubble";
import { ProjectChatToolCallCard } from "./ProjectChatToolCallCard";

type ChatMessage = Message;

const ChatStreamingMessage = memo<{
  artifacts: GeneratedArtifact[];
  content: string;
  isZh: boolean;
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  projectId: number;
  references: Reference[];
  toolCalls: ToolCallEvent[];
}>(({ artifacts, content, isZh, onDownloadArtifact, projectId, references, toolCalls }) => {
  const renderedContent = useMemo(() => <MarkdownRenderer content={content} />, [content]);

  const buildReferenceHref = (reference: Reference) => {
    if (reference.type === "milestone") return `/projects/${projectId}/milestones`;
    return `/projects/${projectId}/documents`;
  };

  return (
    <div className="mx-auto flex max-w-5xl items-start gap-3.5">
      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-gradient-to-br from-primary to-indigo-500 shadow-sm shadow-primary/20">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col items-stretch">
        <p className="text-[11px] font-medium text-gray-400 mb-1.5 px-0.5">Aria</p>
        <div className="w-full max-w-none text-[15px] leading-[1.8] text-gray-700">
          <div className="md-root w-full">
            {renderedContent}
            <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse rounded-sm" />
          </div>
          {(toolCalls.length > 0 || artifacts.length > 0 || references.length > 0) && (
            <div className="mt-3 space-y-2 w-full max-w-2xl">
              {toolCalls.map((call, index) => (
                <ProjectChatToolCallCard
                  key={`${call.tool_name}-${call.status}-${index}`}
                  call={call}
                  isZh={isZh}
                />
              ))}
              {artifacts.map((artifact) => (
                <ProjectChatArtifactCard
                  key={`${artifact.path}-${artifact.name}`}
                  artifact={artifact}
                  isZh={isZh}
                  onDownload={onDownloadArtifact}
                />
              ))}
              {references.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {references.map((ref, index) => (
                    <Link
                      to={buildReferenceHref(ref)}
                      key={`${ref.type}-${ref.id}-${index}`}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500 hover:border-primary/30 hover:text-primary"
                    >
                      {ref.type === "skill" && <Wrench className="h-3 w-3" />}
                      {ref.type === "doc" && <BookOpen className="h-3 w-3" />}
                      {ref.type === "file" && <FileText className="h-3 w-3" />}
                      {ref.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

type ProjectChatMessagesProps = {
  messages: ChatMessage[];
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  streamingContent: string;
  streamingArtifacts: GeneratedArtifact[];
  streamingReferences: Reference[];
  streamingToolCalls: ToolCallEvent[];
  isLoading: boolean;
  isLoadingMessages: boolean;
  highlightedMessageId?: number | null;
  projectId: number;
  startConversationLabel: string;
  choosePromptLabel: string;
  thinkingLabel: string;
  quickPrompts: ProjectQuickPrompt[];
  onQuickPrompt: (content: string) => void;
  onApplyStakeholders?: (message: Message) => void;
  onSaveMessage: (messageId: number) => void;
};

export function ProjectChatMessages({
  messages,
  onDownloadArtifact,
  streamingContent,
  streamingArtifacts,
  streamingReferences,
  streamingToolCalls,
  isLoading,
  isLoadingMessages,
  highlightedMessageId,
  projectId,
  startConversationLabel,
  choosePromptLabel,
  thinkingLabel,
  quickPrompts,
  onQuickPrompt,
  onApplyStakeholders,
  onSaveMessage,
}: ProjectChatMessagesProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <>
      {isLoadingMessages && (
        <div className="mx-auto max-w-5xl space-y-4 animate-pulse">
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
        <div className="absolute inset-0 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-5xl">
            <ProjectChatEmptyState
              choosePromptLabel={choosePromptLabel}
              onQuickPrompt={onQuickPrompt}
              quickPrompts={quickPrompts}
              startConversationLabel={startConversationLabel}
            />
          </div>
        </div>
      )}

      {!isLoadingMessages && (messages.length > 0 || streamingContent || isLoading) && (
        <>
          {messages.map((msg) => (
            <ProjectChatMessageBubble
              key={msg.id}
              highlight={highlightedMessageId === msg.id}
              msg={msg}
              onDownloadArtifact={onDownloadArtifact}
              onApplyStakeholders={onApplyStakeholders}
              projectId={projectId}
              onSaveToNotes={msg.role === "assistant" ? () => onSaveMessage(msg.id) : undefined}
            />
          ))}
          {streamingContent && (
            <ChatStreamingMessage
              artifacts={streamingArtifacts}
              content={streamingContent}
              isZh={isZh}
              onDownloadArtifact={onDownloadArtifact}
              projectId={projectId}
              references={streamingReferences}
              toolCalls={streamingToolCalls}
            />
          )}
          {isLoading && !streamingContent && (
            <div className="mx-auto flex max-w-5xl gap-3">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="space-y-2">
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm text-gray-500">{thinkingLabel}</span>
                  </div>
                </div>
                {streamingToolCalls.map((call, index) => (
                  <ProjectChatToolCallCard
                    key={`${call.tool_name}-${call.status}-${index}`}
                    call={call}
                    isZh={isZh}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
