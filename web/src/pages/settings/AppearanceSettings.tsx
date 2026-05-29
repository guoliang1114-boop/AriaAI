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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2, Sparkles } from "lucide-react";

import { api } from "../../api/client";
import { CxFormRow, CxStatus } from "../../components/codex";
import { useCodexAppearance } from "../../hooks/useCodexAppearance";
import type {
  CodexAccent,
  CodexDensity,
  CodexRadius,
  CodexTheme,
  CodexWarmth,
} from "../../utils/codexAppearance";
import {
  APP_FONT_SIZE_SETTING_KEY,
  getStoredAppFontSize,
  isAppFontSize,
  setAppFontSize,
  type AppFontSize,
} from "../../utils/fontSize";

interface FontSizeOption {
  value: AppFontSize;
  label_zh: string;
  label_en: string;
  previewClass: string;
}

const FONT_SIZE_OPTIONS: FontSizeOption[] = [
  { value: "small", label_zh: "小", label_en: "Small", previewClass: "text-[13px]" },
  { value: "medium", label_zh: "中", label_en: "Medium", previewClass: "text-[15px]" },
  { value: "large", label_zh: "大", label_en: "Large", previewClass: "text-[17px]" },
];

interface SavedMessage {
  type: "success" | "error";
  text: string;
}

const SAVE_BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 16px",
  background: "var(--color-codex-ink)",
  color: "var(--color-codex-bg-elev)",
  borderRadius: "var(--codex-r-sm, 3px)",
  fontSize: 13,
  fontWeight: 500,
};

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

// Radius previews now use a bigger tile + an inset button-and-pill
// silhouette so the difference between sharp / soft / round is
// obvious at a glance — the earlier version was a 56×36 outline only
// and the user couldn't tell the choices apart.
const RADIUS_OPTIONS: { value: CodexRadius; label_zh: string; label_en: string; px: number }[] = [
  { value: "sharp", label_zh: "锐利", label_en: "Sharp", px: 0 },
  { value: "soft", label_zh: "柔和", label_en: "Soft", px: 8 },
  { value: "round", label_zh: "圆润", label_en: "Round", px: 18 },
];

// Warmth swatches use the same color the CSS class will set as
// ``--color-codex-bg`` — keeps the picker honest. See the
// ``.warmth-*`` rules in ``styles/codex.css``.
const WARMTH_OPTIONS: { value: CodexWarmth; label_zh: string; label_en: string; bg: string }[] = [
  { value: "white", label_zh: "纯白", label_en: "White", bg: "#ffffff" },
  { value: "paper", label_zh: "中性", label_en: "Paper", bg: "#fafaf7" },
  { value: "parchment", label_zh: "暖羊皮", label_en: "Parchment", bg: "#fcfbf7" },
];

export function AppearanceSettings() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const { appearance, patchAppearance } = useCodexAppearance();

  const themeOptions = isZh ? THEME_OPTIONS_ZH : THEME_OPTIONS_EN;
  const densityOptions = isZh ? DENSITY_OPTIONS_ZH : DENSITY_OPTIONS_EN;

  // Font size — backend round-trip (not localStorage-only like the
  // other appearance controls) because it has to follow the user
  // across devices. The picker is live-preview, the save button
  // syncs to ``/settings/font_size``.
  const [fontSize, setFontSize] = useState<AppFontSize>(getStoredAppFontSize);
  const [savingFontSize, setSavingFontSize] = useState(false);
  const [fontSizeMsg, setFontSizeMsg] = useState<SavedMessage | null>(null);

  useEffect(() => {
    api
      .get<Record<string, string>>("/settings/")
      .then((settings) => {
        const remote = settings[APP_FONT_SIZE_SETTING_KEY];
        if (isAppFontSize(remote)) {
          setFontSize(remote);
          setAppFontSize(remote);
        }
      })
      .catch(() => {});
  }, []);

  const handleSelectFontSize = (value: AppFontSize) => {
    setFontSize(value);
    setAppFontSize(value);
    setFontSizeMsg(null);
  };

  const handleSaveFontSize = async () => {
    setSavingFontSize(true);
    setFontSizeMsg(null);
    try {
      await api.put(`/settings/${APP_FONT_SIZE_SETTING_KEY}`, { value: fontSize });
      setAppFontSize(fontSize);
      setFontSizeMsg({
        type: "success",
        text: isZh ? "字体大小已保存" : "Font size saved",
      });
      setTimeout(() => setFontSizeMsg(null), 3000);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFontSizeMsg({
        type: "error",
        text: detail || (isZh ? "保存字体大小失败" : "Failed to save font size"),
      });
    } finally {
      setSavingFontSize(false);
    }
  };

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

      {/* Font size — backend-persisted (per-user, follows across
          devices) unlike the other appearance choices which are local
          to the browser. Lives here because it's a visual choice, not
          an identity field — moved out of 个人资料 in the Codex
          settings reorg. */}
      <CxFormRow
        label={isZh ? "字体大小" : "Font size"}
        hint={
          isZh
            ? "整个界面的文字会按比例缩放，点击即可即时预览。保存后在其他设备同步。"
            : "Scales every text size in the app. Click to preview live; saving syncs across your devices."
        }
      >
        <div className="flex flex-wrap items-stretch gap-3" data-testid="appearance-font-size">
          <div
            className="flex gap-2"
            style={{
              padding: 4,
              background: "var(--color-codex-bg)",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-sm, 3px)",
              flex: "1 1 auto",
            }}
            role="radiogroup"
            aria-label={isZh ? "字体大小" : "Font size"}
          >
            {FONT_SIZE_OPTIONS.map((option) => {
              const active = fontSize === option.value;
              const label = isZh ? option.label_zh : option.label_en;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={label}
                  onClick={() => handleSelectFontSize(option.value)}
                  className="flex flex-1 items-center justify-center gap-1.5 transition"
                  style={{
                    padding: "6px 10px",
                    background: active
                      ? "var(--color-codex-accent-bg)"
                      : "transparent",
                    color: active
                      ? "var(--color-codex-accent-ink)"
                      : "var(--color-codex-ink-soft)",
                    borderRadius: "calc(var(--codex-r-sm, 3px) - 1px)",
                    fontWeight: active ? 500 : 400,
                    cursor: "pointer",
                  }}
                >
                  <span className={option.previewClass}>Aa</span>
                  <span className="text-[13px]">{label}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void handleSaveFontSize()}
            disabled={savingFontSize}
            className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={SAVE_BUTTON_STYLE}
          >
            {savingFontSize ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isZh ? "保存" : "Save"}
          </button>
        </div>
        {fontSizeMsg && (
          <p
            role={fontSizeMsg.type === "error" ? "alert" : undefined}
            className="mt-1.5 inline-flex items-center gap-1"
            style={{
              fontSize: 11.5,
              color:
                fontSizeMsg.type === "success"
                  ? "var(--color-codex-good)"
                  : "var(--color-codex-bad)",
            }}
          >
            {fontSizeMsg.type === "error" && (
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
            )}
            {fontSizeMsg.text}
          </p>
        )}
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
                    background: opt.bg,
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

      {/* Radius — bigger tile with an inset button + pill so the
          radius difference is visible without having to scroll down
          to the live preview card. */}
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
                    borderRadius: opt.px,
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
                  {/* Mini button — uses the same radius value as the
                      tile (proportionally smaller) so the picker
                      reads as a stack of nested radii, not a single
                      outline. */}
                  <span
                    style={{
                      display: "inline-block",
                      width: 48,
                      height: 26,
                      borderRadius: Math.max(0, opt.px - 4),
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
