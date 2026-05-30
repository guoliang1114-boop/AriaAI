/**
 * Settings → 语言 — V0.0.6 Codex redesign (PR 6/N).
 *
 * Visual layout per
 * ``design_handoff_aria_codex_redesign/direction-codex-settings.jsx:118``
 * (the "界面语言" section of the prototype's CxSettingsLanguage —
 * timezone, date format, and week-start are deliberately kept on the
 * Profile page where they already live to avoid scope churn).
 *
 * State machine unchanged: ``selectedLanguage`` mirrors i18n + backend
 * ``/settings/language``, ``handleLanguageChange`` previews immediately,
 * ``handleSave`` PUTs to the backend.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../api/client";
import { CxFormRow } from "../../components/codex";
import { changeLanguage } from "../../i18n";

const LANGUAGES: { code: string; name: string; flag: string }[] = [
  { code: "zh-CN", name: "简体中文", flag: "🇨🇳" },
  { code: "en-US", name: "English", flag: "🇺🇸" },
];

export function LanguageSettings() {
  const { t, i18n } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language || "zh-CN");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  // Track the toast-clear timer so we can cancel it on unmount and
  // not setState on a stale component.
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadSettings();
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
    // loadSettings has no React deps; intentional empty array.
  }, []);

  const loadSettings = async () => {
    try {
      setInitialLoading(true);
      setError("");
      const settings = await api.get<Record<string, string>>("/settings/");
      if (settings.language) {
        setSelectedLanguage(settings.language);
        changeLanguage(settings.language);
      }
    } catch {
      const savedLang = typeof window !== "undefined" ? window.localStorage.getItem("language") : null;
      if (savedLang) {
        setSelectedLanguage(savedLang);
        changeLanguage(savedLang);
      }
    } finally {
      setInitialLoading(false);
    }
  };

  // Auto-save: apply UI language immediately, PUT to backend in the
  // background, surface a brief "saved" pill in the header. Matches
  // the Appearance / Preference settings pattern; the old explicit
  // Save button was the only personal-prefs page that still required
  // a second click after picking an option.
  const handleLanguageChange = async (langCode: string) => {
    setSelectedLanguage(langCode);
    changeLanguage(langCode);
    setLoading(true);
    setSaved(false);
    setError("");
    try {
      await api.put("/settings/language", { value: langCode });
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (err instanceof Error ? err.message : "Failed to save settings"));
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div
        className="theme-codex flex items-center justify-center"
        style={{ padding: "48px 0", color: "var(--color-codex-ink-mute)" }}
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="theme-codex"
      data-testid="language-settings"
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
            {t("language.title")}
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--color-codex-ink-mute)",
              lineHeight: 1.6,
            }}
          >
            {t("language.description")}
          </p>
        </div>
        <span
          aria-live="polite"
          className="inline-flex flex-shrink-0 items-center gap-1.5"
          style={{
            marginTop: 4,
            fontSize: 12,
            color: loading
              ? "var(--color-codex-ink-mute)"
              : error
                ? "var(--color-codex-bad)"
                : saved
                  ? "var(--color-codex-good)"
                  : "var(--color-codex-ink-faint)",
          }}
        >
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("language.saving")}
            </>
          ) : saved ? (
            <>
              <Check className="h-3 w-3" />
              {t("language.saved")}
            </>
          ) : (
            <span style={{ opacity: 0.7 }}>
              {i18n.language.startsWith("zh") ? "修改后自动保存" : "Auto-saves on change"}
            </span>
          )}
        </span>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2"
          style={{
            padding: "9px 12px",
            background: "color-mix(in oklch, var(--color-codex-bad) 8%, transparent)",
            border: "1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)",
            borderRadius: "var(--codex-r-sm, 3px)",
            color: "var(--color-codex-bad)",
            fontSize: 12,
          }}
        >
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <CxFormRow
        label={t("language.interfaceLanguage") || "界面语言"}
        hint={
          i18n.language.startsWith("zh")
            ? "点击即时切换界面语言，自动同步到其他设备。"
            : "Click to switch the UI language instantly; syncs across your devices."
        }
        divider={false}
      >
        <div
          role="radiogroup"
          aria-label={t("language.interfaceLanguage") || "界面语言"}
          className="flex flex-wrap gap-2"
          data-testid="language-options"
        >
          {LANGUAGES.map((lang) => {
            const active = selectedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={lang.name}
                onClick={() => handleLanguageChange(lang.code)}
                className="inline-flex items-center gap-2 transition"
                style={{
                  padding: "8px 14px",
                  border: `1px solid ${
                    active
                      ? "var(--color-codex-accent)"
                      : "var(--color-codex-line)"
                  }`,
                  background: active
                    ? "var(--color-codex-accent-bg)"
                    : "var(--color-codex-bg-elev)",
                  borderRadius: "var(--codex-r-sm, 3px)",
                  color: active
                    ? "var(--color-codex-accent-ink)"
                    : "var(--color-codex-ink-soft)",
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    border: `1.5px solid ${
                      active
                        ? "var(--color-codex-accent)"
                        : "var(--color-codex-line-strong)"
                    }`,
                  }}
                >
                  {active && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: "var(--color-codex-accent)",
                      }}
                    />
                  )}
                </span>
                <span aria-hidden="true">{lang.flag}</span>
                {lang.name}
              </button>
            );
          })}
        </div>
      </CxFormRow>
    </div>
  );
}
