import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Copy,
  FileText,
  GitCompare,
  Loader2,
  Play,
  Save,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type {
  GeneratedArtifact,
  Message,
  MessageMetadata,
  Reference,
  ToolCallEvent,
} from "../../types/api";
import type { ChatTrace } from "../../types/api";
import { api } from "../../api/client";
import { getProjectChatCopy } from "./projectChatCopy";
import { MarkdownDiffViewer } from "./MarkdownDiffViewer";
import { ProjectChatArtifactCard } from "./ProjectChatArtifactCard";
import { ProjectChatTracePanel } from "./ProjectChatTracePanel";
import { ProjectChatToolCallCard } from "./ProjectChatToolCallCard";
import { useAppTimeZone } from "../../hooks/useAppTimeZone";
import { formatTimeOnly } from "../../utils/timezone";
import {
  artifactFromTaskRunArtifact,
  mergeArtifacts,
  workflowStepsFromTask,
} from "./projectChatWorkflow";

const MessageCopyButton = memo(
  ({ text, title }: { text: string; title: string }) => {
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
        {copied ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    );
  },
);

const MessageSaveButton = memo(
  ({ onClick, title }: { onClick: () => void; title: string }) => {
    return (
      <button
        onClick={onClick}
        className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
        title={title}
      >
        <Save className="w-3.5 h-3.5" />
      </button>
    );
  },
);

interface ProjectChatMessageBubbleProps {
  highlight?: boolean;
  msg: Message;
  onDownloadArtifact?: (artifact: GeneratedArtifact) => void;
  onOpenArtifact?: (artifact: GeneratedArtifact) => void;
  onOpenTasks?: () => void;
  onApplyStakeholders?: (message: Message) => void;
  onSaveToNotes?: () => void;
  onContinue?: () => void;
  projectId: number;
}

