import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Brain, Loader2, MessageSquareText, ShieldAlert, Target } from "lucide-react";
import { api } from "../../api/client";
import type { ProjectDetail as ProjectDetailType, ProjectMemory, ProjectMemoryResponse } from "../../types/api";
import { ProjectMemorySlotCard } from "./ProjectMemorySlotCard";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";

interface ProjectAnchorsTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
}

export function ProjectAnchorsTab({ projectDetail, projectId }: ProjectAnchorsTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .get<ProjectMemoryResponse>(`/projects/${projectId}/memory`)
      .then((data) => {
        if (!cancelled) setMemory(data.memory);
      })
      .catch((error) => {
        console.error("Failed to load project anchors:", error);
        if (!cancelled) setMemory(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const anchorStats = useMemo(
    () => [
      {
        label: isZh ? "风险锚点" : "Risk anchors",
        value: memory?.key_risks_detail?.pinned?.length || 0,
        icon: ShieldAlert,
      },
      {
        label: isZh ? "开放问题" : "Open questions",
        value: memory?.open_questions_detail?.pinned?.length || 0,
        icon: Target,
      },
      {
        label: isZh ? "干系人提醒" : "Stakeholder reminders",
        value: memory?.stakeholder_notes_detail?.pinned?.length || 0,
        icon: MessageSquareText,
      },
    ],
    [isZh, memory],
  );

  const handleSaved = (nextMemory: ProjectMemory) => {
    setMemory(nextMemory);
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-codex-line-soft bg-[radial-gradient(circle_at_top_right,#d9fbe8_0%,#f7fbf8_45%,#ffffff_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}`)}
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-codex-line bg-white/80 px-3 py-1.5 text-sm text-codex-good hover:bg-codex-accent-bg"
            >
              <ArrowLeft className="h-4 w-4" />
              {isZh ? "返回项目概览" : "Back to overview"}
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-codex-good text-white">
                <Brain className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-codex-ink">{isZh ? "AI 记忆锚点" : "AI Memory Anchors"}</h1>
                <p className="mt-1 text-sm text-codex-ink-soft">
                  {isZh
                    ? "固定长期有效的风险判断、待确认问题和客户侧沟通提醒，让 AI 总结和聊天优先使用这些上下文。"
                    : "Pin durable risk calls, open questions, and client-side communication reminders for AI summaries and chat context."}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm text-codex-ink-soft shadow-sm">
            <div className="font-medium text-codex-ink">{projectDetail.project.name}</div>
            <div className="mt-1">
              {isZh ? "最近记忆更新：" : "Memory updated: "}
              {formatProjectMemoryUpdatedAt(memory?.last_updated_at, isZh)}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {anchorStats.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-codex-ink-mute">
                <item.icon className="h-4 w-4 text-codex-good" />
                {item.label}
              </div>
              <div className="mt-2 text-2xl font-semibold text-codex-ink">{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-codex-line bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-codex-accent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ProjectMemorySlotCard
            description={isZh ? "固定必须长期保留的风险判断，后续 AI 风险和项目摘要会优先参考。" : "Pin risk calls that should remain visible in future AI risk and project summaries."}
            isZh={isZh}
            onSaved={handleSaved}
            projectId={projectId}
            slotDetail={memory?.key_risks_detail}
            slotKey="key_risks"
            title={isZh ? "固定风险锚点" : "Pinned Risk Anchors"}
          />
          <ProjectMemorySlotCard
            description={isZh ? "固定必须持续追踪的开放问题，避免在项目推进中被淹没。" : "Pin open questions that must stay tracked during delivery."}
            isZh={isZh}
            onSaved={handleSaved}
            projectId={projectId}
            slotDetail={memory?.open_questions_detail}
            slotKey="open_questions"
            title={isZh ? "固定开放问题" : "Pinned Open Questions"}
          />
          <ProjectMemorySlotCard
            description={isZh ? "固定客户侧关键人的偏好、敏感点、决策影响和沟通节奏。" : "Pin client-side stakeholder preferences, sensitivities, influence, and cadence."}
            isZh={isZh}
            onSaved={handleSaved}
            projectId={projectId}
            slotDetail={memory?.stakeholder_notes_detail}
            slotKey="stakeholder_notes"
            title={isZh ? "固定干系人提醒" : "Pinned Stakeholder Reminders"}
          />
        </div>
      )}
    </div>
  );
}
