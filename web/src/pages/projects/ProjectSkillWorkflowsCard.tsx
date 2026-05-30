import { ArrowRight, FileText, MessageSquareText, Sparkles, Target, Users } from "lucide-react";
import type { ProjectDetail as ProjectDetailType } from "../../types/api";

type ProjectSkillIntent = "brief" | "risk" | "stakeholder";

export function ProjectSkillWorkflowsCard({
  isZh,
  onStart,
  projectDetail,
  variant = "default",
}: {
  isZh: boolean;
  onStart: (intent: ProjectSkillIntent) => void;
  projectDetail: ProjectDetailType;
  variant?: "default" | "compact";
}) {
  const { project, files, todos } = projectDetail;
  const openTodos = todos.filter((todo) => !todo.is_done).length;

  const actions = [
    {
      description: isZh
        ? "基于项目记忆、待办、文档和当前进展，整理一份可保存为项目资产的执行简报。"
        : "Create an execution brief from memory, todos, documents, and current progress.",
      icon: FileText,
      intent: "brief" as const,
      title: isZh ? "生成项目简报" : "Project brief",
    },
    {
      description: isZh
        ? "聚焦风险、开放问题、依赖项和下一步缓解动作，适合沉淀到项目笔记。"
        : "Focus on risks, open questions, dependencies, and mitigation actions.",
      icon: Target,
      intent: "risk" as const,
      title: isZh ? "风险与行动建议" : "Risk action plan",
    },
    {
      description: isZh
        ? "围绕客户侧干系人、沟通节奏和需要确认的问题，生成下一轮对齐建议。"
        : "Build next alignment suggestions around client stakeholders and communication cadence.",
      icon: Users,
      intent: "stakeholder" as const,
      title: isZh ? "客户沟通策略" : "Client alignment",
    },
  ];

  if (variant === "compact") {
    return (
      <section className="rounded-xl border border-codex-line bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold leading-5 text-codex-ink">
            <Sparkles className="h-4 w-4 text-codex-accent" />
            {isZh ? "项目 Skill 工作流" : "Project Skill workflows"}
          </h3>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-codex-ink-mute">
            <span>{files.length} {isZh ? "文档" : "docs"}</span>
            <span className="text-codex-ink-faint">/</span>
            <span>{openTodos} {isZh ? "待办" : "open"}</span>
          </div>
        </div>
        <p className="mb-3 text-xs leading-5 text-codex-ink-mute">
          {isZh
            ? "带入当前项目上下文，快速启动常用 Skill。"
            : "Launch common Skills with this project context."}
        </p>
        <div className="space-y-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.intent}
                type="button"
                onClick={() => onStart(action.intent)}
                className="group flex w-full items-center gap-3 rounded-lg border border-codex-line-soft bg-codex-bg-tint/70 p-2.5 text-left transition hover:border-codex-line-soft hover:bg-codex-accent-bg"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-codex-accent shadow-sm">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-5 text-codex-ink">
                    {action.title}
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-codex-ink-mute">
                    {action.description}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 flex-shrink-0 text-codex-ink-faint transition group-hover:text-codex-accent" />
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-codex-line-soft bg-[radial-gradient(circle_at_top_right,#e0e7ff_0%,#f8fafc_45%,#ffffff_100%)] p-6 shadow-sm">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-codex-ink text-white">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-codex-line-soft bg-white/85 px-3 py-1 text-xs font-medium text-codex-accent-ink">
              <MessageSquareText className="h-3.5 w-3.5" />
              {isZh ? "项目 Skill 工作流" : "Project Skill workflows"}
            </div>
            <h2 className="mt-3 text-xl font-semibold text-codex-ink">
              {isZh ? "从当前项目直接启动 Skill" : "Launch a Skill with this project context"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-codex-ink-soft">
              {isZh
                ? "自动带入项目名称、客户、状态、文档、待办、财务和项目记忆线索。Skill 输出后可以在项目聊天里保存为项目文档或笔记。"
                : "Prefills project, client, status, documents, todos, financials, and memory signals. Save the Skill output as project notes or documents from chat."}
            </p>
          </div>
        </div>
        <div className="grid min-w-[260px] grid-cols-3 gap-2 rounded-2xl border border-white/80 bg-white/75 p-3 text-center shadow-sm">
          <Metric label={isZh ? "文档" : "Docs"} value={files.length} />
          <Metric label={isZh ? "未完成" : "Open"} value={openTodos} />
          <Metric label={isZh ? "状态" : "Status"} value={project.status} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.intent}
              type="button"
              onClick={() => onStart(action.intent)}
              className="group flex h-full flex-col rounded-2xl border border-white/80 bg-white/88 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-codex-line hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-codex-accent-bg text-codex-accent-ink transition group-hover:bg-codex-accent group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-codex-ink-faint transition group-hover:text-codex-accent" />
              </div>
              <span className="mt-4 text-sm font-semibold text-codex-ink">{action.title}</span>
              <span className="mt-2 text-xs leading-5 text-codex-ink-mute">{action.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-xl bg-codex-bg-tint px-3 py-2">
      <div className="text-xs font-medium text-codex-ink-mute">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-codex-ink">{value}</div>
    </div>
  );
}

export function buildProjectSkillPrompt({
  intent,
  isZh,
  projectDetail,
}: {
  intent: ProjectSkillIntent;
  isZh: boolean;
  projectDetail: ProjectDetailType;
}) {
  const { files, financials, milestones, project, todos } = projectDetail;
  const memoryPayload = parseProjectMemory(project.context_memory_json);
  const openTodos = todos.filter((todo) => !todo.is_done).slice(0, 8);
  const recentFiles = files.slice(0, 8);
  const upcomingMilestones = milestones.slice(0, 6);

  const intentInstruction = {
    brief: isZh
      ? "请基于当前项目上下文，生成一份项目执行简报。输出需要包含：当前判断、关键进展、风险/开放问题、下一步行动、需要客户确认的事项。"
      : "Generate a project execution brief with current judgment, progress, risks/open questions, next actions, and client confirmations needed.",
    risk: isZh
      ? "请基于当前项目上下文，生成风险与行动建议。输出需要包含：风险等级、触发原因、影响范围、缓解动作、负责人建议、需要补充的信息。"
      : "Generate a risk action plan with risk level, triggers, impact, mitigation actions, owner suggestions, and missing information.",
    stakeholder: isZh
      ? "请基于当前项目上下文，生成客户沟通策略。输出需要包含：关键客户干系人判断、沟通节奏、下一次会议目标、敏感点、建议话术。"
      : "Generate a client alignment strategy with stakeholder judgment, cadence, next meeting goals, sensitivities, and suggested talking points.",
  }[intent];

  const lines = [
    intentInstruction,
    "",
    isZh ? "项目上下文：" : "Project context:",
    `- ${isZh ? "项目名称" : "Name"}: ${project.name}`,
    `- ${isZh ? "客户" : "Client"}: ${project.client || (isZh ? "未填写" : "Not provided")}`,
    `- ${isZh ? "状态" : "Status"}: ${project.status}`,
    `- ${isZh ? "描述" : "Description"}: ${project.description || (isZh ? "未填写" : "Not provided")}`,
    `- ${isZh ? "项目备注" : "Project notes"}: ${project.notes || (isZh ? "暂无" : "None")}`,
    `- ${isZh ? "合同金额" : "Contract amount"}: ${project.contract_amount ?? financials.contract_amount ?? 0}`,
    `- ${isZh ? "已收款" : "Received"}: ${financials.total_received ?? 0}`,
    `- ${isZh ? "未收款" : "Uncollected"}: ${financials.uncollected ?? 0}`,
    "",
    isZh ? "未完成待办：" : "Open todos:",
    openTodos.length ? openTodos.map((todo) => `- ${todo.content}${todo.due_date ? ` (${todo.due_date})` : ""}`).join("\n") : `- ${isZh ? "暂无" : "None"}`,
    "",
    isZh ? "近期里程碑：" : "Recent milestones:",
    upcomingMilestones.length
      ? upcomingMilestones.map((item) => `- ${item.title}: ${item.is_done ? (isZh ? "已完成" : "Done") : (isZh ? "未完成" : "Open")}`).join("\n")
      : `- ${isZh ? "暂无" : "None"}`,
    "",
    isZh ? "项目文档：" : "Project documents:",
    recentFiles.length ? recentFiles.map((file) => `- ${file.name}${file.summary ? `: ${file.summary}` : ""}`).join("\n") : `- ${isZh ? "暂无" : "None"}`,
  ];

  if (memoryPayload) {
    lines.push(
      "",
      isZh ? "项目记忆线索：" : "Project memory signals:",
      `- ${isZh ? "当前目标" : "Current objective"}: ${memoryPayload.current_objective || (isZh ? "暂无" : "None")}`,
      `- ${isZh ? "关键风险" : "Key risks"}: ${formatMemoryList(memoryPayload.key_risks, isZh)}`,
      `- ${isZh ? "开放问题" : "Open questions"}: ${formatMemoryList(memoryPayload.open_questions, isZh)}`,
      `- ${isZh ? "下一步行动" : "Next actions"}: ${formatMemoryList(memoryPayload.next_actions, isZh)}`,
      `- ${isZh ? "干系人提示" : "Stakeholder notes"}: ${formatMemoryList(memoryPayload.stakeholder_notes, isZh)}`,
    );
  }

  lines.push(
    "",
    isZh
      ? "请输出为 Markdown，最后给出“建议保存到项目资产的标题”和“建议沉淀位置：项目文档/项目笔记/固定锚点”。"
      : "Return Markdown. End with a suggested asset title and whether to save it as project document, project note, or pinned anchor.",
  );

  return lines.join("\n");
}

function parseProjectMemory(value?: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as {
      current_objective?: string;
      key_risks?: string[];
      open_questions?: string[];
      next_actions?: string[];
      stakeholder_notes?: string[];
    };
  } catch {
    return null;
  }
}

function formatMemoryList(values: string[] | undefined, isZh: boolean) {
  if (!values?.length) return isZh ? "暂无" : "None";
  return values.slice(0, 5).join("; ");
}