export const ProjectChatMessageBubble = memo<ProjectChatMessageBubbleProps>(
  ({
    highlight = false,
    msg,
    onApplyStakeholders,
    onDownloadArtifact,
    onOpenArtifact,
    onOpenTasks,
    onSaveToNotes,
    onContinue,
    projectId,
  }) => {
    const { t, i18n } = useTranslation();
    const { resolvedTimeZone } = useAppTimeZone();
    const [savingMarkdownIndex, setSavingMarkdownIndex] = useState<
      number | null
    >(null);
    const [savedMarkdownIndexes, setSavedMarkdownIndexes] = useState<
      Set<number>
    >(new Set());
    const [diffViewerOpen, setDiffViewerOpen] = useState<number | null>(null);
    const [trace, setTrace] = useState<ChatTrace | null>(null);
    const [traceLoading, setTraceLoading] = useState(false);
    const [traceUnavailable, setTraceUnavailable] = useState(false);
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
    const taskToolCalls = workflowStepsFromTask(metadata.task_run);
    const toolCalls: ToolCallEvent[] = taskToolCalls.length
      ? taskToolCalls
      : metadata.tool_calls || [];
    const artifacts: GeneratedArtifact[] = mergeArtifacts(
      metadata.artifacts || [],
      (metadata.task_run?.artifacts || [])
        .map(artifactFromTaskRunArtifact)
        .filter(
          (artifact: GeneratedArtifact | null): artifact is GeneratedArtifact =>
            Boolean(artifact),
        ),
    );
    const pendingMarkdownSaves = metadata.pending_markdown_saves || [];
    const isTruncated = metadata.truncated === true;

    const confirmMarkdownSave = async (pendingIndex: number) => {
      setSavingMarkdownIndex(pendingIndex);
      try {
        await api.post(
          `/projects/${projectId}/messages/${msg.id}/confirm-markdown-save`,
          {
            pending_index: pendingIndex,
          },
        );
        setSavedMarkdownIndexes((current) =>
          new Set(current).add(pendingIndex),
        );
      } finally {
        setSavingMarkdownIndex(null);
      }
    };

    const buildReferenceHref = (reference: Reference) => {
      if (reference.type === "milestone")
        return `/projects/${projectId}/milestones`;
      return `/projects/${projectId}/space`;
    };

    const loadTrace = async () => {
      if (trace || traceLoading || traceUnavailable) return;
      setTraceLoading(true);
      try {
        const data = await api.get<ChatTrace>(`/chat/messages/${msg.id}/trace`);
        setTrace(data);
      } catch {
        setTraceUnavailable(true);
      } finally {
        setTraceLoading(false);
      }
    };

    return (
      <div
        id={`message-${msg.id}`}
        className={`project-chat-message mx-auto flex max-w-4xl items-start gap-3 transition ${
          highlight ? "rounded-xl bg-amber-50 p-2 ring-1 ring-amber-300" : ""
        } group ${isUser ? "flex-row-reverse" : ""}`}
      >
        <div
          className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
            isUser ? "bg-slate-200" : "bg-slate-950 shadow-sm"
          }`}
        >
          {isUser ? (
            <span className="text-xs font-semibold text-slate-500">
              {t("chat.you", "You")}
            </span>
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-white" />
          )}
        </div>

        <div
          className={`flex-1 min-w-0 flex flex-col ${isUser ? "items-end" : "items-stretch"}`}
        >
          <p className="mb-1 px-0.5 text-xs font-medium text-slate-400">
            {isUser ? t("chat.you", "You") : "Aria"}
          </p>

          <div
            className={`${
              isUser
                ? "max-w-[78%] rounded-xl rounded-tr-md bg-slate-950 px-3.5 py-2 text-[13px] leading-6 text-white shadow-sm"
                : "w-full max-w-none text-[14px] leading-6 text-slate-700"
            }`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            ) : (
              <div className="md-root project-chat-answer w-full">
                <MarkdownRenderer content={msg.content} />
              </div>
            )}
          </div>

          {!isUser &&
            (references.length > 0 ||
              toolCalls.length > 0 ||
              artifacts.length > 0) && (
              <div className="mt-2.5 w-full max-w-3xl space-y-1.5">
                {toolCalls.map((call, index) => (
                  <ProjectChatToolCallCard
                    key={`${call.tool_name}-${call.status}-${index}`}
                    call={call}
                    isZh={isZh}
                    onOpenTasks={onOpenTasks}
                  />
                ))}
                {artifacts.map((artifact) =>
                  onDownloadArtifact ? (
                    <ProjectChatArtifactCard
                      key={`${artifact.id ?? artifact.path}-${artifact.name}`}
                      artifact={artifact}
                      isZh={isZh}
                      onDownload={onDownloadArtifact}
                      onOpen={onOpenArtifact}
                    />
                  ) : null,
                )}
                {references.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {references.map((ref, i) => (
                      <Link
                        key={`${ref.type}-${ref.id}-${i}`}
                        to={buildReferenceHref(ref)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-xs text-gray-500 border border-gray-200 hover:border-primary/30 hover:text-primary"
                      >
                        {ref.type === "skill" && <Wrench className="w-3 h-3" />}
                        {ref.type === "doc" && <BookOpen className="w-3 h-3" />}
                        {ref.type === "file" && (
                          <FileText className="w-3 h-3" />
                        )}
                        {ref.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

          {!isUser && trace ? (
            <ProjectChatTracePanel trace={trace} isZh={isZh} />
          ) : null}

          {!isUser &&
          pendingMarkdownSaves.some(
            (item, index) =>
              item && !item.saved && !savedMarkdownIndexes.has(index),
          ) ? (
            <div className="mt-2.5 w-full max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium leading-5 text-amber-900">
                    {isZh
                      ? "是否写入项目 Markdown 文件？"
                      : "Write this into the project Markdown file?"}
                  </p>
                  <p className="mt-1 text-xs text-amber-700">
                    {isZh
                      ? "正文已经输出在上方，确认后才会保存到文件。"
                      : "The content is shown above. It will only be saved after confirmation."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pendingMarkdownSaves.map((item, index) =>
                    item && !item.saved && !savedMarkdownIndexes.has(index) ? (
                      <button
                        key={`${item.tool_use_id || "md"}-${index}`}
                        type="button"
                        onClick={() => void confirmMarkdownSave(index)}
                        disabled={savingMarkdownIndex !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-primary disabled:opacity-50"
                      >
                        {savingMarkdownIndex === index ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        {isZh ? "写入文件" : "Save file"}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {!isUser &&
          pendingMarkdownSaves.some(
            (item, index) => item?.saved || savedMarkdownIndexes.has(index),
          ) ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isZh ? "已写入项目文件" : "Saved to project file"}
              </div>
              {pendingMarkdownSaves.map((item, index) =>
                item &&
                (item.saved || savedMarkdownIndexes.has(index)) &&
                item.original_content ? (
                  <button
                    key={`diff-${index}`}
                    onClick={() => setDiffViewerOpen(index)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:border-primary/30 hover:text-primary"
                  >
                    <GitCompare className="h-3.5 w-3.5" />
                    {isZh ? "查看变更" : "View diff"}
                  </button>
                ) : null,
              )}
            </div>
          ) : null}

          {!isUser && isTruncated && onContinue && (
            <div className="mt-3">
              <button
                onClick={onContinue}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/10"
              >
                <Play className="h-3.5 w-3.5" />
                {isZh ? "继续生成" : "Continue generating"}
              </button>
            </div>
          )}

          <div
            className={`mt-1.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${isUser ? "flex-row-reverse" : ""}`}
          >
            <span className="px-0.5 text-xs text-slate-300">
              {formatTimeOnly(
                msg.created_at,
                { hour: "2-digit", minute: "2-digit" },
                resolvedTimeZone,
              )}
            </span>
            {!isUser && (
              <MessageCopyButton text={msg.content} title={copy.copyContent} />
            )}
            {!isUser && !traceUnavailable ? (
              <button
                onClick={() => void loadTrace()}
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                title={isZh ? "查看执行依据" : "View execution trace"}
                disabled={traceLoading}
              >
                <Activity
                  className={`w-3.5 h-3.5 ${traceLoading ? "animate-pulse" : ""}`}
                />
              </button>
            ) : null}
            {!isUser && onSaveToNotes && (
              <MessageSaveButton
                onClick={onSaveToNotes}
                title={copy.saveToNotes}
              />
            )}
            {onApplyStakeholders ? (
              <button
                onClick={() => onApplyStakeholders(msg)}
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                title={
                  isZh
                    ? "从这条消息加入客户干系人"
                    : "Add client stakeholders from this message"
                }
              >
                <Users className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {diffViewerOpen !== null &&
        pendingMarkdownSaves[diffViewerOpen]?.original_content ? (
          <MarkdownDiffViewer
            oldContent={
              pendingMarkdownSaves[diffViewerOpen].original_content || ""
            }
            newContent={pendingMarkdownSaves[diffViewerOpen].content || ""}
            fileName={
              pendingMarkdownSaves[diffViewerOpen].file_name || undefined
            }
            isZh={isZh}
            onClose={() => setDiffViewerOpen(null)}
          />
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    prev.msg.id === next.msg.id &&
    prev.highlight === next.highlight &&
    prev.msg.content === next.msg.content &&
    prev.msg.metadata_json === next.msg.metadata_json &&
    prev.projectId === next.projectId &&
    prev.onApplyStakeholders === next.onApplyStakeholders &&
    prev.onDownloadArtifact === next.onDownloadArtifact &&
    prev.onOpenArtifact === next.onOpenArtifact &&
    prev.onOpenTasks === next.onOpenTasks &&
    prev.onSaveToNotes === next.onSaveToNotes &&
    prev.onContinue === next.onContinue,
);
