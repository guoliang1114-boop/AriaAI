/**
 * AI 个人偏好 (UserMemory preferences) — pure read / write helpers.
 *
 * Extracted from the old ``UserMemorySettingsCard`` component so the
 * new ``PreferenceSettings`` page can reuse the same payload shaping
 * + parsing without dragging React into a logic test. The settings
 * card's React UI was retired when the preferences moved from being
 * an embedded block inside ``ProfileSettings`` to a dedicated
 * top-level page under the "个人" group.
 *
 * Behavior preserved from the original card:
 * - ``compactPreferences`` re-stamps ``personal_info.onboarding_seen
 *   = true`` on every save so the whole-object PUT semantics on the
 *   backend (``backend/app/routers/user_memory.py``) don't drop the
 *   flag and bounce the user back to /onboarding next refresh.
 * - Empty / whitespace ``preferred_name`` is dropped; only set fields
 *   make it into the payload.
 * - ``readShape`` parses a raw preferences object into the typed
 *   ``PreferencesShape``, tolerating missing keys.
 */

import { normalizeAppearance, type CodexAppearance } from "./codexAppearance";

export type Language = "" | "zh" | "en" | "auto";
export type Tone = "" | "direct" | "friendly" | "formal";
export type FormatShape = "" | "conclusion_first" | "bullet_list" | "free";
export type ConfirmationPolicy = "" | "before_write" | "before_delete" | "all" | "none";
export type ProactiveCare = "" | "off" | "work_partner" | "gentle" | "active";

export interface UserMemoryResponse {
  preferences: Record<string, unknown>;
  version: number;
  updated_at: string;
}

export interface PreferencesShape {
  personal_info?: {
    preferred_name?: string;
    /**
     * Housekeeping flag (the post-login Welcome page sets this once).
     * Every save re-stamps it so writes don't bounce users back to
     * /onboarding — see ``compactPreferences`` below.
     */
    onboarding_seen?: boolean;
  };
  response_preferences?: {
    language?: Language;
    tone?: Tone;
    format?: FormatShape;
  };
  work_style?: {
    ask_before_destructive?: boolean;
    confirmation_policy?: ConfirmationPolicy;
  };
  collaboration_style?: {
    proactive_care?: ProactiveCare;
  };
  /**
   * Codex appearance — theme / accent / density / radius / warmth.
   * Mirrors what's in localStorage (``aria-codex-appearance``) so the
   * user's visual choices follow them across devices.
   */
  appearance?: CodexAppearance;
}

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "zh", label: "中文优先" },
  { value: "en", label: "English first" },
  { value: "auto", label: "跟随对话语言" },
];

export const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "direct", label: "直接、协作" },
  { value: "friendly", label: "友好、亲和" },
  { value: "formal", label: "正式、客户场合" },
];

export const FORMAT_OPTIONS: { value: FormatShape; label: string }[] = [
  { value: "", label: "未设置" },
  { value: "conclusion_first", label: "先给结论再展开" },
  { value: "bullet_list", label: "分点列举" },
  { value: "free", label: "由模型自由判断" },
];

export function compactPreferences(prefs: PreferencesShape): Record<string, unknown> {
  const compact: PreferencesShape = {};

  // The settings page is reachable only AFTER onboarding, so by
  // definition the user has seen it. Re-stamp the flag on every
  // save so the backend's whole-object PUT doesn't drop it.
  const preferredName = prefs.personal_info?.preferred_name?.trim() ?? "";
  const personalOut: NonNullable<PreferencesShape["personal_info"]> = {
    onboarding_seen: true,
  };
  if (preferredName) personalOut.preferred_name = preferredName;
  compact.personal_info = personalOut;

  const rp = prefs.response_preferences ?? {};
  const rpOut: PreferencesShape["response_preferences"] = {};
  if (rp.language) rpOut.language = rp.language;
  if (rp.tone) rpOut.tone = rp.tone;
  if (rp.format) rpOut.format = rp.format;
  if (Object.keys(rpOut).length > 0) compact.response_preferences = rpOut;

  const ws = prefs.work_style ?? {};
  if (typeof ws.ask_before_destructive === "boolean" || ws.confirmation_policy) {
    compact.work_style = {};
    if (typeof ws.ask_before_destructive === "boolean") {
      compact.work_style.ask_before_destructive = ws.ask_before_destructive;
    }
    if (ws.confirmation_policy) {
      compact.work_style.confirmation_policy = ws.confirmation_policy;
    }
  }
  const cs = prefs.collaboration_style ?? {};
  if (cs.proactive_care) {
    compact.collaboration_style = { proactive_care: cs.proactive_care };
  }
  if (prefs.appearance) compact.appearance = prefs.appearance;
  return compact as unknown as Record<string, unknown>;
}

export function readShape(raw: Record<string, unknown> | undefined): PreferencesShape {
  if (!raw || typeof raw !== "object") return {};
  const pi = (raw as { personal_info?: unknown }).personal_info;
  const rp = (raw as { response_preferences?: unknown }).response_preferences;
  const ws = (raw as { work_style?: unknown }).work_style;
  const cs = (raw as { collaboration_style?: unknown }).collaboration_style;
  const out: PreferencesShape = {};
  if (pi && typeof pi === "object") {
    const block = pi as Partial<Record<string, unknown>>;
    const name = typeof block.preferred_name === "string" ? block.preferred_name : "";
    if (name) out.personal_info = { preferred_name: name };
  }
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
    const policy = typeof block.confirmation_policy === "string"
      ? (block.confirmation_policy as ConfirmationPolicy)
      : "";
    if (typeof block.ask_before_destructive === "boolean") {
      out.work_style = { ask_before_destructive: block.ask_before_destructive };
    }
    if (["before_write", "before_delete", "all", "none"].includes(policy)) {
      out.work_style = {
        ...(out.work_style ?? {}),
        confirmation_policy: policy,
      };
    }
  }
  if (cs && typeof cs === "object") {
    const block = cs as Partial<Record<string, unknown>>;
    const proactiveCare = typeof block.proactive_care === "string"
      ? (block.proactive_care as ProactiveCare)
      : "";
    if (["off", "work_partner", "gentle", "active"].includes(proactiveCare)) {
      out.collaboration_style = { proactive_care: proactiveCare };
    }
  }
  const app = (raw as { appearance?: unknown }).appearance;
  if (app && typeof app === "object") {
    out.appearance = normalizeAppearance(app);
  }
  return out;
}
