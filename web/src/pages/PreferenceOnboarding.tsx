/**
 * Post-login onboarding page — V0.0.6 Codex redesign (PR 4/N).
 *
 * Visual layout per
 * ``design_handoff_aria_codex_redesign/direction-codex-more-2.jsx:158``:
 *
 *   - Top bar: ``CxLogo`` left + "稍后再说 →" link right (no border row).
 *   - Body grid 1fr | 1fr:
 *     LEFT  — personalization form. 30s headline + 称呼 input + 4 chip
 *             groups (语言 / 语气 / 结构 / 写入确认). Footer with
 *             "完成设置" CTA.
 *     RIGHT — live preview card with a faint dot grid, "Aria 会这样回应你"
 *             header + pulse status, user bubble + Aria bubble with
 *             cursor blink, "setting → effect" chip rows, and a dashed
 *             accent-tinted footer note.
 *
 * The state machine, ``buildPayloadFromDraft`` / ``readDraftFromPreferences``,
 * ``generatePreview``, and the /user-memory PUT semantics are unchanged
 * from V0.0.4. Only the rendering layer was rewritten.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2, MessageSquare, Sparkles } from "lucide-react";

import { api } from "../api/client";
import { CxLogo, CxStatus } from "../components/codex";
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
  proactive_care: "" | "off" | "work_partner" | "gentle" | "active";
}

const EMPTY_DRAFT: DraftPreferences = {
  preferred_name: "",
  language: "",
  tone: "",
  format: "",
  ask_before_destructive: "",
  proactive_care: "",
};

// Chip option lists — short labels per the Codex prototype so they fit
// inside the pill button without wrapping. The underlying values stay
// the same as V0.0.4 so persisted preferences round-trip cleanly.
type LangValue = Exclude<PreviewLanguage, "">;
type ToneValue = Exclude<PreviewTone, "">;
type FormatValue = Exclude<PreviewFormat, "">;
type AskValue = "true" | "false";
type ProactiveCareValue = "off" | "work_partner" | "gentle" | "active";

interface Chip<T extends string> {
  value: T;
  label_zh: string;
  label_en: string;
}

const LANGUAGE_CHIPS: Chip<LangValue>[] = [
  { value: "auto", label_zh: "跟你一致", label_en: "Match you" },
  { value: "zh", label_zh: "中文", label_en: "Chinese" },
  { value: "en", label_zh: "English", label_en: "English" },
];

const TONE_CHIPS: Chip<ToneValue>[] = [
  { value: "direct", label_zh: "直接", label_en: "Direct" },
  { value: "friendly", label_zh: "温和", label_en: "Friendly" },
  { value: "formal", label_zh: "严谨", label_en: "Formal" },
];

const FORMAT_CHIPS: Chip<FormatValue>[] = [
  { value: "conclusion_first", label_zh: "先结论", label_en: "Conclusion first" },
  { value: "free", label_zh: "自由", label_en: "Free-form" },
];

const ASK_CHIPS: Chip<AskValue>[] = [
  { value: "true", label_zh: "总是确认", label_en: "Always ask" },
  { value: "false", label_zh: "不必确认", label_en: "Never ask" },
];

const PROACTIVE_CARE_CHIPS: Chip<ProactiveCareValue>[] = [
  { value: "off", label_zh: "关闭", label_en: "Off" },
  { value: "work_partner", label_zh: "工作型", label_en: "Work partner" },
  { value: "gentle", label_zh: "温和型", label_en: "Gentle" },
  { value: "active", label_zh: "积极型", label_en: "Active" },
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
  const cs = preferences.collaboration_style;
  if (cs && typeof cs === "object") {
    const block = cs as Record<string, unknown>;
    if (
      block.proactive_care === "off" ||
      block.proactive_care === "work_partner" ||
      block.proactive_care === "gentle" ||
      block.proactive_care === "active"
    ) {
      draft.proactive_care = block.proactive_care;
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

  if (draft.proactive_care) {
    next.collaboration_style = { proactive_care: draft.proactive_care };
  } else {
    delete next.collaboration_style;
  }

  return next;
}

export function PreferenceOnboarding() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isZh = (i18n.language ?? "zh").startsWith("zh");
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
      <div
        className="theme-codex flex min-h-screen items-center justify-center"
        style={{ background: "var(--color-codex-bg)", color: "var(--color-codex-ink-mute)" }}
      >
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // Effect chips derived from the current draft — match the prototype's
  // "setting · choice → impact on reply" row.
  const effectRows = (
    isZh
      ? [
          draft.tone === "direct"
            ? { k: "语气 · 直接", e: "省去客套寒暄，直接给判断" }
            : draft.tone === "friendly"
              ? { k: "语气 · 温和", e: "保留同理心 + 简短背景，再给判断" }
              : draft.tone === "formal"
                ? { k: "语气 · 严谨", e: "用正式书面语，列出关键节点与依据" }
                : null,
          draft.format === "conclusion_first"
            ? { k: "结构 · 先结论", e: "结论在前，理由在后" }
            : draft.format === "free"
              ? { k: "结构 · 自由", e: "由模型按场景自然展开" }
              : null,
          draft.language === "auto"
            ? { k: "语言 · 跟你一致", e: "你用什么语言，它就用什么" }
            : draft.language === "zh"
              ? { k: "语言 · 中文", e: "默认用中文回答" }
              : draft.language === "en"
                ? { k: "语言 · English", e: "Defaults to English replies" }
                : null,
          draft.proactive_care === "off"
            ? { k: "主动关怀 · 关闭", e: "只在你明确提问时回应" }
            : draft.proactive_care === "work_partner"
              ? { k: "主动关怀 · 工作型", e: "长任务或深夜收尾时，帮你整理下一步" }
              : draft.proactive_care === "gentle"
                ? { k: "主动关怀 · 温和型", e: "压力大时先稳一下，再拆解任务" }
                : draft.proactive_care === "active"
                  ? { k: "主动关怀 · 积极型", e: "更主动提醒节奏、风险和下一步" }
                  : null,
        ]
      : [
          draft.tone === "direct"
            ? { k: "Tone · Direct", e: "Skips pleasantries — calls it as it sees it" }
            : draft.tone === "friendly"
              ? { k: "Tone · Friendly", e: "Acknowledges, frames briefly, then decides" }
              : draft.tone === "formal"
                ? { k: "Tone · Formal", e: "Reads as written prose with explicit key points" }
                : null,
          draft.format === "conclusion_first"
            ? { k: "Structure · Conclusion first", e: "Verdict up front, reasoning afterwards" }
            : draft.format === "free"
              ? { k: "Structure · Free-form", e: "Lets the model shape the reply to the situation" }
              : null,
          draft.language === "auto"
            ? { k: "Language · Match you", e: "Replies in whatever language your prompt was in" }
            : draft.language === "zh"
              ? { k: "Language · Chinese", e: "Defaults to Chinese replies" }
              : draft.language === "en"
                ? { k: "Language · English", e: "Defaults to English replies" }
                : null,
          draft.proactive_care === "off"
            ? { k: "Proactive care · Off", e: "Only responds when you explicitly ask" }
            : draft.proactive_care === "work_partner"
              ? { k: "Proactive care · Work partner", e: "Wraps up long or late work into next steps" }
              : draft.proactive_care === "gentle"
                ? { k: "Proactive care · Gentle", e: "Steadies the moment, then structures the task" }
                : draft.proactive_care === "active"
                  ? { k: "Proactive care · Active", e: "More actively flags cadence, risks, and next steps" }
                  : null,
        ]
  ).filter((row): row is { k: string; e: string } => row !== null);

  return (
    <div
      className="theme-codex flex min-h-screen flex-col"
      style={{ background: "var(--color-codex-bg-elev)" }}
      data-testid="preference-onboarding-page"
    >
      {/* Top bar — logo left, skip-link right. No bottom border. */}
      <header
        className="flex flex-shrink-0 items-center justify-between"
        style={{ height: 64, padding: "0 36px" }}
      >
        <CxLogo size={22} />
        <button
          type="button"
          onClick={() => void handleSave("skipping")}
          disabled={saving !== null}
          className="transition disabled:opacity-50"
          style={{ fontSize: 12.5, color: "var(--color-codex-ink-mute)" }}
          data-testid="skip-onboarding"
        >
          {isZh ? "稍后再说 →" : "Later →"}
        </button>
      </header>

      {/* Centered, capped stage — keeps the two cards readable on ultrawide */}
      <div
        className="flex flex-1 items-center justify-center"
        style={{ padding: "24px 36px 48px", minHeight: 0 }}
      >
        <div
          className="grid w-full lg:grid-cols-2"
          style={{ maxWidth: 1160, gap: 20, alignItems: "stretch" }}
        >
        {/* ---- LEFT — personalization form ---- */}
        <section
          className="flex flex-col overflow-hidden"
          style={{
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-lg, 10px)",
            padding: "36px 40px",
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
                letterSpacing: "-0.02em",
                lineHeight: 1.3,
              }}
            >
              {isZh ? (
                <>
                  一起花{" "}
                  <span
                    className="font-mono"
                    style={{ color: "var(--color-codex-accent)", fontVariantNumeric: "tabular-nums" }}
                  >
                    30
                  </span>{" "}
                  秒，把 Aria 调到顺手
                </>
              ) : (
                <>
                  Take{" "}
                  <span
                    className="font-mono"
                    style={{ color: "var(--color-codex-accent)", fontVariantNumeric: "tabular-nums" }}
                  >
                    30
                  </span>{" "}
                  seconds to make Aria fit your style
                </>
              )}
            </h1>
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 13.5,
                color: "var(--color-codex-ink-mute)",
                lineHeight: 1.65,
              }}
            >
              {isZh
                ? "全部可选，之后随时可以在「设置 → 外观 / AI 个人偏好」里调。"
                : "All optional — you can revisit any of this later under Settings → Appearance / Personal preferences."}
            </p>
          </div>

          {/* 称呼 input */}
          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="onb-preferred-name"
              style={{
                fontSize: 13,
                color: "var(--color-codex-ink)",
                fontWeight: 500,
                display: "block",
                marginBottom: 8,
              }}
            >
              {isZh ? "Aria 怎么称呼你" : "How should Aria address you"}
            </label>
            <input
              id="onb-preferred-name"
              type="text"
              value={draft.preferred_name}
              onChange={(e) =>
                setDraft((cur) => ({ ...cur, preferred_name: e.target.value }))
              }
              placeholder={isZh ? "例如：李总、小李、Liang" : "e.g. Boss Li, Liang"}
              maxLength={40}
              autoComplete="off"
              className="codex-input"
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 13.5,
                background: "var(--color-codex-bg)",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 3px)",
                color: "var(--color-codex-ink)",
              }}
              data-testid="onb-preferred-name"
            />
            <div
              style={{
                fontSize: 11.5,
                color: "var(--color-codex-ink-mute)",
                marginTop: 6,
              }}
            >
              {isZh
                ? "最长 40 个字 · 留空也行，后续可以补"
                : "Up to 40 characters · leave blank and fill in later"}
            </div>
          </div>

          {/* Chip groups */}
          <PrefChips
            label={isZh ? "回复语言" : "Reply language"}
            isZh={isZh}
            value={draft.language}
            options={LANGUAGE_CHIPS}
            onChange={(v) => setDraft((cur) => ({ ...cur, language: v as PreviewLanguage }))}
            groupTestId="onb-language"
          />
          <PrefChips
            label={isZh ? "回复语气" : "Tone"}
            isZh={isZh}
            value={draft.tone}
            options={TONE_CHIPS}
            onChange={(v) => setDraft((cur) => ({ ...cur, tone: v as PreviewTone }))}
            groupTestId="onb-tone"
          />
          <PrefChips
            label={isZh ? "回复结构" : "Structure"}
            isZh={isZh}
            value={draft.format}
            options={FORMAT_CHIPS}
            onChange={(v) => setDraft((cur) => ({ ...cur, format: v as PreviewFormat }))}
            groupTestId="onb-format"
          />
          <PrefChips
            label={isZh ? "主动关怀" : "Proactive care"}
            isZh={isZh}
            value={draft.proactive_care}
            options={PROACTIVE_CARE_CHIPS}
            onChange={(v) =>
              setDraft((cur) => ({
                ...cur,
                proactive_care: v as DraftPreferences["proactive_care"],
              }))
            }
            groupTestId="onb-proactive-care"
          />
          <PrefChips
            label={isZh ? "写入 / 删除前是否再次确认" : "Confirm before writing or deleting?"}
            isZh={isZh}
            value={draft.ask_before_destructive}
            options={ASK_CHIPS}
            onChange={(v) =>
              setDraft((cur) => ({
                ...cur,
                ask_before_destructive: v as DraftPreferences["ask_before_destructive"],
              }))
            }
            groupTestId="onb-ask"
          />

          {error ? (
            <p
              role="alert"
              style={{
                marginTop: 16,
                padding: "8px 12px",
                background: "color-mix(in oklch, var(--color-codex-bad) 8%, transparent)",
                border: "1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)",
                borderRadius: "var(--codex-r-sm, 3px)",
                color: "var(--color-codex-bad)",
                fontSize: 12,
              }}
            >
              {error}
            </p>
          ) : null}

          {/* Footer — note left, CTA right */}
          <div
            className="mt-auto flex items-center justify-between"
            style={{ paddingTop: 24 }}
          >
            <span style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}>
              {isZh ? "所有设置仅对你自己生效" : "These settings only apply to your account"}
            </span>
            <button
              type="button"
              onClick={() => void handleSave("completing")}
              disabled={saving !== null}
              className="inline-flex items-center gap-2 transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                padding: "10px 22px",
                background: "var(--color-codex-ink)",
                color: "var(--color-codex-bg-elev)",
                borderRadius: "var(--codex-r-sm, 3px)",
                fontSize: 13.5,
                fontWeight: 500,
              }}
              data-testid="complete-onboarding"
            >
              {saving === "completing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  {isZh ? "完成设置" : "Done"}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </>
              )}
              {saving === "completing" ? (isZh ? "保存中…" : "Saving…") : null}
            </button>
          </div>
        </section>

        {/* ---- RIGHT — live preview ---- */}
        <section
          className="relative flex flex-col overflow-hidden"
          style={{
            background: "var(--color-codex-bg-tint)",
            border: "1px solid var(--color-codex-line-soft)",
            borderRadius: "var(--codex-r-lg, 10px)",
            padding: "32px 40px",
            gap: 20,
          }}
        >
          {/* Faint dot grid background */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.35,
              backgroundImage:
                "radial-gradient(circle, var(--color-codex-line-strong) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
              maskImage:
                "radial-gradient(ellipse 80% 80% at 50% 30%, black 30%, transparent 90%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 80% 80% at 50% 30%, black 30%, transparent 90%)",
              pointerEvents: "none",
            }}
          />

          {/* Header */}
          <div
            className="relative flex items-center gap-2"
            style={{ color: "var(--color-codex-ink-mute)" }}
          >
            <MessageSquare className="h-3 w-3" aria-hidden="true" strokeWidth={1.5} />
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {isZh ? "Aria 会这样回应你" : "How Aria would reply"}
            </span>
            <CxStatus tone="accent" pulse>
              {isZh ? "实时" : "Live"}
            </CxStatus>
          </div>

          <div
            className="relative flex flex-col gap-4"
            data-testid="preview-conversation"
          >
            {/* User bubble — right aligned */}
            <div className="flex justify-end">
              <div
                style={{
                  maxWidth: "82%",
                  background: "var(--color-codex-bg-elev)",
                  border: "1px solid var(--color-codex-line)",
                  padding: "10px 14px",
                  borderRadius: "var(--codex-r-md, 6px)",
                  fontSize: 13.5,
                  color: "var(--color-codex-ink)",
                  lineHeight: 1.6,
                }}
              >
                {preview.userMessage}
              </div>
            </div>

            {/* Aria bubble — sparkle avatar + cursor blink */}
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: "var(--color-codex-accent)",
                  color: "var(--color-codex-bg-elev)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              </span>
              <div
                style={{
                  flex: 1,
                  maxWidth: "85%",
                  background: "var(--color-codex-bg-elev)",
                  border: "1px solid var(--color-codex-line)",
                  padding: "12px 16px",
                  borderRadius: "var(--codex-r-md, 6px)",
                }}
                data-testid="preview-aria-reply"
              >
                <p
                  className="codex-cursor"
                  style={{
                    margin: 0,
                    fontSize: 14,
                    color: "var(--color-codex-ink)",
                    lineHeight: 1.75,
                    whiteSpace: "pre-line",
                  }}
                >
                  {preview.ariaReply}
                </p>
              </div>
            </div>
          </div>

          {/* Setting → effect chips — only rows for actively selected prefs */}
          {effectRows.length > 0 && (
            <div className="relative flex flex-col gap-2" style={{ marginTop: 4 }}>
              {effectRows.map((row) => (
                <div
                  key={row.k}
                  className="flex items-center gap-2.5"
                  style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)" }}
                >
                  <span
                    style={{
                      padding: "2px 8px",
                      background: "var(--color-codex-accent-bg)",
                      color: "var(--color-codex-accent-ink)",
                      borderRadius: "var(--codex-r-sm, 3px)",
                      fontWeight: 500,
                    }}
                  >
                    {row.k}
                  </span>
                  <ArrowRight
                    className="h-2.5 w-2.5"
                    aria-hidden="true"
                    strokeWidth={1.5}
                    style={{ color: "var(--color-codex-ink-faint)" }}
                  />
                  <span>{row.e}</span>
                </div>
              ))}
            </div>
          )}

          {/* Footer note — dashed accent border */}
          <div
            className="relative mt-auto flex items-start gap-2"
            style={{
              padding: "10px 14px",
              background:
                "color-mix(in oklch, var(--color-codex-accent-bg) 50%, transparent)",
              border:
                "1px dashed color-mix(in oklch, var(--color-codex-accent) 35%, transparent)",
              borderRadius: "var(--codex-r-sm, 3px)",
              fontSize: 11.5,
              color: "var(--color-codex-ink-mute)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: "var(--color-codex-accent)",
                marginTop: 2,
                flexShrink: 0,
                fontSize: 11,
              }}
            >
              ✦
            </span>
            <span>
              {isZh
                ? "这是示范，不是真的对话。改改左侧设置，右边会跟着变 — 你能看到每个偏好对回答的具体影响。"
                : "This is a demo, not a real conversation. Tweak the form on the left and the right side updates live — you'll see exactly how each preference shapes the reply."}
            </span>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}

