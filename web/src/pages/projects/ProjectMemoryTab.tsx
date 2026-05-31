import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Brain,
  Building2,
  Check,
  GitCompare,
  HelpCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Target,
  Users,
} from "lucide-react";
import { api } from "../../api/client";
import type {
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
  ProjectMemorySnapshot,
} from "../../types/api";
import { dispatchProjectMemoryStateUpdated } from "./useProjectDetailData";
import { ProjectMemorySlotCard } from "./ProjectMemorySlotCard";
import { CxPanel } from "./ProjectOverviewPanels";
import { formatDateOnly } from "../../utils/timezone";
import { formatProjectMemoryUpdatedAt } from "./projectMemoryTime";

interface ProjectMemoryTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
}

type AnchorTone = "bad" | "warn" | "info";

interface AnchorGroup {
  key: "key_risks" | "open_questions" | "stakeholder_notes";
  title: string;
  description: string;
  tone: AnchorTone;
  icon: ReactNode;
  items: string[];
}

const ANCHOR_TONE_COLOR: Record<AnchorTone, string> = {
  bad: "var(--color-codex-bad)",
  warn: "var(--color-codex-warn)",
  info: "var(--color-codex-info, var(--color-codex-accent))",
};

interface StructuredSlot {
  key: string;
  title: string;
  icon: ReactNode;
  body: string;
  sources: string[];
}

function buildStructuredSlots(isZh: boolean, memory: ProjectMemory | null): StructuredSlot[] {
  const fallback = isZh ? "暂未沉淀,可在对话或编辑卡中补齐。" : "Not captured yet.";
  const stage = memory?.current_stage?.trim();
  const objective = memory?.current_objective?.trim();
  const keyRisks = (memory?.key_risks || []).filter(Boolean);
  const deliverySignals = (memory?.delivery_signals || []).filter(Boolean);
  const stakeholderNotes = (memory?.stakeholder_notes || []).filter(Boolean);
  const nextActions = (memory?.next_actions || []).filter(Boolean);

  return [
    {
      key: "client_background",
      title: isZh ? "客户背景 · Client Background" : "Client Background",
      icon: <Building2 className="h-3.5 w-3.5" />,
      body: [stage, objective].filter(Boolean).join("\n\n") || fallback,
      sources: memory?.important_documents?.slice(0, 2).map((doc) => doc.name).filter(Boolean) ?? [],
    },
    {
      key: "pain_points",
      title: isZh ? "核心痛点 · Pain Points" : "Pain Points",
      icon: <Target className="h-3.5 w-3.5" />,
      body: keyRisks.length ? keyRisks.map((line) => `• ${line}`).join("\n") : fallback,
      sources: memory?.recent_progress?.slice(0, 2) ?? [],
    },
    {
      key: "our_proposal",
      title: isZh ? "我方方案 · Our Proposal" : "Our Proposal",
      icon: <Sparkles className="h-3.5 w-3.5" />,
      body: deliverySignals.length ? deliverySignals.map((line) => `• ${line}`).join("\n") : fallback,
      sources: [`v${memory?.memory_version ?? 0}`],
    },
    {
      key: "decision_chain",
      title: isZh ? "决策链 · Decision Chain" : "Decision Chain",
      icon: <Users className="h-3.5 w-3.5" />,
      body: stakeholderNotes.length ? stakeholderNotes.map((line) => `• ${line}`).join("\n") : fallback,
      sources: memory?.stakeholder_notes_detail?.pinned?.slice(0, 2) ?? [],
    },
    {
      key: "next_steps",
      title: isZh ? "下一步 · Next Steps" : "Next Steps",
      icon: <ArrowRight className="h-3.5 w-3.5" />,
      body: nextActions.length ? nextActions.map((line) => `• ${line}`).join("\n") : fallback,
      sources: memory?.recent_progress?.slice(0, 1) ?? [],
    },
  ];
}

