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
import { useTranslation } from "react-i18next";
import { Check, Sparkles } from "lucide-react";

import { CxFormRow, CxStatus } from "../../components/codex";
import { useCodexAppearance } from "../../hooks/useCodexAppearance";
import type {
  CodexAccent,
  CodexDensity,
  CodexRadius,
  CodexTheme,
} from "../../utils/codexAppearance";

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

const RADIUS_OPTIONS: { value: CodexRadius; label_zh: string; label_en: string; px: number }[] = [
  { value: "sharp", label_zh: "锐利", label_en: "Sharp", px: 0 },
  { value: "soft", label_zh: "柔和", label_en: "Soft", px: 6 },
  { value: "round", label_zh: "圆润", label_en: "Round", px: 14 },
];

export function AppearanceSettings() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const { appearance, patchAppearance } = useCodexAppearance();

  const themeOptions = isZh ? THEME_OPTIONS_ZH : THEME_OPTIONS_EN;
  const densityOptions = isZh ? DENSITY_OPTIONS_ZH : DENSITY_OPTIONS_EN;

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
      <header style={{ marginBottom: 16 }}>
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
            ? "主题、强调色、密度和圆角 — 改动只影响当前账户，所有 Codex 风格的页面立即生效。"
            : "Theme, accent, density, and corner radius — applied per-user, instantly across every Codex-styled page."}
        </p>
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

      {/* Radius */}
      <CxFormRow
        label={isZh ? "圆角" : "Corner radius"}
        hint={
          isZh
            ? "影响卡片、按钮、徽章的整体气质。"
            : "Sets the visual mood of cards, buttons, and badges."
        }
        divider={false}
      >
        <div className="flex gap-2.5" data-testid="appearance-radius">
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
                className="flex flex-col items-center gap-1.5 transition"
                style={{ padding: 4, cursor: "pointer" }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 56,
                    height: 36,
                    borderRadius: opt.px,
                    background: active
                      ? "var(--color-codex-accent-bg)"
                      : "var(--color-codex-bg-elev)",
                    border: `1px solid ${
                      active
                        ? "var(--color-codex-accent)"
                        : "var(--color-codex-line)"
                    }`,
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
