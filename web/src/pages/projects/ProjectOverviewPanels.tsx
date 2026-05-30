/**
 * Overview tab panels, mapped 1:1 to the Codex handoff
 * (`direction-codex-project-1.jsx`).
 *
 * Layout (designed):
 *   Main column (vertical stack)
 *     1. AI 项目快照            — one-liner + 3 highlight chips
 *     2. 项目记忆摘要 + 会前 30 秒卡 (side-by-side)
 *     3. 最近动态              — vertical timeline
 *   Right rail (320px)
 *     · 项目档案
 *     · 关键干系人
 *     · 项目团队
 *
 * Data is sourced from existing hooks — see
 * ``useProjectOverviewData`` and ``ProjectDetail``. Stakeholder preview
 * derives from ``memory.stakeholder_notes_detail.pinned`` so we don't
 * need a second network roundtrip for a small preview list.
 */
import type { ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  User,
  UserPlus,
} from "lucide-react";
import type {
  Milestone,
  Project,
  ProjectFile,
  ProjectMember,
  ProjectMemory,
  ProjectTodo,
} from "../../types/api";
import { resolveProjectStage } from "../../types/enums";
import { formatDateOnly, parseAppDateTime } from "../../utils/timezone";

// ------- Shared primitives ------------------------------------------------

