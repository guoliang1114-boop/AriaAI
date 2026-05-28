/**
 * Login page — V0.0.6 Codex redesign (fullscreen-tuned).
 *
 * Fullscreen / ultrawide fix:
 *   1. Outer wrapper now uses bg-elev so the left aside background extends
 *      to viewport edges on ultrawide. Inner container is capped at 1440.
 *   2. Desktop uses a deterministic flex shell: left flex 1.4, right 480px.
 *   3. Brand mark + hero + footer are wrapped in a single 520-wide column
 *      so all 3 align to the same vertical axis (no more footer items
 *      flying to opposite corners on wide screens).
 *   4. Right main is fixed 480px on desktop — form column never inflates.
 *   5. Dot grid + orbs remain pinned to the aside (not the inner column)
 *      so they keep filling the panel space.
 *
 * Auth state machine unchanged. i18n keys unchanged.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { PageTitle } from "../components/PageTitle";
import { CxLogo } from "../components/codex";
import type { LoginResponse } from "../types/api";

const INPUT_STYLE = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 13.5,
  background: "var(--color-codex-bg-elev)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  color: "var(--color-codex-ink)",
};

export function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await api.post<LoginResponse>("/auth/login", {
        email: email.toLowerCase().trim(),
        password,
      });

      if (!response.token) {
        throw new Error("No token received from server");
      }

      login(response.token, response.user);
      navigate("/");
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const message =
        detail ||
        (err instanceof Error ? err.message : null) ||
        "Login failed. Please check your credentials.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageTitle title={t("login.title")} />

      {/* ============================================================
          OUTER — viewport-wide. bg-elev fills the entire viewport so
          on ultrawide screens the left aside background appears to
          extend forever (and the inner 1440 container is invisible).
          ============================================================ */}
      <div className="theme-codex codex-login-outer">
        {/* ----------------------------------------------------------
            INNER — capped at 1440. Above this width, viewport just
            adds equal left/right whitespace that visually merges with
            the left aside background.
            ---------------------------------------------------------- */}
        <div className="codex-login-inner">
          {/* --------------------------------------------------------
              LEFT — quiet hero (hidden on small screens). Desktop flex
              gives this column all remaining width beside the 480px form.
              -------------------------------------------------------- */}
          <aside
            className="codex-login-aside"
            aria-hidden="false"
          >
            {/* Faint dot grid — drifts on a 22s loop. Stays pinned to
                the full aside so the texture fills the whole panel. */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "radial-gradient(circle, var(--color-codex-line-strong) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
                opacity: 0.4,
                pointerEvents: "none",
                maskImage:
                  "radial-gradient(ellipse 80% 60% at 70% 50%, black 30%, transparent 90%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 80% 60% at 70% 50%, black 30%, transparent 90%)",
                animation: "codex-drift 22s ease-in-out infinite",
              }}
            />

            {/* Two floating accent orbs. */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "18%",
                right: "20%",
                width: 240,
                height: 240,
                borderRadius: 9999,
                background:
                  "radial-gradient(circle, color-mix(in oklch, var(--color-codex-accent) var(--codex-login-orb-a-mix, 18%), transparent) 0%, transparent 70%)",
                animation: "codex-float-a 14s ease-in-out infinite",
                filter: "blur(2px)",
                pointerEvents: "none",
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: "12%",
                right: "55%",
                width: 180,
                height: 180,
                borderRadius: 9999,
                background:
                  "radial-gradient(circle, color-mix(in oklch, var(--color-codex-accent) var(--codex-login-orb-b-mix, 12%), transparent) 0%, transparent 70%)",
                animation: "codex-float-b 18s ease-in-out infinite",
                filter: "blur(2px)",
                pointerEvents: "none",
              }}
            />

            {/* Content column — capped at 520px and full-height
                space-between, so brand mark, hero, and footer all
                align to the same vertical axis on any screen width. */}
            <div
              className="codex-login-hero-column"
            >
              {/* Brand mark — pinned top. */}
              <div className="relative">
                <CxLogo size={26} wordmarkSize={18} />
              </div>

              {/* Center — accent line + headline + body. */}
              <div className="relative" style={{ maxWidth: 480 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--color-codex-accent)",
                    marginBottom: 22,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18,
                      height: 1,
                      background: "var(--color-codex-accent)",
                    }}
                  />
                  {t("login.heroBadge")}
                </div>

                <h1
                  style={{
                    margin: 0,
                    fontSize: 44,
                    fontWeight: 400,
                    lineHeight: 1.18,
                    letterSpacing: "-0.025em",
                    color: "var(--color-codex-ink)",
                    whiteSpace: "pre-line",
                  }}
                >
                  {t("login.heroHeadline")}
                </h1>

                <p
                  style={{
                    margin: "20px 0 0",
                    fontSize: 14,
                    color: "var(--color-codex-ink-soft)",
                    lineHeight: 1.75,
                    maxWidth: 380,
                  }}
                >
                  {t("login.heroBody")}
                </p>
              </div>

              {/* Footer — edition tag + copyright on the same axis. */}
              <div
                className="codex-login-footer"
                style={{ fontSize: 11.5, color: "var(--color-codex-ink-faint)" }}
              >
                <span>{t("login.heroEdition")}</span>
                <span>{t("login.heroCopyright")}</span>
              </div>
            </div>
          </aside>

          {/* --------------------------------------------------------
              RIGHT — form. Fixed 480px width on desktop so the form
              column never inflates on ultrawide screens.
              -------------------------------------------------------- */}
          <main
            className="codex-login-main"
          >
            <div style={{ maxWidth: 340, width: "100%" }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 26,
                  fontWeight: 500,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.02em",
                }}
              >
                {t("login.welcomeBack")}
              </h2>
              <p
                style={{
                  margin: "8px 0 30px",
                  fontSize: 13,
                  color: "var(--color-codex-ink-mute)",
                }}
              >
                {t("login.subtitle")}
              </p>

              {error && (
                <div
                  role="alert"
                  style={{
                    marginBottom: 18,
                    padding: "10px 12px",
                    borderRadius: "var(--codex-r-sm, 3px)",
                    background:
                      "color-mix(in oklch, var(--color-codex-bad) 8%, transparent)",
                    border:
                      "1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)",
                    color: "var(--color-codex-bad)",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <label
                  htmlFor="login-email"
                  style={{
                    fontSize: 12.5,
                    color: "var(--color-codex-ink-soft)",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  {t("login.email")}
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="codex-input"
                  style={{ ...INPUT_STYLE, marginBottom: 18 }}
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 6,
                  }}
                >
                  <label
                    htmlFor="login-password"
                    style={{
                      fontSize: 12.5,
                      color: "var(--color-codex-ink-soft)",
                    }}
                  >
                    {t("login.password")}
                  </label>
                  <a
                    href="#"
                    style={{
                      fontSize: 11.5,
                      color: "var(--color-codex-accent)",
                    }}
                    onClick={(e) => e.preventDefault()}
                  >
                    {t("login.forgotPassword")}
                  </a>
                </div>
                <input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="codex-input"
                  style={{ ...INPUT_STYLE, marginBottom: 24 }}
                />

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: 11,
                    background: "var(--color-codex-ink)",
                    color: "var(--color-codex-bg-elev)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                    fontSize: 13.5,
                    fontWeight: 500,
                    opacity: loading ? 0.5 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                    transition: "opacity 0.15s",
                  }}
                >
                  {loading ? t("login.signingIn") : t("login.signIn")}
                </button>
              </form>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
