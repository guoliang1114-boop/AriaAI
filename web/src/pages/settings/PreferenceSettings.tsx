/**
 * Settings → 个人偏好 (AI personal preferences) — V0.0.6 Codex page.
 *
 * What used to be an embedded ``UserMemorySettingsCard`` at the
 * bottom of ``ProfileSettings`` is now its own settings page under
 * the "个人" group. The original card was MD3-styled (``card``,
 * ``btn-primary``, ``text-label-sm``…) and shipped before the Codex
 * redesign; this page re-skins the same payload in the
 * ``CxFormRow``-row layout the other settings pages use, so the
 * "个人" group reads cohesively (个人资料 → 个人偏好 → 外观 → 语言).
 *
 * State + payload logic is unchanged — see
 * ``utils/userMemoryPreferences.ts`` for the helpers shared with the
 * legacy module's tests.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Brain, Check, Eraser, Loader2 } from "lucide-react";

import { api } from "../../api/client";
import { CxConfirmDialog, CxFormRow } from "../../components/codex";
import {
  FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  TONE_OPTIONS,
  compactPreferences,
  readShape,
  type FormatShape,
  type Language,
  type PreferencesShape,
  type Tone,
  type UserMemoryResponse,
} from "../../utils/userMemoryPreferences";

interface SavedMessage {
  type: "success" | "error";
  text: string;
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 13.5,
  background: "var(--color-codex-bg)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  color: "var(--color-codex-ink)",
};

const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE };

const GHOST_BUTTON_STYLE: React.CSSProperties = {
  padding: "7px 14px",
  fontSize: 12.5,
  color: "var(--color-codex-ink-soft)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  background: "var(--color-codex-bg-elev)",
};

export function PreferenceSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [version, setVersion] = useState(0);
  const [prefs, setPrefs] = useState<PreferencesShape>({});
  const [msg, setMsg] = useState<SavedMessage | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Auto-save plumbing: skip the initial hydration effect, then debounce
  // writes so a fast typist in 称呼 doesn't fan out a PUT per keystroke.
  const hasHydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .get<UserMemoryResponse>("/user-memory")
      .then((data) => {
        setPrefs(readShape(data.preferences as Record<string, unknown>));
        setVersion(data.version || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateResponsePref = <
    K extends keyof NonNullable<PreferencesShape["response_preferences"]>,
  >(
    key: K,
    value: NonNullable<PreferencesShape["response_preferences"]>[K],
  ) => {
    setPrefs((cur) => ({
      ...cur,
      response_preferences: { ...(cur.response_preferences ?? {}), [key]: value },
    }));
  };

  const updateWorkStyle = (value: boolean | null) => {
    setPrefs((cur) => {
      if (value === null) {
        const { work_style: _omit, ...rest } = cur;
        return rest;
      }
      return { ...cur, work_style: { ask_before_destructive: value } };
    });
  };

  // Auto-save effect — debounced PUT whenever `prefs` changes after the
  // initial hydration.
  useEffect(() => {
    if (loading) return;
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      setMsg(null);
      try {
        const payload = compactPreferences(prefs);
        const data = await api.put<UserMemoryResponse>("/user-memory", {
          preferences: payload,
        });
        setVersion(data.version || version + 1);
        setMsg({ type: "success", text: "已保存" });
        setTimeout(() => setMsg(null), 1800);
      } catch (err: any) {
        setMsg({ type: "error", text: err.response?.data?.detail || "保存失败" });
      } finally {
        setSaving(false);
      }
    }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [prefs, loading]);

  const handleClear = async () => {
    setClearing(true);
    setMsg(null);
    try {
      await api.delete("/user-memory");
      setPrefs({});
      setClearConfirmOpen(false);
      setMsg({ type: "success", text: "偏好已清除。" });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ type: "error", text: err.response?.data?.detail || "清除失败" });
      setClearConfirmOpen(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="theme-codex"
      data-testid="preference-settings"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        padding: "8px 4px 32px",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 500,
            color: "var(--color-codex-ink)",
            letterSpacing: "-0.015em",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Brain className="h-4 w-4" style={{ color: "var(--color-codex-accent)" }} />
          个人偏好
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--color-codex-ink-mute)",
            lineHeight: 1.6,
            maxWidth: 640,
          }}
        >
          跨项目生效。AI 会在系统提示词中读取这些偏好，但不会写入客户/项目记忆。
          {version > 0 ? (
            <>
              {" "}
              <span className="font-mono" style={{ color: "var(--color-codex-ink-faint)" }}>
                v{version}
              </span>
            </>
          ) : null}
        </p>
      </header>

      {loading ? (
        <div
          className="inline-flex items-center gap-2"
          style={{ fontSize: 13, color: "var(--color-codex-ink-mute)" }}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载…
        </div>
      ) : (
        <>
          <CxFormRow
            label="Aria 怎么称呼你"
            hint="例如「李总」「小李」「Liang」。留空则使用账户姓名。"
          >
            <input
              type="text"
              value={prefs.personal_info?.preferred_name ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                setPrefs((cur) => ({
                  ...cur,
                  personal_info: { preferred_name: next },
                }));
              }}
              placeholder="例如：李总、小李、Liang"
              maxLength={40}
              autoComplete="off"
              style={INPUT_STYLE}
            />
          </CxFormRow>

          <CxFormRow
            label="回复语言"
            hint="影响 AI 的主要输出语言，跟随对话语言会根据上下文自动判断。"
          >
            <select
              value={prefs.response_preferences?.language ?? ""}
              onChange={(e) => updateResponsePref("language", e.target.value as Language)}
              style={SELECT_STYLE}
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </CxFormRow>

          <CxFormRow
            label="回复语气"
            hint="直接 / 友好 / 正式。客户场合建议正式；项目内部多用直接。"
          >
            <select
              value={prefs.response_preferences?.tone ?? ""}
              onChange={(e) => updateResponsePref("tone", e.target.value as Tone)}
              style={SELECT_STYLE}
            >
              {TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </CxFormRow>

          <CxFormRow
            label="回复结构"
            hint="先给结论再展开适合汇报场景；自由让 AI 自己组织。"
          >
            <select
              value={prefs.response_preferences?.format ?? ""}
              onChange={(e) => updateResponsePref("format", e.target.value as FormatShape)}
              style={SELECT_STYLE}
            >
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </CxFormRow>

          <CxFormRow
            label="写入/删除前再确认"
            hint="开启后，AI 在动笔改项目记忆或删除文档之前会先跟你打个招呼。"
            divider={false}
          >
            <select
              value={
                typeof prefs.work_style?.ask_before_destructive === "boolean"
                  ? prefs.work_style.ask_before_destructive
                    ? "true"
                    : "false"
                  : ""
              }
              onChange={(e) => {
                if (e.target.value === "") updateWorkStyle(null);
                else updateWorkStyle(e.target.value === "true");
              }}
              style={SELECT_STYLE}
            >
              <option value="">未设置</option>
              <option value="true">是，先确认</option>
              <option value="false">否，直接动手</option>
            </select>
          </CxFormRow>

          <div
            className="flex items-center justify-between"
            style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--color-codex-line)" }}
          >
            <button
              type="button"
              onClick={() => setClearConfirmOpen(true)}
              disabled={clearing}
              className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
              style={GHOST_BUTTON_STYLE}
            >
              {clearing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eraser className="h-3.5 w-3.5" />
              )}
              清除所有偏好
            </button>
            <span
              className="inline-flex items-center gap-1.5"
              style={{
                fontSize: 12,
                color: saving
                  ? "var(--color-codex-ink-mute)"
                  : msg?.type === "error"
                    ? "var(--color-codex-bad)"
                    : "var(--color-codex-ink-faint)",
              }}
              aria-live="polite"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在保存…
                </>
              ) : msg?.type === "error" ? (
                <>
                  <AlertCircle className="h-3 w-3" />
                  {msg.text}
                </>
              ) : msg?.type === "success" ? (
                <>
                  <Check className="h-3 w-3" style={{ color: "var(--color-codex-good)" }} />
                  {msg.text}
                </>
              ) : (
                <span style={{ opacity: 0.6 }}>修改后自动保存</span>
              )}
            </span>
          </div>
        </>
      )}
      <CxConfirmDialog
        open={clearConfirmOpen}
        onClose={() => {
          if (!clearing) setClearConfirmOpen(false);
        }}
        onConfirm={() => void handleClear()}
        tone="danger"
        title="清除所有 AI 偏好？"
        description="清除后 AI 将不再读取这些个人化设置。该操作不可撤销。"
        confirmLabel="清除"
        cancelLabel="取消"
        busy={clearing}
      />
    </div>
  );
}
