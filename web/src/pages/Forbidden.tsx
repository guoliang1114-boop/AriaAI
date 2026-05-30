/**
 * 403 — V0.0.6 Codex redesign.
 *
 * No dedicated mockup in the design handoff; layout mirrors
 * ``NotFound.tsx`` for visual consistency (oversized numeral →
 * headline → explanation → CTAs) but uses the ``warn`` accent on the
 * numeral and a ShieldAlert icon to signal "you can't be here", not
 * "this doesn't exist".
 *
 * Previous MD3 version dragged in the surface / on-surface-muted /
 * tertiary-container tokens which look loud against the rest of the
 * Codex-styled app. This rewrite stays inside the ``theme-codex``
 * scope.
 */
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function Forbidden() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = isZh
    ? {
        title: "暂时没有访问权限",
        description:
          "这个页面对当前账户不开放。如果你需要进入，请联系管理员开通权限，或者回到其他可用的工作区。",
        goBack: "返回上一页",
        dashboard: "回到工作台",
      }
    : {
        title: "You can't access this area",
        description:
          "This page isn't open to your account. Ask an admin to grant access, or head back to another workspace you can use.",
        goBack: "Go back",
        dashboard: "Back to workspace",
      };

  return (
    <div
      className="theme-codex flex min-h-[calc(100vh-56px)] flex-col items-center justify-center"
      data-testid="forbidden"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        padding: "60px 24px",
        textAlign: "center",
      }}
    >
      <div
        className="inline-flex items-center justify-center"
        style={{
          width: 56,
          height: 56,
          borderRadius: 999,
          background:
            "color-mix(in oklab, var(--color-codex-warn) 14%, var(--color-codex-bg-elev))",
          color: "var(--color-codex-warn)",
          marginBottom: 4,
        }}
        aria-hidden="true"
      >
        <ShieldAlert className="h-6 w-6" />
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 96,
          color: "var(--color-codex-accent-bg)",
          fontWeight: 500,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          marginTop: 4,
        }}
      >
        403
      </div>
      <h1
        style={{
          margin: "-8px 0 0",
          fontSize: 24,
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
          fontSize: 13.5,
          color: "var(--color-codex-ink-mute)",
          maxWidth: 460,
          lineHeight: 1.65,
        }}
      >
        {copy.description}
      </p>

      <div className="flex gap-2.5" style={{ marginTop: 28 }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5"
          style={{
            padding: "9px 16px",
            fontSize: 13,
            color: "var(--color-codex-ink-soft)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-sm, 3px)",
            background: "var(--color-codex-bg-elev)",
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {copy.goBack}
        </button>
        <button
          type="button"
          onClick={() => navigate("/")}
          style={{
            padding: "9px 18px",
            fontSize: 13,
            color: "var(--color-codex-bg-elev)",
            background: "var(--color-codex-ink)",
            borderRadius: "var(--codex-r-sm, 3px)",
            fontWeight: 500,
          }}
        >
          {copy.dashboard}
        </button>
      </div>
    </div>
  );
}
