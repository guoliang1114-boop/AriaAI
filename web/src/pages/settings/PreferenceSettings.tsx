/**
 * Settings -> Personal preferences.
 *
 * This page mirrors the user's standalone HTML reference:
 * max-width content, grouped cards, and pill choices instead of native selects.
 * The payload still goes through the shared UserMemory helpers so existing
 * onboarding and prompt-injection behavior stays compatible.
 */
import { useEffect, useState } from "react";
import { AlertCircle, Check, Eraser, Loader2, Save, Sparkles } from "lucide-react";

import { api } from "../../api/client";
import { CxConfirmDialog } from "../../components/codex";
import {
  compactPreferences,
  readShape,
  type ConfirmationPolicy,
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
  marginTop: 12,
  padding: "10px 14px",
  fontSize: 13.5,
  background: "var(--color-codex-bg)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 6px)",
  color: "var(--color-codex-ink)",
};

const LANGUAGE_CHOICES: Array<{ value: Language; label: string }> = [
  { value: "auto", label: "跟你一致" },
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

const TONE_CHOICES: Array<{ value: Tone; label: string }> = [
  { value: "direct", label: "直接" },
  { value: "friendly", label: "友好" },
  { value: "formal", label: "正式" },
];

const FORMAT_CHOICES: Array<{ value: FormatShape; label: string }> = [
  { value: "conclusion_first", label: "先结论" },
  { value: "bullet_list", label: "分点列举" },
  { value: "free", label: "自由" },
];

const CONFIRMATION_CHOICES: Array<{ value: ConfirmationPolicy; label: string }> = [
  { value: "before_write", label: "写入前" },
  { value: "before_delete", label: "删除前" },
  { value: "all", label: "都需要" },
  { value: "none", label: "都不需要" },
];

function getConfirmationPolicy(prefs: PreferencesShape): ConfirmationPolicy {
  const policy = prefs.work_style?.confirmation_policy;
  if (policy) return policy;
  if (typeof prefs.work_style?.ask_before_destructive === "boolean") {
    return prefs.work_style.ask_before_destructive ? "all" : "none";
  }
  return "before_write";
}

export function PreferenceSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [prefs, setPrefs] = useState<PreferencesShape>({});
  const [msg, setMsg] = useState<SavedMessage | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  useEffect(() => {
    api
      .get<UserMemoryResponse>("/user-memory")
      .then((data) => {
        setPrefs(readShape(data.preferences as Record<string, unknown>));
        setVersion(data.version || 0);
        setDirty(false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const changePrefs = (updater: (cur: PreferencesShape) => PreferencesShape) => {
    setPrefs(updater);
    setDirty(true);
    setMsg(null);
  };

  const updateResponsePref = <
    K extends keyof NonNullable<PreferencesShape["response_preferences"]>,
  >(
    key: K,
    value: NonNullable<PreferencesShape["response_preferences"]>[K],
  ) => {
    changePrefs((cur) => ({
      ...cur,
      response_preferences: { ...(cur.response_preferences ?? {}), [key]: value },
    }));
  };

  const updateConfirmationPolicy = (value: ConfirmationPolicy) => {
    changePrefs((cur) => ({
      ...cur,
      work_style: {
        ...(cur.work_style ?? {}),
        confirmation_policy: value,
        ask_before_destructive: value !== "none",
      },
    }));
  };

  const savePreferences = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload = compactPreferences(prefs);
      const data = await api.put<UserMemoryResponse>("/user-memory", {
        preferences: payload,
      });
      setPrefs(readShape(data.preferences as Record<string, unknown>));
      setVersion(data.version || version + 1);
      setDirty(false);
      setMsg({ type: "success", text: "已保存" });
      setTimeout(() => setMsg(null), 1800);
    } catch (err: any) {
      setMsg({ type: "error", text: err.response?.data?.detail || "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setMsg(null);
    try {
      await api.delete("/user-memory");
      setPrefs({});
      setDirty(false);
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

  const selectedLanguage = prefs.response_preferences?.language || "auto";
  const selectedTone = prefs.response_preferences?.tone || "direct";
  const selectedFormat = prefs.response_preferences?.format || "conclusion_first";
  const selectedConfirmation = getConfirmationPolicy(prefs);

  return (
    <div
      className="theme-codex"
      data-testid="preference-settings"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        minHeight: "100%",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", paddingBottom: 32 }}>
        <header style={{ marginBottom: 26 }}>
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center"
              style={{
                width: 30,
                height: 30,
                background: "var(--color-codex-accent-bg)",
                color: "var(--color-codex-accent)",
                borderRadius: "var(--codex-r-sm, 6px)",
              }}
            >
              <Sparkles className="h-[15px] w-[15px]" strokeWidth={1.5} />
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
                letterSpacing: "-0.02em",
              }}
            >
              个人偏好
            </h1>
          </div>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13.5,
              color: "var(--color-codex-ink-mute)",
              lineHeight: 1.6,
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
            正在加载...
          </div>
        ) : (
          <>
            <SectionLabel>称呼</SectionLabel>
            <PreferenceCard>
              <PreferenceOption
                title="Aria 怎么称呼你"
                description="例如「李总」「小李」「Liang」。留空则使用账户姓名。"
                divider={false}
              >
                <input
                  type="text"
                  value={prefs.personal_info?.preferred_name ?? ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    changePrefs((cur) => ({
                      ...cur,
                      personal_info: { ...(cur.personal_info ?? {}), preferred_name: next },
                    }));
                  }}
                  placeholder="例如: 李总、小李、Liang"
                  maxLength={40}
                  autoComplete="off"
                  style={INPUT_STYLE}
                />
              </PreferenceOption>
            </PreferenceCard>

            <SectionLabel>回复风格</SectionLabel>
            <PreferenceCard>
              <PreferenceOption
                title="回复语言"
                description="AI 的主要输出语言。「跟你一致」会根据你的提问语言自动判断。"
              >
                <ChoiceGroup
                  ariaLabel="回复语言"
                  value={selectedLanguage}
                  options={LANGUAGE_CHOICES}
                  onChange={(value) => updateResponsePref("language", value as Language)}
                />
              </PreferenceOption>

              <PreferenceOption
                title="回复语气"
                description="客户场合建议「正式」；项目内部多用「直接」。"
              >
                <ChoiceGroup
                  ariaLabel="回复语气"
                  value={selectedTone}
                  options={TONE_CHOICES}
                  onChange={(value) => updateResponsePref("tone", value as Tone)}
                />
              </PreferenceOption>

              <PreferenceOption
                title="回复结构"
                description="「先结论」适合汇报场景；「自由」让 AI 自己组织。"
                divider={false}
              >
                <ChoiceGroup
                  ariaLabel="回复结构"
                  value={selectedFormat}
                  options={FORMAT_CHOICES}
                  onChange={(value) => updateResponsePref("format", value as FormatShape)}
                />
              </PreferenceOption>
            </PreferenceCard>

            <SectionLabel>安全</SectionLabel>
            <PreferenceCard>
              <PreferenceOption
                title="写入 / 删除前再确认"
                description="AI 在改写项目记忆或删除文档之前，会先跟你打个招呼。"
                divider={false}
              >
                <ChoiceGroup
                  ariaLabel="写入 / 删除前再确认"
                  value={selectedConfirmation}
                  options={CONFIRMATION_CHOICES}
                  onChange={(value) => updateConfirmationPolicy(value as ConfirmationPolicy)}
                />
              </PreferenceOption>
            </PreferenceCard>

            <div
              className="flex flex-wrap items-center justify-between gap-3"
              style={{ marginTop: 24 }}
            >
              <button
                type="button"
                onClick={() => setClearConfirmOpen(true)}
                disabled={clearing}
                className="inline-flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  padding: "9px 16px",
                  fontSize: 13,
                  color: "var(--color-codex-ink-soft)",
                  border: "1px solid var(--color-codex-line)",
                  borderRadius: "var(--codex-r-sm, 6px)",
                  background: "transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--color-codex-bad)";
                  e.currentTarget.style.borderColor =
                    "color-mix(in oklch, var(--color-codex-bad) 30%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--color-codex-ink-soft)";
                  e.currentTarget.style.borderColor = "var(--color-codex-line)";
                }}
              >
                {clearing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eraser className="h-3.5 w-3.5" />
                )}
                清除所有偏好
              </button>

              <div className="ml-auto flex items-center gap-3">
                <StatusText saving={saving} dirty={dirty} msg={msg} />
                <button
                  type="button"
                  onClick={() => void savePreferences()}
                  disabled={saving || clearing}
                  className="inline-flex items-center gap-1.5 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    padding: "9px 22px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--color-codex-bg-elev)",
                    background: "var(--color-codex-ink)",
                    borderRadius: "var(--codex-r-sm, 6px)",
                  }}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  保存
                </button>
              </div>
            </div>
          </>
        )}
      </div>

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        margin: "24px 0 10px",
        fontSize: 11,
        color: "var(--color-codex-ink-faint)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </div>
  );
}

function PreferenceCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        marginBottom: 16,
        padding: "6px 22px",
        background: "var(--color-codex-bg-elev)",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-md, 10px)",
      }}
    >
      {children}
    </section>
  );
}

function PreferenceOption({
  title,
  description,
  divider = true,
  children,
}: {
  title: string;
  description: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "18px 0",
        borderBottom: divider ? "1px solid var(--color-codex-line-soft)" : undefined,
      }}
    >
      <div style={{ fontSize: 14, color: "var(--color-codex-ink)", fontWeight: 500 }}>
        {title}
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 12,
          color: "var(--color-codex-ink-mute)",
          lineHeight: 1.55,
        }}
      >
        {description}
      </div>
      {children}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1.5"
      style={{ marginTop: 12 }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className="transition-colors"
            style={{
              padding: "7px 14px",
              fontSize: 12.5,
              color: active ? "var(--color-codex-accent-ink)" : "var(--color-codex-ink-soft)",
              background: active ? "var(--color-codex-accent-bg)" : "var(--color-codex-bg)",
              border: active
                ? "1px solid var(--color-codex-accent)"
                : "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-pill, 999px)",
              fontWeight: active ? 500 : 400,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusText({
  saving,
  dirty,
  msg,
}: {
  saving: boolean;
  dirty: boolean;
  msg: SavedMessage | null;
}) {
  if (!saving && !dirty && !msg) return null;
  return (
    <span
      className="hidden items-center gap-1.5 sm:inline-flex"
      style={{
        fontSize: 12,
        color: saving || dirty
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
          正在保存...
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
        <span>有未保存修改</span>
      )}
    </span>
  );
}