export function CxPanel({
  title,
  subtitle,
  action,
  children,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        background: "var(--color-codex-bg-elev)",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-md, 8px)",
        padding: "18px 20px",
        ...style,
      }}
    >
      {(title || action) && (
        <div
          className="flex items-start justify-between"
          style={{ marginBottom: 14, gap: 12 }}
        >
          <div>
            {title ? (
              <h3
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 12,
                  color: "var(--color-codex-ink-mute)",
                  lineHeight: 1.5,
                }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function PanelLinkButton({
  children,
  onClick,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center transition-colors"
      style={{
        gap: 4,
        fontSize: 11.5,
        color: "var(--color-codex-accent)",
        background: "transparent",
        border: "none",
        padding: 0,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ------- AI Snapshot -----------------------------------------------------

interface AISnapshotPanelProps {
  briefText: string;
  isZh: boolean;
  loading: boolean;
  memory: ProjectMemory | null;
  memoryStale: boolean;
  memoryUpdatedAt?: string | null;
  memoryVersion?: number;
  onRegenerate: () => void;
  ownerLabel?: string;
}

export function ProjectOverviewAISnapshotPanel({
  briefText,
  isZh,
  loading,
  memory,
  memoryStale,
  memoryUpdatedAt,
  memoryVersion,
  onRegenerate,
  ownerLabel,
}: AISnapshotPanelProps) {
  const nextAction = memory?.next_actions?.[0]?.trim();
  const stakeholderHint = memory?.stakeholder_notes_detail?.pinned?.[0]?.trim()
    || memory?.stakeholder_notes?.[0]?.trim();
  const memoryStatusLabel = memoryStale
    ? isZh ? "记忆待更新" : "Memory stale"
    : memoryVersion
      ? isZh ? `已同步 · v${memoryVersion}` : `Synced · v${memoryVersion}`
      : isZh ? "暂无记忆" : "No memory yet";
  const memoryStatusTone: "good" | "warn" | "neutral" = memoryStale
    ? "warn"
    : memoryVersion
      ? "good"
      : "neutral";

  const updatedAtLabel = memoryUpdatedAt
    ? formatDateOnly(memoryUpdatedAt)
    : isZh
      ? "尚未生成"
      : "Not generated yet";

  const subtitle = isZh
    ? `基于项目记忆 v${memoryVersion ?? 0} · ${updatedAtLabel}`
    : `Based on project memory v${memoryVersion ?? 0} · ${updatedAtLabel}`;

  return (
    <CxPanel
      title={isZh ? "AI 项目快照" : "AI Snapshot"}
      subtitle={subtitle}
      action={
        <PanelLinkButton
          onClick={onRegenerate}
          icon={
            loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )
          }
        >
          {isZh ? "重新生成" : "Regenerate"}
        </PanelLinkButton>
      }
    >
      <p
        style={{
          margin: "0 0 14px",
          fontSize: 14,
          color: "var(--color-codex-ink)",
          lineHeight: 1.75,
          minHeight: 22,
        }}
      >
        {briefText.trim()
          ? briefText
          : isZh
            ? "暂无 AI 项目快照,点击「重新生成」让 Aria 综合最近的会议和文档生成。"
            : "No AI snapshot yet. Click Regenerate to synthesize one from recent meetings and documents."}
      </p>

      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{
          gap: 14,
          paddingTop: 14,
          borderTop: "1px solid var(--color-codex-line-soft)",
        }}
      >
        <HighlightChip
          icon={<ArrowRight className="h-3 w-3" />}
          label={isZh ? "下一动作" : "Next action"}
          value={
            nextAction
              || (isZh ? "尚未在记忆中标记" : "Not yet captured in memory")
          }
        />
        <HighlightChip
          icon={<User className="h-3 w-3" />}
          label={isZh ? "关键干系人" : "Key stakeholder"}
          value={
            stakeholderHint
              || ownerLabel
              || (isZh ? "尚未填写" : "Not captured")
          }
        />
        <HighlightChip
          icon={<Check className="h-3 w-3" />}
          label={isZh ? "记忆状态" : "Memory status"}
          value={memoryStatusLabel}
          tone={memoryStatusTone}
        />
      </div>
    </CxPanel>
  );
}

function HighlightChip({
  icon,
  label,
  value,
  tone = "accent",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "accent" | "good" | "warn" | "neutral";
}) {
  const palette =
    tone === "good"
      ? { bg: "color-mix(in oklch, var(--color-codex-good) 14%, transparent)", ink: "var(--color-codex-good)" }
      : tone === "warn"
        ? { bg: "color-mix(in oklch, var(--color-codex-warn) 14%, transparent)", ink: "var(--color-codex-warn)" }
        : tone === "neutral"
          ? { bg: "var(--color-codex-bg-tint)", ink: "var(--color-codex-ink-mute)" }
          : { bg: "var(--color-codex-accent-bg)", ink: "var(--color-codex-accent)" };
  return (
    <div className="flex" style={{ gap: 10 }}>
      <span
        className="inline-flex flex-shrink-0 items-center justify-center"
        style={{
          width: 26,
          height: 26,
          borderRadius: "var(--codex-r-sm, 6px)",
          background: palette.bg,
          color: palette.ink,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--color-codex-ink-mute)",
            marginBottom: 2,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--color-codex-ink)",
            fontWeight: 500,
            lineHeight: 1.45,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

// ------- Memory excerpt --------------------------------------------------

export function ProjectOverviewMemoryExcerptPanel({
  isZh,
  memory,
  memoryVersion,
  onOpenMemory,
}: {
  isZh: boolean;
  memory: ProjectMemory | null;
  memoryVersion?: number;
  onOpenMemory: () => void;
}) {
  const rows: Array<[string, string]> = [
    [
      isZh ? "项目阶段" : "Stage",
      memory?.current_stage?.trim() || (isZh ? "—" : "—"),
    ],
    [
      isZh ? "当前目标" : "Objective",
      memory?.current_objective?.trim() || (isZh ? "—" : "—"),
    ],
    [
      isZh ? "关键风险" : "Key risk",
      memory?.key_risks?.[0]?.trim() || (isZh ? "—" : "—"),
    ],
    [
      isZh ? "下一步" : "Next step",
      memory?.next_actions?.[0]?.trim() || (isZh ? "—" : "—"),
    ],
  ];

  return (
    <CxPanel
      title={isZh ? "项目记忆摘要" : "Memory excerpt"}
      subtitle={
        memoryVersion
          ? isZh
            ? `结构化沉淀 · v${memoryVersion}`
            : `Structured memory · v${memoryVersion}`
          : isZh
            ? "结构化沉淀"
            : "Structured memory"
      }
      action={
        <PanelLinkButton onClick={onOpenMemory}>
          {isZh ? "查看完整 →" : "Open →"}
        </PanelLinkButton>
      }
    >
      <div>
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className="grid"
            style={{
              gridTemplateColumns: "75px 1fr",
              padding: "8px 0",
              borderBottom:
                i === rows.length - 1
                  ? "none"
                  : "1px solid var(--color-codex-line-soft)",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                fontSize: 11.5,
                color: "var(--color-codex-ink-mute)",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--color-codex-ink)",
                lineHeight: 1.55,
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
    </CxPanel>
  );
}

// ------- Briefing 30-sec preview ----------------------------------------

export function ProjectOverviewBriefingPreviewPanel({
  isZh,
  memory,
  onOpenBriefing,
}: {
  isZh: boolean;
  memory: ProjectMemory | null;
  onOpenBriefing: () => void;
}) {
  const rows: Array<{ label: string; value: string; tone: "good" | "warn" | "neutral" }> = [
    {
      label: isZh ? "建议说" : "Lead with",
      value: memory?.next_actions?.[0]?.trim()
        || memory?.delivery_signals?.[0]?.trim()
        || (isZh ? "—" : "—"),
      tone: "good",
    },
    {
      label: isZh ? "避开" : "Avoid",
      value: memory?.key_risks?.[0]?.trim() || (isZh ? "—" : "—"),
      tone: "warn",
    },
    {
      label: isZh ? "确认" : "Confirm",
      value: memory?.open_questions?.[0]?.trim() || (isZh ? "—" : "—"),
      tone: "neutral",
    },
  ];

  return (
    <CxPanel
      title={isZh ? "会前 30 秒卡" : "30-second card"}
      subtitle={isZh ? "下次例会前自动准备" : "Ready for the next meeting"}
      action={
        <PanelLinkButton onClick={onOpenBriefing}>
          {isZh ? "详细 →" : "Detail →"}
        </PanelLinkButton>
      }
    >
      <div className="grid grid-cols-1" style={{ gap: 10 }}>
        {rows.map((b, i) => (
          <div
            key={b.label}
            className="flex"
            style={{
              gap: 12,
              padding: "8px 0",
              borderBottom:
                i === rows.length - 1
                  ? "none"
                  : "1px solid var(--color-codex-line-soft)",
            }}
          >
            <span
              className="flex-shrink-0"
              style={{
                width: 36,
                color:
                  b.tone === "good"
                    ? "var(--color-codex-good)"
                    : b.tone === "warn"
                      ? "var(--color-codex-warn)"
                      : "var(--color-codex-ink-mute)",
                fontSize: 11.5,
                fontWeight: 500,
                paddingTop: 1,
              }}
            >
              {b.label}
            </span>
            <span
              style={{
                fontSize: 13,
                color: "var(--color-codex-ink)",
                lineHeight: 1.55,
              }}
            >
              {b.value}
            </span>
          </div>
        ))}
      </div>
    </CxPanel>
  );
}

// ------- Activity timeline -----------------------------------------------

type TimelineEntry = {
  at: number;
  label: string;
  text: string;
  tone: "accent" | "good" | "warn" | "neutral";
};

export function ProjectOverviewActivityTimelinePanel({
  files,
  isZh,
  memoryUpdatedAt,
  memoryVersion,
  milestones,
  onOpenChat,
  todos,
}: {
  files: ProjectFile[];
  isZh: boolean;
  memoryUpdatedAt?: string | null;
  memoryVersion?: number;
  milestones: Milestone[];
  onOpenChat?: () => void;
  todos: ProjectTodo[];
}) {
  const entries: TimelineEntry[] = [];
  for (const file of files.slice(0, 4)) {
    const at = parseAppDateTime(file.uploaded_at).getTime();
    if (!Number.isFinite(at)) continue;
    entries.push({
      at,
      label: file.name,
      text: isZh ? `上传文档 · ${file.name}` : `Uploaded · ${file.name}`,
      tone: "neutral",
    });
  }
  for (const milestone of milestones.slice(0, 3)) {
    const at = parseAppDateTime(milestone.created_at || "").getTime();
    if (!Number.isFinite(at)) continue;
    entries.push({
      at,
      label: milestone.title,
      text: isZh
        ? `里程碑 · ${milestone.title}`
        : `Milestone · ${milestone.title}`,
      tone: milestone.is_done ? "good" : "accent",
    });
  }
  for (const todo of todos.slice(0, 3)) {
    const at = parseAppDateTime(todo.updated_at || todo.created_at || "").getTime();
    if (!Number.isFinite(at)) continue;
    entries.push({
      at,
      label: todo.content,
      text: isZh ? `待办 · ${todo.content}` : `Todo · ${todo.content}`,
      tone: todo.is_done ? "good" : "warn",
    });
  }
  if (memoryUpdatedAt) {
    const at = parseAppDateTime(memoryUpdatedAt).getTime();
    if (Number.isFinite(at)) {
      entries.push({
        at,
        label: `v${memoryVersion ?? 0}`,
        text: isZh
          ? `项目记忆已更新 · v${memoryVersion ?? 0}`
          : `Memory updated · v${memoryVersion ?? 0}`,
        tone: "accent",
      });
    }
  }
  const ordered = entries
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  return (
    <CxPanel
      title={isZh ? "最近动态" : "Recent activity"}
      subtitle={isZh ? "近期项目变化" : "Last few project changes"}
      action={
        onOpenChat ? (
          <PanelLinkButton onClick={onOpenChat}>
            {isZh ? "全部 →" : "All →"}
          </PanelLinkButton>
        ) : null
      }
    >
      {ordered.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--color-codex-ink-mute)",
            padding: "12px 0",
          }}
        >
          {isZh
            ? "暂无动态。上传文档、添加里程碑或对话生成第一条记录。"
            : "No recent activity. Upload docs or chat to start the timeline."}
        </p>
      ) : (
        <div className="relative" style={{ paddingLeft: 14 }}>
          <div
            style={{
              position: "absolute",
              left: 4,
              top: 4,
              bottom: 4,
              width: 1,
              background: "var(--color-codex-line)",
            }}
          />
          {ordered.map((e, i) => {
            const dotColor =
              e.tone === "accent"
                ? "var(--color-codex-accent)"
                : e.tone === "good"
                  ? "var(--color-codex-good)"
                  : e.tone === "warn"
                    ? "var(--color-codex-warn)"
                    : "var(--color-codex-ink-faint, var(--color-codex-ink-mute))";
            return (
              <div
                key={`${e.text}-${i}`}
                className="grid"
                style={{
                  gridTemplateColumns: "76px auto 1fr",
                  gap: 12,
                  padding: "9px 0",
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--color-codex-ink-mute)",
                    paddingTop: 1,
                  }}
                >
                  {formatDateOnly(new Date(e.at).toISOString())}
                </span>
                <span
                  className="flex-shrink-0"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: "var(--color-codex-bg-elev)",
                    border: `1.5px solid ${dotColor}`,
                    marginTop: 6,
                    position: "relative",
                    left: -14,
                  }}
                />
                <div style={{ marginLeft: -10 }}>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                      lineHeight: 1.55,
                    }}
                  >
                    {e.text}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CxPanel>
  );
}

// ------- Right rail ------------------------------------------------------

export function ProjectOverviewArchivePanel({
  contractAmountText,
  createdAt,
  isZh,
  ownerLabel,
  project,
}: {
  contractAmountText: string;
  createdAt?: string | null;
  isZh: boolean;
  ownerLabel?: string;
  project: Project;
}) {
  const stage = resolveProjectStage(project.status);
  const rows: Array<[string, string]> = [];
  rows.push([isZh ? "客户" : "Client", project.client || (isZh ? "—" : "—")]);
  rows.push([
    isZh ? "状态" : "Status",
    isZh ? stage.labelZh : stage.label,
  ]);
  if (contractAmountText.trim()) {
    rows.push([isZh ? "合同金额" : "Contract", contractAmountText]);
  }
  if (createdAt) {
    rows.push([isZh ? "创建于" : "Created", createdAt]);
  }
  if (ownerLabel) {
    rows.push([isZh ? "负责人" : "Owner", ownerLabel]);
  }

  return (
    <CxPanel title={isZh ? "项目档案" : "Project facts"}>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
          lineHeight: 1.85,
        }}
      >
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex"
            style={{ justifyContent: "space-between", gap: 12, padding: "4px 0" }}
          >
            <span style={{ color: "var(--color-codex-ink-mute)" }}>{k}</span>
            <span
              className="text-right"
              style={{ color: "var(--color-codex-ink)", minWidth: 0 }}
            >
              {v}
            </span>
          </div>
        ))}
      </div>
    </CxPanel>
  );
}

