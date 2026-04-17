import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Brain,
  Clock3,
  FileText,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import { api } from "../../api/client";
import type {
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
} from "../../types/api";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { ProjectOverviewMemoryCard } from "./ProjectOverviewMemoryCard";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";
import { useProjectMemorySummary } from "./useProjectMemorySummary";

interface ProjectMemoryTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
}

function SectionList({
  emptyText,
  items,
}: {
  emptyText: string;
  items: string[];
}) {
  if (items.length === 0) {
    return <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">{emptyText}</div>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm text-gray-700">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DetailCard({
  children,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  icon: typeof Brain;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
          <Icon className="h-4 w-4 text-gray-600" />
        </div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function ProjectMemoryTab({ projectDetail, projectId }: ProjectMemoryTabProps) {
  const { project, files, milestones, todos, members, financials } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);

  const overviewInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成项目记忆摘要失败，请稍后重试" : "Failed to generate project memory summary",
    language: i18n.language,
    memoryVersion: memory?.memory_version ?? project.memory_version ?? 0,
    projectId,
    summaryType: "overview",
  });
  const riskInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成项目风险摘要失败，请稍后重试" : "Failed to generate project risk summary",
    language: i18n.language,
    memoryVersion: memory?.memory_version ?? project.memory_version ?? 0,
    projectId,
    summaryType: "risk",
  });
  const stakeholderInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成干系人摘要失败，请稍后重试" : "Failed to generate stakeholder summary",
    language: i18n.language,
    memoryVersion: memory?.memory_version ?? project.memory_version ?? 0,
    projectId,
    summaryType: "stakeholder",
  });

  const refreshMemory = async () => {
    setIsLoadingMemory(true);
    try {
      const data = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
      setMemory(data.memory);
    } catch (error) {
      console.error("Failed to load project memory:", error);
      setMemory(null);
    } finally {
      setIsLoadingMemory(false);
    }
  };

  const rebuildMemory = async () => {
    setIsRebuildingMemory(true);
    try {
      const data = await api.post<ProjectMemoryResponse>(
        `/projects/${projectId}/memory/rebuild`,
        {},
        { timeout: 60000 },
      );
      setMemory(data.memory);
      await Promise.all([
        overviewInsight.refresh(true),
        riskInsight.refresh(true),
        stakeholderInsight.refresh(true),
      ]);
    } finally {
      setIsRebuildingMemory(false);
    }
  };

  useEffect(() => {
    void refreshMemory();
  }, [projectId]);

  const sourceCoverage = useMemo(
    () => [
      { label: isZh ? "项目文档" : "Documents", value: files.length },
      { label: isZh ? "里程碑" : "Milestones", value: milestones.length },
      { label: isZh ? "待办" : "Todos", value: todos.length },
      { label: isZh ? "项目成员" : "Members", value: members.length },
      { label: isZh ? "财务记录" : "Payments", value: financials.payments.length },
    ],
    [files.length, financials.payments.length, isZh, members.length, milestones.length, todos.length],
  );

  const memoryUpdatedText = formatProjectMemoryUpdatedAt(memory?.last_updated_at, isZh);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <ProjectOverviewMemoryCard
            isLoading={isLoadingMemory}
            isRebuilding={isRebuildingMemory}
            isZh={isZh}
            memory={memory}
            onRebuild={() => {
              void rebuildMemory();
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "当前阶段" : "Current Stage"}
            </div>
            <div className="mt-2 text-lg font-semibold text-gray-900">
              {memory?.current_stage || project.status}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "当前目标" : "Current Objective"}
            </div>
            <div className="mt-2 text-sm leading-relaxed text-gray-900">
              {memory?.current_objective || (isZh ? "暂未明确当前目标" : "No objective yet")}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "记忆更新时间" : "Memory Updated"}
            </div>
            <div className="mt-2 text-sm font-medium text-gray-900">{memoryUpdatedText}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {isZh ? "来源覆盖" : "Source Coverage"}
            </div>
            <div className="mt-2 text-sm text-gray-900">
              {sourceCoverage.reduce((sum, item) => sum + item.value, 0)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
              {sourceCoverage.map((item) => (
                <div key={item.label} className="rounded-lg bg-gray-50 px-2.5 py-2">
                  <div>{item.label}</div>
                  <div className="mt-1 font-semibold text-gray-900">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <ProjectMemoryInsightCard
            content={overviewInsight.content}
            error={overviewInsight.error}
            hint={
              isZh
                ? "用业务语言快速理解当前项目共识，适合项目经理和业务负责人先看这一块。"
                : "Business-readable overview of the current project consensus."
            }
            isZh={isZh}
            loading={overviewInsight.loading}
            onRefresh={() => {
              void overviewInsight.refresh(true);
            }}
            title={isZh ? "AI 项目记忆摘要" : "AI Memory Overview"}
          />
        </div>
        <div className="xl:col-span-1">
          <ProjectMemoryInsightCard
            content={riskInsight.content}
            error={riskInsight.error}
            hint={
              isZh
                ? "聚焦关键风险、阻塞点和需要尽快处理的问题。"
                : "Focused view of the major risks and blockers."
            }
            isZh={isZh}
            loading={riskInsight.loading}
            onRefresh={() => {
              void riskInsight.refresh(true);
            }}
            title={isZh ? "AI 风险摘要" : "AI Risk Summary"}
          />
        </div>
        <div className="xl:col-span-1">
          <ProjectMemoryInsightCard
            content={stakeholderInsight.content}
            error={stakeholderInsight.error}
            hint={
              isZh
                ? "用来理解关键干系人状态、沟通重点和预期管理。"
                : "Useful for understanding stakeholder signals and communication focus."
            }
            isZh={isZh}
            loading={stakeholderInsight.loading}
            onRefresh={() => {
              void stakeholderInsight.refresh(true);
            }}
            title={isZh ? "AI 干系人摘要" : "AI Stakeholder Summary"}
          />
        </div>
      </div>

      {memory?.stale ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">
                {isZh ? "这份项目记忆可能已经过期" : "This project memory may be out of date"}
              </div>
              <div className="mt-1 text-amber-800">
                {isZh
                  ? "项目近期发生了变化。你现在看到的内容仍可参考，但建议重建后再用于正式判断。"
                  : "The project changed recently. This memory is still useful, but rebuilding it is recommended before relying on it for decisions."}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DetailCard icon={Brain} title={isZh ? "项目概况" : "Project Brief"}>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "核心摘要" : "Core Summary"}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-gray-700">
                {memory?.project_brief || (isZh ? "暂无项目概况" : "No project brief yet")}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "当前目标" : "Current Objective"}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-gray-700">
                {memory?.current_objective || (isZh ? "暂无当前目标" : "No current objective yet")}
              </div>
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={Clock3} title={isZh ? "近期进展与下一步" : "Recent Progress & Next Steps"}>
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "近期进展" : "Recent Progress"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无近期进展" : "No recent progress yet."}
                items={memory?.recent_progress || []}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "下一步动作" : "Next Actions"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无下一步动作" : "No next actions yet."}
                items={memory?.next_actions || []}
              />
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={ShieldAlert} title={isZh ? "风险与待确认问题" : "Risks & Open Questions"}>
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "关键风险" : "Key Risks"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无关键风险" : "No key risks yet."}
                items={memory?.key_risks || []}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "待确认问题" : "Open Questions"}
              </div>
              <SectionList
                emptyText={isZh ? "暂无待确认问题" : "No open questions yet."}
                items={memory?.open_questions || []}
              />
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={FileText} title={isZh ? "重要文档与财务状态" : "Documents & Financial Status"}>
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "重要文档" : "Important Documents"}
              </div>
              {memory?.important_documents?.length ? (
                <div className="space-y-3">
                  {memory.important_documents.map((document, index) => (
                    <div key={`${document.name}-${index}`} className="rounded-lg bg-gray-50 p-3">
                      <div className="text-sm font-medium text-gray-900">{document.name}</div>
                      <div className="mt-1 text-sm text-gray-600">{document.reason}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">
                  {isZh ? "暂无重要文档线索" : "No important document signals yet."}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                {isZh ? "财务状态" : "Financial Status"}
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">
                {memory?.financial_status || (isZh ? "暂无财务状态" : "No financial status yet.")}
              </div>
            </div>
          </div>
        </DetailCard>

        <DetailCard icon={Target} title={isZh ? "交付信号" : "Delivery Signals"}>
          <SectionList
            emptyText={isZh ? "暂无交付信号" : "No delivery signals yet."}
            items={memory?.delivery_signals || []}
          />
        </DetailCard>

        <DetailCard icon={Users} title={isZh ? "干系人备注" : "Stakeholder Notes"}>
          <SectionList
            emptyText={isZh ? "暂无干系人备注" : "No stakeholder notes yet."}
            items={memory?.stakeholder_notes || []}
          />
        </DetailCard>
      </div>
    </div>
  );
}
