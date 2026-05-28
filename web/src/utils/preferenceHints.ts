/**
 * Lightweight detector that suggests when a user's chat message looks like a
 * lasting preference worth saving into UserMemory (V0.0.4 track B).
 *
 * Used by ``ProjectChatMessageBubble`` to surface a small "💡 记住为偏好"
 * affordance under the user's own message — clicking it opens a focused modal
 * pre-filled with the suggested key/value. The detector is intentionally
 * conservative so it does not pop up on every message.
 */

export type PreferenceKey =
  | "response_preferences.language"
  | "response_preferences.tone"
  | "response_preferences.format"
  | "work_style.ask_before_destructive";

export interface PreferenceSuggestion {
  key: PreferenceKey;
  value: string | boolean;
  label: string;
  hint: string;
}

const PHRASES: Array<{
  pattern: RegExp;
  build: (match: RegExpMatchArray) => PreferenceSuggestion;
}> = [
  // 语言偏好
  {
    pattern: /(以后|从现在开始|默认)[^。\n]{0,12}(中文|用中文|讲中文|回中文)/i,
    build: () => ({
      key: "response_preferences.language",
      value: "zh",
      label: "回复语言：中文优先",
      hint: "AI 在所有项目里默认用中文回复。",
    }),
  },
  {
    pattern: /(以后|从现在开始|默认|reply in english)[^。\n]{0,30}(english|英文|用英文|讲英文|回英文)/i,
    build: () => ({
      key: "response_preferences.language",
      value: "en",
      label: "回复语言：English first",
      hint: "AI 在所有项目里默认用英文回复。",
    }),
  },
  // 回复结构 — "先给结论 / 结论先行"
  {
    pattern: /(先(?:给|讲|说)?)?(结论|结论先行|结论优先|conclusion[\s-]?first)/i,
    build: () => ({
      key: "response_preferences.format",
      value: "conclusion_first",
      label: "回复结构：先给结论再展开",
      hint: "AI 会先点结论再列依据,避免长铺垫。",
    }),
  },
  // 语气
  {
    pattern: /(以后|从现在开始|默认)?[^。\n]{0,8}(直接(?:点)?|不要客气|别绕弯|直接说重点)/i,
    build: () => ({
      key: "response_preferences.tone",
      value: "direct",
      label: "回复语气：直接、协作",
      hint: "AI 会更直接,省略铺垫和客套。",
    }),
  },
  // 写入/删除确认
  {
    pattern: /(写入|改写|删除|覆盖)[^。\n]{0,12}(前|时|请|要|都)[^。\n]{0,10}(确认|问我|再(?:问|确认))/i,
    build: () => ({
      key: "work_style.ask_before_destructive",
      value: true,
      label: "写入/删除前再确认我一下",
      hint: "AI 在执行不可逆动作前会先弹确认。",
    }),
  },
];

export function detectPreferenceSuggestion(text: string): PreferenceSuggestion | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 300) return null;
  for (const { pattern, build } of PHRASES) {
    const match = trimmed.match(pattern);
    if (match) return build(match);
  }
  return null;
}

/**
 * Merge a key/value pair onto the existing preferences object using the same
 * dotted-key convention the backend formatter expects.
 */
export function applyPreferenceSuggestion(
  current: Record<string, unknown>,
  suggestion: PreferenceSuggestion,
): Record<string, unknown> {
  const [top, sub] = suggestion.key.split(".") as [string, string];
  const next: Record<string, unknown> = { ...current };
  const existingBlock = (next[top] && typeof next[top] === "object") ? (next[top] as Record<string, unknown>) : {};
  next[top] = { ...existingBlock, [sub]: suggestion.value };
  return next;
}
