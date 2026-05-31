import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  BookOpen,
  FileText,
  Loader2,
  Play,
  Sparkles,
  Wrench,
} from "lucide-react";

import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useRunActivityStore } from "../../stores/runActivityStore";
import type {
  ChatPlanResponse,
  GeneratedArtifact,
  Message,
  Reference,
  ToolCallEvent,
} from "../../types/api";
import { isRunHarnessV1Enabled } from "../../utils/runHarnessFlag";
import { ProjectChatActivityTimeline } from "./ProjectChatActivityTimeline";
import type { ProjectQuickPrompt } from "./projectChatCopy";
import { ProjectChatArtifactCard } from "./ProjectChatArtifactCard";
import { ProjectChatEmptyState } from "./ProjectChatEmptyState";
import { ProjectChatMessageBubble } from "./ProjectChatMessageBubble";
import { ProjectChatPlanCard } from "./ProjectChatPlanCard";
import { ProjectChatToolCallCard } from "./ProjectChatToolCallCard";

type ChatMessage = Message;

const ChatStreamingMessage = memo<{
  artifacts: GeneratedArtifact[];
  content: string;
  isTruncated: boolean;
  isZh: boolean;
  onContinue?: () => void;
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  onOpenArtifact?: (artifact: GeneratedArtifact) => void;
  onOpenTasks?: () => void;
  projectId: number;
  references: Reference[];
  status: string;
  toolCalls: ToolCallEvent[];
}>(
  ({
    artifacts,
    content,
    isTruncated,
    isZh,
    onContinue,
    onDownloadArtifact,
    onOpenArtifact,
    onOpenTasks,
    projectId,
    references,
    status,
    toolCalls,
  }) => {
    const renderedContent = useMemo(
      () => <MarkdownRenderer content={content} />,
      [content],
    );

    const buildReferenceHref = (reference: Reference) => {
      if (reference.type === "milestone")
        return `/projects/${projectId}/milestones`;
      return `/projects/${projectId}/documents`;
    };

    return (
      <div className="project-chat-message mx-auto flex max-w-4xl items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-codex-ink shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col items-stretch">
          <p className="mb-1 px-0.5 text-xs font-medium text-codex-ink-faint">Aria</p>
          <div className="w-full max-w-none text-[14px] leading-6 text-codex-ink-soft">
            <div className="md-root project-chat-answer w-full">
              {content ? renderedContent : null}
              {status ? (
                <div
                  className={`${content ? "mt-2" : ""} inline-flex items-center gap-2 rounded-lg border border-codex-line bg-white px-2.5 py-1.5 text-xs text-codex-ink-mute shadow-sm`}
                >
                  <Loader2 className="h-4 w-4 animate-spin text-codex-accent" />
                  <span>{status}</span>
                </div>
              ) : null}
              <span className="project-chat-stream-caret ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-codex-ink" />
              {isTruncated && onContinue && (
                <div className="mt-3">
                  <button
                    onClick={onContinue}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-codex-accent transition hover:bg-primary/10"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {isZh ? "继续生成" : "Continue generating"}
                  </button>
                </div>
              )}
            </div>
            {(toolCalls.length > 0 ||
              artifacts.length > 0 ||
              references.length > 0) && (
              <div className="mt-2.5 w-full max-w-3xl space-y-1.5">
                {toolCalls.map((call, index) => (
                  <ProjectChatToolCallCard
                    key={`${call.tool_name}-${call.status}-${index}`}
                    call={call}
                    isZh={isZh}
                    onOpenTasks={onOpenTasks}
                  />
                ))}
                {artifacts.map((artifact) => (
                  <ProjectChatArtifactCard
                    key={`${artifact.path || artifact.id || artifact.name}-${artifact.name}`}
                    artifact={artifact}
                    isZh={isZh}
                    onDownload={onDownloadArtifact}
                    onOpen={onOpenArtifact}
                  />
                ))}
                {references.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {references.map((ref, index) => (
                      <Link
                        to={buildReferenceHref(ref)}
                        key={`${ref.type}-${ref.id}-${index}`}
                        className="inline-flex items-center gap-1 rounded-md border border-codex-line bg-codex-bg-tint px-2 py-0.5 text-xs text-codex-ink-mute hover:border-primary/30 hover:text-codex-accent"
                      >
                        {ref.type === "skill" && <Wrench className="h-3 w-3" />}
                        {ref.type === "doc" && <BookOpen className="h-3 w-3" />}
                        {ref.type === "file" && (
                          <FileText className="h-3 w-3" />
                        )}
                        {ref.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            <RunHarnessV1TimelineSection />
          </div>
        </div>
      </div>
    );
  },
);

/**
 * Conditional, additive activity-timeline section for the streaming bubble.
 * Subscribes to the Product Run Event v1 store. Renders nothing unless the
 * feature flag is on AND a timeline exists for the current run; in that case
 * it sits alongside the legacy tool cards so the two views can be compared.
 */
function RunHarnessV1TimelineSection() {
  const timeline = useRunActivityStore((state) => state.timeline);
  if (!isRunHarnessV1Enabled() || !timeline) return null;
  return (
    <div className="mt-2.5 w-full max-w-3xl">
      <ProjectChatActivityTimeline timeline={timeline} />
    </div>
  );
}

type ProjectChatMessagesProps = {
  messages: ChatMessage[];
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  onOpenArtifact?: (artifact: GeneratedArtifact) => void;
  onOpenTasks?: () => void;
  streamingContent: string;
  streamingStatus: string;
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
  onRegenerate?: (message: Message) => void;
  onPinAsAnchor?: (message: Message) => void;
  onSinkToMemory?: (message: Message) => void;
  onSaveMessage: (messageId: number) => void;
  isStreamingTruncated?: boolean;
  onContinue?: () => void;
  planResult?: ChatPlanResponse | null;
  isGeneratingPlan?: boolean;
  onExecutePlan?: () => void;
  onCancelPlan?: () => void;
};

export function ProjectChatMessages({
  messages,
  onDownloadArtifact,
  onOpenArtifact,
  onOpenTasks,
  streamingContent,
  streamingStatus,
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
  onRegenerate,
  onPinAsAnchor,
  onSinkToMemory,
  onSaveMessage,
  isStreamingTruncated,
  onContinue,
  planResult,
  isGeneratingPlan,
  onExecutePlan,
  onCancelPlan,
}: ProjectChatMessagesProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <>
      {isLoadingMessages && (
        <div className="mx-auto max-w-4xl space-y-4 animate-pulse">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-codex-bg-tint flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-codex-bg-tint rounded-full w-3/4" />
              <div className="h-3 bg-codex-bg-tint rounded-full w-1/2" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <div className="flex-1 space-y-2 flex flex-col items-end">
              <div className="h-3 bg-codex-bg-tint rounded-full w-2/3" />
              <div className="h-3 bg-codex-bg-tint rounded-full w-1/3" />
            </div>
            <div className="w-8 h-8 rounded-full bg-codex-bg-tint flex-shrink-0" />
          </div>
        </div>
      )}

      {messages.length === 0 &&
        !streamingContent &&
        !streamingStatus &&
        !isLoading &&
        !isLoadingMessages && (
          <div className="absolute inset-0 flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-4xl">
              <ProjectChatEmptyState
                choosePromptLabel={choosePromptLabel}
                onQuickPrompt={onQuickPrompt}
                quickPrompts={quickPrompts}
                startConversationLabel={startConversationLabel}
              />
            </div>
          </div>
        )}

      {!isLoadingMessages &&
        (messages.length > 0 ||
          streamingContent ||
          streamingStatus ||
          isLoading) && (
          <>
            {messages.map((msg) => {
              return (
                <ProjectChatMessageBubble
                  key={msg.id}
                  highlight={highlightedMessageId === msg.id}
                  msg={msg}
                  onDownloadArtifact={onDownloadArtifact}
                  onOpenArtifact={onOpenArtifact}
                  onOpenTasks={onOpenTasks}
                  onApplyStakeholders={onApplyStakeholders}
                  onContinue={
                    msg.role === "assistant" && !isLoading
                      ? onContinue
                      : undefined
                  }
                  projectId={projectId}
                  onSaveToNotes={
                    msg.role === "assistant"
                      ? () => onSaveMessage(msg.id)
                      : undefined
                  }
                  onRegenerate={
                    msg.role === "assistant" && !isLoading ? onRegenerate : undefined
                  }
                  onPinAsAnchor={
                    msg.role === "assistant" ? onPinAsAnchor : undefined
                  }
                  onSinkToMemory={
                    msg.role === "assistant" ? onSinkToMemory : undefined
                  }
                />
              );
            })}
            {(streamingContent ||
              streamingStatus ||
              streamingToolCalls.length > 0 ||
              streamingArtifacts.length > 0 ||
              streamingReferences.length > 0) && (
              <ChatStreamingMessage
                artifacts={streamingArtifacts}
                content={streamingContent}
                isTruncated={!!isStreamingTruncated}
                isZh={isZh}
                onContinue={onContinue}
                onDownloadArtifact={onDownloadArtifact}
                onOpenArtifact={onOpenArtifact}
                onOpenTasks={onOpenTasks}
                projectId={projectId}
                references={streamingReferences}
                status={streamingStatus}
                toolCalls={streamingToolCalls}
              />
            )}
            {planResult && onExecutePlan && onCancelPlan && (
              <ProjectChatPlanCard
                plan={planResult}
                isGenerating={isGeneratingPlan}
                onExecute={onExecutePlan}
                onCancel={onCancelPlan}
              />
            )}
            {isLoading &&
              !streamingContent &&
              !streamingStatus &&
              streamingToolCalls.length === 0 &&
              streamingArtifacts.length === 0 &&
              streamingReferences.length === 0 && (
                <div className="project-chat-message mx-auto flex max-w-4xl gap-3">
                  <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-codex-ink shadow-sm">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-lg border border-codex-line bg-white px-2.5 py-1.5 shadow-sm">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-codex-accent" />
                        <span className="text-xs text-codex-ink-mute">
                          {thinkingLabel}
                        </span>
                      </div>
                    </div>
                    {streamingToolCalls.map((call, index) => (
                      <ProjectChatToolCallCard
                        key={`${call.tool_name}-${call.status}-${index}`}
                        call={call}
                        isZh={isZh}
                        onOpenTasks={onOpenTasks}
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
