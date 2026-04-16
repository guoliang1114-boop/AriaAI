import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  CheckCircle2,
  Copy,
  FileText,
  Save,
  Sparkles,
  Wrench,
} from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { Message } from "../../types/api";
import { getProjectChatCopy } from "./projectChatCopy";

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

interface ProjectChatMessageBubbleProps {
  msg: Message;
  onSaveToNotes?: () => void;
}

export const ProjectChatMessageBubble = memo<ProjectChatMessageBubbleProps>(
  ({ msg, onSaveToNotes }) => {
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
  },
  (prev, next) => prev.msg.id === next.msg.id && prev.msg.content === next.msg.content && prev.onSaveToNotes === next.onSaveToNotes,
);
