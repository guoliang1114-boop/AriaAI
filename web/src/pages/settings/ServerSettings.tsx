/**
 * Settings → 服务器配置 — V0.0.6 Codex redesign (PR 7/N).
 *
 * Refactors the API base URL config page to the Codex visual language.
 * State machine + behaviors unchanged: ``getApiConfig``,
 * ``saveApiBaseUrl``, the /health probe, the /settings/api_base_url
 * PUT, and the post-save ``window.location.reload()`` all preserve
 * their existing semantics.
 *
 * Sections (top-down):
 *   1. Page header (title + subtitle).
 *   2. Status banner — connection state pill + version/uptime.
 *   3. URL config: source/value/backend snapshot + input + test button
 *      + connection result chip.
 *   4. Quick presets — 3 chip buttons.
 *   5. Security info note.
 *   6. Help link + save CTA footer.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Server,
  Shield,
  Wifi,
  WifiOff,
} from "lucide-react";

import { api } from "../../api/client";
import { CxStatus } from "../../components/codex";
import {
  getApiConfig,
  saveApiBaseUrl,
  type ApiUrlSource,
} from "../../config/api";

interface ServerInfo {
  version: string;
  status: string;
  uptime?: string;
}

type ConnectionStatus = "idle" | "online" | "offline";

const INPUT_STYLE = {
  flex: 1,
  padding: "9px 12px",
  fontSize: 13.5,
  background: "var(--color-codex-bg)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  color: "var(--color-codex-ink)",
};

const GHOST_BUTTON_STYLE = {
  padding: "8px 14px",
  fontSize: 12.5,
  color: "var(--color-codex-ink-soft)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  background: "var(--color-codex-bg-elev)",
};

const PRIMARY_BUTTON_STYLE = {
  padding: "9px 18px",
  background: "var(--color-codex-ink)",
  color: "var(--color-codex-bg-elev)",
  borderRadius: "var(--codex-r-sm, 3px)",
  fontSize: 13,
  fontWeight: 500,
};

export function ServerSettings() {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState("");
  const [initialServerUrl, setInitialServerUrl] = useState("");
  const [backendServerUrl, setBackendServerUrl] = useState("");
  const [effectiveUrl, setEffectiveUrl] = useState("");
  const [effectiveSource, setEffectiveSource] = useState<ApiUrlSource>("default");
  const [isChecking, setIsChecking] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState("");

  const sourceLabels: Record<ApiUrlSource, string> = {
    localStorage: t("settings.server.sourceLocal") || "浏览器本地设置",
    env: t("settings.server.sourceEnv") || "环境变量",
    default: t("settings.server.sourceDefault") || "默认值",
  };

  const hasUnsavedChanges = serverUrl.trim() !== initialServerUrl.trim();

  useEffect(() => {
    void loadServerSettings();
    // Load once on mount; no deps.
  }, []);

  const loadServerSettings = async () => {
    try {
      setLoading(true);
      setError("");
      const apiConfig = getApiConfig();
      setEffectiveUrl(apiConfig.url);
      setEffectiveSource(apiConfig.source);

      let resolvedUrl = apiConfig.url;
      try {
        const settings = await api.get<Record<string, string>>("/settings/");
        if (settings.api_base_url) {
          setBackendServerUrl(settings.api_base_url);
          resolvedUrl = settings.api_base_url;
        }
      } catch {
        setBackendServerUrl("");
      }

      setServerUrl(resolvedUrl);
      setInitialServerUrl(resolvedUrl);
      await checkConnection(resolvedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const checkConnection = async (url?: string) => {
    const checkUrl = url || serverUrl;
    if (!checkUrl) return;

    setIsChecking(true);
    setStatus("idle");
    setError("");

    try {
      const response = await fetch(`${checkUrl}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        setStatus("online");
        const data = await response.json().catch(() => null);
        if (data) {
          setServerInfo({
            version: data.version || "unknown",
            status: data.status || "healthy",
            uptime: data.uptime,
          });
        }
      } else {
        setStatus("offline");
        setServerInfo(null);
      }
    } catch {
      setStatus("offline");
      setServerInfo(null);
    } finally {
      setIsChecking(false);
    }
  };

  const handleCheckConnection = () => void checkConnection();

  const handleSave = async () => {
    if (!serverUrl.trim()) {
      setError(t("settings.server.emptyUrl") || "请输入服务器地址");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await api.put("/settings/api_base_url", { value: serverUrl.trim() });
      saveApiBaseUrl(serverUrl.trim());
      // The reload happens immediately, so setSaved/setTimeout below are
      // mostly defensive — kept for visual feedback if reload is delayed.
      window.location.reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (err instanceof Error ? err.message : "保存失败"));
    } finally {
      setLoading(false);
    }
  };

  const handlePresetClick = (url: string) => {
    setServerUrl(url);
    void checkConnection(url);
  };

  if (loading) {
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
      data-testid="server-settings"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        padding: "8px 4px 32px",
      }}
    >
      {/* Header */}
      <header style={{ marginBottom: 18 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 500,
            color: "var(--color-codex-ink)",
            letterSpacing: "-0.015em",
          }}
        >
          {t("settings.server.title") || "服务器配置"}
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--color-codex-ink-mute)",
            lineHeight: 1.6,
          }}
        >
          {t("settings.server.subtitle") || "配置 AriaAI 后端服务器连接"}
        </p>
      </header>

      {/* Error */}
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
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Status banner */}
      <section
        className="mb-4 flex items-center gap-4"
        style={{
          padding: "14px 16px",
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 6px)",
        }}
      >
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center flex-shrink-0"
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--codex-r-sm, 3px)",
            background:
              status === "online"
                ? "color-mix(in oklch, var(--color-codex-good) 14%, transparent)"
                : status === "offline"
                  ? "color-mix(in oklch, var(--color-codex-bad) 14%, transparent)"
                  : "var(--color-codex-bg-tint)",
            color:
              status === "online"
                ? "var(--color-codex-good)"
                : status === "offline"
                  ? "var(--color-codex-bad)"
                  : "var(--color-codex-ink-mute)",
          }}
        >
          {status === "online" ? (
            <Wifi className="h-4 w-4" />
          ) : status === "offline" ? (
            <WifiOff className="h-4 w-4" />
          ) : (
            <Server className="h-4 w-4" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-codex-ink)",
            }}
          >
            {status === "online"
              ? t("settings.server.connected") || "已连接"
              : status === "offline"
                ? t("settings.server.disconnected") || "未连接"
                : t("settings.server.checking") || "检查中…"}
          </div>
          <div
            className="mt-1 flex items-center gap-2"
            style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}
          >
            {serverInfo ? (
              <>
                <span className="font-mono">v{serverInfo.version}</span>
                {serverInfo.uptime && (
                  <>
                    <span aria-hidden="true">·</span>
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    <span className="font-mono">{serverInfo.uptime}</span>
                  </>
                )}
              </>
            ) : (
              <span>
                {status === "offline"
                  ? t("settings.server.cannotConnect") || "无法连接到服务器"
                  : t("settings.server.checkingStatus") || "正在检查服务器状态…"}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheckConnection}
          disabled={isChecking}
          className="inline-flex items-center gap-1.5 disabled:opacity-50"
          style={GHOST_BUTTON_STYLE}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isChecking ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isChecking ? t("common.checking") || "检查中" : t("common.refresh") || "刷新"}
        </button>
      </section>

      {/* URL config */}
      <section
        className="mb-4"
        style={{
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 6px)",
          padding: "16px 20px",
        }}
      >
        <div
          className="mb-3 flex items-center gap-2"
          style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-codex-ink)" }}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          {t("settings.server.address") || "服务器地址"}
        </div>

        {/* Snapshot */}
        <div
          style={{
            padding: "12px 14px",
            background: "var(--color-codex-bg-tint)",
            borderRadius: "var(--codex-r-sm, 3px)",
            fontSize: 12.5,
            marginBottom: 12,
          }}
        >
          <SnapshotRow
            label={t("settings.server.currentSource") || "当前生效来源"}
            value={sourceLabels[effectiveSource]}
          />
          <SnapshotRow
            label={t("settings.server.currentValue") || "当前生效地址"}
            value={effectiveUrl}
            mono
          />
          <SnapshotRow
            label={t("settings.server.backendValue") || "后端存储值"}
            value={backendServerUrl || t("settings.server.notSet") || "未设置"}
            mono
          />
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://127.0.0.1:8000"
            className="codex-input font-mono"
            style={INPUT_STYLE}
          />
          <button
            type="button"
            onClick={handleCheckConnection}
            disabled={isChecking || !serverUrl}
            className="inline-flex items-center gap-1.5 disabled:opacity-50"
            style={GHOST_BUTTON_STYLE}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isChecking ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {t("settings.server.test") || "测试"}
          </button>
        </div>

        {status !== "idle" && (
          <div
            className="mt-3 flex items-center gap-2"
            style={{
              padding: "8px 12px",
              fontSize: 12,
              background:
                status === "online"
                  ? "color-mix(in oklch, var(--color-codex-good) 8%, transparent)"
                  : "color-mix(in oklch, var(--color-codex-bad) 8%, transparent)",
              border: `1px solid color-mix(in oklch, var(${
                status === "online" ? "--color-codex-good" : "--color-codex-bad"
              }) 30%, transparent)`,
              borderRadius: "var(--codex-r-sm, 3px)",
              color:
                status === "online"
                  ? "var(--color-codex-good)"
                  : "var(--color-codex-bad)",
            }}
          >
            {status === "online" ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                {t("settings.server.connectionSuccess") || "连接成功"}
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {t("settings.server.connectionFailed") || "连接失败，请检查服务器地址"}
              </>
            )}
          </div>
        )}
      </section>

      {/* Presets */}
      <section
        className="mb-4"
        style={{
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 6px)",
          padding: "16px 20px",
        }}
      >
        <div
          className="mb-3 flex items-center gap-2"
          style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-codex-ink)" }}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
          {t("settings.server.presets") || "快速选择"}
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            {
              label: t("settings.server.local") || "本地开发",
              url: "http://127.0.0.1:8000",
            },
            {
              label: t("settings.server.lan") || "局域网",
              url: "http://192.168.1.100:8000",
            },
            {
              label: t("settings.server.production") || "生产环境",
              url: "https://aria.d2cgo.co",
            },
          ].map((preset) => {
            const active = serverUrl === preset.url;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => handlePresetClick(preset.url)}
                className="inline-flex items-center gap-2 transition"
                style={{
                  padding: "7px 12px",
                  fontSize: 12.5,
                  color: active
                    ? "var(--color-codex-accent-ink)"
                    : "var(--color-codex-ink-soft)",
                  background: active
                    ? "var(--color-codex-accent-bg)"
                    : "var(--color-codex-bg)",
                  border: `1px solid ${
                    active
                      ? "var(--color-codex-accent)"
                      : "var(--color-codex-line)"
                  }`,
                  borderRadius: "var(--codex-r-sm, 3px)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {preset.label}
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: "var(--color-codex-ink-faint)",
                  }}
                >
                  {preset.url.replace(/^https?:\/\//, "")}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Security info */}
      <section
        className="mb-4 flex items-start gap-3"
        style={{
          padding: "12px 14px",
          background: "color-mix(in oklch, var(--color-codex-info) 5%, transparent)",
          border: "1px solid color-mix(in oklch, var(--color-codex-info) 25%, transparent)",
          borderRadius: "var(--codex-r-sm, 3px)",
        }}
      >
        <Shield
          className="h-4 w-4 flex-shrink-0"
          aria-hidden="true"
          style={{ color: "var(--color-codex-info)", marginTop: 1 }}
        />
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-codex-ink)",
            }}
          >
            {t("settings.server.security") || "连接安全"}
          </div>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 12,
              color: "var(--color-codex-ink-soft)",
              lineHeight: 1.6,
            }}
          >
            {t("settings.server.securityDesc") ||
              "本地开发使用 HTTP，生产环境建议使用 HTTPS 加密连接。所有 API 请求都需要身份验证。"}
          </p>
        </div>
      </section>

      {/* Help link */}
      <a
        href="https://docs.ariaai.com/server-setup"
        target="_blank"
        rel="noopener noreferrer"
        className="mb-5 inline-flex items-center gap-1.5"
        style={{
          fontSize: 12.5,
          color: "var(--color-codex-accent)",
        }}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        {t("settings.server.help") || "如何设置服务器？"}
      </a>

      {/* Footer — save */}
      <div
        className="flex items-center justify-between"
        style={{
          paddingTop: 14,
          borderTop: "1px solid var(--color-codex-line-soft)",
        }}
      >
        <p style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}>
          {saved ? (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: "var(--color-codex-good)" }}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t("settings.saved") || "已保存"}
            </span>
          ) : hasUnsavedChanges ? (
            <span className="inline-flex items-center gap-1.5">
              <CxStatus tone="warn">{t("settings.unsavedChanges") || "有未保存的更改"}</CxStatus>
            </span>
          ) : (
            <>{t("settings.allSaved") || "所有更改已保存"}</>
          )}
        </p>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || !serverUrl}
          className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          style={PRIMARY_BUTTON_STYLE}
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {t("settings.saving") || "保存中…"}
            </>
          ) : saved ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t("settings.saved") || "已保存"}
            </>
          ) : (
            <>
              <Server className="h-3.5 w-3.5" aria-hidden="true" />
              {t("settings.server.save") || "保存并应用"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------

function SnapshotRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ padding: "2px 0" }}>
      <span style={{ color: "var(--color-codex-ink-mute)" }}>{label}</span>
      <span
        className={mono ? "font-mono" : undefined}
        style={{
          color: "var(--color-codex-ink-soft)",
          textAlign: "right",
          wordBreak: "break-all",
          maxWidth: "70%",
        }}
      >
        {value}
      </span>
    </div>
  );
}
