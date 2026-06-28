/**
 * "我的本周重点" — a compact widget for the Workspace home that mirrors the
 * full /weekly board but scoped to the current user + current week. Self-
 * contained (fetches its own data) so it can drop into Workspace without
 * touching its data-loading. Click-through to /weekly for the team board.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Target } from "lucide-react";

import { api } from "../../api/client";
import { currentWeekStart } from "../../utils/weekDate";
import type { WeeklyFocusItem, WeeklyFocusMyResponse, WeeklyFocusStatus } from "../../types/api";

const STATUS_ORDER: WeeklyFocusStatus[] = ["in_progress", "done", "blocked"];

function statusColor(status: WeeklyFocusStatus): string {
  if (status === "done") return "var(--color-codex-good)";
  if (status === "blocked") return "var(--color-codex-warn)";
  return "var(--color-codex-accent)";
}

function nextStatus(status: WeeklyFocusStatus): WeeklyFocusStatus {
  const idx = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
}

export function MyWeeklyFocusCard() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const weekStart = useMemo(() => currentWeekStart(), []);

  const [items, setItems] = useState<WeeklyFocusItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<WeeklyFocusMyResponse>("/weekly/my", { params: { week_start: weekStart } });
      setItems(res.items);
    } catch {
      /* soft-fail: the widget just stays empty */
    } finally {
      setLoaded(true);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const addItem = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await api.post("/weekly", { content, week_start: weekStart });
      setDraft("");
      await load();
    } catch {
      /* surfaced on the full page; keep the widget quiet */
    } finally {
      setBusy(false);
    }
  };

  const cycleStatus = async (item: WeeklyFocusItem) => {
    // optimistic
    const updated = nextStatus(item.status);
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: updated } : it)));
    try {
      await api.patch(`/weekly/${item.id}`, { status: updated });
    } catch {
      void load();
    }
  };

  const doneCount = items.filter((it) => it.status === "done").length;

  return (
    <div
      style={{
        background: "var(--color-codex-bg-elev)",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-md, 6px)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2" style={{ fontSize: 13, color: "var(--color-codex-ink)" }}>
          <Target className="h-3.5 w-3.5" aria-hidden="true" />
          {isZh ? "我的本周重点" : "My weekly focus"}
          {loaded && items.length ? (
            <span className="font-mono" style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)" }}>
              {doneCount}/{items.length}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => navigate("/weekly")}
          style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}
        >
          {isZh ? "全员看板 →" : "Team board →"}
        </button>
      </div>

      {loaded && items.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-codex-ink-faint)", margin: 0 }}>
          {isZh ? "本周还没有重点事项，添加一条吧。" : "No focus items yet this week — add one."}
        </p>
      ) : null}

      {items.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.slice(0, 6).map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => void cycleStatus(item)}
                title={isZh ? "点击切换状态" : "Click to change status"}
                style={{
                  flexShrink: 0,
                  width: 9,
                  height: 9,
                  marginTop: 5,
                  borderRadius: "50%",
                  background: statusColor(item.status),
                }}
                aria-label={isZh ? "切换状态" : "Toggle status"}
              />
              <span
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: item.status === "done" ? "var(--color-codex-ink-mute)" : "var(--color-codex-ink)",
                  textDecoration: item.status === "done" ? "line-through" : "none",
                  wordBreak: "break-word",
                }}
              >
                {item.content}
                {item.project_name ? (
                  <span style={{ color: "var(--color-codex-ink-faint)" }}> · {item.project_name}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addItem();
          }}
          placeholder={isZh ? "添加本周重点…" : "Add a focus item…"}
          disabled={busy}
          style={{
            flex: 1,
            minHeight: 32,
            background: "var(--color-codex-bg)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-sm, 3px)",
            color: "var(--color-codex-ink)",
            fontSize: 12.5,
            padding: "0 10px",
          }}
        />
        <button
          type="button"
          onClick={() => void addItem()}
          disabled={!draft.trim() || busy}
          className="inline-flex items-center gap-1.5"
          style={{
            padding: "7px 11px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: "var(--codex-r-sm, 3px)",
            background: !draft.trim() || busy ? "var(--color-codex-bg-tint)" : "var(--color-codex-ink)",
            color: !draft.trim() || busy ? "var(--color-codex-ink-mute)" : "var(--color-codex-bg-elev)",
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {isZh ? "添加" : "Add"}
        </button>
      </div>
    </div>
  );
}
