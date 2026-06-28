/**
 * Weekly focus board ("本周重点") — per-person weekly key items with a
 * team-wide board. Weeks start Monday; the switcher rolls week-by-week so
 * you can look back or plan ahead ("双周滚动"). Each person is a card; your
 * own card is pinned first and is inline-editable. Admins can add/adjust any
 * card (the "manager assigns" path). Mobile: cards stack to a single column.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { api } from "../../api/client";
import { CxTopProgress } from "../../components/codex";
import { PageTitle } from "../../components/PageTitle";
import { useToast } from "../../contexts/ToastContext";
import { currentWeekStart, shiftWeek, weekRangeLabel } from "../../utils/weekDate";
import type {
  WeeklyFocusBoard,
  WeeklyFocusCarryOverResponse,
  WeeklyFocusItem,
  WeeklyFocusPerson,
  WeeklyFocusStatus,
} from "../../types/api";

interface ProjectOption {
  id: number;
  name: string;
  client: string;
  status: string;
}

const STATUS_ORDER: WeeklyFocusStatus[] = ["in_progress", "done", "blocked"];

function statusMeta(status: WeeklyFocusStatus, isZh: boolean): { label: string; color: string } {
  if (status === "done") return { label: isZh ? "完成" : "Done", color: "var(--color-codex-good)" };
  if (status === "blocked") return { label: isZh ? "受阻" : "Blocked", color: "var(--color-codex-warn)" };
  return { label: isZh ? "进行中" : "In progress", color: "var(--color-codex-accent)" };
}

function nextStatus(status: WeeklyFocusStatus): WeeklyFocusStatus {
  const idx = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
}

function readStoredUser(): { id: number; is_admin: boolean } | null {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: number; is_admin?: boolean };
    if (typeof parsed?.id !== "number") return null;
    return { id: parsed.id, is_admin: !!parsed.is_admin };
  } catch {
    return null;
  }
}

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({
  status,
  editable,
  onCycle,
  isZh,
}: {
  status: WeeklyFocusStatus;
  editable: boolean;
  onCycle: () => void;
  isZh: boolean;
}) {
  const meta = statusMeta(status, isZh);
  return (
    <button
      type="button"
      onClick={editable ? onCycle : undefined}
      disabled={!editable}
      title={editable ? (isZh ? "点击切换状态" : "Click to change status") : undefined}
      className="inline-flex items-center gap-1.5"
      style={{
        flexShrink: 0,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 500,
        borderRadius: "var(--codex-r-pill, 999px)",
        border: "1px solid var(--color-codex-line)",
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink-soft)",
        cursor: editable ? "pointer" : "default",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: meta.color,
          display: "inline-block",
        }}
      />
      {meta.label}
    </button>
  );
}

// ── One item row ───────────────────────────────────────────────────────────────

function ItemRow({
  item,
  canManage,
  isZh,
  onCycleStatus,
  onSaveProgress,
  onDelete,
  onOpenProject,
}: {
  item: WeeklyFocusItem;
  canManage: boolean;
  isZh: boolean;
  onCycleStatus: () => void;
  onSaveProgress: (note: string) => void;
  onDelete: () => void;
  onOpenProject: (projectId: number) => void;
}) {
  // Uncontrolled-with-a-key: the parent remounts this row (key includes
  // updated_at) whenever the server value changes, so local edits aren't
  // clobbered mid-typing and we avoid syncing prop→state in an effect.
  const [note, setNote] = useState(item.progress_note || "");

  const assignedByOther =
    item.created_by && item.created_by.id !== item.owner_user_id ? item.created_by.display_name : null;

  return (
    <div
      style={{
        padding: "10px 0",
        borderTop: "1px solid var(--color-codex-line)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div className="flex items-start gap-2" style={{ justifyContent: "space-between" }}>
        <div className="flex items-start gap-2" style={{ minWidth: 0 }}>
          <StatusChip status={item.status} editable={canManage} onCycle={onCycleStatus} isZh={isZh} />
          <span
            style={{
              fontSize: 13,
              color: item.status === "done" ? "var(--color-codex-ink-mute)" : "var(--color-codex-ink)",
              textDecoration: item.status === "done" ? "line-through" : "none",
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}
          >
            {item.content}
          </span>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={isZh ? "删除" : "Delete"}
            title={isZh ? "删除" : "Delete"}
            className="cx-no-hover"
            style={{ flexShrink: 0, color: "var(--color-codex-ink-faint)", padding: 2 }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2" style={{ paddingLeft: 2 }}>
        {item.project_id ? (
          <button
            type="button"
            onClick={() => onOpenProject(item.project_id as number)}
            className="cx-no-hover"
            style={{
              fontSize: 11,
              padding: "1px 7px",
              borderRadius: "var(--codex-r-sm, 3px)",
              background: "var(--color-codex-bg-tint)",
              color: "var(--color-codex-ink-soft)",
            }}
          >
            {item.project_name || (isZh ? "关联项目" : "Project")}
          </button>
        ) : null}
        {assignedByOther ? (
          <span style={{ fontSize: 11, color: "var(--color-codex-ink-faint)" }}>
            {isZh ? `由 ${assignedByOther} 指派` : `Assigned by ${assignedByOther}`}
          </span>
        ) : null}
      </div>

      {canManage ? (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note.trim() !== (item.progress_note || "").trim()) onSaveProgress(note.trim());
          }}
          placeholder={isZh ? "一句话进展 / 下一步…" : "One line: progress / next step…"}
          style={{
            width: "100%",
            background: "var(--color-codex-bg)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-sm, 3px)",
            color: "var(--color-codex-ink-soft)",
            fontSize: 12,
            padding: "5px 8px",
          }}
        />
      ) : item.progress_note ? (
        <p style={{ fontSize: 12, color: "var(--color-codex-ink-soft)", lineHeight: 1.5, margin: 0, paddingLeft: 2 }}>
          {item.progress_note}
        </p>
      ) : null}
    </div>
  );
}

// ── Add-item form (inline on a manageable card) ─────────────────────────────────

function AddItemForm({
  projects,
  isZh,
  onAdd,
}: {
  projects: ProjectOption[];
  isZh: boolean;
  onAdd: (content: string, projectId: number | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5"
        style={{
          marginTop: 10,
          fontSize: 12,
          color: "var(--color-codex-ink-mute)",
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        {isZh ? "添加重点事项" : "Add focus item"}
      </button>
    );
  }

  const submit = async () => {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onAdd(text, projectId);
      setContent("");
      setProjectId(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        autoFocus
        rows={2}
        placeholder={isZh ? "本周重点：要推进什么？" : "This week's focus: what to push forward?"}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
        style={{
          width: "100%",
          resize: "vertical",
          minHeight: 48,
          background: "var(--color-codex-bg)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-sm, 3px)",
          color: "var(--color-codex-ink)",
          fontSize: 12.5,
          lineHeight: 1.5,
          padding: "7px 9px",
        }}
      />
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
        <select
          value={projectId ?? ""}
          onChange={(e) => setProjectId(Number(e.target.value) || null)}
          style={{
            flex: "1 1 160px",
            minHeight: 30,
            background: "var(--color-codex-bg)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-sm, 3px)",
            color: "var(--color-codex-ink)",
            fontSize: 12,
            padding: "0 8px",
          }}
        >
          <option value="">{isZh ? "不关联项目（可选）" : "No project (optional)"}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.client ? ` · ${p.client}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!content.trim() || busy}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: "var(--codex-r-sm, 3px)",
            background: !content.trim() || busy ? "var(--color-codex-bg-tint)" : "var(--color-codex-ink)",
            color: !content.trim() || busy ? "var(--color-codex-ink-mute)" : "var(--color-codex-bg-elev)",
          }}
        >
          {busy ? (isZh ? "添加中" : "Adding") : isZh ? "添加" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setContent("");
          }}
          aria-label={isZh ? "取消" : "Cancel"}
          className="cx-no-hover"
          style={{ color: "var(--color-codex-ink-faint)", padding: 4 }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Person card ────────────────────────────────────────────────────────────────

function PersonCard({
  person,
  isMe,
  canManage,
  projects,
  isZh,
  onAdd,
  onCycleStatus,
  onSaveProgress,
  onDelete,
  onCarryOver,
  onOpenProject,
}: {
  person: WeeklyFocusPerson;
  isMe: boolean;
  canManage: boolean;
  projects: ProjectOption[];
  isZh: boolean;
  onAdd: (ownerId: number, content: string, projectId: number | null) => Promise<void>;
  onCycleStatus: (item: WeeklyFocusItem) => void;
  onSaveProgress: (item: WeeklyFocusItem, note: string) => void;
  onDelete: (item: WeeklyFocusItem) => void;
  onCarryOver: (ownerId: number) => void;
  onOpenProject: (projectId: number) => void;
}) {
  const initials = (person.user.display_name || "?").trim().slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        background: "var(--color-codex-bg-elev)",
        border: isMe ? "1px solid var(--color-codex-accent)" : "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-md, 6px)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: 4 }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "var(--color-codex-bg-tint)",
              color: "var(--color-codex-ink-soft)",
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {initials}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-codex-ink)" }}>
            {person.user.display_name}
            {isMe ? (isZh ? "（我）" : " (me)") : ""}
          </span>
          {person.user.is_admin ? (
            <span style={{ fontSize: 10.5, color: "var(--color-codex-ink-faint)" }}>{isZh ? "管理员" : "Admin"}</span>
          ) : null}
        </div>
        <span
          className="font-mono"
          style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)", fontVariantNumeric: "tabular-nums" }}
        >
          {person.done_count}/{person.total_count}
        </span>
      </div>

      {person.items.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-codex-ink-faint)", padding: "8px 0", margin: 0 }}>
          {isZh ? "本周还没有重点事项" : "No focus items this week"}
        </p>
      ) : (
        <div>
          {person.items.map((item) => (
            <ItemRow
              key={`${item.id}:${item.updated_at}`}
              item={item}
              canManage={canManage}
              isZh={isZh}
              onCycleStatus={() => onCycleStatus(item)}
              onSaveProgress={(note) => onSaveProgress(item, note)}
              onDelete={() => onDelete(item)}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}

      {canManage ? (
        <div className="flex items-center justify-between gap-2" style={{ flexWrap: "wrap" }}>
          <AddItemForm projects={projects} isZh={isZh} onAdd={(c, pid) => onAdd(person.user.id, c, pid)} />
          <button
            type="button"
            onClick={() => onCarryOver(person.user.id)}
            className="inline-flex items-center gap-1"
            title={isZh ? "把上周未完成的事项复制到本周" : "Copy last week's unfinished items here"}
            style={{ marginTop: 10, fontSize: 11.5, color: "var(--color-codex-ink-faint)" }}
          >
            <History className="h-3 w-3" />
            {isZh ? "滚动上周未完成" : "Carry over"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function WeeklyFocus() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const toast = useToast();

  const currentUser = useMemo(() => readStoredUser(), []);
  const thisWeek = useMemo(() => currentWeekStart(), []);
  const [weekStart, setWeekStart] = useState<string>(thisWeek);
  const [board, setBoard] = useState<WeeklyFocusBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const isCurrentWeek = weekStart === thisWeek;

  const loadBoard = useCallback(
    async (ws: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<WeeklyFocusBoard>("/weekly/board", { params: { week_start: ws } });
        setBoard(data);
      } catch {
        setError(isZh ? "加载本周重点失败" : "Failed to load weekly focus");
      } finally {
        setLoading(false);
      }
    },
    [isZh],
  );

  useEffect(() => {
    void loadBoard(weekStart);
  }, [weekStart, loadBoard]);

  useEffect(() => {
    api
      .get<ProjectOption[]>("/projects/meta/dashboard-summary")
      .then((rows) => setProjects(rows.filter((r) => r.status !== "archived")))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => loadBoard(weekStart), [loadBoard, weekStart]);

  const handleError = useCallback(
    (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error({
        title: isZh ? "操作失败" : "Action failed",
        description: status === 403 ? (isZh ? "无权进行该操作" : "Not allowed") : undefined,
      });
    },
    [isZh, toast],
  );

  const addItem = useCallback(
    async (ownerId: number, content: string, projectId: number | null) => {
      try {
        await api.post("/weekly", {
          content,
          week_start: weekStart,
          owner_user_id: ownerId,
          project_id: projectId,
        });
        await refresh();
      } catch (err) {
        handleError(err);
      }
    },
    [weekStart, refresh, handleError],
  );

  const cycleStatus = useCallback(
    async (item: WeeklyFocusItem) => {
      try {
        await api.patch(`/weekly/${item.id}`, { status: nextStatus(item.status) });
        await refresh();
      } catch (err) {
        handleError(err);
      }
    },
    [refresh, handleError],
  );

  const saveProgress = useCallback(
    async (item: WeeklyFocusItem, note: string) => {
      try {
        await api.patch(`/weekly/${item.id}`, { progress_note: note });
        await refresh();
      } catch (err) {
        handleError(err);
      }
    },
    [refresh, handleError],
  );

  const deleteItem = useCallback(
    async (item: WeeklyFocusItem) => {
      try {
        await api.delete(`/weekly/${item.id}`);
        await refresh();
      } catch (err) {
        handleError(err);
      }
    },
    [refresh, handleError],
  );

  const carryOver = useCallback(
    async (ownerId: number) => {
      try {
        const res = await api.post<WeeklyFocusCarryOverResponse>("/weekly/carry-over", {
          to_week: weekStart,
          owner_user_id: ownerId,
        });
        await refresh();
        toast.success({
          title: res.created_count
            ? isZh
              ? `已滚动 ${res.created_count} 条未完成事项`
              : `Carried over ${res.created_count} item(s)`
            : isZh
              ? "上周没有可滚动的未完成事项"
              : "Nothing to carry over",
        });
      } catch (err) {
        handleError(err);
      }
    },
    [weekStart, refresh, toast, isZh, handleError],
  );

  // Pin my own card first; the backend already sorts the rest.
  const people = useMemo(() => {
    if (!board) return [];
    const mine = board.people.filter((p) => p.user.id === currentUser?.id);
    const others = board.people.filter((p) => p.user.id !== currentUser?.id);
    return [...mine, ...others];
  }, [board, currentUser]);

  return (
    <>
      <PageTitle title={isZh ? "本周重点" : "Weekly focus"} />
      <main
        className="theme-codex min-h-full"
        style={{
          background: "var(--color-codex-bg)",
          color: "var(--color-codex-ink)",
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        {loading && !board ? <CxTopProgress /> : null}
        <div style={{ padding: "32px clamp(20px, 4vw, 56px) 48px", minWidth: 0 }}>
          <header className="flex flex-col gap-4" style={{ marginBottom: 24 }}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1
                  className="inline-flex items-center gap-2"
                  style={{ margin: 0, fontSize: 26, fontWeight: 500, color: "var(--color-codex-ink)" }}
                >
                  <Target className="h-5 w-5" style={{ color: "var(--color-codex-accent)" }} />
                  {isZh ? "本周重点" : "Weekly focus"}
                </h1>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-codex-ink-mute)" }}>
                  {isZh
                    ? "每个人的每周重点事项，一眼看全团队进展"
                    : "Each person's weekly key items — the whole team at a glance"}
                </p>
              </div>

              {/* Week switcher */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart((w) => shiftWeek(w, -1))}
                  aria-label={isZh ? "上一周" : "Previous week"}
                  className="cx-no-hover inline-flex items-center justify-center"
                  style={{
                    width: 30,
                    height: 30,
                    border: "1px solid var(--color-codex-line)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                    color: "var(--color-codex-ink-soft)",
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div
                  className="flex flex-col items-center"
                  style={{ minWidth: 150, textAlign: "center" }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-codex-ink)" }}>
                    {weekRangeLabel(weekStart, isZh)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-codex-ink-faint)" }}>
                    {isCurrentWeek ? (isZh ? "本周" : "This week") : null}
                    {!isCurrentWeek ? (
                      <button
                        type="button"
                        onClick={() => setWeekStart(thisWeek)}
                        style={{ fontSize: 11, color: "var(--color-codex-accent)" }}
                      >
                        {isZh ? "回到本周" : "Back to this week"}
                      </button>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setWeekStart((w) => shiftWeek(w, 1))}
                  aria-label={isZh ? "下一周" : "Next week"}
                  className="cx-no-hover inline-flex items-center justify-center"
                  style={{
                    width: 30,
                    height: 30,
                    border: "1px solid var(--color-codex-line)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                    color: "var(--color-codex-ink-soft)",
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {board ? (
              <div
                className="flex items-center gap-4"
                style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}
              >
                <span>
                  {isZh ? "共" : "Total"} <strong style={{ color: "var(--color-codex-ink)" }}>{board.stats.total_items}</strong>{" "}
                  {isZh ? "项" : "items"}
                </span>
                <span>
                  {isZh ? "完成" : "Done"}{" "}
                  <strong style={{ color: "var(--color-codex-good)" }}>{board.stats.done}</strong>
                </span>
                <span>
                  {board.stats.people} {isZh ? "人有重点" : "people active"}
                </span>
              </div>
            ) : null}
          </header>

          {error ? (
            <div
              style={{
                padding: "12px 14px",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-md, 6px)",
                color: "var(--color-codex-bad)",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}

          {!error && board ? (
            people.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-codex-ink-mute)" }}>
                {isZh ? "暂无成员" : "No members yet"}
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                {people.map((person) => {
                  const isMe = person.user.id === currentUser?.id;
                  const canManage = !!currentUser && (currentUser.is_admin || isMe);
                  return (
                    <PersonCard
                      key={person.user.id}
                      person={person}
                      isMe={isMe}
                      canManage={canManage}
                      projects={projects}
                      isZh={isZh}
                      onAdd={addItem}
                      onCycleStatus={cycleStatus}
                      onSaveProgress={saveProgress}
                      onDelete={deleteItem}
                      onCarryOver={carryOver}
                      onOpenProject={(pid) => navigate(`/projects/${pid}`)}
                    />
                  );
                })}
              </div>
            )
          ) : null}
        </div>
      </main>
    </>
  );
}
