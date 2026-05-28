/**
 * Preview generator for the post-login PreferenceOnboarding page.
 *
 * Given the user's current draft of AI personal preferences, produce the
 * sample user question + Aria reply that the right-side preview card
 * displays. Pure — no React, no API — so it's cheap to re-run on every
 * keystroke and easy to unit-test.
 *
 * Design notes:
 * - Language picks zh or en (auto / empty default to zh).
 * - Tone shapes the *body* of the reply (direct ↔ formal); format chooses
 *   whether a `结论：…` lead line is prepended (conclusion_first) or the
 *   reply flows naturally (free / empty).
 * - Salutation only appears when the user typed a 称呼 AND the tone is
 *   friendly/formal — direct tone deliberately omits it (a direct reply
 *   gets to the point, not the greeting).
 */

export type PreviewLanguage = "zh" | "en" | "auto" | "";
export type PreviewTone = "direct" | "friendly" | "formal" | "";
export type PreviewFormat = "conclusion_first" | "free" | "";

export interface PreviewInputs {
  preferredName: string;
  language: PreviewLanguage;
  tone: PreviewTone;
  format: PreviewFormat;
}

export interface PreviewOutput {
  language: "zh" | "en";
  userMessage: string;
  ariaReply: string;
}

const SAMPLE_USER_ZH = "项目预算超了 20%，你怎么看？";
const SAMPLE_USER_EN = "We're 20% over budget on this project. What's your read?";

function resolveLanguage(input: PreviewLanguage): "zh" | "en" {
  return input === "en" ? "en" : "zh";
}

function salutation(name: string, tone: PreviewTone, lang: "zh" | "en"): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (tone === "direct" || tone === "") return "";
  if (lang === "en") {
    if (tone === "formal") return `Dear ${trimmed}, `;
    return `Hi ${trimmed} — `;
  }
  // zh
  if (tone === "formal") return `${trimmed}，您好。`;
  return `${trimmed}，`;
}

function bodyFor(tone: PreviewTone, lang: "zh" | "en"): string {
  if (lang === "en") {
    if (tone === "direct")
      return "Freeze non-critical spend this week and reopen scope with the client before any new commitments.";
    if (tone === "formal")
      return "I recommend convening PM and finance this week to produce a scope-realignment memo before any further commitments are made.";
    if (tone === "friendly")
      return "Let's walk through it together — is it an estimation gap or a quiet scope creep? The fix is different for each, and either way we'll be fine.";
    // unset → balanced default
    return "Two paths to check: was the original estimate low, or did scope quietly grow? The right move depends on which one it is.";
  }
  // zh
  if (tone === "direct") return "建议本周内冻结非关键支出，先把范围跟客户重新对齐再谈新增。";
  if (tone === "formal")
    return "关于本期预算超支，建议本周内召集 PM 与财务，输出一份范围对齐说明，再决定后续投入节奏。";
  if (tone === "friendly")
    return "我们一起捋一下：是估算偏低，还是范围悄悄扩了？两种情形的处理路径完全不同，先别慌。";
  return "先分两路核：是估算偏低，还是范围悄悄扩了？两种情形的处理路径完全不同。";
}

function leadLine(format: PreviewFormat, lang: "zh" | "en"): string {
  if (format !== "conclusion_first") return "";
  if (lang === "en") return "Bottom line: scope realignment before any new spend. ";
  return "结论：先做范围对齐，再谈追加预算。";
}

export function generatePreview(inputs: PreviewInputs): PreviewOutput {
  const lang = resolveLanguage(inputs.language);
  const userMessage = lang === "en" ? SAMPLE_USER_EN : SAMPLE_USER_ZH;
  const sal = salutation(inputs.preferredName, inputs.tone, lang);
  const lead = leadLine(inputs.format, lang);
  const body = bodyFor(inputs.tone, lang);
  const ariaReply =
    lang === "en"
      ? `${sal}${lead}${body}`.trim()
      : lead
        ? `${sal}${lead}\n\n${body}`.trim()
        : `${sal}${body}`.trim();
  return { language: lang, userMessage, ariaReply };
}
