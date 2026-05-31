import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { api } from "../../api/client";
import type {
  ClientMemory,
  ClientMemoryResponse,
  ClientStakeholder,
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
} from "../../types/api";
import { CxPanel } from "./ProjectOverviewPanels";

interface ProjectStakeholdersTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
}

interface ClientSummary {
  id: number;
  name: string;
  industry?: string;
  contact?: string;
}

interface RowStakeholder {
  id: string;
  name: string;
  role: string;
  level: "决策" | "影响" | "执行";
  relationship: "支持" | "积极" | "推动" | "中立" | "保留";
  influence: number;
  concerns: string;
  lastAction: string;
}

function levelLabel(stakeholder: ClientStakeholder, isZh: boolean): RowStakeholder["level"] {
  const value = (stakeholder.organization_level || stakeholder.influence_type || "").trim();
  if (/决策|deci/i.test(value)) return "决策";
  if (/影响|infl/i.test(value)) return "影响";
  return "执行";
}

function relationshipLabel(stakeholder: ClientStakeholder): RowStakeholder["relationship"] {
  const value = (stakeholder.relationship_status || "").trim();
  if (!value) return "中立";
  if (/支持|advoc/i.test(value)) return "支持";
  if (/积极|active|positive/i.test(value)) return "积极";
  if (/推动|drive/i.test(value)) return "推动";
  if (/保留|skep|reserv|block/i.test(value)) return "保留";
  return "中立";
}

function influenceScore(level: RowStakeholder["level"], relationship: RowStakeholder["relationship"]): number {
  const levelBase = level === "决策" ? 80 : level === "影响" ? 55 : 30;
  const relAdj =
    relationship === "支持" || relationship === "积极"
      ? 10
      : relationship === "推动"
        ? 5
        : relationship === "保留"
          ? -10
          : 0;
  return Math.max(5, Math.min(95, levelBase + relAdj));
}

function normalizeClientName(value: string) {
  return value.trim().toLowerCase();
}

const RELATIONSHIP_COLOR: Record<RowStakeholder["relationship"], string> = {
  支持: "var(--color-codex-good)",
  积极: "var(--color-codex-good)",
  推动: "var(--color-codex-accent)",
  中立: "var(--color-codex-ink-mute)",
  保留: "var(--color-codex-warn)",
};

const LEVEL_PILL: Record<RowStakeholder["level"], { fg: string; bg: string }> = {
  决策: {
    fg: "var(--color-codex-accent-ink)",
    bg: "var(--color-codex-accent-bg)",
  },
  影响: {
    fg: "var(--color-codex-ink-soft, var(--color-codex-ink))",
    bg: "var(--color-codex-bg-tint)",
  },
  执行: {
    fg: "var(--color-codex-ink-mute)",
    bg: "var(--color-codex-bg-tint)",
  },
};

