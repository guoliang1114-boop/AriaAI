import { ArrowDown, BookOpen, ChevronDown, Clock3, Info, Radio, Wrench } from "lucide-react";
import { forwardRef, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type {
  Conversation,
  GeneratedArtifact,
  Message,
  ProjectMemoryStatusResponse,
  Reference,
  Skill,
  ToolCallEvent,
} from "../../types/api";
import { ProjectChatExportDropdown } from "./ProjectChatExportDropdown";
import { ProjectChatHeader } from "./ProjectChatHeader";
import { ProjectChatInput } from "./ProjectChatInput";
import { ProjectChatMemoryQuickBar } from "./ProjectChatMemoryQuickBar";
import { ProjectChatMessages } from "./ProjectChatMessages";
import { getProjectChatCopy, type ProjectMemoryQuickAction, type ProjectQuickPrompt } from "./projectChatCopy";

interface ProjectChatMainPanelProps {
  activeConversation?: Conversation | null;
  handleScroll: () => void;
  inputValue: string;
  isLoading: boolean;
  isLoadingMessages: boolean;
  isFullscreen: boolean;
  isAutoFollow: boolean;
  showScrollToBottom: boolean;
  isSidebarOpen: boolean;
  knowledgeScope: "project" | "client" | "global";
  memoryStatus: ProjectMemoryStatusResponse | null;
  isLoadingMemoryStatus: boolean;
  isRebuildingMemory: boolean;
  memoryQuickActions: ProjectMemoryQuickAction[];
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onOpenConversationSaveModal: () => void;
  onQuickPrompt: (content: string) => void;
  onRebuildMemory: () => void;
  onSaveMessage: (messageId: number) => void;
  onSend: () => void;
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  onToggleFullscreen: () => void;
  onToggleSidebar: () => void;
  onEnableAutoFollow: () => void;
  onJumpToBottom: () => void;
  onKnowledgeScopeChange: (value: "project" | "client" | "global") => void;
  projectId: number;
  projectClientName?: string;
  quickPrompts: ProjectQuickPrompt[];
  startConversationLabel: string;
  streamingArtifacts: GeneratedArtifact[];
  streamingContent: string;
  streamingReferences: Reference[];
  streamingToolCalls: ToolCallEvent[];
  subtitle: string;
  thinkingLabel: string;
  title: string;
  choosePromptLabel: string;
  inputPlaceholder: string;
  skills: Skill[];
  selectedSkillId: number | null;
  isLoadingSkills: boolean;
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
  isFullscreen,
  isAutoFollow,
  showScrollToBottom,
  isSidebarOpen,
  knowledgeScope,
  memoryStatus,
  isLoadingMemoryStatus,
  isRebuildingMemory,
  memoryQuickActions,
  messages,
  messagesContainerRef,
  onInputChange,
  onKnowledgeScopeChange,
  onOpenConversationSaveModal,
  onQuickPrompt,
  onRebuildMemory,
  onSaveMessage,
  onSend,
  onDownloadArtifact,
  onToggleFullscreen,
  onToggleSidebar,
  onEnableAutoFollow,
  onJumpToBottom,
  quickPrompts,
  projectId,
  startConversationLabel,
  streamingArtifacts,
  streamingContent,
  streamingReferences,
  streamingToolCalls,
  subtitle,
  thinkingLabel,
  title,
  skills,
  selectedSkillId,
  isLoadingSkills,
  onSkillChange,
  projectClientName,
}: ProjectChatMainPanelProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = getProjectChatCopy(isZh);
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  const selectedSkillData = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills],
  );
  const [showSkillDropdown, setShowSkillDropdown] = useState(false);
  const [skillCategoryFilter, setSkillCategoryFilter] = useState<string>("all");
  const skillDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (skillDropdownRef.current && !skillDropdownRef.current.contains(event.target as Node)) {
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
        onToggleFullscreen={onToggleFullscreen}
        onToggleSidebar={onToggleSidebar}
        onKnowledgeScopeChange={onKnowledgeScopeChange}
        skillSaveControl={
          activeConversation?.id && selectedSkillId ? (
            <div className="inline-flex items-center gap-2">
              {latestAssistantMessage ? (
                <button
                  type="button"
                  onClick={() => onSaveMessage(latestAssistantMessage.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <BookOpen className="h-4 w-4" />
                  <span>{copy.saveSkillResult}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onOpenConversationSaveModal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 transition-colors hover:bg-blue-100"
              >
                <BookOpen className="h-4 w-4" />
                <span>{copy.saveSkillConversation}</span>
              </button>
            </div>
          ) : undefined
        }
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

      <ProjectChatMemoryQuickBar
        actions={memoryQuickActions}
        onSelect={onQuickPrompt}
      />

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="relative flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
      >
        <ProjectChatMessages
          messages={messages}
          onDownloadArtifact={onDownloadArtifact}
          streamingContent={streamingContent}
          streamingArtifacts={streamingArtifacts}
          streamingReferences={streamingReferences}
          streamingToolCalls={streamingToolCalls}
          isLoading={isLoading}
          isLoadingMessages={isLoadingMessages}
          projectId={projectId}
          startConversationLabel={startConversationLabel}
          choosePromptLabel={choosePromptLabel}
          thinkingLabel={thinkingLabel}
          quickPrompts={quickPrompts}
          onQuickPrompt={onQuickPrompt}
          onSaveMessage={onSaveMessage}
        />

        {showScrollToBottom && !isAutoFollow ? (
          <div className="pointer-events-none sticky bottom-4 z-10 mx-auto flex max-w-5xl justify-end">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={onEnableAutoFollow}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
              >
                <Radio className="h-3.5 w-3.5" />
                <span>{copy.followToBottom}</span>
              </button>
              <button
                type="button"
                onClick={onJumpToBottom}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                <span>{copy.scrollToBottom}</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <ProjectChatInput
        value={inputValue}
        isLoading={isLoading}
        isFullscreen={isFullscreen}
        contextControls={
          <div className="mx-auto mb-2 flex max-w-5xl items-center gap-1.5">
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
                  <div className="border-b border-gray-100 px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {["all", ...Array.from(new Set(skills.map((skill) => skill.category)))].map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSkillCategoryFilter(category);
                          }}
                          className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                            skillCategoryFilter === category
                              ? "bg-primary text-white"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
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
          selectedSkillData ? (
            <ProjectSkillReferencePanel
              isZh={isZh}
              knowledgeScope={knowledgeScope}
              projectClientName={projectClientName}
              skill={selectedSkillData}
              onKnowledgeScopeChange={onKnowledgeScopeChange}
            />
          ) : null
        }
        placeholder={inputPlaceholder}
        onChange={onInputChange}
        onSend={onSend}
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
    <div className="mx-auto mb-3 max-w-5xl overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
          <Info className="h-4 w-4 text-emerald-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-700">{skill.name}</p>
          <p className="truncate text-xs text-gray-500">
            {skill.category} · {isZh ? "将随消息一起携带" : "attached to the next message"}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-white/80 px-2 py-1 text-xs text-emerald-700">
          {scopeLabel}
        </span>
        {skill.estimated_time ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-xs text-gray-500">
            <Clock3 className="h-3 w-3" />
            {skill.estimated_time}
          </span>
        ) : null}
      </div>
      <div className="space-y-2 px-3 py-3">
        {skill.description ? (
          <p className="text-sm leading-6 text-gray-600">{skill.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onKnowledgeScopeChange("project")}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              knowledgeScope === "project"
                ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                : "border-gray-200 bg-white/80 text-gray-600 hover:bg-white"
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
                  ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                  : "border-gray-200 bg-white/80 text-gray-600 hover:bg-white"
              }`}
            >
              {isZh ? `使用客户记忆：${projectClientName}` : `Use client memory: ${projectClientName}`}
            </button>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-gray-500">
          {isZh
            ? "Skill 产出后可通过顶部“沉淀结果 / 沉淀对话”保存到项目文档，后续可继续进入项目或客户记忆治理。"
            : "After the skill runs, use Save result / Save chat in the header to persist output into project documents for later memory governance."}
        </p>
        {skill.user_template ? (
          <div className="rounded-lg border border-gray-200 bg-white/80 px-3 py-2">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Template</p>
            <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-gray-500">
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
        <div className="bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-400">{category}</div>
        {categorySkills.map((skill) => (
          <DropdownItem key={skill.id} onClick={() => onSelect(skill.id)}>
            <div className="flex flex-col">
              <span>{skill.name}</span>
              {skill.estimated_time ? (
                <span className="text-xs text-gray-400">{skill.estimated_time}</span>
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
            <span className="text-xs text-gray-400">{skill.estimated_time}</span>
          ) : null}
        </div>
      </DropdownItem>
    ));
}

const ContextPill = forwardRef<HTMLDivElement, {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  secondary?: boolean;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}>(({ icon, label, active, secondary, open: _open, onToggle, children }, ref) => (
  <div className="relative" ref={ref}>
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? secondary
            ? "bg-gray-100/80 text-gray-600"
            : "bg-primary/8 text-primary"
          : "text-gray-400 hover:bg-gray-100/70 hover:text-gray-600"
      }`}
    >
      {icon}
      {label}
      <ChevronDown className={`h-3 w-3 transition-transform ${_open ? "rotate-180" : ""}`} />
    </button>
    {children}
  </div>
));
ContextPill.displayName = "ContextPill";

function DropdownMenu({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`absolute bottom-full left-0 z-50 mb-2 rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg ${wide ? "w-80" : "w-60"}`}>
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
      className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
        muted ? "text-gray-400" : "text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}
