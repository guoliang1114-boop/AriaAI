/**
 * Settings → 外观 (Appearance) — V0.0.6 Codex redesign (PR 5/N).
 *
 * First settings page in the Codex visual language and the first page
 * with REAL user-driven state in the redesign series. Renders 4 control
 * groups (theme / accent / density / radius) + a small live preview
 * card. Picks are persisted to localStorage via ``useCodexAppearance``
 * and applied to ``<html>`` as classes so every codex-migrated subtree
 * picks them up on the next paint.
 *
 * Layout follows
 * ``design_handoff_aria_codex_redesign/direction-codex-settings-v2.jsx:404``
 * — minus the "open Tweaks panel" callout because we don't ship a
 * Tweaks panel in production; this page IS the Tweaks panel.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2, Sparkles } from "lucide-react";

import { api } from "../../api/client";
import { CxFormRow, CxStatus } from "../../components/codex";
import { useCodexAppearance } from "../../hooks/useCodexAppearance";
import { resolveTheme } from "../../utils/codexAppearance";
import type {
  CodexAccent,
  CodexDensity,
  CodexRadius,
  CodexTheme,
  CodexWarmth,
} from "../../utils/codexAppearance";
import {
  compactPreferences,
  readShape,
  type PreferencesShape,
  type UserMemoryResponse,
} from "../../utils/userMemoryPreferences";

interface SavedMessage {
  type: "success" | "error";
  text: string;
}

interface ChipOption<T extends string> {
  value: T;
  label: string;
}

const THEME_OPTIONS_ZH: ChipOption<CodexTheme>[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "auto", label: "跟随系统" },
];

const THEME_OPTIONS_EN: ChipOption<CodexTheme>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "System" },
];

const ACCENT_OPTIONS: { value: CodexAccent; label_zh: string; label_en: string; hue: number; chroma: number }[] = [
  { value: "moss", label_zh: "苔绿", label_en: "Moss", hue: 150, chroma: 0.07 },
  { value: "amber", label_zh: "琥珀", label_en: "Amber", hue: 75, chroma: 0.12 },
  { value: "azure", label_zh: "天蓝", label_en: "Azure", hue: 235, chroma: 0.1 },
  { value: "rose", label_zh: "玫瑰", label_en: "Rose", hue: 15, chroma: 0.12 },
];

const DENSITY_OPTIONS_ZH: ChipOption<CodexDensity>[] = [
  { value: "compact", label: "紧凑" },
  { value: "regular", label: "中等" },
  { value: "comfy", label: "宽松" },
];

const DENSITY_OPTIONS_EN: ChipOption<CodexDensity>[] = [
  { value: "compact", label: "Compact" },
  { value: "regular", label: "Regular" },
  { value: "comfy", label: "Comfy" },
];

// Radius preview tiles use the same r-md / r-sm values the CSS will
// actually apply, so the picker is an honest preview of the real UI.
// Numbers below mirror the ``--codex-r-*`` rules in styles/codex.css.
const RADIUS_OPTIONS: {
  value: CodexRadius;
  label_zh: string;
  label_en: string;
  tile: number; // matches --codex-r-md for the tile itself
  inner: number; // matches --codex-r-sm for the mini button inside
}[] = [
  { value: "sharp", label_zh: "锐利", label_en: "Sharp", tile: 0, inner: 0 },
  { value: "soft", label_zh: "柔和", label_en: "Soft", tile: 10, inner: 6 },
  { value: "round", label_zh: "圆润", label_en: "Round", tile: 22, inner: 16 },
];

// Warmth swatches use the same colors the CSS class will set as
// ``--color-codex-bg`` for the resolved theme — light bg in light mode,
// dark bg in dark mode. See the ``.warmth-*`` and ``.dark.warmth-*``
// rules in ``styles/codex.css``.
const WARMTH_OPTIONS: {
  value: CodexWarmth;
  label_zh: string;
  label_en: string;
  bg_light: string;
  bg_dark: string;
}[] = [
  {
    value: "white",
    label_zh: "纯白 / 纯黑",
    label_en: "White / Black",
    bg_light: "#ffffff",
    bg_dark: "#070707",
  },
  {
    value: "paper",
    label_zh: "中性",
    label_en: "Paper",
    bg_light: "#fafaf7",
    bg_dark: "#1c1c1d",
  },
  {
    value: "parchment",
    label_zh: "暖羊皮",
    label_en: "Parchment",
    bg_light: "#fcfbf7",
    bg_dark: "#241e16",
  },
];

export function AppearanceSettings() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const { appearance, setAppearance, patchAppearance } = useCodexAppearance();

  const themeOptions = isZh ? THEME_OPTIONS_ZH : THEME_OPTIONS_EN;
  const densityOptions = isZh ? DENSITY_OPTIONS_ZH : DENSITY_OPTIONS_EN;
  const resolvedTheme = resolveTheme(appearance.theme);

  // Page-level save status — shared across font size + the appearance
  // bundle so the user only sees one indicator (the old per-row toast
  // was inconsistent with the rest of the page).
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<SavedMessage | null>(null);
  const flashSaved = (text: string) => {
    setStatusMsg({ type: "success", text });
    setTimeout(
      () => setStatusMsg((cur) => (cur && cur.type === "success" ? null : cur)),
      1800,
    );
  };

  // ----- Appearance ↔ /user-memory sync -----
  //
  // localStorage gives us synchronous reads (no FOUC). The backend is
  // the source of truth for cross-device sync: we fetch once on mount
  // and apply server values if present, then debounced-PUT the full
  // prefs whenever appearance changes after the initial hydration.
  // We hold the rest of the prefs (response_preferences / work_style /
  // personal_info / onboarding_seen) in state so the PUT doesn't clobber
  // what PreferenceSettings has saved.
  const [otherPrefs, setOtherPrefs] = useState<PreferencesShape>({});
  const [hydratedFromServer, setHydratedFromServer] = useState(false);
  const skipNextAppearanceSaveRef = useRef(false);
  const appearanceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .get<UserMemoryResponse>("/user-memory")
      .then((data) => {
        const shape = readShape(data.preferences as Record<string, unknown>);
        const { appearance: serverAppearance, ...rest } = shape;
        setOtherPrefs(rest);
        if (serverAppearance) {
          // Apply server's snapshot. The next save effect run will see
          // ``skipNextAppearanceSaveRef`` and bail without bouncing the
          // value right back to the server.
          skipNextAppearanceSaveRef.current = true;
          setAppearance(serverAppearance);
        }
      })
      .catch(() => {})
      .finally(() => setHydratedFromServer(true));
  }, [setAppearance]);

  useEffect(() => {
    if (!hydratedFromServer) return;
    if (skipNextAppearanceSaveRef.current) {
      skipNextAppearanceSaveRef.current = false;
      return;
    }
    if (appearanceSaveTimerRef.current) clearTimeout(appearanceSaveTimerRef.current);
    appearanceSaveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      setStatusMsg(null);
      try {
        const payload = compactPreferences({ ...otherPrefs, appearance });
        await api.put<UserMemoryResponse>("/user-memory", { preferences: payload });
        flashSaved(isZh ? "已保存" : "Saved");
      } catch (err: any) {
        setStatusMsg({
          type: "error",
          text: err?.response?.data?.detail || (isZh ? "保存失败" : "Save failed"),
        });
      } finally {
        setSaving(false);
      }
    }, 400);
    return () => {
      if (appearanceSaveTimerRef.current) clearTimeout(appearanceSaveTimerRef.current);
    };
  }, [appearance, hydratedFromServer, otherPrefs, isZh]);

  // All copy on this page is in the Codex theme scope, so use codex tokens
  // directly. The outer wrapper opts the subtree into the codex theme even
  // if <html> doesn't carry it yet (e.g. early in the migration when the
  // bootstrap script hasn't fired, in test environments, etc.).
  return (
    <div
      className="theme-codex"
      data-testid="appearance-settings"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        padding: "8px 4px 32px",
      }}
    >
      <header
        className="flex items-start justify-between gap-4"
        style={{ marginBottom: 16 }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 500,
              color: "var(--color-codex-ink)",
              letterSpacing: "-0.015em",
            }}
          >
            {isZh ? "外观" : "Appearance"}
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--color-codex-ink-mute)",
              lineHeight: 1.6,
            }}
          >
            {isZh
              ? "主题、背景、强调色、密度和圆角 — 改动随用户跨设备生效，所有 Codex 风格的页面立即应用。"
              : "Theme, background, accent, density, and radius — synced per-user across devices, applied instantly across every Codex-styled page."}
          </p>
        </div>
        <span
          aria-live="polite"
          className="inline-flex flex-shrink-0 items-center gap-1.5"
          style={{
            marginTop: 4,
            fontSize: 12,
            color: saving
              ? "var(--color-codex-ink-mute)"
              : statusMsg?.type === "error"
                ? "var(--color-codex-bad)"
                : statusMsg?.type === "success"
                  ? "var(--color-codex-good)"
                  : "var(--color-codex-ink-faint)",
          }}
        >
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {isZh ? "正在保存…" : "Saving…"}
            </>
          ) : statusMsg?.type === "error" ? (
            <>
              <AlertCircle className="h-3 w-3" />
              {statusMsg.text}
            </>
          ) : statusMsg?.type === "success" ? (
            <>
              <Check className="h-3 w-3" />
              {statusMsg.text}
            </>
          ) : (
            <span style={{ opacity: 0.7 }}>
              {isZh ? "修改后自动保存" : "Auto-saves on change"}
            </span>
          )}
        </span>
      </header>

      {/* Theme */}
      <CxFormRow
        label={isZh ? "主题" : "Theme"}
        hint={
          isZh
            ? "深色模式更适合长时间阅读和会议场景。"
            : "Dark mode is friendlier for long reads and meeting rooms."
        }
      >
        <SwatchRow
          value={appearance.theme}
          onChange={(v) => patchAppearance({ theme: v })}
          options={themeOptions}
          dataTestId="appearance-theme"
          renderSwatch={(opt, active) => (
            <>
              <ThemeSwatch theme={opt.value} active={active} />
              {opt.label}
            </>
          )}
        />
      </CxFormRow>

      {/* Background warmth — page color from pure white to warm
          parchment. Light AND dark themes both honor it now;
          previously only light theme listened. */}
      <CxFormRow
        label={isZh ? "页面背景" : "Page background"}
        hint={
          isZh
            ? "羊皮偏暖、纯白偏冷 — 选你看着最舒服的那一档。浅色和深色主题都会跟着变。"
            : "Parchment is warm, white is cool — pick whatever's easiest on your eyes. Applies to both light and dark themes."
        }
      >
        <div className="flex flex-wrap gap-2.5" data-testid="appearance-warmth">
          {WARMTH_OPTIONS.map((opt) => {
            const active = appearance.warmth === opt.value;
            const swatchBg = resolvedTheme === "dark" ? opt.bg_dark : opt.bg_light;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={isZh ? opt.label_zh : opt.label_en}
                onClick={() => patchAppearance({ warmth: opt.value })}
                className="flex flex-col items-center gap-1.5 transition"
                style={{ padding: 4, cursor: "pointer" }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 56,
                    height: 36,
                    borderRadius: 6,
                    background: swatchBg,
                    border: `1px solid ${
                      active
                        ? "var(--color-codex-accent)"
                        : "var(--color-codex-line-strong)"
                    }`,
                    boxShadow: active
                      ? "0 0 0 2px var(--color-codex-bg), 0 0 0 4px var(--color-codex-accent)"
                      : "none",
                    transition: "box-shadow 0.15s",
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    color: active
                      ? "var(--color-codex-ink)"
                      : "var(--color-codex-ink-mute)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {isZh ? opt.label_zh : opt.label_en}
                </span>
              </button>
            );
          })}
        </div>
      </CxFormRow>

      {/* Accent */}
      <CxFormRow
        label={isZh ? "强调色" : "Accent"}
        hint={
          isZh
            ? "出现在状态点、链接、CTA 与高亮上 — 整体克制使用。"
            : "Appears on status dots, links, CTAs, and highlights — used sparingly."
        }
      >
        <div className="flex flex-wrap gap-2.5" data-testid="appearance-accent">
          {ACCENT_OPTIONS.map((opt) => {
            const active = appearance.accent === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={isZh ? opt.label_zh : opt.label_en}
                onClick={() => patchAppearance({ accent: opt.value })}
                className="flex flex-col items-center gap-1.5 transition"
                style={{ padding: 4, cursor: "pointer" }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: `oklch(0.5 ${opt.chroma} ${opt.hue})`,
                    boxShadow: active
                      ? `0 0 0 2px var(--color-codex-bg), 0 0 0 4px oklch(0.5 ${opt.chroma} ${opt.hue})`
                      : "0 0 0 1px var(--color-codex-line)",
                    transition: "box-shadow 0.15s",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: active
                      ? "var(--color-codex-ink)"
                      : "var(--color-codex-ink-mute)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {isZh ? opt.label_zh : opt.label_en}
                </span>
              </button>
            );
          })}
        </div>
      </CxFormRow>

      {/* Density */}
      <CxFormRow
        label={isZh ? "信息密度" : "Density"}
        hint={
          isZh
            ? "紧凑显示更多信息，宽松呼吸感更好。"
            : "Compact fits more on screen; comfy gives more breathing room."
        }
      >
        <SwatchRow
          value={appearance.density}
          onChange={(v) => patchAppearance({ density: v })}
          options={densityOptions}
          dataTestId="appearance-density"
        />
      </CxFormRow>

      {/* Radius — preview tiles use the real ``--codex-r-md`` / ``--codex-r-sm``
          numbers so the picker is an honest match for the live UI. */}
      <CxFormRow
        label={isZh ? "圆角" : "Corner radius"}
        hint={
          isZh
            ? "影响卡片、按钮、徽章的整体气质。"
            : "Sets the visual mood of cards, buttons, and badges."
        }
        divider={false}
      >
        <div className="flex flex-wrap gap-3" data-testid="appearance-radius">
          {RADIUS_OPTIONS.map((opt) => {
            const active = appearance.radius === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={isZh ? opt.label_zh : opt.label_en}
                onClick={() => patchAppearance({ radius: opt.value })}
                className="flex flex-col items-center gap-2 transition"
                style={{ padding: 0, cursor: "pointer" }}
              >
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center gap-2"
                  style={{
                    width: 132,
                    height: 80,
                    padding: "0 14px",
                    borderRadius: opt.tile,
                    background: active
                      ? "var(--color-codex-accent-bg)"
                      : "var(--color-codex-bg-elev)",
                    border: `1px solid ${
                      active
                        ? "var(--color-codex-accent)"
                        : "var(--color-codex-line)"
                    }`,
                    boxShadow: active
                      ? "0 0 0 2px var(--color-codex-bg), 0 0 0 3px var(--color-codex-accent)"
                      : "none",
                    transition: "box-shadow 0.15s, border-color 0.15s",
                  }}
                >
                  {/* Mini button — uses ``--codex-r-sm`` magnitude so
                      what the picker shows actually matches what hits
                      a real button or chip downstream. */}
                  <span
                    style={{
                      display: "inline-block",
                      width: 48,
                      height: 26,
                      borderRadius: opt.inner,
                      background: "var(--color-codex-ink)",
                    }}
                  />
                  {/* Mini pill — always fully rounded, just to give a
                      second visual anchor and hint that real UI lives
                      inside these surfaces. */}
                  <span
                    style={{
                      display: "inline-block",
                      width: 36,
                      height: 14,
                      borderRadius: 999,
                      background: "var(--color-codex-line-strong)",
                    }}
                  />
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: active
                      ? "var(--color-codex-ink)"
                      : "var(--color-codex-ink-mute)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {isZh ? opt.label_zh : opt.label_en}
                </span>
              </button>
            );
          })}
        </div>
      </CxFormRow>

      {/* Live preview */}
      <div style={{ marginTop: 28 }} data-testid="appearance-preview">
        <h3
          style={{
            margin: "0 0 10px",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-codex-ink-mute)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {isZh ? "预览" : "Preview"}
        </h3>
        <div
          style={{
            padding: "16px 20px",
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 6px)",
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <CxStatus tone="accent" pulse>
                {isZh ? "示例徽章" : "live status"}
              </CxStatus>
              <h4
                style={{
                  margin: "8px 0 0",
                  fontSize: 16,
                  fontWeight: 500,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {isZh
                  ? "鼎和保险 · 数字化转型咨询"
                  : "Dinghe Insurance · digital transformation"}
              </h4>
            </div>
            <button
              type="button"
              style={{
                padding: "8px 16px",
                background: "var(--color-codex-accent)",
                color: "var(--color-codex-bg-elev)",
                borderRadius: "var(--codex-r-sm, 3px)",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {isZh ? "主操作" : "Primary"}
              </span>
            </button>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--color-codex-ink-soft)",
              lineHeight: 1.65,
            }}
          >
            {isZh
              ? "根据上面的选择，这块预览的卡片圆角、徽章形状、按钮主色都会跟着变化。"
              : "The card radius, status pill, and button color above all change as you adjust the controls."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Helpers ----------------------------------------------------------------

interface SwatchRowProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: ChipOption<T>[];
  dataTestId: string;
  renderSwatch?: (opt: ChipOption<T>, active: boolean) => React.ReactNode;
}

function SwatchRow<T extends string>({
  value,
  onChange,
  options,
  dataTestId,
  renderSwatch,
}: SwatchRowProps<T>) {
  return (
    <div className="flex flex-wrap gap-2.5" data-testid={dataTestId}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            onClick={() => onChange(opt.value)}
            className="inline-flex items-center gap-2 transition"
            style={{
              padding: "9px 14px",
              background: active
                ? "var(--color-codex-accent-bg)"
                : "var(--color-codex-bg)",
              border: `1px solid ${
                active
                  ? "var(--color-codex-accent)"
                  : "var(--color-codex-line)"
              }`,
              borderRadius: "var(--codex-r-sm, 3px)",
              color: active
                ? "var(--color-codex-accent-ink)"
                : "var(--color-codex-ink-soft)",
              fontSize: 13,
              fontWeight: active ? 500 : 400,
              cursor: "pointer",
            }}
          >
            {renderSwatch ? (
              renderSwatch(opt, active)
            ) : (
              <>
                {active && <Check className="h-3 w-3" aria-hidden="true" />}
                {opt.label}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Tiny tile-style swatch for the theme picker — visualizes the surface
// color the user is about to pick (light, dark, or split for "auto").
function ThemeSwatch({ theme, active }: { theme: CodexTheme; active: boolean }) {
  let background: string;
  if (theme === "dark") background = "#15130F";
  else if (theme === "auto")
    background = "linear-gradient(to right, var(--color-codex-bg) 50%, #15130F 50%)";
  else background = "var(--color-codex-bg-elev)";
  return (
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 24,
        borderRadius: 4,
        background,
        border: `1px solid ${
          active
            ? "var(--color-codex-accent)"
            : "var(--color-codex-line-strong)"
        }`,
        display: "inline-block",
      }}
    />
  );
}
