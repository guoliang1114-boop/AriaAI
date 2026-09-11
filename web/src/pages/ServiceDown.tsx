/**
 * 503 Service Unavailable — V0.0.6 Codex.
 *
 * Layout per
 * ``design_handoff_aria_codex_redesign/direction-codex-more-2.jsx:384``
 * (CxServiceDown). Centered 503 numeral on a faint dot grid →
 * headline → auto-retry card with live countdown → component status
 * table → bottom CTA row with incident ID.
 *
 * Auto-retry: every 15 seconds we ping the backend's lightweight
 * ``/health`` endpoint. On the first 200 response we redirect back to
 * the page the user was on (or ``/`` if there's no return-to).
 * Pinging in the foreground beats waiting for the user to mash
 * refresh — most real outages clear up within a minute or two and
 * the user is just left wondering whether to retry.
 *
 * Reached two ways:
 * 1. Directly via ``/503`` (e.g. for design review or when an admin
 *    points someone at a maintenance link).
 * 2. Via the ``api:service-down`` window event the API client fires
 *    when it sees a 503 response — handled in ``App.tsx`` so any
 *    page in the app can be replaced with this view on a real
 *    outage.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock3 } from "lucide-react";

import { api } from "../api/client";
import { CxLogo, CxStatus, type CxStatusTone } from "../components/codex";

const RETRY_INTERVAL_SECONDS = 15;
// Stable per-load incident ID — easier than letting users invent one
// when they file a ticket. Format mirrors the prototype: INC-YYYY-MMDD-Axx.
function generateIncidentId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const seed = (now.getTime() & 0xfff).toString(16).toUpperCase().padStart(3, "0");
  return `INC-${y}-${m}${d}-${seed}`;
}

interface ComponentStatusRow {
  label: { zh: string; en: string };
  tone: CxStatusTone;
  status: { zh: string; en: string };
  note?: { zh: string; en: string };
}

// No component telemetry is available here. Do not invent a maintenance
// cause, recovery estimate, provider failover, or persisted draft guarantee.
const COMPONENT_STATUS: ComponentStatusRow[] = [
  {
    label: { zh: "Web 前端", en: "Web frontend" },
    tone: "good",
    status: { zh: "正常", en: "Operational" },
  },
  {
    label: { zh: "API 服务", en: "API service" },
    tone: "bad",
    status: { zh: "请求失败 · 原因待确认", en: "Request failed · cause unconfirmed" },
  },
  {
    label: { zh: "AI 模型代理", en: "AI model proxy" },
    tone: "warn",
    status: {
      zh: "未独立验证",
      en: "Not independently verified",
    },
  },
  {
    label: { zh: "向量检索", en: "Vector retrieval" },
    tone: "warn",
    status: { zh: "未独立验证", en: "Not independently verified" },
  },
  {
    label: { zh: "记忆任务队列", en: "Memory task queue" },
    tone: "warn",
    status: {
      zh: "未独立验证",
      en: "Not independently verified",
    },
  },
  {
    label: { zh: "文件存储", en: "File storage" },
    tone: "warn",
    status: { zh: "未独立验证", en: "Not independently verified" },
  },
];

export function ServiceDown() {
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigationState = location.state as { from?: string; reason?: string } | null;
  const requestedFrom = navigationState?.from;
  const returnTo = typeof requestedFrom === "string" && requestedFrom.startsWith("/")
    && !/^\/[\\/]/.test(requestedFrom) && !["/503", "/403"].includes(requestedFrom.split("?")[0])
    ? requestedFrom : "/";
  const recoveryProbe = navigationState?.reason === "user-memory-unavailable" ? "/user-memory" : "/health";

  const [secondsLeft, setSecondsLeft] = useState(RETRY_INTERVAL_SECONDS);
  const [retrying, setRetrying] = useState(false);
  const incidentId = useMemo(() => generateIncidentId(), []);

  // Countdown ticker. On reaching zero we both fire a retry and reset
  // the counter — keeps the UX aligned with what the design shows
  // ("下次重试 12 秒后") without manual rearming.
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) return RETRY_INTERVAL_SECONDS;
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // Health ping every RETRY_INTERVAL_SECONDS. We avoid checking on
  // mount because we just got here — the API was almost certainly
  // still down a moment ago.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (cancelled) return;
      setRetrying(true);
      try {
        await api.get(recoveryProbe);
        if (cancelled) return;
        // Recovered — go back to where the user was. Prefer the
        // referrer if it's on our origin, otherwise drop to root.
        navigate(returnTo, { replace: true });
      } catch (error) {
        if (!cancelled && (error as { response?: { status?: number } })?.response?.status === 403) {
          navigate("/403", { replace: true });
        }
        // Still down — countdown continues.
      } finally {
        if (!cancelled) setRetrying(false);
      }
    };
    const interval = setInterval(probe, RETRY_INTERVAL_SECONDS * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [navigate, recoveryProbe, returnTo]);

  const handleManualRetry = async () => {
    setRetrying(true);
    try {
      await api.get(recoveryProbe);
      navigate(returnTo, { replace: true });
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 403) {
        navigate("/403", { replace: true });
      }
      setSecondsLeft(RETRY_INTERVAL_SECONDS);
    } finally {
      setRetrying(false);
    }
  };

  const copy = isZh
    ? {
        statusPill: "服务连接异常",
        title: "服务暂时不可用",
        description:
          "暂时无法完成服务请求，可能是网络波动或服务暂不可用。请保留尚未提交的输入；连接恢复后，回到原页面确认任务和消息的保存状态。",
        retryingNow: "正在尝试重新连接",
        countdownPrefix: "每 15 秒自动重试 · 下次重试",
        countdownSuffix: "秒后",
        retryNow: "立即重试",
        componentStatus: "各组件状态",
        incidentLabel: "本地参考号",
      }
    : {
        statusPill: "Connection unavailable",
        title: "Service temporarily unavailable",
        description:
          "The service request could not be completed. This may be a network or service interruption. Keep any unsent input; after reconnecting, check the original page for the saved task and message status.",
        retryingNow: "Trying to reconnect",
        countdownPrefix: "Auto-retry every 15s · next attempt",
        countdownSuffix: "s",
        retryNow: "Retry now",
        componentStatus: "Component status",
        incidentLabel: "Local reference",
      };

  return (
    <div
      className="theme-codex flex min-h-screen flex-col"
      data-testid="service-down"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
      }}
    >
      <header
        className="flex flex-shrink-0 items-center justify-between"
        style={{
          height: 56,
          padding: "0 36px",
          borderBottom: "1px solid var(--color-codex-line)",
        }}
      >
        <CxLogo size={22} />
        <CxStatus tone="bad" pulse>
          {copy.statusPill}
        </CxStatus>
      </header>

      <div
        className="relative flex flex-1 justify-center"
        style={{ padding: "60px 60px 40px", overflow: "hidden" }}
      >
        {/* Faint dot grid behind the content, masked to a soft ellipse
            so the page edges stay clean. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.35,
            backgroundImage:
              "radial-gradient(circle, var(--color-codex-line-strong) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            maskImage:
              "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 90%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 90%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ maxWidth: 680, width: "100%", position: "relative" }}>
          <div
            className="font-mono"
            style={{
              fontSize: 96,
              color: "var(--color-codex-accent-bg)",
              fontWeight: 500,
              letterSpacing: "-0.05em",
              lineHeight: 1,
            }}
          >
            503
          </div>
          <h1
            style={{
              margin: "8px 0 0",
              fontSize: 28,
              fontWeight: 500,
              color: "var(--color-codex-ink)",
              letterSpacing: "-0.02em",
            }}
          >
            {copy.title}
          </h1>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 14,
              color: "var(--color-codex-ink-soft)",
              lineHeight: 1.7,
              maxWidth: 480,
            }}
          >
            {copy.description}
          </p>

          {/* Auto-retry card */}
          <div
            className="flex items-center gap-3"
            style={{
              marginTop: 24,
              padding: "12px 16px",
              background: "var(--color-codex-bg-elev)",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-md, 6px)",
            }}
          >
            <span
              className="inline-flex items-center justify-center"
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: "var(--color-codex-accent-bg)",
                color: "var(--color-codex-accent)",
                flexShrink: 0,
              }}
            >
              <Clock3 className="h-3.5 w-3.5" />
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-codex-ink)",
                  fontWeight: 500,
                }}
              >
                {copy.retryingNow}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--color-codex-ink-mute)",
                  marginTop: 2,
                }}
              >
                {copy.countdownPrefix}{" "}
                <span className="font-mono">{secondsLeft}</span>
                {" "}
                {copy.countdownSuffix}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleManualRetry()}
              disabled={retrying}
              className="disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                padding: "6px 12px",
                fontSize: 12,
                color: "var(--color-codex-ink-soft)",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 3px)",
                background: "var(--color-codex-bg)",
              }}
            >
              {copy.retryNow}
            </button>
          </div>

          {/* Component status */}
          <div style={{ marginTop: 24 }}>
            <div
              className="font-mono"
              style={{
                fontSize: 11.5,
                color: "var(--color-codex-ink-mute)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 10,
              }}
            >
              {copy.componentStatus}
            </div>
            <div
              style={{
                background: "var(--color-codex-bg-elev)",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-md, 6px)",
              }}
            >
              {COMPONENT_STATUS.map((row, idx) => (
                <div
                  key={row.label.zh}
                  className="items-center"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 1fr auto",
                    padding: "12px 18px",
                    gap: 14,
                    borderBottom:
                      idx === COMPONENT_STATUS.length - 1
                        ? "none"
                        : "1px solid var(--color-codex-line-soft)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--color-codex-ink)",
                      fontWeight: 500,
                    }}
                  >
                    {isZh ? row.label.zh : row.label.en}
                  </span>
                  <CxStatus
                    tone={row.tone}
                    pulse={row.tone === "warn" || row.tone === "bad"}
                  >
                    {isZh ? row.status.zh : row.status.en}
                  </CxStatus>
                  {row.note ? (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "var(--color-codex-ink-mute)",
                      }}
                    >
                      {isZh ? row.note.zh : row.note.en}
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Incident id only — the prior "Status page" + secondary CTAs
              pointed at a status.example.com placeholder that was never
              wired up. The header retry button already covers the primary
              "try again now" action. */}
          <div
            className="flex items-center"
            style={{ marginTop: 24, flexWrap: "wrap" }}
          >
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11.5,
                color: "var(--color-codex-ink-faint)",
              }}
            >
              {copy.incidentLabel}{" "}
              <span
                className="font-mono"
                style={{ color: "var(--color-codex-ink-mute)" }}
              >
                {incidentId}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
