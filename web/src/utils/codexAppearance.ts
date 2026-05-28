/**
 * Codex appearance settings — pure read / write / apply layer.
 *
 * Per ``design_handoff_aria_codex_redesign/README.md`` §"State
 * Management": "Tweaks → Settings 外观: persist theme / accent /
 * density / radius per-user. Backend endpoint or local-storage if no
 * backend support yet."
 *
 * V1 ships local-storage only. A backend ``/user-memory`` slot can
 * be added later without changing the surface this module exposes
 * (``readSavedAppearance`` / ``writeSavedAppearance`` / ``applyAppearance``)
 * — only the storage adapter changes.
 *
 * The DOM application step toggles classes on ``document.documentElement``:
 *
 *   ``<html class="theme-codex dark accent-amber density-comfy radius-soft">``
 *
 * Every Codex-migrated subtree picks the tokens up through cascade.
 * Non-Codex (legacy ``--color-primary``) pages are unaffected because
 * they don't reference any ``--color-codex-*`` variable.
 */
export const CODEX_APPEARANCE_STORAGE_KEY = "aria-codex-appearance";
export const CODEX_APPEARANCE_EVENT = "aria:codex-appearance-changed";

export type CodexTheme = "light" | "dark" | "auto";
export type CodexAccent = "moss" | "amber" | "azure" | "rose";
export type CodexDensity = "compact" | "regular" | "comfy";
export type CodexRadius = "sharp" | "soft" | "round";

export interface CodexAppearance {
  theme: CodexTheme;
  accent: CodexAccent;
  density: CodexDensity;
  radius: CodexRadius;
}

export const CODEX_APPEARANCE_DEFAULT: CodexAppearance = {
  theme: "light",
  accent: "moss",
  density: "regular",
  radius: "soft",
};

const THEME_VALUES: readonly CodexTheme[] = ["light", "dark", "auto"];
const ACCENT_VALUES: readonly CodexAccent[] = ["moss", "amber", "azure", "rose"];
const DENSITY_VALUES: readonly CodexDensity[] = ["compact", "regular", "comfy"];
const RADIUS_VALUES: readonly CodexRadius[] = ["sharp", "soft", "round"];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Parse an arbitrary value into a valid ``CodexAppearance``, falling back
 * to the default for any field that's missing or invalid. Safe to feed
 * raw ``localStorage.getItem`` output through this.
 */
export function normalizeAppearance(input: unknown): CodexAppearance {
  if (!input || typeof input !== "object") return { ...CODEX_APPEARANCE_DEFAULT };
  const raw = input as Record<string, unknown>;
  return {
    theme: isOneOf(raw.theme, THEME_VALUES) ? raw.theme : CODEX_APPEARANCE_DEFAULT.theme,
    accent: isOneOf(raw.accent, ACCENT_VALUES) ? raw.accent : CODEX_APPEARANCE_DEFAULT.accent,
    density: isOneOf(raw.density, DENSITY_VALUES)
      ? raw.density
      : CODEX_APPEARANCE_DEFAULT.density,
    radius: isOneOf(raw.radius, RADIUS_VALUES)
      ? raw.radius
      : CODEX_APPEARANCE_DEFAULT.radius,
  };
}

export function readSavedAppearance(): CodexAppearance {
  if (typeof window === "undefined") return { ...CODEX_APPEARANCE_DEFAULT };
  try {
    const raw = window.localStorage.getItem(CODEX_APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...CODEX_APPEARANCE_DEFAULT };
    return normalizeAppearance(JSON.parse(raw));
  } catch {
    return { ...CODEX_APPEARANCE_DEFAULT };
  }
}

export function writeSavedAppearance(next: CodexAppearance): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CODEX_APPEARANCE_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CODEX_APPEARANCE_EVENT, { detail: next }));
  } catch {
    // localStorage can throw in private-mode Safari; swallow — the DOM
    // update below is the user-visible effect, persistence is best-effort.
  }
}

/**
 * Resolve ``"auto"`` theme to ``"light" | "dark"`` based on the OS
 * preference. Falls back to ``"light"`` when matchMedia is absent.
 */
export function resolveTheme(theme: CodexTheme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

const APPEARANCE_CLASS_PREFIXES = ["accent-", "density-", "radius-"] as const;

/**
 * Toggle the appearance classes on ``<html>``:
 * - ``theme-codex`` is always present (so any Codex-themed subtree
 *   inherits the tokens).
 * - ``dark`` is present iff the resolved theme is dark.
 * - One ``accent-*``, ``density-*``, ``radius-*`` class each.
 *
 * Idempotent: removes any previous variant from the same family before
 * adding the new one.
 */
export function applyAppearance(
  appearance: CodexAppearance,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): void {
  if (!root) return;

  root.classList.add("theme-codex");

  const resolved = resolveTheme(appearance.theme);
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");

  // Remove any prior variant class from the three switchable families,
  // then add the chosen one.
  const previous = Array.from(root.classList).filter((cls) =>
    APPEARANCE_CLASS_PREFIXES.some((p) => cls.startsWith(p)),
  );
  for (const cls of previous) root.classList.remove(cls);

  root.classList.add(`accent-${appearance.accent}`);
  root.classList.add(`density-${appearance.density}`);
  root.classList.add(`radius-${appearance.radius}`);
}

/**
 * One-shot helper to run at app boot — reads saved value, applies it,
 * and returns what was applied so the bootstrapping caller can log it
 * or hand it to React state.
 */
export function bootstrapCodexAppearance(): CodexAppearance {
  const appearance = readSavedAppearance();
  applyAppearance(appearance);
  return appearance;
}