export function ProjectStakeholdersTab({ projectDetail, projectId }: ProjectStakeholdersTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const { project } = projectDetail;
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [clientMemory, setClientMemory] = useState<ClientMemory | null>(null);
  const [structuredStakeholders, setStructuredStakeholders] = useState<ClientStakeholder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const memoryData = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
        if (cancelled) return;
        setMemory(memoryData.memory);

        const clientName = project.client?.trim() || "";
        if (!clientName) {
          setClient(null);
          setClientMemory(null);
          setStructuredStakeholders([]);
          return;
        }
        const clients = await api.get<ClientSummary[]>("/clients");
        if (cancelled) return;
        const matchedClient = clients.find(
          (item) => normalizeClientName(item.name) === normalizeClientName(clientName),
        );
        setClient(matchedClient || null);
        if (!matchedClient) {
          setClientMemory(null);
          setStructuredStakeholders([]);
          return;
        }
        const [clientMemoryData, stakeholderData] = await Promise.all([
          api.get<ClientMemoryResponse>(`/clients/${matchedClient.id}/memory`),
          api.get<ClientStakeholder[]>(`/clients/${matchedClient.id}/stakeholders`),
        ]);
        if (!cancelled) {
          setClientMemory(clientMemoryData.memory);
          setStructuredStakeholders(stakeholderData);
        }
      } catch (error) {
        console.error("Failed to load project stakeholders:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [project.client, projectId]);

  const rows: RowStakeholder[] = useMemo(() => {
    const fromStructured = structuredStakeholders.map((stakeholder) => {
      const level = levelLabel(stakeholder, isZh);
      const relationship = relationshipLabel(stakeholder);
      return {
        id: `s-${stakeholder.id}`,
        name: stakeholder.name || (isZh ? "未命名" : "Unnamed"),
        role: stakeholder.role || stakeholder.organization_level || "—",
        level,
        relationship,
        influence: influenceScore(level, relationship),
        concerns:
          stakeholder.concerns
          || stakeholder.note
          || stakeholder.communication_preference
          || "",
        lastAction: stakeholder.last_action || "",
      } satisfies RowStakeholder;
    });
    if (fromStructured.length) return fromStructured;
    const contacts = clientMemory?.key_contacts || [];
    return contacts.map((contact, i) => ({
      id: `c-${i}`,
      name: contact.name || (isZh ? "未命名" : "Unnamed"),
      role: contact.role || "—",
      level: "执行" as const,
      relationship: "中立" as const,
      influence: 40,
      concerns: contact.note || "",
      lastAction: "",
    }));
  }, [clientMemory?.key_contacts, isZh, structuredStakeholders]);

  const decisionCount = rows.filter((row) => row.level === "决策").length;
  const influenceCount = rows.filter((row) => row.level === "影响").length;
  const executionCount = rows.filter((row) => row.level === "执行").length;

  const pinnedHints = memory?.stakeholder_notes_detail?.pinned?.filter(Boolean).slice(0, 5) || [];

  const decisionStructure = useMemo(() => {
    const decisionMakers = rows
      .filter((row) => row.level === "决策")
      .map((row) => `${row.name} (${row.role})`);
    const influencers = rows
      .filter((row) => row.level === "影响")
      .map((row) => `${row.name} (${row.role})`);
    const executors = rows
      .filter((row) => row.level === "执行")
      .map((row) => `${row.name} (${row.role})`);
    return { decisionMakers, influencers, executors };
  }, [rows]);

  return (
    <div
      className="grid gap-5"
      style={{ gridTemplateColumns: "minmax(0, 1fr) 320px", alignItems: "start" }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: 18 }}>
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between" style={{ gap: 12 }}>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
                letterSpacing: "-0.015em",
              }}
            >
              {isZh ? `关键干系人 · ${rows.length} 人` : `Stakeholders · ${rows.length}`}
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
              }}
            >
              {isZh
                ? `${decisionCount} 决策 · ${influenceCount} 影响 · ${executionCount} 执行 · 与客户档案联动`
                : `${decisionCount} decision · ${influenceCount} influence · ${executionCount} execution · linked to client record`}
            </p>
          </div>
          <div className="flex" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                if (client) navigate(`/clients/${client.id}/memory`);
              }}
              disabled={!client}
              className="inline-flex items-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
              <RefreshCw className="h-3 w-3" />
              {isZh ? "从客户记忆同步" : "Sync from client memory"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (client) navigate(`/clients/${client.id}/stakeholders`);
              }}
              disabled={!client}
              className="inline-flex items-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                gap: 5,
                padding: "6px 12px",
                fontSize: 12,
                background: "var(--color-codex-ink)",
                color: "var(--color-codex-bg-elev)",
                borderRadius: "var(--codex-r-sm, 6px)",
                border: "none",
              }}
            >
              <Plus className="h-3 w-3" />
              {isZh ? "添加" : "Add"}
            </button>
          </div>
        </div>

        {/* Influence map */}
        <div
          style={{
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
            padding: "16px 20px",
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ marginBottom: 14 }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-codex-ink)",
              }}
            >
              {isZh ? "影响力地图" : "Influence map"}
            </h3>
            <span style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}>
              {isZh
                ? "横轴:影响力 · 圆点大小:支持度"
                : "x: influence · dot size: support"}
            </span>
          </div>
          <div
            className="relative"
            style={{
              height: 80,
              borderBottom: "1px solid var(--color-codex-line-soft)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "50%",
                height: 1,
                background: "var(--color-codex-line-soft)",
              }}
            />
            {rows.map((row) => {
              const support =
                row.relationship === "支持" || row.relationship === "积极"
                  ? 80
                  : row.relationship === "推动"
                    ? 60
                    : row.relationship === "保留"
                      ? 30
                      : 50;
              const size =
                row.relationship === "支持" || row.relationship === "积极"
                  ? 22
                  : row.relationship === "推动"
                    ? 18
                    : 16;
              const positive =
                row.relationship === "支持" || row.relationship === "积极";
              return (
                <div
                  key={row.id}
                  title={`${row.name} · ${row.relationship}`}
                  style={{
                    position: "absolute",
                    left: `${row.influence}%`,
                    bottom: `${support}%`,
                    transform: "translate(-50%, 50%)",
                  }}
                >
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: size,
                      height: size,
                      borderRadius: 99,
                      background: positive
                        ? "var(--color-codex-accent-bg)"
                        : "var(--color-codex-bg-tint)",
                      color: positive
                        ? "var(--color-codex-accent-ink)"
                        : "var(--color-codex-ink-soft, var(--color-codex-ink))",
                      border: `1.5px solid ${
                        positive
                          ? "var(--color-codex-accent)"
                          : "var(--color-codex-line-strong, var(--color-codex-line))"
                      }`,
                      fontSize: 10,
                      fontWeight: 500,
                    }}
                  >
                    {row.name.slice(0, 1)}
                  </span>
                </div>
              );
            })}
          </div>
          <div
            className="flex justify-between"
            style={{
              marginTop: 4,
              fontSize: 10,
              color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
            }}
          >
            <span>{isZh ? "低影响" : "Low influence"}</span>
            <span>{isZh ? "高影响" : "High influence"}</span>
          </div>
        </div>

        {/* Table */}
        <div
          style={{
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
            overflow: "hidden",
          }}
        >
          <div
            className="grid"
            style={{
              gridTemplateColumns: "1.4fr 0.7fr 0.6fr 0.7fr 1.4fr 0.8fr 14px",
              padding: "12px 16px",
              fontSize: 11,
              color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
              borderBottom: "1px solid var(--color-codex-line)",
            }}
          >
            <span>{isZh ? "姓名 · 角色" : "Name · Role"}</span>
            <span>{isZh ? "层级" : "Level"}</span>
            <span>{isZh ? "关系" : "Relation"}</span>
            <span>{isZh ? "影响" : "Influence"}</span>
            <span>{isZh ? "关注点" : "Concerns"}</span>
            <span>{isZh ? "最近接触" : "Last contact"}</span>
            <span />
          </div>
          {loading ? (
            <div
              className="flex items-center justify-center"
              style={{ padding: "32px 16px", gap: 8, color: "var(--color-codex-ink-mute)" }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span style={{ fontSize: 12 }}>
                {isZh ? "加载干系人…" : "Loading stakeholders…"}
              </span>
            </div>
          ) : rows.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--color-codex-ink-mute)",
                fontSize: 12.5,
              }}
            >
              {isZh
                ? "暂无干系人。从客户记忆同步或手动添加。"
                : "No stakeholders yet. Sync from client memory or add manually."}
            </div>
          ) : (
            rows.map((row, i) => {
              const pill = LEVEL_PILL[row.level];
              const relColor = RELATIONSHIP_COLOR[row.relationship];
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    if (client) navigate(`/clients/${client.id}/stakeholders`);
                  }}
                  className="grid w-full transition-colors hover:[background:var(--color-codex-bg-tint)]"
                  style={{
                    gridTemplateColumns: "1.4fr 0.7fr 0.6fr 0.7fr 1.4fr 0.8fr 14px",
                    padding: "14px 16px",
                    gap: 12,
                    alignItems: "center",
                    borderTop: i === 0 ? "none" : "1px solid var(--color-codex-line-soft)",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: client ? "pointer" : "default",
                  }}
                >
                  <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
                    <span
                      className="inline-flex flex-shrink-0 items-center justify-center"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 99,
                        background: "var(--color-codex-accent-bg)",
                        color: "var(--color-codex-accent-ink)",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {row.name.slice(0, 1)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 13,
                          color: "var(--color-codex-ink)",
                          fontWeight: 500,
                        }}
                      >
                        {row.name}
                      </div>
                      <div
                        className="truncate"
                        style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}
                      >
                        {row.role}
                      </div>
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center"
                    style={{
                      gap: 4,
                      padding: "1px 7px",
                      fontSize: 10.5,
                      color: pill.fg,
                      background: pill.bg,
                      borderRadius: 999,
                      width: "fit-content",
                    }}
                  >
                    {row.level}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: relColor,
                    }}
                  >
                    {row.relationship}
                  </span>
                  <div className="flex items-center" style={{ gap: 6 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 3,
                        background: "var(--color-codex-bg-sunken, var(--color-codex-bg-tint))",
                        borderRadius: 99,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${row.influence}%`,
                          background: "var(--color-codex-accent)",
                          borderRadius: 99,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--color-codex-ink-mute)",
                        fontFamily:
                          'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                      }}
                    >
                      {row.influence}
                    </span>
                  </div>
                  <div
                    className="line-clamp-2"
                    style={{
                      fontSize: 12.5,
                      color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                      lineHeight: 1.5,
                    }}
                  >
                    {row.concerns || "—"}
                  </div>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "var(--color-codex-ink-mute)",
                    }}
                  >
                    {row.lastAction || "—"}
                  </span>
                  <ArrowRight
                    className="h-3 w-3"
                    style={{ color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))" }}
                  />
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right rail */}
      <aside className="flex flex-col" style={{ gap: 16, position: "sticky", top: 76 }}>
        <CxPanel title={isZh ? "客户决策结构" : "Decision structure"}>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--color-codex-ink)",
            }}
          >
            <div
              style={{
                paddingBottom: 10,
                borderBottom: "1px solid var(--color-codex-line-soft)",
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}>
                {isZh ? "最终决策" : "Final approvers"}
              </div>
              <div style={{ marginTop: 2, fontWeight: 500 }}>
                {decisionStructure.decisionMakers.length
                  ? decisionStructure.decisionMakers.join(" · ")
                  : isZh
                    ? "未识别"
                    : "Unknown"}
              </div>
            </div>
            <div
              style={{
                paddingBottom: 10,
                borderBottom: "1px solid var(--color-codex-line-soft)",
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}>
                {isZh ? "关键影响" : "Influencers"}
              </div>
              <div style={{ marginTop: 2 }}>
                {decisionStructure.influencers.length
                  ? decisionStructure.influencers.join(" · ")
                  : isZh
                    ? "未识别"
                    : "Unknown"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}>
                {isZh ? "执行推动" : "Drivers"}
              </div>
              <div style={{ marginTop: 2 }}>
                {decisionStructure.executors.length
                  ? decisionStructure.executors.join(" · ")
                  : isZh
                    ? "未识别"
                    : "Unknown"}
              </div>
            </div>
          </div>
        </CxPanel>

        <CxPanel title={isZh ? "沟通节奏建议" : "Comms cadence"}>
          {pinnedHints.length ? (
            pinnedHints.map((hint, i) => (
              <div
                key={`${hint}-${i}`}
                className="flex"
                style={{
                  gap: 10,
                  padding: "8px 0",
                  borderBottom:
                    i === pinnedHints.length - 1
                      ? "none"
                      : "1px solid var(--color-codex-line-soft)",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    marginTop: 7,
                    borderRadius: 99,
                    background: "var(--color-codex-accent)",
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    color: "var(--color-codex-ink)",
                    lineHeight: 1.55,
                  }}
                >
                  {hint}
                </div>
              </div>
            ))
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
                ? "暂无固定沟通建议。在项目记忆的「干系人提示」中固定。"
                : "No pinned cadence yet. Pin in Memory → stakeholder notes."}
            </p>
          )}
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/memory`)}
            className="inline-flex items-center"
            style={{
              gap: 4,
              marginTop: 8,
              fontSize: 11.5,
              color: "var(--color-codex-accent)",
              background: "transparent",
              border: "none",
              padding: 0,
            }}
          >
            {isZh ? "去固定" : "Pin →"}
          </button>
        </CxPanel>

        <CxPanel
          title={isZh ? "AI 提示" : "AI hint"}
          subtitle={isZh ? "基于干系人画像" : "Based on the stakeholder map"}
        >
          <div
            style={{
              background: "var(--color-codex-accent-bg)",
              padding: "10px 12px",
              borderRadius: "var(--codex-r-sm, 6px)",
              fontSize: 12.5,
              color: "var(--color-codex-accent-ink)",
              lineHeight: 1.6,
            }}
          >
            <Sparkles
              className="mr-1 inline-block h-3 w-3"
              style={{ verticalAlign: -1 }}
            />
            {rows.length === 0
              ? isZh
                ? "目前没有结构化干系人。建议先把客户的关键联系人在客户空间登记,再回到这里同步。"
                : "No structured stakeholders. Register key contacts in the client workspace and sync back here."
              : rows.find((row) => row.level === "决策" && row.relationship === "保留")
                ? isZh
                  ? "存在持保留态度的决策人,建议在下次客户接触前单独沟通。"
                  : "A decision-maker is reserved — schedule a 1:1 before the next touchpoint."
                : decisionCount < 2
                  ? isZh
                    ? "决策面较窄,建议补齐 1-2 名关键影响人,降低单点风险。"
                    : "Decision surface is narrow — add 1-2 influencers to reduce single-point risk."
                  : isZh
                    ? "干系人画像基础充足,关注下次例会的决策人共识更新即可。"
                    : "Map looks solid — focus on decision-maker alignment in the next meeting."}
          </div>
        </CxPanel>
      </aside>
    </div>
  );
}
