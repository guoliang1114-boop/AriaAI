import { describe, expect, it } from "vitest";
import {
  applyPreferenceSuggestion,
  detectPreferenceSuggestion,
} from "./preferenceHints";

describe("detectPreferenceSuggestion", () => {
  it("returns null for unrelated content", () => {
    expect(detectPreferenceSuggestion("帮我看一下这份合同")).toBeNull();
    expect(detectPreferenceSuggestion("")).toBeNull();
    expect(detectPreferenceSuggestion("hi")).toBeNull();
  });

  it("picks up '以后用中文回复' as a Chinese-language preference", () => {
    const out = detectPreferenceSuggestion("以后请你都用中文回复我");
    expect(out).not.toBeNull();
    expect(out?.key).toBe("response_preferences.language");
    expect(out?.value).toBe("zh");
  });

  it("picks up '以后用 English' as an English-language preference", () => {
    const out = detectPreferenceSuggestion("从现在开始, please reply in English");
    expect(out).not.toBeNull();
    expect(out?.key).toBe("response_preferences.language");
    expect(out?.value).toBe("en");
  });

  it("picks up '先给结论' as a conclusion-first format preference", () => {
    const out = detectPreferenceSuggestion("先给结论再展开论证");
    expect(out?.key).toBe("response_preferences.format");
    expect(out?.value).toBe("conclusion_first");
  });

  it("picks up direct-tone phrasing", () => {
    const out = detectPreferenceSuggestion("以后直接说重点就行");
    expect(out?.key).toBe("response_preferences.tone");
    expect(out?.value).toBe("direct");
  });

  it("picks up '写入前再确认我一下'", () => {
    const out = detectPreferenceSuggestion("以后写入项目空间前请先确认我一下");
    expect(out?.key).toBe("work_style.ask_before_destructive");
    expect(out?.value).toBe(true);
  });
});

describe("applyPreferenceSuggestion", () => {
  it("merges a dotted-key suggestion into the existing preferences", () => {
    const start: Record<string, unknown> = {
      response_preferences: { tone: "direct" },
    };
    const out = applyPreferenceSuggestion(start, {
      key: "response_preferences.language",
      value: "zh",
      label: "x",
      hint: "y",
    });
    expect(out).toEqual({
      response_preferences: { tone: "direct", language: "zh" },
    });
    // Original object must not be mutated.
    expect(start).toEqual({ response_preferences: { tone: "direct" } });
  });

  it("creates the top-level block when missing", () => {
    const out = applyPreferenceSuggestion(
      {},
      { key: "work_style.ask_before_destructive", value: true, label: "x", hint: "y" },
    );
    expect(out).toEqual({ work_style: { ask_before_destructive: true } });
  });
});