interface PrefChipsProps<T extends string> {
  label: string;
  isZh: boolean;
  value: T | "";
  options: Chip<T>[];
  onChange: (next: T | "") => void;
  groupTestId: string;
}

function PrefChips<T extends string>({
  label,
  isZh,
  value,
  options,
  onChange,
  groupTestId,
}: PrefChipsProps<T>) {
  return (
    <div style={{ marginBottom: 18 }} data-testid={groupTestId}>
      <div
        style={{
          fontSize: 13,
          color: "var(--color-codex-ink)",
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(active ? "" : opt.value)}
              className="transition"
              style={{
                padding: "6px 12px",
                fontSize: 12.5,
                color: active
                  ? "var(--color-codex-accent-ink)"
                  : "var(--color-codex-ink-soft)",
                background: active
                  ? "var(--color-codex-accent-bg)"
                  : "var(--color-codex-bg)",
                border: `1px solid ${
                  active
                    ? "color-mix(in oklch, var(--color-codex-accent) 50%, transparent)"
                    : "var(--color-codex-line)"
                }`,
                borderRadius: "var(--codex-r-pill, 999px)",
                fontWeight: active ? 500 : 400,
              }}
            >
              {isZh ? opt.label_zh : opt.label_en}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const __test__ = { readDraftFromPreferences, buildPayloadFromDraft };