function computeHealthScore(memory: ProjectMemory | null): { score: number; filled: number; total: number } {
  if (!memory) return { score: 0, filled: 0, total: 7 };
  const checks: boolean[] = [
    Boolean(memory.project_brief?.trim()),
    Boolean(memory.current_stage?.trim()),
    Boolean(memory.current_objective?.trim()),
    (memory.key_risks || []).filter(Boolean).length > 0,
    (memory.open_questions || []).filter(Boolean).length > 0,
    (memory.next_actions || []).filter(Boolean).length > 0,
    (memory.stakeholder_notes || []).filter(Boolean).length > 0,
  ];
  const filled = checks.filter(Boolean).length;
  return {
    filled,
    total: checks.length,
    score: Math.round((filled / checks.length) * 100),
  };
}

function StructuredSlotCard({
  slot,
  isZh,
}: {
  slot: StructuredSlot;
  isZh: boolean;
}) {
  return (
    <section
      style={{
        background: "var(--color-codex-bg-elev)",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-md, 8px)",
        padding: "16px 20px",
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div className="flex items-center" style={{ gap: 10 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--codex-r-sm, 6px)",
              background: "var(--color-codex-accent-bg)",
              color: "var(--color-codex-accent)",
            }}
          >
            {slot.icon}
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-codex-ink)",
            }}
          >
            {slot.title}
          </h3>
        </div>
      </div>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 13.5,
          color: "var(--color-codex-ink)",
          lineHeight: 1.75,
          whiteSpace: "pre-line",
        }}
      >
        {slot.body}
      </p>
      {slot.sources.length ? (
        <div
          className="flex flex-wrap items-center"
          style={{
            gap: 8,
            paddingTop: 10,
            borderTop: "1px solid var(--color-codex-line-soft)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
            }}
          >
            {isZh ? "依据:" : "Sources:"}
          </span>
          {slot.sources.map((src, i) => (
            <span
              key={`${src}-${i}`}
              style={{
                fontSize: 11.5,
                color: "var(--color-codex-accent)",
                padding: "1px 6px",
                background: "var(--color-codex-accent-bg)",
                borderRadius: "var(--codex-r-sm, 6px)",
              }}
            >
              {src}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ProjectMemoryTab({ projectDetail, projectId }: ProjectMemoryTabProps) {
  const { project } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [memoryMeta, setMemoryMeta] = useState<ProjectMemoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [snapshots, setSnapshots] = useState<ProjectMemorySnapshot[]>([]);
  const [rollbackSnapshotId, setRollbackSnapshotId] = useState<number | null>(null);
  const [showAnchorEditor, setShowAnchorEditor] = useState<
    "key_risks" | "open_questions" | "stakeholder_notes" | null
  >(null);

  const refreshMemory = async () => {
    setIsLoading(true);
    try {
      const data = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
      setMemory(data.memory);
      setMemoryMeta(data);
    } catch (error) {
      console.error("Failed to load project memory:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshSnapshots = async () => {
    try {
      const data = await api.get<ProjectMemorySnapshot[]>(
        `/projects/${projectId}/memory/snapshots`,
      );
      setSnapshots(data);
    } catch (error) {
      console.error("Failed to load project memory snapshots:", error);
      setSnapshots([]);
    }
  };

  useEffect(() => {
    void refreshMemory();
    void refreshSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const rebuildMemory = async () => {
    setIsRebuilding(true);
    try {
      const data = await api.post<ProjectMemoryResponse>(
        `/projects/${projectId}/memory/rebuild`,
        {},
        { timeout: 60000 },
      );
      setMemory(data.memory);
      setMemoryMeta(data);
      dispatchProjectMemoryStateUpdated({
        projectId: Number(projectId),
        memory_stale: data.memory_stale,
        memory_updated_at: data.memory_updated_at,
        memory_version: data.memory_version,
        memory_rebuild_status: data.memory_rebuild_status ?? "idle",
        memory_rebuild_failed_at: data.memory_rebuild_failed_at ?? null,
        project_brief: data.memory.project_brief,
      });
      await refreshSnapshots();
    } finally {
      setIsRebuilding(false);
    }
  };

  const rollbackSnapshot = async (snapshot: ProjectMemorySnapshot) => {
    setRollbackSnapshotId(snapshot.id);
    try {
      const data = await api.post<ProjectMemoryResponse>(
        `/projects/${projectId}/memory/snapshots/${snapshot.id}/rollback`,
        {},
        { timeout: 60000 },
      );
      setMemory(data.memory);
      setMemoryMeta(data);
      dispatchProjectMemoryStateUpdated({
        projectId: Number(projectId),
        memory_stale: false,
        memory_updated_at: data.memory.last_updated_at,
        memory_version: data.memory_version,
        memory_rebuild_status: "idle",
        memory_rebuild_failed_at: null,
        project_brief: data.memory.project_brief,
      });
      await refreshSnapshots();
    } finally {
      setRollbackSnapshotId(null);
    }
  };

  const anchorGroups: AnchorGroup[] = useMemo(
    () => [
      {
        key: "key_risks",
        title: isZh ? "风险锚点" : "Risk Anchors",
        description: isZh ? "长期需要盯住的风险判断" : "Risks to track over time",
        tone: "bad",
        icon: <AlertTriangle className="h-3 w-3" />,
        items: (memory?.key_risks_detail?.pinned || []).filter(Boolean),
      },
      {
        key: "open_questions",
        title: isZh ? "待确认问题" : "Open Questions",
        description: isZh ? "会影响推进的未决事项" : "Unresolved items affecting progress",
        tone: "warn",
        icon: <HelpCircle className="h-3 w-3" />,
        items: (memory?.open_questions_detail?.pinned || []).filter(Boolean),
      },
      {
        key: "stakeholder_notes",
        title: isZh ? "干系人提示" : "Stakeholder Notes",
        description: isZh ? "沟通偏好、敏感点和跟进提醒" : "Comms preferences and reminders",
        tone: "info",
        icon: <Users className="h-3 w-3" />,
        items: (memory?.stakeholder_notes_detail?.pinned || []).filter(Boolean),
      },
    ],
    [
      isZh,
      memory?.key_risks_detail?.pinned,
      memory?.open_questions_detail?.pinned,
      memory?.stakeholder_notes_detail?.pinned,
    ],
  );

  const totalAnchors = anchorGroups.reduce((sum, group) => sum + group.items.length, 0);
  const structuredSlots = buildStructuredSlots(isZh, memory);
  const memoryHealth = computeHealthScore(memory);
  const memoryVersion = memoryMeta?.memory_version ?? memory?.memory_version ?? project.memory_version ?? 0;
  const memoryStale = memoryMeta?.memory_stale ?? memory?.stale ?? project.memory_stale ?? false;
  const memoryUpdatedLabel = formatProjectMemoryUpdatedAt(
    memoryMeta?.memory_updated_at ?? memory?.last_updated_at ?? project.memory_updated_at,
    isZh,
  );

  if (isLoading && !memory) {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          minHeight: 360,
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 8px)",
        }}
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--color-codex-accent)" }} />
      </div>
    );
  }

  return (
    <div
      className="grid gap-5"
      style={{
        gridTemplateColumns: "minmax(0, 1fr) 300px",
        alignItems: "start",
      }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: 18 }}>
        {/* Header strip */}
        <div
          className="flex flex-wrap items-center justify-between"
          style={{
            padding: "14px 18px",
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
            gap: 12,
          }}
        >
          <div className="flex flex-wrap items-center" style={{ gap: 14 }}>
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-codex-ink)",
                  fontWeight: 500,
                }}
              >
                {isZh ? `项目记忆 v${memoryVersion}` : `Project memory v${memoryVersion}`}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--color-codex-ink-mute)",
                  marginTop: 2,
                }}
              >
                {isZh ? "更新于" : "Updated"} {memoryUpdatedLabel}
              </div>
            </div>
            <span
              className="inline-flex items-center"
              style={{
                gap: 5,
                padding: "2px 10px",
                fontSize: 11,
                fontWeight: 500,
                color: memoryStale ? "var(--color-codex-warn)" : "var(--color-codex-good)",
                background: memoryStale
                  ? "color-mix(in oklch, var(--color-codex-warn) 12%, transparent)"
                  : "color-mix(in oklch, var(--color-codex-good) 12%, transparent)",
                borderRadius: 999,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: memoryStale ? "var(--color-codex-warn)" : "var(--color-codex-good)",
                }}
              />
              {memoryStale
                ? isZh
                  ? "待更新"
                  : "Stale"
                : isZh
                  ? "已同步"
                  : "Synced"}
            </span>
          </div>
          <div className="flex" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={() => void refreshSnapshots()}
              className="inline-flex items-center transition-colors"
              style={{
                gap: 5,
                padding: "6px 12px",
                fontSize: 12,
                color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 6px)",
                background: "transparent",
              }}
            >
              <GitCompare className="h-3 w-3" />
              {isZh ? "历史版本" : "History"}
            </button>
            <button
              type="button"
              onClick={() => void rebuildMemory()}
              disabled={isRebuilding}
              className="inline-flex items-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                gap: 5,
                padding: "6px 12px",
                fontSize: 12,
                color: "var(--color-codex-bg-elev)",
                background: "var(--color-codex-accent)",
                borderRadius: "var(--codex-r-sm, 6px)",
                border: "none",
              }}
            >
              {isRebuilding ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {isZh ? "重新汇总" : "Rebuild"}
            </button>
          </div>
        </div>

        {/* Pinned anchors */}
        <div
          style={{
            background:
              "linear-gradient(135deg, var(--color-codex-accent-bg) 0%, var(--color-codex-bg-elev) 100%)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
            padding: "16px 20px",
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 12 }}>
            <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <Star
                className="h-3.5 w-3.5 flex-shrink-0 fill-current"
                style={{ color: "var(--color-codex-accent)" }}
              />
              <h3
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "var(--color-codex-ink)",
                }}
              >
                {isZh ? `固定锚点 · ${totalAnchors} 项` : `Pinned anchors · ${totalAnchors}`}
              </h3>
              <span style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)" }}>
                {isZh
                  ? "会优先参与 AI 总结、风险判断与会前简报"
                  : "Used by AI summaries, risk calls, and meeting briefs"}
              </span>
            </div>
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            {anchorGroups.map((group) => {
              const ink = ANCHOR_TONE_COLOR[group.tone];
              return (
                <div key={group.key}>
                  <div
                    className="flex items-center"
                    style={{ gap: 7, marginBottom: 8 }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 99,
                        background: ink,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                        fontWeight: 500,
                      }}
                    >
                      {group.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        color: ink,
                        fontWeight: 500,
                        marginLeft: "auto",
                        fontFamily:
                          'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                      }}
                    >
                      {group.items.length}
                    </span>
                  </div>
                  {group.items.length === 0 ? (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        color: "var(--color-codex-ink-mute)",
                        lineHeight: 1.55,
                      }}
                    >
                      {isZh ? "暂无,点编辑添加。" : "None — open editor to add."}
                    </p>
                  ) : (
                    group.items.slice(0, 5).map((item, i) => (
                      <div
                        key={`${item}-${i}`}
                        className="flex items-start"
                        style={{ gap: 7, padding: "4px 0" }}
                      >
                        <span
                          style={{
                            width: 3,
                            height: 3,
                            marginTop: 7,
                            borderRadius: 99,
                            background: ink,
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12.5,
                            color: "var(--color-codex-ink)",
                            lineHeight: 1.55,
                          }}
                        >
                          {item}
                        </span>
                      </div>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAnchorEditor(group.key)}
                    className="inline-flex items-center"
                    style={{
                      marginTop: 8,
                      gap: 4,
                      fontSize: 11.5,
                      color: "var(--color-codex-accent)",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                    }}
                  >
                    {isZh ? "编辑" : "Edit"} →
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section divider */}
        <div className="flex items-center" style={{ gap: 10, padding: "4px 0" }}>
          <span
            style={{
              fontSize: 11,
              color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {isZh ? "结构化记忆" : "Structured memory"}
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--color-codex-line-soft)" }} />
        </div>

        {/* Structured memory cards */}
        {structuredSlots.map((slot) => (
          <StructuredSlotCard key={slot.key} slot={slot} isZh={isZh} />
        ))}

        {/* Inline anchor editor modal-ish region (kept simple) */}
        {showAnchorEditor ? (
          <div
            style={{
              background: "var(--color-codex-bg-elev)",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-md, 8px)",
              padding: 4,
            }}
          >
            <div
              className="flex items-center justify-between"
              style={{ padding: "8px 12px" }}
            >
              <span
                style={{ fontSize: 13, fontWeight: 500, color: "var(--color-codex-ink)" }}
              >
                {isZh ? "编辑锚点" : "Edit anchors"}
              </span>
              <button
                type="button"
                onClick={() => setShowAnchorEditor(null)}
                style={{
                  fontSize: 12,
                  color: "var(--color-codex-ink-mute)",
                  background: "transparent",
                  border: "none",
                }}
              >
                {isZh ? "收起" : "Close"}
              </button>
            </div>
            <ProjectMemorySlotCard
              description={
                showAnchorEditor === "key_risks"
                  ? isZh
                    ? "固定必须长期保留的风险判断。"
                    : "Pin the risk calls that should stay over time."
                  : showAnchorEditor === "open_questions"
                    ? isZh
                      ? "固定必须持续跟踪的开放问题。"
                      : "Pin the open questions that must stay visible."
                    : isZh
                      ? "固定关键干系人的偏好和沟通提醒。"
                      : "Pin stakeholder preferences and reminders."
              }
              isZh={isZh}
              onSaved={(nextMemory) => setMemory(nextMemory)}
              projectId={projectId}
              slotDetail={
                showAnchorEditor === "key_risks"
                  ? memory?.key_risks_detail
                  : showAnchorEditor === "open_questions"
                    ? memory?.open_questions_detail
                    : memory?.stakeholder_notes_detail
              }
              slotKey={showAnchorEditor}
              title={
                showAnchorEditor === "key_risks"
                  ? isZh
                    ? "固定风险要点"
                    : "Pinned Risk Notes"
                  : showAnchorEditor === "open_questions"
                    ? isZh
                      ? "固定开放问题"
                      : "Pinned Open Questions"
                    : isZh
                      ? "固定干系人提示"
                      : "Pinned Stakeholder Notes"
              }
            />
          </div>
        ) : null}
      </div>

      {/* Right rail */}
      <aside className="flex flex-col" style={{ gap: 16, position: "sticky", top: 76 }}>
        <CxPanel title={isZh ? "记忆健康度" : "Memory health"}>
          <div
            className="grid grid-cols-2"
            style={{ gap: 10, marginBottom: 10 }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-codex-ink-mute)",
                  marginBottom: 4,
                }}
              >
                {isZh ? "完整度" : "Completeness"}
              </div>
              <div className="flex items-baseline" style={{ gap: 3 }}>
                <span
                  style={{
                    fontFamily:
                      'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                    fontSize: 22,
                    color: "var(--color-codex-ink)",
                    fontWeight: 500,
                  }}
                >
                  {memoryHealth.score}
                </span>
                <span
                  style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}
                >
                  / 100
                </span>
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-codex-ink-mute)",
                  marginBottom: 4,
                }}
              >
                {isZh ? "新鲜度" : "Freshness"}
              </div>
              <span
                className="inline-flex items-center"
                style={{
                  gap: 5,
                  padding: "1px 8px",
                  fontSize: 11,
                  color: memoryStale
                    ? "var(--color-codex-warn)"
                    : "var(--color-codex-good)",
                  background: memoryStale
                    ? "color-mix(in oklch, var(--color-codex-warn) 12%, transparent)"
                    : "color-mix(in oklch, var(--color-codex-good) 12%, transparent)",
                  borderRadius: 999,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 99,
                    background: memoryStale
                      ? "var(--color-codex-warn)"
                      : "var(--color-codex-good)",
                  }}
                />
                {memoryUpdatedLabel}
              </span>
            </div>
          </div>
          <div
            style={{
              paddingTop: 10,
              borderTop: "1px solid var(--color-codex-line-soft)",
              fontSize: 12,
              color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
              lineHeight: 1.7,
            }}
          >
            <div className="flex justify-between">
              <span>{isZh ? "已填写槽位" : "Filled slots"}</span>
              <span
                style={{
                  fontFamily:
                    'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                }}
              >
                {memoryHealth.filled} / {memoryHealth.total}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{isZh ? "固定锚点" : "Pinned anchors"}</span>
              <span
                style={{
                  fontFamily:
                    'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  color: "var(--color-codex-good)",
                }}
              >
                {totalAnchors}
              </span>
            </div>
          </div>
        </CxPanel>

        <CxPanel title={isZh ? "自动更新建议" : "Auto-update hints"}>
          {memoryStale ? (
            <div className="flex items-start" style={{ gap: 10, padding: "8px 0" }}>
              <span
                style={{
                  width: 5,
                  marginTop: 4,
                  height: 5,
                  borderRadius: 99,
                  background: "var(--color-codex-warn)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--color-codex-ink)",
                    fontWeight: 500,
                  }}
                >
                  {isZh ? "项目近期有变化" : "Project recently changed"}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--color-codex-ink-mute)",
                    marginTop: 2,
                  }}
                >
                  {isZh
                    ? "建议重新汇总,把最新文档和对话纳入记忆。"
                    : "Rebuild to fold in the latest documents and chats."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void rebuildMemory()}
                disabled={isRebuilding}
                style={{
                  fontSize: 11,
                  color: "var(--color-codex-accent)",
                  padding: "2px 8px",
                  border: "1px solid var(--color-codex-accent-bg)",
                  background: "var(--color-codex-accent-bg)",
                  borderRadius: "var(--codex-r-sm, 6px)",
                  height: 22,
                  flexShrink: 0,
                }}
              >
                {isZh ? "重建" : "Rebuild"}
              </button>
            </div>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                padding: "6px 0",
                lineHeight: 1.55,
              }}
            >
              {isZh
                ? "暂无建议。下次有显著文档或对话变化时会自动提示。"
                : "No suggestions. Hints appear after significant doc or chat changes."}
            </p>
          )}
        </CxPanel>

        <CxPanel
          title={isZh ? "版本历史" : "Version history"}
          action={
            <button
              type="button"
              onClick={() => void refreshSnapshots()}
              style={{
                fontSize: 11.5,
                color: "var(--color-codex-ink-mute)",
                background: "transparent",
                border: "none",
              }}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          }
        >
          {snapshots.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                padding: "6px 0",
                lineHeight: 1.55,
              }}
            >
              {isZh
                ? "暂无快照。下次重新汇总会自动生成。"
                : "No snapshots yet. Next rebuild will create one."}
            </p>
          ) : (
            snapshots.slice(0, 5).map((snapshot, i) => {
              const isCurrent = snapshot.memory_version === memoryVersion;
              const isRollingBack = rollbackSnapshotId === snapshot.id;
              return (
                <div
                  key={snapshot.id}
                  className="flex"
                  style={{
                    gap: 10,
                    padding: "7px 0",
                    borderBottom:
                      i === Math.min(snapshots.length, 5) - 1
                        ? "none"
                        : "1px solid var(--color-codex-line-soft)",
                  }}
                >
                  <span
                    style={{
                      fontFamily:
                        'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                      fontSize: 11.5,
                      color: isCurrent
                        ? "var(--color-codex-accent)"
                        : "var(--color-codex-ink-mute)",
                      fontWeight: 500,
                      minWidth: 32,
                    }}
                  >
                    v{snapshot.memory_version}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="truncate"
                      style={{ fontSize: 12.5, color: "var(--color-codex-ink)" }}
                    >
                      {snapshot.trigger
                        || (isZh ? "手动生成" : "Manual rebuild")}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-codex-ink-mute)",
                        marginTop: 1,
                      }}
                    >
                      {formatDateOnly(snapshot.created_at)}
                    </div>
                  </div>
                  {!isCurrent ? (
                    <button
                      type="button"
                      onClick={() => void rollbackSnapshot(snapshot)}
                      disabled={isRollingBack}
                      title={isZh ? "回滚到此版本" : "Restore this version"}
                      style={{
                        fontSize: 11,
                        color: "var(--color-codex-ink-mute)",
                        background: "transparent",
                        border: "none",
                        padding: "2px 4px",
                      }}
                    >
                      {isRollingBack ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3" />
                      )}
                    </button>
                  ) : (
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--color-codex-good)",
                      }}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
              );
            })
          )}
        </CxPanel>
      </aside>
    </div>
  );
}

// Re-export to satisfy lingering imports.
export { Brain };
