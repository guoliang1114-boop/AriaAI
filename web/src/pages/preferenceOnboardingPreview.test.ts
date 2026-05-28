import { describe, expect, it } from "vitest";

import { generatePreview } from "./preferenceOnboardingPreview";

describe("generatePreview", () => {
  it("defaults to Chinese with no lead line and no salutation when nothing is set", () => {
    const out = generatePreview({
      preferredName: "",
      language: "",
      tone: "",
      format: "",
    });
    expect(out.language).toBe("zh");
    expect(out.userMessage).toContain("预算");
    expect(out.ariaReply).not.toMatch(/^结论：/);
    // No preferred name and no friendly/formal tone → no salutation
    // substring should appear (e.g., 您好 or "Hi ").
    expect(out.ariaReply).not.toContain("您好");
    expect(out.ariaReply).not.toContain("Hi ");
  });

  it("switches to English when language=en", () => {
    const out = generatePreview({
      preferredName: "Liang",
      language: "en",
      tone: "friendly",
      format: "",
    });
    expect(out.language).toBe("en");
    expect(out.userMessage).toMatch(/budget/i);
    expect(out.ariaReply).toContain("Hi Liang");
  });

  it("falls back to Chinese when language=auto", () => {
    const out = generatePreview({
      preferredName: "李总",
      language: "auto",
      tone: "formal",
      format: "",
    });
    expect(out.language).toBe("zh");
    expect(out.ariaReply.startsWith("李总，您好")).toBe(true);
  });

  it("prepends a 结论 lead line when format=conclusion_first (zh)", () => {
    const out = generatePreview({
      preferredName: "",
      language: "zh",
      tone: "direct",
      format: "conclusion_first",
    });
    expect(out.ariaReply).toMatch(/^结论：/);
  });

  it("prepends a 'Bottom line:' lead when format=conclusion_first (en)", () => {
    const out = generatePreview({
      preferredName: "",
      language: "en",
      tone: "direct",
      format: "conclusion_first",
    });
    expect(out.ariaReply.toLowerCase()).toContain("bottom line");
  });

  it("omits the salutation when tone=direct even if a name is set", () => {
    const out = generatePreview({
      preferredName: "李总",
      language: "zh",
      tone: "direct",
      format: "",
    });
    expect(out.ariaReply.startsWith("李总")).toBe(false);
  });

  it("uses the formal salutation pattern when tone=formal (zh)", () => {
    const out = generatePreview({
      preferredName: "李总",
      language: "zh",
      tone: "formal",
      format: "",
    });
    expect(out.ariaReply.startsWith("李总，您好。")).toBe(true);
  });

  it("trims the preferred name before using it in the salutation", () => {
    const out = generatePreview({
      preferredName: "  小李  ",
      language: "zh",
      tone: "friendly",
      format: "",
    });
    expect(out.ariaReply.startsWith("小李，")).toBe(true);
    expect(out.ariaReply).not.toContain("  小李  ");
  });

  it("varies body text by tone (direct vs friendly produce different copy)", () => {
    const base = { preferredName: "", language: "zh" as const, format: "" as const };
    const direct = generatePreview({ ...base, tone: "direct" });
    const friendly = generatePreview({ ...base, tone: "friendly" });
    expect(direct.ariaReply).not.toBe(friendly.ariaReply);
  });
});
