import {
  BookOpen,
  ChevronDown,
  ClipboardList,
  Clock3,
  Info,
  Wrench,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  ChatModel,
  ChatPlanResponse,
  Conversation,
  GeneratedArtifact,
  Message,
  PendingToolAction,
  ProjectMemoryStatusResponse,
  Reference,
  Skill,
  TaskRun,
  ToolCallEvent,
} from "../../types/api";
import {
  ProjectChatActionPreviewPanel,
  type ProjectChatPendingAction,
} from "./ProjectChatActionPreviewPanel";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
import { ProjectChatMessages } from "./ProjectChatMessages";
import { ProjectTaskRunsDrawer } from "./ProjectTaskRunsDrawer";
import { getProjectChatCopy, type ProjectQuickPrompt } from "./projectChatCopy";
import {
  findPendingAction,
  groupPendingToolActions,
  pendingActionBadge,
} from "./projectChatPendingActions";

type HitasActionTarget = { actionId: number; batchId?: string };

interface ProjectChatMainPanelProps {
  activeConversation?: Conversation | null;
  handleScroll: () => void;
  inputValue: string;
  isLoading: boolean;
  isLoadingMessages: boolean;
  highlightedMessageId?: number | null;
  isFullscreen: boolean;
  isSidebarOpen: boolean;
  knowledgeScope: "project" | "client" | "global";
  memoryStatus: ProjectMemoryStatusResponse | null;
  isLoadingMemoryStatus: boolean;
  isRebuildingMemory: boolean;
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onApplyStakeholders?: (message: Message) => void;
  onOpenConversationSaveModal: () => void;
  onQuickPrompt: (content: string) => void;
  onRebuildMemory: () => void;
  onRegenerateMessage?: (message: Message) => void;
  onPinAsAnchor?: (message: Message) => void;
  onSinkToMemory?: (message: Message) => void;
  onSaveMessage: (messageId: number) => void;
  onSend: () => void;
  onStop?: () => void;
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  onOpenArtifact?: (artifact: GeneratedArtifact) => void;
  onConfirmToolAction?: (content: string, confirmationToken: string) => void;
  onConfirmHitasAction?: (
    target: HitasActionTarget,
  ) => Promise<{ status: string } | undefined>;
  onRejectHitasAction?: (target: HitasActionTarget) => Promise<void>;
  pendingToolActions?: PendingToolAction[];
  serverPendingAction?: ProjectChatPendingAction | null;
  onTaskRunUpdated?: (task: TaskRun) => void;
  onToggleSidebar: () => void;
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
  models?: ChatModel[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  projectId: number;
  projectClientName?: string;
  quickPrompts: ProjectQuickPrompt[];
  startConversationLabel: string;
  streamingArtifacts: GeneratedArtifact[];
  streamingContent: string;
  streamingStatus: string;
  streamingReferences: Reference[];
  streamingToolCalls: ToolCallEvent[];
  isStreamingTruncated?: boolean;
  onContinue?: () => void;
  planResult?: ChatPlanResponse | null;
  isGeneratingPlan?: boolean;
  onExecutePlan?: () => void;
  onCancelPlan?: () => void;
  subtitle: string;
  thinkingLabel: string;
  title: string;
  choosePromptLabel: string;
  inputPlaceholder: string;
  skills: Skill[];
  selectedSkillId: number | null;
  onSkillChange: (value: number | null) => void;
}

export function ProjectChatMainPanel({
  activeConversation,
  choosePromptLabel,
  handleScroll,
  inputPlaceholder,
  inputValue,
  isLoading,
  isLoadingMessages,
  highlightedMessageId,
  isFullscreen,
  isSidebarOpen,
  knowledgeScope,
  memoryStatus,
  isLoadingMemoryStatus,
  isRebuildingMemory,
  messages,
  messagesContainerRef,
  onInputChange,
  onApplyStakeholders,
  onRegenerateMessage,
  onPinAsAnchor,
  onSinkToMemory,
  onKnowledgeScopeChange,
  onOpenConversationSaveModal,
  onQuickPrompt,
  onRebuildMemory,
  onSaveMessage,
  onSend,
  onStop,
  onDownloadArtifact,
  onOpenArtifact,
  onConfirmToolAction,
  onConfirmHitasAction,
  onRejectHitasAction,
  pendingToolActions,
  serverPendingAction,
  onTaskRunUpdated,
  onToggleSidebar,
  quickPrompts,
  models,
  selectedModel,
  onModelChange,
  projectId,
  startConversationLabel,
  streamingArtifacts,
  streamingContent,
  streamingStatus,
  streamingReferences,
  streamingToolCalls,
  isStreamingTruncated,
  onContinue,
  planResult,
  isGeneratingPlan,
  onExecutePlan,
  onCancelPlan,
  subtitle,
  thinkingLabel,
  title,
  skills,
  selectedSkillId,
  onSkillChange,
  projectClientName,
}: ProjectChatMainPanelProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const selectedSkillData = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills],
  );
  const [showSkillDropdown, setShowSkillDropdown] = useState(false);
  const [skillCategoryFilter, setSkillCategoryFilter] = useState<string>("all");
  const [isTaskDrawerOpen, setIsTaskDrawerOpen] = useState(false);
  const [dismissedActionToken, setDismissedActionToken] = useState<
    string | null
  >(null);
  const [confirmingHitasActionKeys, setConfirmingHitasActionKeys] = useState<
    Set<string>
  >(() => new Set());
  const skillDropdownRef = useRef<HTMLDivElement>(null);
  const localPendingAction = useMemo(
    () => findPendingAction({ messages, streamingToolCalls }),
    [messages, streamingToolCalls],
  );
  const pendingAction = localPendingAction || serverPendingAction || null;
  const visiblePendingAction =
    pendingAction?.call.confirmation_token &&
    pendingAction.call.confirmation_token !== dismissedActionToken
      ? pendingAction
      : null;
  const activePendingToolActions = pendingToolActions ?? [];
  const activePendingToolActionBatches = useMemo(
    () => groupPendingToolActions(activePendingToolActions, isZh),
    [activePendingToolActions, isZh],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        skillDropdownRef.current &&
        !skillDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSkillDropdown(false);
      }
    };

    if (showSkillDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSkillDropdown]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ProjectChatHeader
        hasMemory={memoryStatus?.has_memory ?? false}
        isFullscreen={isFullscreen}
        isSidebarOpen={isSidebarOpen}
        isLoadingMemoryStatus={isLoadingMemoryStatus}
        isRebuildingMemory={isRebuildingMemory}
        title={title}
        subtitle={subtitle}
        knowledgeScope={knowledgeScope}
        memoryStale={memoryStatus?.memory_stale ?? false}
        memoryUpdatedAt={memoryStatus?.memory_updated_at}
        memoryVersion={memoryStatus?.memory_version ?? 0}
        onRebuildMemory={onRebuildMemory}
        onToggleSidebar={onToggleSidebar}
        onKnowledgeScopeChange={onKnowledgeScopeChange}
        models={models}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
        skillSaveControl={
          activeConversation?.id && selectedSkillId ? (
            <div className="inline-flex items-center gap-2">
              {latestAssistantMessage ? (
                <button
                  type="button"
                  onClick={() => onSaveMessage(latestAssistantMessage.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-codex-line bg-codex-accent-bg px-2.5 py-1.5 text-xs text-codex-good transition-colors hover:bg-codex-accent-bg"
                >
                  <BookOpen className="h-4 w-4" />
                  <span>{copy.saveSkillResult}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onOpenConversationSaveModal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-codex-line bg-codex-accent-bg px-2.5 py-1.5 text-xs text-codex-accent-ink transition-colors hover:bg-codex-accent-bg"
              >
                <BookOpen className="h-4 w-4" />
                <span>{copy.saveSkillConversation}</span>
              </button>
            </div>
          ) : undefined
        }
        taskControl={
          <button
            type="button"
            onClick={() => setIsTaskDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-codex-line bg-white px-2.5 py-1.5 text-xs text-codex-ink-soft shadow-sm transition-colors hover:border-codex-line hover:bg-codex-accent-bg hover:text-codex-accent-ink"
          >
            <ClipboardList className="h-4 w-4" />
            <span>{isZh ? "任务" : "Tasks"}</span>
          </button>
        }
      />

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="project-chat-scroll relative min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5"
      >
        <ProjectChatMessages
          messages={messages}
          onDownloadArtifact={onDownloadArtifact}
          onOpenArtifact={onOpenArtifact}
          onOpenTasks={() => setIsTaskDrawerOpen(true)}
          streamingContent={streamingContent}
          streamingStatus={streamingStatus}
          streamingArtifacts={streamingArtifacts}
          streamingReferences={streamingReferences}
          streamingToolCalls={streamingToolCalls}
          isLoading={isLoading}
          isLoadingMessages={isLoadingMessages}
          highlightedMessageId={highlightedMessageId}
          projectId={projectId}
          startConversationLabel={startConversationLabel}
          choosePromptLabel={choosePromptLabel}
          thinkingLabel={thinkingLabel}
          quickPrompts={quickPrompts}
          onQuickPrompt={onQuickPrompt}
          onApplyStakeholders={onApplyStakeholders}
          onRegenerate={onRegenerateMessage}
          onPinAsAnchor={onPinAsAnchor}
          onSinkToMemory={onSinkToMemory}
          onSaveMessage={onSaveMessage}
          isStreamingTruncated={isStreamingTruncated}
          onContinue={onContinue}
          planResult={planResult}
          isGeneratingPlan={isGeneratingPlan}
          onExecutePlan={onExecutePlan}
          onCancelPlan={onCancelPlan}
        />
      </div>

      <ProjectChatInput
        value={inputValue}
        isLoading={isLoading}
        isFullscreen={isFullscreen}
        projectId={projectId}
        contextControls={
          <div className="mx-auto mb-2 flex max-w-4xl items-center gap-1.5">
            <ContextPill
              ref={skillDropdownRef}
              icon={<Wrench className="h-3 w-3" />}
              label={selectedSkillData ? selectedSkillData.name : "@ Skills"}
              active={!!selectedSkillId}
              secondary
              open={showSkillDropdown}
              onToggle={() => setShowSkillDropdown((value) => !value)}
            >
              {showSkillDropdown ? (
                <DropdownMenu wide>
                  <DropdownItem
                    onClick={() => {
                      onSkillChange(null);
                      setSkillCategoryFilter("all");
                      setShowSkillDropdown(false);
                    }}
                    muted
                  >
                    {copy.noSkill}
                  </DropdownItem>
                  <div className="border-b border-codex-line-soft px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {[
                        "all",
                        ...Array.from(
                          new Set(skills.map((skill) => skill.category)),
                        ),
                      ].map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSkillCategoryFilter(category);
                          }}
                          className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                            skillCategoryFilter === category
                              ? "bg-codex-accent text-white"
                              : "bg-codex-bg-tint text-codex-ink-mute hover:bg-codex-bg-tint"
                          }`}
                        >
                          {category === "all" ? "All" : category}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {renderSkillOptions({
                      skills,
                      skillCategoryFilter,
                      onSelect: (skillId) => {
                        onSkillChange(skillId);
                        setShowSkillDropdown(false);
                      },
                    })}
                  </div>
                </DropdownMenu>
              ) : null}
            </ContextPill>
          </div>
        }
        selectedSkillPanel={
          <>
            {/* HITAS: Server-side persisted pending actions. Keep it as a real modal so reload/new windows cannot hide approval behind the chat input. */}
            {activePendingToolActionBatches.length > 0 &&
            onConfirmHitasAction ? (
              <div className="fixed inset-0 z-[80] flex items-end justify-center bg-codex-ink/25 px-4 py-5 backdrop-blur-[2px] sm:items-center">
                <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-codex-line bg-white shadow-2xl">
                  <div className="flex items-start justify-between gap-4 border-b border-codex-line-soft bg-codex-bg-tint px-5 py-4">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-codex-bg-tint text-codex-warn">
                        <Wrench className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-base font-semibold text-codex-ink">
                          {isZh
                            ? "Action Preview：等待确认"
                            : "Action Preview: approval required"}
                        </h4>
                        <p className="mt-1 text-sm text-codex-ink-soft">
                          {isZh
                            ? "这些操作会直接修改项目空间，确认后将按已保存的工具参数确定性执行。"
                            : "These actions will modify the project workspace and run deterministically with the saved tool input."}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-codex-line bg-white px-3 py-1 text-xs font-medium text-codex-warn">
                      {isZh ? "确认后才会执行" : "Requires approval"}
                    </span>
                  </div>
                  <div className="max-h-[55vh] overflow-y-auto p-5">
                    <div className="space-y-3">
                      {activePendingToolActionBatches.map((batch) => {
                        const primaryAction = batch.actions[0];
                        const isConfirmingBatch = confirmingHitasActionKeys.has(
                          batch.key,
                        );
                        return (
                          <div
                            key={batch.key}
                            className="rounded-lg border border-codex-line bg-codex-bg-tint p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-codex-ink">
                                  {batch.title}
                                </div>
                                <div className="mt-1 text-sm text-codex-ink-soft">
                                  {batch.description}
                                </div>
                              </div>
                              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-codex-ink-mute ring-1 ring-slate-200">
                                {pendingActionBadge(primaryAction, isZh)}
                              </span>
                            </div>
                            {batch.details.length > 0 ? (
                              <ul className="mt-3 max-h-40 overflow-y-auto rounded-md border border-codex-line bg-white p-3 text-sm text-codex-ink-soft">
                                {batch.details.map((detail, index) => (
                                  <li key={index} className="py-0.5">
                                    • {detail}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {batch.actions.length > 1 ? (
                              <div className="mt-3 rounded-md border border-codex-line-soft bg-codex-bg-tint px-3 py-2 text-xs text-codex-warn">
                                {isZh
                                  ? "确认会执行同一批次里的全部动作，不会每完成一个动作再弹一次确认。"
                                  : "Approval applies to every action in this batch, so the flow will not ask again after each step."}
                              </div>
                            ) : null}
                            <div className="mt-4 flex justify-end gap-2">
                              {onRejectHitasAction ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (isConfirmingBatch) return;
                                    setConfirmingHitasActionKeys((current) =>
                                      new Set(current).add(batch.key),
                                    );
                                    try {
                                      await onRejectHitasAction({
                                        actionId: batch.primaryActionId,
                                        batchId: batch.batchId,
                                      });
                                    } finally {
                                      setConfirmingHitasActionKeys(
                                        (current) => {
                                          const next = new Set(current);
                                          next.delete(batch.key);
                                          return next;
                                        },
                                      );
                                    }
                                  }}
                                  disabled={isConfirmingBatch}
                                  className="rounded-lg border border-codex-line bg-white px-4 py-2 text-sm font-medium text-codex-ink-soft shadow-sm hover:bg-codex-bg-tint disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isZh ? "取消" : "Cancel"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={async () => {
                                  if (isConfirmingBatch) return;
                                  setConfirmingHitasActionKeys((current) =>
                                    new Set(current).add(batch.key),
                                  );
                                  try {
                                    await onConfirmHitasAction({
                                      actionId: batch.primaryActionId,
                                      batchId: batch.batchId,
                                    });
                                  } finally {
                                    setConfirmingHitasActionKeys((current) => {
                                      const next = new Set(current);
                                      next.delete(batch.key);
                                      return next;
                                    });
                                  }
                                }}
                                disabled={isConfirmingBatch}
                                className="rounded-lg bg-codex-ink px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-codex-ink disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isConfirmingBatch
                                  ? isZh
                                    ? "执行中..."
                                    : "Running..."
                                  : isZh
                                    ? "确认并执行"
                                    : "Confirm and run"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {/* Legacy token-based confirmation flow (fallback) */}
            {visiblePendingAction &&
            onConfirmToolAction &&
            activePendingToolActionBatches.length === 0 ? (
              <ProjectChatActionPreviewPanel
                action={visiblePendingAction}
                isConfirming={isLoading}
                isZh={isZh}
                onCancel={() =>
                  setDismissedActionToken(
                    visiblePendingAction.call.confirmation_token || null,
                  )
                }
                onConfirm={(content, confirmationToken) => {
                  onConfirmToolAction(content, confirmationToken);
                }}
                onRefreshPreview={(content) => onQuickPrompt(content)}
              />
            ) : null}
            {selectedSkillData ? (
              <ProjectSkillReferencePanel
                isZh={isZh}
                knowledgeScope={knowledgeScope}
                projectClientName={projectClientName}
                skill={selectedSkillData}
                onKnowledgeScopeChange={onKnowledgeScopeChange}
              />
            ) : null}
          </>
        }
        placeholder={inputPlaceholder}
        onChange={onInputChange}
        onSend={onSend}
        onStop={onStop}
      />
      <ProjectTaskRunsDrawer
        isOpen={isTaskDrawerOpen}
        isZh={isZh}
        projectId={projectId}
        onClose={() => setIsTaskDrawerOpen(false)}
        onDownloadArtifact={onDownloadArtifact}
        onOpenArtifact={onOpenArtifact}
        onTaskUpdated={onTaskRunUpdated}
      />
    </div>
  );
}

function ProjectSkillReferencePanel({
  isZh,
  knowledgeScope,
  onKnowledgeScopeChange,
  projectClientName,
  skill,
}: {
  isZh: boolean;
  knowledgeScope: "project" | "client" | "global";
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
  projectClientName?: string;
  skill: Skill;
}) {
  const scopeLabel =
    knowledgeScope === "client"
      ? isZh
        ? "客户记忆"
        : "Client memory"
      : knowledgeScope === "global"
        ? isZh
          ? "全局知识"
          : "Global knowledge"
        : isZh
          ? "项目上下文"
          : "Project context";

  return (
    <div className="mx-auto mb-3 max-w-4xl overflow-hidden rounded-lg border border-codex-line bg-codex-accent-bg/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-codex-line/80 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-codex-accent-bg">
          <Info className="h-4 w-4 text-codex-good" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-5 text-codex-ink-soft">
            {skill.name}
          </p>
          <p className="truncate text-xs text-codex-ink-mute">
            {skill.category} ·{" "}
            {isZh ? "将随消息一起携带" : "attached to the next message"}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-white/80 px-2 py-1 text-xs text-codex-good">
          {scopeLabel}
        </span>
        {skill.estimated_time ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-xs text-codex-ink-mute">
            <Clock3 className="h-3 w-3" />
            {skill.estimated_time}
          </span>
        ) : null}
      </div>
      <div className="space-y-2 px-3 py-3">
        {skill.description ? (
          <p className="text-[13px] leading-5 text-codex-ink-soft">
            {skill.description}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onKnowledgeScopeChange("project")}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              knowledgeScope === "project"
                ? "border-codex-line bg-codex-accent-bg text-codex-good"
                : "border-codex-line bg-white/80 text-codex-ink-soft hover:bg-white"
            }`}
          >
            {isZh ? "使用项目上下文" : "Use project context"}
          </button>
          {projectClientName ? (
            <button
              type="button"
              onClick={() => onKnowledgeScopeChange("client")}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                knowledgeScope === "client"
                  ? "border-codex-line bg-codex-accent-bg text-codex-good"
                  : "border-codex-line bg-white/80 text-codex-ink-soft hover:bg-white"
              }`}
            >
              {isZh
                ? `使用客户记忆：${projectClientName}`
                : `Use client memory: ${projectClientName}`}
            </button>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-codex-ink-mute">
          {isZh
            ? "Skill 产出后可通过顶部“沉淀结果 / 沉淀对话”保存到项目文档，后续可继续进入项目或客户记忆治理。"
            : "After the skill runs, use Save result / Save chat in the header to persist output into project documents for later memory governance."}
        </p>
        {skill.user_template ? (
          <div className="rounded-lg border border-codex-line bg-white/80 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-codex-ink-faint">Template</p>
            <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-codex-ink-mute">
              {skill.user_template}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderSkillOptions({
  skills,
  skillCategoryFilter,
  onSelect,
}: {
  skills: Skill[];
  skillCategoryFilter: string;
  onSelect: (skillId: number) => void;
}) {
  if (skillCategoryFilter === "all") {
    const grouped = skills.reduce<Record<string, Skill[]>>((acc, skill) => {
      if (!acc[skill.category]) acc[skill.category] = [];
      acc[skill.category].push(skill);
      return acc;
    }, {});

    return Object.entries(grouped).map(([category, categorySkills]) => (
      <div key={category}>
        <div className="bg-codex-bg-tint px-4 py-1.5 text-xs font-medium text-codex-ink-faint">
          {category}
        </div>
        {categorySkills.map((skill) => (
          <DropdownItem key={skill.id} onClick={() => onSelect(skill.id)}>
            <div className="flex flex-col">
              <span>{skill.name}</span>
              {skill.estimated_time ? (
                <span className="text-xs text-codex-ink-faint">
                  {skill.estimated_time}
                </span>
              ) : null}
            </div>
          </DropdownItem>
        ))}
      </div>
    ));
  }

  return skills
    .filter((skill) => skill.category === skillCategoryFilter)
    .map((skill) => (
      <DropdownItem key={skill.id} onClick={() => onSelect(skill.id)}>
        <div className="flex flex-col">
          <span>{skill.name}</span>
          {skill.estimated_time ? (
            <span className="text-xs text-codex-ink-faint">
              {skill.estimated_time}
            </span>
          ) : null}
        </div>
      </DropdownItem>
    ));
}

const ContextPill = forwardRef<
  HTMLDivElement,
  {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    secondary?: boolean;
    open: boolean;
    onToggle: () => void;
    children?: React.ReactNode;
  }
>(
  (
    { icon, label, active, secondary, open: _open, onToggle, children },
    ref,
  ) => (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
          active
            ? secondary
              ? "bg-codex-bg-tint/80 text-codex-ink-soft"
              : "bg-primary/8 text-codex-accent"
            : "text-codex-ink-faint hover:bg-codex-bg-tint/70 hover:text-codex-ink-soft"
        }`}
      >
        {icon}
        {label}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${_open ? "rotate-180" : ""}`}
        />
      </button>
      {children}
    </div>
  ),
);
ContextPill.displayName = "ContextPill";

function DropdownMenu({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`absolute bottom-full left-0 z-50 mb-2 rounded-xl border border-codex-line bg-white py-1.5 shadow-lg ${wide ? "w-80" : "w-60"}`}
    >
      {children}
    </div>
  );
}

function DropdownItem({
  onClick,
  children,
  muted,
}: {
  onClick: () => void;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-codex-bg-tint ${
        muted ? "text-codex-ink-faint" : "text-codex-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}
