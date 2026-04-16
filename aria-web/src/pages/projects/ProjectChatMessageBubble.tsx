import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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
import type { GeneratedArtifact, Message, MessageMetadata, Reference, ToolCallEvent } from "../../types/api";
import { getProjectChatCopy } from "./projectChatCopy";
import { ProjectChatArtifactCard } from "./ProjectChatArtifactCard";
import { ProjectChatToolCallCard } from "./ProjectChatToolCallCard";

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
  onDownloadArtifact?: (artifact: GeneratedArtifact) => void;
  onSaveToNotes?: () => void;
  projectId: number;
}

export const ProjectChatMessageBubble = memo<ProjectChatMessageBubbleProps>(
  ({ msg, onDownloadArtifact, onSaveToNotes, projectId }) => {
    const { t, i18n } = useTranslation();
    const isUser = msg.role === "user";
    const isZh = i18n.language.startsWith("zh");
    const copy = getProjectChatCopy(i18n.language.startsWith("zh"));

    let metadata: MessageMetadata = {};
    try {
      metadata = JSON.parse(msg.metadata_json || "{}") as MessageMetadata;
    } catch {
      metadata = {};
    }
    const references: Reference[] = metadata.references || [];
    const toolCalls: ToolCallEvent[] = metadata.tool_calls || [];
    const artifacts: GeneratedArtifact[] = metadata.artifacts || [];

    const buildReferenceHref = (reference: Reference) => {
      if (reference.type === "milestone") return `/projects/${projectId}/milestones`;
      return `/projects/${projectId}/documents`;
    };

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

          {!isUser && (references.length > 0 || toolCalls.length > 0 || artifacts.length > 0) && (
            <div className="mt-3 space-y-2 max-w-[40rem]">
              {toolCalls.map((call, index) => (
                <ProjectChatToolCallCard
                  key={`${call.tool_name}-${call.status}-${index}`}
                  call={call}
                  isZh={isZh}
                />
              ))}
              {artifacts.map((artifact) =>
                onDownloadArtifact ? (
                  <ProjectChatArtifactCard
                    key={`${artifact.id ?? artifact.path}-${artifact.name}`}
                    artifact={artifact}
                    isZh={isZh}
                    onDownload={onDownloadArtifact}
                  />
                ) : null,
              )}
              {references.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {references.map((ref, i) => (
                    <Link
                      key={`${ref.type}-${ref.id}-${i}`}
                      to={buildReferenceHref(ref)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-[11px] text-gray-500 border border-gray-200 hover:border-primary/30 hover:text-primary"
                    >
                      {ref.type === "skill" && <Wrench className="w-3 h-3" />}
                      {ref.type === "doc" && <BookOpen className="w-3 h-3" />}
                      {ref.type === "file" && <FileText className="w-3 h-3" />}
                      {ref.title}
                    </Link>
                  ))}
                </div>
              )}
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
  (prev, next) =>
    prev.msg.id === next.msg.id &&
    prev.msg.content === next.msg.content &&
    prev.msg.metadata_json === next.msg.metadata_json &&
    prev.projectId === next.projectId &&
    prev.onDownloadArtifact === next.onDownloadArtifact &&
    prev.onSaveToNotes === next.onSaveToNotes,
);
