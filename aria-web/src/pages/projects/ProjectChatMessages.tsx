import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Save,
  Sparkles,
  Wrench,
} from "lucide-react";

import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { Message } from "../../types/api";
import type { ProjectQuickPrompt } from "./projectChatCopy";
import { getProjectChatCopy } from "./projectChatCopy";

type ChatMessage = Message;

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
        <div className="h-full flex flex-col items-center justify-center text-gray-500">
          <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center mb-4 border border-primary/10">
            <Bot className="w-8 h-8 text-primary/40" />
          </div>
          <p className="text-base font-semibold text-gray-900 mb-2">{startConversationLabel}</p>
          <p className="text-sm text-gray-500 mb-6 max-w-xs text-center">{choosePromptLabel}</p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.key}
                onClick={() => onQuickPrompt(prompt.label)}
                className="flex items-center gap-2 p-3 bg-white border border-gray-200 hover:border-primary/30 hover:bg-primary/5 rounded-xl text-left transition-all shadow-sm hover:shadow"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <prompt.icon className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-gray-700">{prompt.label}</span>
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
