/**
 * Settings -> Personal preferences.
 *
 * This page mirrors the user's standalone HTML reference:
 * max-width content, grouped cards, and pill choices instead of native selects.
 * The payload still goes through the shared UserMemory helpers so existing
 * onboarding and prompt-injection behavior stays compatible.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Eraser, Loader2, Save, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../api/client";
import { CxConfirmDialog } from "../../components/codex";
import {
  compactPreferences,
  readShape,
  type ConfirmationPolicy,
  type FormatShape,
  type Language,
  type ProactiveCare,
  type PreferencesShape,
  type Tone,
  type UserMemoryResponse,
} from "../../utils/userMemoryPreferences";

interface SavedMessage {
  type: "success" | "error";
  text: string;
}

interface Choice<T extends string> {
  value: T;
  label_zh: string;
  label_en: string;
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

const LANGUAGE_CHOICES: Choice<Language>[] = [
  { value: "auto", label_zh: "跟你一致", label_en: "Match you" },
  { value: "zh", label_zh: "中文", label_en: "Chinese" },
  { value: "en", label_zh: "English", label_en: "English" },
];

const TONE_CHOICES: Choice<Tone>[] = [
  { value: "direct", label_zh: "直接", label_en: "Direct" },
  { value: "friendly", label_zh: "友好", label_en: "Friendly" },
  { value: "formal", label_zh: "正式", label_en: "Formal" },
];

const FORMAT_CHOICES: Choice<FormatShape>[] = [
  { value: "conclusion_first", label_zh: "先结论", label_en: "Conclusion first" },
  { value: "bullet_list", label_zh: "分点列举", label_en: "Bulleted" },
  { value: "free", label_zh: "自由", label_en: "Free-form" },
];

const CONFIRMATION_CHOICES: Choice<ConfirmationPolicy>[] = [
  { value: "before_write", label_zh: "写入前", label_en: "Before writes" },
  { value: "before_delete", label_zh: "删除前", label_en: "Before deletes" },
  { value: "all", label_zh: "都需要", label_en: "Both" },
  { value: "none", label_zh: "都不需要", label_en: "Never" },
];

const PROACTIVE_CARE_CHOICES: Choice<Exclude<ProactiveCare, "">>[] = [
  { value: "off", label_zh: "关闭", label_en: "Off" },
  { value: "work_partner", label_zh: "工作型", label_en: "Work partner" },
  { value: "gentle", label_zh: "温和型", label_en: "Gentle" },
  { value: "active", label_zh: "积极型", label_en: "Active" },
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
  const { i18n } = useTranslation();
  const isZh = (i18n.language ?? "zh").startsWith("zh");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [prefs, setPrefs] = useState<PreferencesShape>({});
  const [msg, setMsg] = useState<SavedMessage | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => {
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    };
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

  const updateProactiveCare = (value: Exclude<ProactiveCare, "">) => {
    changePrefs((cur) => ({
      ...cur,
      collaboration_style: {
        ...(cur.collaboration_style ?? {}),
        proactive_care: value,
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
      setMsg({ type: "success", text: isZh ? "已保存" : "Saved" });
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
      msgTimerRef.current = setTimeout(() => setMsg(null), 1800);
    } catch (err: any) {
      setMsg({
        type: "error",
        text: err.response?.data?.detail || (isZh ? "保存失败" : "Save failed"),
      });
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
      setMsg({ type: "success", text: isZh ? "偏好已清除。" : "Preferences cleared." });
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
      msgTimerRef.current = setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({
        type: "error",
        text: err.response?.data?.detail || (isZh ? "清除失败" : "Failed to clear preferences"),
      });
      setClearConfirmOpen(false);
    } finally {
      setClearing(false);
    }
  };

  const selectedLanguage = prefs.response_preferences?.language || "auto";
  const selectedTone = prefs.response_preferences?.tone || "direct";
  const selectedFormat = prefs.response_preferences?.format || "conclusion_first";
  const selectedConfirmation = getConfirmationPolicy(prefs);
  const selectedProactiveCare: Exclude<ProactiveCare, ""> =
    prefs.collaboration_style?.proactive_care || "off";

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
      <div style={{ width: "100%", paddingBottom: 32 }}>
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
              {isZh ? "个人偏好" : "Personal preferences"}
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
            {isZh
              ? "跨项目生效。AI 会在系统提示词中读取这些偏好，但不会写入客户/项目记忆。"
              : "Applies across every project. The model reads these as system context, but never writes them into client or project memory."}
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
            {isZh ? "正在加载..." : "Loading..."}
          </div>
        ) : (
          <>
            <SectionLabel>{isZh ? "称呼" : "Name"}</SectionLabel>
            <PreferenceCard>
              <PreferenceOption
                title={isZh ? "Aria 怎么称呼你" : "How should Aria address you"}
                description={
                  isZh
                    ? "例如「李总」「小李」「Liang」。留空则使用账户姓名。"
                    : "Examples: 'Boss Li', 'Liang'. Leave empty to fall back to your account name."
                }
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
                  placeholder={isZh ? "例如: 李总、小李、Liang" : "e.g. Boss Li, Liang"}
                  maxLength={40}
                  autoComplete="off"
                  style={INPUT_STYLE}
                />
              </PreferenceOption>
            </PreferenceCard>

            <SectionLabel>{isZh ? "回复风格" : "Reply style"}</SectionLabel>
            <PreferenceCard>
              <PreferenceOption
                title={isZh ? "回复语言" : "Reply language"}
                description={
                  isZh
                    ? "AI 的主要输出语言。「跟你一致」会根据你的提问语言自动判断。"
                    : "The main output language. 'Match you' picks up the language of your last prompt."
                }
              >
                <ChoiceGroup
                  ariaLabel={isZh ? "回复语言" : "Reply language"}
                  isZh={isZh}
                  value={selectedLanguage}
                  options={LANGUAGE_CHOICES}
                  onChange={(value) => updateResponsePref("language", value as Language)}
                />
              </PreferenceOption>

              <PreferenceOption
                title={isZh ? "回复语气" : "Tone"}
                description={
                  isZh
                    ? "客户场合建议「正式」；项目内部多用「直接」。"
                    : "Use 'Formal' with clients, 'Direct' for internal project work."
                }
              >
                <ChoiceGroup
                  ariaLabel={isZh ? "回复语气" : "Tone"}
                  isZh={isZh}
                  value={selectedTone}
                  options={TONE_CHOICES}
                  onChange={(value) => updateResponsePref("tone", value as Tone)}
                />
              </PreferenceOption>

              <PreferenceOption
                title={isZh ? "回复结构" : "Structure"}
                description={
                  isZh
                    ? "「先结论」适合汇报场景；「自由」让 AI 自己组织。"
                    : "'Conclusion first' suits briefings; 'Free-form' lets the model decide."
                }
                divider={false}
              >
                <ChoiceGroup
                  ariaLabel={isZh ? "回复结构" : "Structure"}
                  isZh={isZh}
                  value={selectedFormat}
                  options={FORMAT_CHOICES}
                  onChange={(value) => updateResponsePref("format", value as FormatShape)}
                />
              </PreferenceOption>
            </PreferenceCard>

            <SectionLabel>{isZh ? "协作方式" : "Collaboration"}</SectionLabel>
            <PreferenceCard>
              <PreferenceOption
                title={isZh ? "主动关怀" : "Proactive care"}
                description={
                  isZh
                    ? "允许 Aria 在你长时间工作、深夜收尾或表达压力时，适度提醒节奏，并帮你整理下一步。"
                    : "Allow Aria to lightly check in during long work sessions, late wrap-ups, or moments of pressure, then help structure the next step."
                }
                divider={false}
              >
                <ChoiceGroup
                  ariaLabel={isZh ? "主动关怀" : "Proactive care"}
                  isZh={isZh}
                  value={selectedProactiveCare}
                  options={PROACTIVE_CARE_CHOICES}
                  onChange={(value) => updateProactiveCare(value as Exclude<ProactiveCare, "">)}
                />
              </PreferenceOption>
            </PreferenceCard>

            <SectionLabel>{isZh ? "安全" : "Safety"}</SectionLabel>
            <PreferenceCard>
              <PreferenceOption
                title={isZh ? "写入 / 删除前再确认" : "Confirm before writing or deleting"}
                description={
                  isZh
                    ? "AI 在改写项目记忆或删除文档之前，会先跟你打个招呼。"
                    : "The model will check in with you before rewriting project memory or deleting a doc."
                }
                divider={false}
              >
                <ChoiceGroup
                  ariaLabel={isZh ? "写入 / 删除前再确认" : "Confirm before writing or deleting"}
                  isZh={isZh}
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
                {isZh ? "清除所有偏好" : "Clear all preferences"}
              </button>

              <div className="ml-auto flex items-center gap-3">
                <StatusText isZh={isZh} saving={saving} dirty={dirty} msg={msg} />
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
                  {isZh ? "保存" : "Save"}
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
        title={isZh ? "清除所有 AI 偏好？" : "Clear all AI preferences?"}
        description={
          isZh
            ? "清除后 AI 将不再读取这些个人化设置。该操作不可撤销。"
            : "Once cleared, the model will stop reading these personalisation settings. This cannot be undone."
        }
        confirmLabel={isZh ? "清除" : "Clear"}
        cancelLabel={isZh ? "取消" : "Cancel"}
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
  isZh,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  isZh: boolean;
  value: T;
  options: Choice<T>[];
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
            {isZh ? option.label_zh : option.label_en}
          </button>
        );
      })}
    </div>
  );
}

function StatusText({
  isZh,
  saving,
  dirty,
  msg,
}: {
  isZh: boolean;
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
          {isZh ? "正在保存..." : "Saving..."}
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
        <span>{isZh ? "有未保存修改" : "Unsaved changes"}</span>
      )}
    </span>
  );
}
