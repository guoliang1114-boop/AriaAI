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
import type { RunActivityTimeline } from "../../stores/runActivityReducer";
import { isRunHarnessV1Enabled } from "../../utils/runHarnessFlag";
import { getProjectChatCopy } from "./projectChatCopy";
import { MarkdownDiffViewer } from "./MarkdownDiffViewer";
import { ProjectChatActivityTimeline } from "./ProjectChatActivityTimeline";
import { ProjectChatArtifactCard } from "./ProjectChatArtifactCard";
import { ProjectChatPptPathBadge } from "./ProjectChatPptPathBadge";
import { ProjectChatRememberPreferenceModal } from "./ProjectChatRememberPreferenceModal";
import { ProjectChatTracePanel } from "./ProjectChatTracePanel";
import { ProjectChatToolCallCard } from "./ProjectChatToolCallCard";
import { detectPreferenceSuggestion } from "../../utils/preferenceHints";
import { useAppTimeZone } from "../../hooks/useAppTimeZone";
import { formatTimeOnly } from "../../utils/timezone";
import {
  artifactFromTaskRunArtifact,
  mergeArtifacts,
  workflowStepsFromTask,
  workflowStepsFromToolCalls,
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
        title={title}
        className="inline-flex items-center justify-center transition-colors"
        style={{
          width: 26,
          height: 26,
          borderRadius: "var(--codex-r-sm, 6px)",
          background: "transparent",
          border: "1px solid var(--color-codex-line)",
          color: copied
            ? "var(--color-codex-good)"
            : "var(--color-codex-ink-mute)",
        }}
      >
        {copied ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <Copy className="h-3 w-3" />
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
        title={title}
        className="inline-flex items-center justify-center transition-colors"
        style={{
          width: 26,
          height: 26,
          borderRadius: "var(--codex-r-sm, 6px)",
          background: "transparent",
          border: "1px solid var(--color-codex-line)",
          color: "var(--color-codex-ink-mute)",
        }}
      >
        <Save className="h-3 w-3" />
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
      : workflowStepsFromToolCalls(metadata.tool_calls || []);
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
      return `/projects/${projectId}/documents`;
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
        className={`project-chat-message mx-auto flex max-w-4xl items-start gap-3 transition group ${isUser ? "flex-row-reverse" : ""}`}
        style={
          highlight
            ? {
                padding: 8,
                borderRadius: "var(--codex-r-md, 8px)",
                background: "var(--color-codex-accent-bg)",
                border:
                  "1px solid color-mix(in oklch, var(--color-codex-accent) 28%, transparent)",
              }
            : undefined
        }
      >
        <div
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center"
          style={{
            borderRadius: "var(--codex-r-sm, 6px)",
            background: isUser
              ? "var(--color-codex-bg-tint)"
              : "var(--color-codex-accent-bg)",
            color: isUser
              ? "var(--color-codex-ink-mute)"
              : "var(--color-codex-accent)",
            border: isUser
              ? "1px solid var(--color-codex-line)"
              : "1px solid color-mix(in oklch, var(--color-codex-accent) 22%, transparent)",
          }}
        >
          {isUser ? (
            <span style={{ fontSize: 11, fontWeight: 500 }}>
              {t("chat.you", "You")}
            </span>
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
        </div>

        <div
          className={`flex-1 min-w-0 flex flex-col ${isUser ? "items-end" : "items-stretch"}`}
        >
          <p
            style={{
              margin: "0 0 4px",
              padding: "0 2px",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.02em",
              color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
            }}
          >
            {isUser ? t("chat.you", "You") : "Aria"}
          </p>

          <div
            className={`${
              isUser
                ? "max-w-[78%] whitespace-pre-wrap"
                : "w-full max-w-none"
            }`}
            style={
              isUser
                ? {
                    padding: "8px 14px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--color-codex-bg-elev)",
                    background: "var(--color-codex-ink)",
                    borderRadius: "var(--codex-r-md, 8px)",
                    borderTopRightRadius: 4,
                  }
                : {
                    fontSize: 14,
                    lineHeight: 1.75,
                    color: "var(--color-codex-ink)",
                  }
            }
          >
            {isUser ? (
              <>
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <UserMessagePreferenceHint content={msg.content} />
              </>
            ) : (
              <div className="md-root project-chat-answer w-full">
                <MarkdownRenderer content={msg.content} />
                <PersistedRunActivityTimelineSection metadata={metadata} />
              </div>
            )}
          </div>

          {!isUser && artifacts.length > 0 && (
            <div className="mt-1.5">
              <ProjectChatPptPathBadge metadata={metadata} artifacts={artifacts} />
            </div>
          )}

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
                  <div className="flex flex-wrap" style={{ gap: 6 }}>
                    {references.map((ref, i) => (
                      <Link
                        key={`${ref.type}-${ref.id}-${i}`}
                        to={buildReferenceHref(ref)}
                        className="inline-flex items-center transition-colors"
                        style={{
                          gap: 5,
                          padding: "2px 8px",
                          fontSize: 11.5,
                          color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                          background: "var(--color-codex-bg-elev)",
                          border: "1px solid var(--color-codex-line)",
                          borderRadius: "var(--codex-r-sm, 6px)",
                        }}
                      >
                        <span
                          style={{
                            fontFamily:
                              'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                            fontSize: 10,
                            color: "var(--color-codex-accent)",
                            fontWeight: 500,
                          }}
                        >
                          [{i + 1}]
                        </span>
                        {ref.type === "skill" && (
                          <Wrench
                            className="h-3 w-3"
                            style={{ color: "var(--color-codex-ink-mute)" }}
                          />
                        )}
                        {ref.type === "doc" && (
                          <BookOpen
                            className="h-3 w-3"
                            style={{ color: "var(--color-codex-ink-mute)" }}
                          />
                        )}
                        {ref.type === "file" && (
                          <FileText
                            className="h-3 w-3"
                            style={{ color: "var(--color-codex-ink-mute)" }}
                          />
                        )}
                        <span className="truncate" style={{ maxWidth: 220 }}>
                          {ref.title}
                        </span>
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
            <div className="mt-2.5 w-full max-w-3xl rounded-lg border border-codex-line bg-codex-bg-tint px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium leading-5 text-codex-warn">
                    {isZh
                      ? "是否写入项目 Markdown 文件？"
                      : "Write this into the project Markdown file?"}
                  </p>
                  <p className="mt-1 text-xs text-codex-warn">
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
                        className="inline-flex items-center gap-1.5 rounded-lg bg-codex-ink px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-codex-accent disabled:opacity-50"
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
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-codex-line bg-codex-accent-bg px-3 py-1.5 text-xs font-medium text-codex-good">
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
                    className="inline-flex items-center gap-1 rounded-lg border border-codex-line bg-white px-2.5 py-1.5 text-xs font-medium text-codex-ink-soft transition hover:border-primary/30 hover:text-codex-accent"
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-codex-accent transition hover:bg-primary/10"
              >
                <Play className="h-3.5 w-3.5" />
                {isZh ? "继续生成" : "Continue generating"}
              </button>
            </div>
          )}

          <div
            className={`mt-1.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${isUser ? "flex-row-reverse" : ""}`}
          >
            <span className="px-0.5 text-xs text-codex-ink-faint">
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
                className="p-1.5 rounded-lg bg-codex-bg-tint hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-ink-soft transition-colors"
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
                className="p-1.5 rounded-lg bg-codex-bg-tint hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-ink-soft transition-colors"
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

/**
 * Persisted Run Activity Timeline section (Product Run Event v1).
 *
 * Reads ``metadata.activity_timeline`` from a saved assistant message and, when
 * the feature flag is on and the payload looks well-formed, renders the same
 * ``ProjectChatActivityTimeline`` component used during streaming. Until the
 * backend starts writing this field at persist time this is a graceful no-op,
 * so the bubble keeps rendering normally on legacy messages.
 */
function PersistedRunActivityTimelineSection({
  metadata,
}: {
  metadata: MessageMetadata;
}) {
  if (!isRunHarnessV1Enabled()) return null;
  const raw = (metadata as { activity_timeline?: unknown }).activity_timeline;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<RunActivityTimeline>;
  if (typeof candidate.run_id !== "string" || !candidate.run_id) return null;
  if (!Array.isArray(candidate.steps) || !Array.isArray(candidate.artifacts)) return null;

  // Re-shape with safe defaults so the renderer never crashes on
  // missing-but-optional fields. The reducer's output shape is the contract.
  const timeline: RunActivityTimeline = {
    run_id: candidate.run_id,
    skill: candidate.skill,
    display_mode: candidate.display_mode,
    steps: candidate.steps as RunActivityTimeline["steps"],
    artifacts: candidate.artifacts as RunActivityTimeline["artifacts"],
    task: candidate.task,
    confirmation: candidate.confirmation,
    message_id: candidate.message_id,
    final_status: candidate.final_status,
    error: candidate.error,
    text: typeof candidate.text === "string" ? candidate.text : "",
  };
  return (
    <div className="mt-2.5">
      <ProjectChatActivityTimeline timeline={timeline} />
    </div>
  );
}

/**
 * "💡 记住为偏好" affordance shown under a user message that looks like a
 * lasting preference (see ``utils/preferenceHints``). Click → opens a small
 * modal that writes the suggestion to /user-memory. Renders nothing when no
 * preference phrase is detected — keeps the chat quiet on normal turns.
 */
function UserMessagePreferenceHint({ content }: { content: string }) {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const suggestion = detectPreferenceSuggestion(content);
  if (!suggestion) return null;
  if (savedKey === suggestion.key) {
    return (
      <p className="mt-1 text-[11px] text-codex-ink-mute">已记住为偏好 ✓</p>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-codex-ink-mute hover:text-codex-accent"
      >
        💡 记住为偏好：{suggestion.label}
      </button>
      {modalOpen && (
        <ProjectChatRememberPreferenceModal
          suggestion={suggestion}
          onClose={() => setModalOpen(false)}
          onSaved={() => setSavedKey(suggestion.key)}
        />
      )}
    </>
  );
}
