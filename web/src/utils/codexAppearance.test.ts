import { describe, expect, it, beforeEach } from "vitest";

import {
  CODEX_APPEARANCE_DEFAULT,
  CODEX_APPEARANCE_STORAGE_KEY,
  applyAppearance,
  bootstrapCodexAppearance,
  normalizeAppearance,
  readSavedAppearance,
  resolveTheme,
  writeSavedAppearance,
} from "./codexAppearance";

describe("normalizeAppearance", () => {
  it("returns the default when input is null or wrong shape", () => {
    expect(normalizeAppearance(null)).toEqual(CODEX_APPEARANCE_DEFAULT);
    expect(normalizeAppearance("not an object")).toEqual(CODEX_APPEARANCE_DEFAULT);
    expect(normalizeAppearance(42)).toEqual(CODEX_APPEARANCE_DEFAULT);
  });

  it("falls back per-field for invalid values", () => {
    expect(
      normalizeAppearance({ theme: "neon", accent: "moss", density: "regular", radius: "soft" }),
    ).toEqual({ theme: "light", accent: "moss", density: "regular", radius: "soft", warmth: "parchment" });
    expect(
      normalizeAppearance({ accent: "lime", density: "compact" }),
    ).toEqual({ theme: "light", accent: "moss", density: "compact", radius: "soft", warmth: "parchment" });
  });

  it("preserves a fully valid payload unchanged", () => {
    const value = { theme: "dark", accent: "azure", density: "comfy", radius: "round", warmth: "white" } as const;
    expect(normalizeAppearance(value)).toEqual(value);
  });

  it("falls back to the default warmth when missing or invalid", () => {
    expect(
      normalizeAppearance({ theme: "light", accent: "moss", density: "regular", radius: "soft", warmth: "neon" }),
    ).toEqual({ theme: "light", accent: "moss", density: "regular", radius: "soft", warmth: "parchment" });
  });
});

describe("readSavedAppearance / writeSavedAppearance", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the default when storage is empty", () => {
    expect(readSavedAppearance()).toEqual(CODEX_APPEARANCE_DEFAULT);
  });

  it("round-trips a written value", () => {
    writeSavedAppearance({ theme: "dark", accent: "amber", density: "comfy", radius: "round", warmth: "paper" });
    expect(window.localStorage.getItem(CODEX_APPEARANCE_STORAGE_KEY)).toContain('"theme":"dark"');
    expect(readSavedAppearance()).toEqual({
      theme: "dark",
      accent: "amber",
      density: "comfy",
      radius: "round",
      warmth: "paper",
    });
  });

  it("returns the default when stored JSON is malformed", () => {
    window.localStorage.setItem(CODEX_APPEARANCE_STORAGE_KEY, "{not json");
    expect(readSavedAppearance()).toEqual(CODEX_APPEARANCE_DEFAULT);
  });
});

describe("resolveTheme", () => {
  it("returns light or dark unchanged", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves auto via matchMedia", () => {
    // jsdom's matchMedia returns matches=false by default.
    expect(resolveTheme("auto")).toBe("light");
  });
});

describe("applyAppearance", () => {
  it("adds the four expected classes and toggles dark in / out", () => {
    const root = document.createElement("html");
    applyAppearance(
      { theme: "dark", accent: "azure", density: "comfy", radius: "round" },
      root,
    );
    expect(root.classList.contains("theme-codex")).toBe(true);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("accent-azure")).toBe(true);
    expect(root.classList.contains("density-comfy")).toBe(true);
    expect(root.classList.contains("radius-round")).toBe(true);

    applyAppearance(
      { theme: "light", accent: "moss", density: "regular", radius: "soft" },
      root,
    );
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.classList.contains("accent-azure")).toBe(false);
    expect(root.classList.contains("accent-moss")).toBe(true);
  });

  it("replaces a prior variant within each family (no stale classes)", () => {
    const root = document.createElement("html");
    applyAppearance(
      { theme: "light", accent: "amber", density: "compact", radius: "sharp" },
      root,
    );
    applyAppearance(
      { theme: "light", accent: "rose", density: "comfy", radius: "round" },
      root,
    );
    expect(root.classList.contains("accent-amber")).toBe(false);
    expect(root.classList.contains("accent-rose")).toBe(true);
    expect(root.classList.contains("density-compact")).toBe(false);
    expect(root.classList.contains("density-comfy")).toBe(true);
    expect(root.classList.contains("radius-sharp")).toBe(false);
    expect(root.classList.contains("radius-round")).toBe(true);
  });

  it("is a no-op when given a null root", () => {
    expect(() => applyAppearance(CODEX_APPEARANCE_DEFAULT, null)).not.toThrow();
  });
});

describe("bootstrapCodexAppearance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("reads storage + applies classes + returns the resolved appearance", () => {
    writeSavedAppearance({
      theme: "dark",
      accent: "amber",
      density: "comfy",
      radius: "round",
      warmth: "paper",
    });
    const result = bootstrapCodexAppearance();
    expect(result).toEqual({
      theme: "dark",
      accent: "amber",
      density: "comfy",
      radius: "round",
      warmth: "paper",
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("accent-amber")).toBe(true);
    expect(document.documentElement.classList.contains("warmth-paper")).toBe(true);
  });

  it("applies the default when nothing has been saved", () => {
    const result = bootstrapCodexAppearance();
    expect(result).toEqual(CODEX_APPEARANCE_DEFAULT);
    expect(document.documentElement.classList.contains("accent-moss")).toBe(true);
    expect(document.documentElement.classList.contains("density-regular")).toBe(true);
  });
});
