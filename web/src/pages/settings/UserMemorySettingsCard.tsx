/**
 * "AI 个人偏好" card (V0.0.4 track B v1).
 *
 * Reads/writes the current user's UserMemory preferences via /user-memory.
 * Surfaces a small, structured set of preferences (language, tone, response
 * shape, confirm-before-destructive) — that's enough to demonstrate the
 * backend prompt-injection without inviting users to free-edit arbitrary JSON.
 *
 * Behaviour:
 * - Loads existing preferences on mount.
 * - Save explicitly via the "保存" button (PUT /user-memory).
 * - "清除所有偏好" wipes the row (DELETE /user-memory).
 * - All preferences are optional. Defaults stay unset → the backend section
 *   simply omits them.
 */
import { useEffect, useState } from "react";
import { AlertCircle, Brain, Check, Eraser, Loader2 } from "lucide-react";

import { api } from "../../api/client";

type Language = "" | "zh" | "en" | "auto";
type Tone = "" | "direct" | "friendly" | "formal";
type FormatShape = "" | "conclusion_first" | "free";

interface UserMemoryResponse {
  preferences: Record<string, unknown>;
  version: number;
  updated_at: string;
}

interface PreferencesShape {
  response_preferences?: {
    language?: Language;
    tone?: Tone;
    format?: FormatShape;
  };
  work_style?: {
    ask_before_destructive?: boolean;
  };
}

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "zh", label: "中文优先" },
  { value: "en", label: "English first" },
  { value: "auto", label: "跟随对话语言" },
];

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "direct", label: "直接、协作" },
  { value: "friendly", label: "友好、亲和" },
  { value: "formal", label: "正式、客户场合" },
];

const FORMAT_OPTIONS: { value: FormatShape; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "conclusion_first", label: "先给结论再展开" },
  { value: "free", label: "由模型自由判断" },
];

function compactPreferences(prefs: PreferencesShape): Record<string, unknown> {
  const compact: PreferencesShape = {};
  const rp = prefs.response_preferences ?? {};
  const rpOut: PreferencesShape["response_preferences"] = {};
  if (rp.language) rpOut.language = rp.language;
  if (rp.tone) rpOut.tone = rp.tone;
  if (rp.format) rpOut.format = rp.format;
  if (Object.keys(rpOut).length > 0) compact.response_preferences = rpOut;

  const ws = prefs.work_style ?? {};
  if (typeof ws.ask_before_destructive === "boolean") {
    compact.work_style = { ask_before_destructive: ws.ask_before_destructive };
  }
  return compact as unknown as Record<string, unknown>;
}

function readShape(raw: Record<string, unknown> | undefined): PreferencesShape {
  if (!raw || typeof raw !== "object") return {};
  const rp = (raw as { response_preferences?: unknown }).response_preferences;
  const ws = (raw as { work_style?: unknown }).work_style;
  const out: PreferencesShape = {};
  if (rp && typeof rp === "object") {
    const block = rp as Partial<Record<string, unknown>>;
    out.response_preferences = {
      language: (block.language as Language) ?? "",
      tone: (block.tone as Tone) ?? "",
      format: (block.format as FormatShape) ?? "",
    };
  }
  if (ws && typeof ws === "object") {
    const block = ws as Partial<Record<string, unknown>>;
    if (typeof block.ask_before_destructive === "boolean") {
      out.work_style = { ask_before_destructive: block.ask_before_destructive };
    }
  }
  return out;
}

export function UserMemorySettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [version, setVersion] = useState(0);
  const [prefs, setPrefs] = useState<PreferencesShape>({});
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const updateResponsePref = <K extends keyof NonNullable<PreferencesShape["response_preferences"]>>(
    key: K,
    value: NonNullable<PreferencesShape["response_preferences"]>[K],
  ) => {
    setPrefs((cur) => ({
      ...cur,
      response_preferences: { ...(cur.response_preferences ?? {}), [key]: value },
    }));
    setMsg(null);
  };

  const updateWorkStyle = (value: boolean | null) => {
    setPrefs((cur) => {
      if (value === null) {
        const { work_style: _omit, ...rest } = cur;
        return rest;
      }
      return { ...cur, work_style: { ask_before_destructive: value } };
    });
    setMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload = compactPreferences(prefs);
      const data = await api.put<UserMemoryResponse>("/user-memory", { preferences: payload });
      setVersion(data.version || version + 1);
      setMsg({ type: "success", text: "偏好已保存,下一轮对话生效。" });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ type: "error", text: err.response?.data?.detail || "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("将清除所有 AI 偏好,AI 将不再读取这些个人化设置。继续?")) return;
    setClearing(true);
    setMsg(null);
    try {
      await api.delete("/user-memory");
      setPrefs({});
      setMsg({ type: "success", text: "偏好已清除。" });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ type: "error", text: err.response?.data?.detail || "清除失败" });
    } finally {
      setClearing(false);
    }
  };

  const selectCls =
    "rounded-xl border border-outline/20 bg-surface-container-lowest px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-label-lg text-on-surface flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-primary" />
            AI 个人偏好
          </h3>
          <p className="text-body-sm text-on-surface-muted">
            跨项目生效。AI 会在系统提示词中读取这些偏好,但不会写入客户/项目记忆。
          </p>
        </div>
        {version > 0 && (
          <span className="text-xs text-on-surface-muted">v{version}</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-on-surface-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          正在加载...
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-label-sm text-on-surface-muted">回复语言</label>
              <select
                value={prefs.response_preferences?.language ?? ""}
                onChange={(e) => updateResponsePref("language", e.target.value as Language)}
                className={selectCls + " w-full"}
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-label-sm text-on-surface-muted">回复语气</label>
              <select
                value={prefs.response_preferences?.tone ?? ""}
                onChange={(e) => updateResponsePref("tone", e.target.value as Tone)}
                className={selectCls + " w-full"}
              >
                {TONE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-label-sm text-on-surface-muted">回复结构</label>
              <select
                value={prefs.response_preferences?.format ?? ""}
                onChange={(e) => updateResponsePref("format", e.target.value as FormatShape)}
                className={selectCls + " w-full"}
              >
                {FORMAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-label-sm text-on-surface-muted">写入/删除前是否再确认</label>
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
                className={selectCls + " w-full"}
              >
                <option value="">未设置</option>
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleClear}
              disabled={clearing}
              className="btn-secondary flex items-center gap-2 px-3 disabled:opacity-40"
            >
              {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
              清除所有偏好
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2 px-4 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              保存
            </button>
          </div>

          {msg && (
            <p className={`text-xs flex items-center gap-1 ${msg.type === "success" ? "text-active" : "text-error"}`}>
              {msg.type === "error" && <AlertCircle className="w-3 h-3" />}
              {msg.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
