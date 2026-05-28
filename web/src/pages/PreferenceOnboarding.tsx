/**
 * Post-login onboarding page (V0.0.4 follow-up).
 *
 * Two-column layout:
 *   - Left: all AI personal preferences (称呼 / 语言 / 语气 / 结构 / 写入确认).
 *   - Right: a live "Aria 示范回复" card that re-renders as the user adjusts
 *     settings, so they feel the difference instead of guessing at it.
 *
 * Gating:
 *   - All fields are optional.
 *   - "完成设置" saves whatever the user filled in + marks the onboarding as
 *     seen, then navigates to the workspace.
 *   - "稍后再说" saves only the onboarding-seen flag and navigates away.
 *   - Either way, the user is not redirected back here on the next login.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, MessageSquare, Sparkles } from "lucide-react";

import { api } from "../api/client";
import { generatePreview } from "./preferenceOnboardingPreview";
import type {
  PreviewFormat,
  PreviewLanguage,
  PreviewTone,
} from "./preferenceOnboardingPreview";

interface UserMemoryResponse {
  preferences: Record<string, unknown>;
  version: number;
  updated_at: string;
}

interface DraftPreferences {
  preferred_name: string;
  language: PreviewLanguage;
  tone: PreviewTone;
  format: PreviewFormat;
  ask_before_destructive: "" | "true" | "false";
}

const EMPTY_DRAFT: DraftPreferences = {
  preferred_name: "",
  language: "",
  tone: "",
  format: "",
  ask_before_destructive: "",
};

const LANGUAGE_OPTIONS: { value: PreviewLanguage; label: string }[] = [
  { value: "", label: "未设置（由模型判断）" },
  { value: "zh", label: "中文优先" },
  { value: "en", label: "English first" },
  { value: "auto", label: "跟随对话语言" },
];

const TONE_OPTIONS: { value: PreviewTone; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "direct", label: "直接、协作" },
  { value: "friendly", label: "友好、亲和" },
  { value: "formal", label: "正式、客户场合" },
];

const FORMAT_OPTIONS: { value: PreviewFormat; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "conclusion_first", label: "先给结论再展开" },
  { value: "free", label: "由模型自由判断" },
];

const ASK_OPTIONS: { value: DraftPreferences["ask_before_destructive"]; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "true", label: "是（更稳）" },
  { value: "false", label: "否（更顺畅）" },
];

function readDraftFromPreferences(preferences: Record<string, unknown>): DraftPreferences {
  const draft: DraftPreferences = { ...EMPTY_DRAFT };
  const personal = preferences.personal_info;
  if (personal && typeof personal === "object") {
    const block = personal as Record<string, unknown>;
    if (typeof block.preferred_name === "string") draft.preferred_name = block.preferred_name;
  }
  const rp = preferences.response_preferences;
  if (rp && typeof rp === "object") {
    const block = rp as Record<string, unknown>;
    if (typeof block.language === "string") draft.language = block.language as PreviewLanguage;
    if (typeof block.tone === "string") draft.tone = block.tone as PreviewTone;
    if (typeof block.format === "string") draft.format = block.format as PreviewFormat;
  }
  const ws = preferences.work_style;
  if (ws && typeof ws === "object") {
    const block = ws as Record<string, unknown>;
    if (typeof block.ask_before_destructive === "boolean") {
      draft.ask_before_destructive = block.ask_before_destructive ? "true" : "false";
    }
  }
  return draft;
}

function buildPayloadFromDraft(
  existing: Record<string, unknown>,
  draft: DraftPreferences,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };

  const personalRaw = next.personal_info;
  const personal: Record<string, unknown> =
    personalRaw && typeof personalRaw === "object"
      ? { ...(personalRaw as Record<string, unknown>) }
      : {};
  const trimmedName = draft.preferred_name.trim();
  if (trimmedName) personal.preferred_name = trimmedName;
  else delete personal.preferred_name;
  personal.onboarding_seen = true;
  next.personal_info = personal;

  const rp: Record<string, unknown> = {};
  if (draft.language) rp.language = draft.language;
  if (draft.tone) rp.tone = draft.tone;
  if (draft.format) rp.format = draft.format;
  if (Object.keys(rp).length > 0) next.response_preferences = rp;
  else delete next.response_preferences;

  if (draft.ask_before_destructive === "true") {
    next.work_style = { ask_before_destructive: true };
  } else if (draft.ask_before_destructive === "false") {
    next.work_style = { ask_before_destructive: false };
  } else {
    delete next.work_style;
  }

  return next;
}

export function PreferenceOnboarding() {
  const navigate = useNavigate();
  const [existing, setExisting] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<DraftPreferences>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"completing" | "skipping" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<UserMemoryResponse>("/user-memory")
      .then((response) => {
        const prefs = response.preferences ?? {};
        setExisting(prefs);
        setDraft(readDraftFromPreferences(prefs));
      })
      .catch(() => {
        setExisting({});
      })
      .finally(() => setLoading(false));
  }, []);

  const preview = useMemo(
    () =>
      generatePreview({
        preferredName: draft.preferred_name,
        language: draft.language,
        tone: draft.tone,
        format: draft.format,
      }),
    [draft.preferred_name, draft.language, draft.tone, draft.format],
  );

  const handleSave = async (mode: "completing" | "skipping") => {
    setSaving(mode);
    setError(null);
    try {
      const payload =
        mode === "skipping"
          ? buildPayloadFromDraft(existing, { ...EMPTY_DRAFT })
          : buildPayloadFromDraft(existing, draft);
      await api.put<UserMemoryResponse>("/user-memory", { preferences: payload });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试");
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-on-surface-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-surface via-surface-container-lowest to-surface-container-low"
      data-testid="preference-onboarding-page"
    >
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          <span className="font-manrope text-base font-semibold">Aria AI</span>
        </div>
        <button
          type="button"
          onClick={() => void handleSave("skipping")}
          disabled={saving !== null}
          className="text-xs text-on-surface-muted underline-offset-4 transition hover:text-on-surface hover:underline disabled:opacity-50"
          data-testid="skip-onboarding"
        >
          稍后再说
        </button>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-6 pb-16 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: settings */}
        <section className="rounded-3xl border border-outline/10 bg-surface-container-lowest/80 p-7 shadow-sm backdrop-blur">
          <div className="mb-5">
            <h1 className="text-2xl font-semibold text-on-surface">
              一起花 30 秒，把 Aria 调到顺手
            </h1>
            <p className="mt-1.5 text-sm text-on-surface-muted">
              全部可选，之后随时可以在「设置 → AI 个人偏好」里调。
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="onb-preferred-name"
                className="block text-sm font-medium text-on-surface"
              >
                Aria 怎么称呼你
              </label>
              <input
                id="onb-preferred-name"
                type="text"
                value={draft.preferred_name}
                onChange={(e) =>
                  setDraft((cur) => ({ ...cur, preferred_name: e.target.value }))
                }
                placeholder="例如：李总、小李、Liang"
                maxLength={40}
                className="mt-1.5 w-full rounded-xl border border-outline/15 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                autoComplete="off"
                data-testid="onb-preferred-name"
              />
              <p className="mt-1 text-[11px] text-on-surface-muted">
                最长 40 个字。留空也行，后续可以补。
              </p>
            </div>

            <PrefSelect
              label="回复语言"
              value={draft.language}
              onChange={(v) => setDraft((cur) => ({ ...cur, language: v as PreviewLanguage }))}
              options={LANGUAGE_OPTIONS}
              testId="onb-language"
            />

            <PrefSelect
              label="回复语气"
              value={draft.tone}
              onChange={(v) => setDraft((cur) => ({ ...cur, tone: v as PreviewTone }))}
              options={TONE_OPTIONS}
              testId="onb-tone"
            />

            <PrefSelect
              label="回复结构"
              value={draft.format}
              onChange={(v) => setDraft((cur) => ({ ...cur, format: v as PreviewFormat }))}
              options={FORMAT_OPTIONS}
              testId="onb-format"
            />

            <PrefSelect
              label="写入/删除前是否再次确认"
              value={draft.ask_before_destructive}
              onChange={(v) =>
                setDraft((cur) => ({
                  ...cur,
                  ask_before_destructive: v as DraftPreferences["ask_before_destructive"],
                }))
              }
              options={ASK_OPTIONS}
              testId="onb-ask"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-error/10 px-3 py-2 text-xs text-error"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-7 flex items-center justify-between">
            <span className="text-[11px] text-on-surface-muted">所有设置仅对你自己生效</span>
            <button
              type="button"
              onClick={() => void handleSave("completing")}
              disabled={saving !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-on-primary shadow-sm transition hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="complete-onboarding"
            >
              {saving === "completing" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              )}
              {saving === "completing" ? "保存中…" : "完成设置"}
            </button>
          </div>
        </section>

        {/* Right: live preview */}
        <section className="flex flex-col rounded-3xl border border-outline/10 bg-gradient-to-br from-primary/[0.04] via-surface-container-lowest/60 to-secondary-container/30 p-7 shadow-sm backdrop-blur">
          <div className="mb-4 flex items-center gap-2 text-on-surface-muted">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-wide">
              Aria 会这样回应你
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-3" data-testid="preview-conversation">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-surface-container-low/80 px-4 py-2.5 text-sm text-on-surface shadow-sm">
                {preview.userMessage}
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-primary text-white"
                aria-hidden="true"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div
                className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-tl-sm bg-surface-container-lowest px-4 py-3 text-sm leading-relaxed text-on-surface shadow-sm"
                data-testid="preview-aria-reply"
              >
                {preview.ariaReply}
              </div>
            </div>
          </div>

          <p className="mt-6 text-[11px] text-on-surface-muted">
            这是示范，不是真的对话。改改左侧设置，右边会跟着变。
          </p>
        </section>
      </main>
    </div>
  );
}

interface PrefSelectProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  testId: string;
}

function PrefSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: PrefSelectProps<T>) {
  return (
    <div>
      <label className="block text-sm font-medium text-on-surface">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1.5 w-full rounded-xl border border-outline/15 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export const __test__ = { readDraftFromPreferences, buildPayloadFromDraft };