export function ProjectOverviewStakeholdersPreviewPanel({
  isZh,
  memory,
  onOpenStakeholders,
}: {
  isZh: boolean;
  memory: ProjectMemory | null;
  onOpenStakeholders: () => void;
}) {
  const items = (memory?.stakeholder_notes_detail?.pinned?.length
    ? memory.stakeholder_notes_detail.pinned
    : memory?.stakeholder_notes || []
  )
    .map((note) => note.trim())
    .filter(Boolean)
    .slice(0, 3);

  return (
    <CxPanel
      title={isZh ? "关键干系人" : "Key stakeholders"}
      action={
        <PanelLinkButton onClick={onOpenStakeholders}>
          {isZh ? "详细 →" : "Detail →"}
        </PanelLinkButton>
      }
    >
      {items.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--color-codex-ink-mute)",
            lineHeight: 1.6,
            padding: "4px 0",
          }}
        >
          {isZh
            ? "暂无干系人提示。在干系人页签登记决策链或在对话中固定干系人锚点。"
            : "No stakeholder notes yet. Capture them in the Stakeholders tab or pin from chat."}
        </p>
      ) : (
        items.map((note, i) => {
          const [head, ...rest] = note.split(/[·:|]/);
          const headLabel = head.trim() || note;
          const restLabel = rest.join(" ").trim();
          const initial = headLabel.slice(0, 1) || "·";
          return (
            <div
              key={`${note}-${i}`}
              className="flex items-center"
              style={{
                gap: 10,
                padding: "8px 0",
                borderBottom:
                  i === items.length - 1
                    ? "none"
                    : "1px solid var(--color-codex-line-soft)",
              }}
            >
              <span
                className="inline-flex flex-shrink-0 items-center justify-center"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 99,
                  background: "var(--color-codex-accent-bg)",
                  color: "var(--color-codex-accent-ink)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {initial}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="truncate"
                  style={{
                    fontSize: 13,
                    color: "var(--color-codex-ink)",
                    fontWeight: 500,
                  }}
                >
                  {headLabel}
                </div>
                {restLabel ? (
                  <div
                    className="truncate"
                    style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}
                  >
                    {restLabel}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </CxPanel>
  );
}

export function ProjectOverviewTeamPanel({
  isZh,
  members,
  onInviteMember,
}: {
  isZh: boolean;
  members: ProjectMember[];
  onInviteMember?: () => void;
}) {
  return (
    <CxPanel title={isZh ? "项目团队" : "Project team"}>
      {members.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--color-codex-ink-mute)",
            padding: "4px 0",
          }}
        >
          {isZh ? "暂无成员。" : "No members yet."}
        </p>
      ) : (
        members.map((member) => {
          const name = member.user.display_name || `#${member.user_id}`;
          const role =
            member.role === "owner"
              ? isZh ? "负责人" : "Owner"
              : member.role === "viewer"
                ? isZh ? "只读" : "Viewer"
                : isZh ? "可编辑" : "Editor";
          return (
            <div
              key={member.id}
              className="flex items-center"
              style={{ gap: 10, padding: "7px 0" }}
            >
              <span
                className="inline-flex flex-shrink-0 items-center justify-center"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 99,
                  background: "var(--color-codex-bg-tint)",
                  color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {name.slice(0, 1)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="truncate"
                  style={{ fontSize: 13, color: "var(--color-codex-ink)" }}
                >
                  {name}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--color-codex-ink-mute)" }}
                >
                  {role}
                </div>
              </div>
            </div>
          );
        })
      )}
      {onInviteMember ? (
        <button
          type="button"
          onClick={onInviteMember}
          className="inline-flex w-full items-center justify-center transition-colors"
          style={{
            gap: 6,
            marginTop: 8,
            padding: "7px 10px",
            fontSize: 12,
            color: "var(--color-codex-ink-mute)",
            border: "1px dashed var(--color-codex-line-strong, var(--color-codex-line))",
            borderRadius: "var(--codex-r-sm, 6px)",
            background: "transparent",
          }}
        >
          <UserPlus className="h-3.5 w-3.5" />
          {isZh ? "邀请成员" : "Invite member"}
        </button>
      ) : null}
    </CxPanel>
  );
}

// ------- Loading skeleton -------------------------------------------------

export function ProjectOverviewLoadingSkeleton({ isZh }: { isZh: boolean }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: 320, gap: 8, color: "var(--color-codex-ink-mute)" }}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span style={{ fontSize: 12.5 }}>
        {isZh ? "加载概览…" : "Loading overview…"}
      </span>
    </div>
  );
}

// Re-export icons used by tab for empty states if needed.
export { Clock, FileText, RefreshCw };
