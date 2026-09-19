import type { PreviewFormat, PreviewLanguage, PreviewTone } from "./preferenceOnboardingPreview";

export interface DraftPreferences {
  preferred_name: string;
  language: PreviewLanguage;
  tone: PreviewTone;
  format: PreviewFormat;
  ask_before_destructive: "" | "true" | "false";
  proactive_care: "" | "off" | "work_partner" | "gentle" | "active";
}

export const EMPTY_DRAFT: DraftPreferences = {
  preferred_name: "",
  language: "",
  tone: "",
  format: "",
  ask_before_destructive: "",
  proactive_care: "",
};

export function readDraftFromPreferences(preferences: Record<string, unknown>): DraftPreferences {
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

export function buildPayloadFromDraft(
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
