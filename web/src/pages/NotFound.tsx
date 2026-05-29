/**
 * 404 — V0.0.6 Codex redesign.
 *
 * Layout follows
 * ``design_handoff_aria_codex_redesign/direction-codex-more-2.jsx:290``
 * (CxNotFound). Centered: oversized 404 numeral → headline → one-line
 * explanation → two CTAs → faint search hint with ⌘K shortcut.
 *
 * The previous MD3 version (rounded card with gradient backdrop +
 * three "quick routes" tiles) didn't match the Codex direction's
 * quieter-empty-state mood and stuck out against the rest of the
 * redesigned app. The new layout keeps the same three escape hatches
 * but treats them as the search hint instead of three big buttons.
 */
import { ArrowLeft, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function NotFound() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = isZh
    ? {
        title: "这里什么也没有",
        description:
          "你访问的页面不存在，或已被移除。可能是链接陈旧 — 不用紧张，回到工作台继续。",
        goBack: "返回上一页",
        dashboard: "回到工作台",
        searchHint: "或者搜索你要找的内容",
        searchPlaceholder: "搜索项目、对话、Skill",
      }
    : {
        title: "Nothing here",
        description:
          "The page you tried to reach doesn't exist, or has been moved. The link may be stale — just head back to the workspace.",
        goBack: "Go back",
        dashboard: "Back to workspace",
        searchHint: "Or search for what you wanted",
        searchPlaceholder: "Search projects, chats, skills",
      };

  return (
    <div
      className="theme-codex flex min-h-[calc(100vh-56px)] flex-col items-center justify-center"
      data-testid="not-found"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        padding: "60px 24px",
        textAlign: "center",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 110,
          color: "var(--color-codex-accent-bg)",
          fontWeight: 500,
          letterSpacing: "-0.05em",
          lineHeight: 1,
        }}
      >
        404
      </div>
      <h1
        style={{
          margin: "-12px 0 0",
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
          maxWidth: 420,
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

      <div
        className="flex flex-col items-center gap-2.5"
        style={{ marginTop: 56 }}
      >
        <div style={{ fontSize: 11.5, color: "var(--color-codex-ink-faint)" }}>
          {copy.searchHint}
        </div>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-2"
          style={{
            padding: "8px 14px",
            fontSize: 13,
            border: "1px solid var(--color-codex-line)",
            borderRadius: 99,
            color: "var(--color-codex-ink-mute)",
            width: 300,
            background: "var(--color-codex-bg-elev)",
          }}
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.searchPlaceholder}</span>
          <span
            className="font-mono"
            style={{
              marginLeft: "auto",
              fontSize: 10.5,
              color: "var(--color-codex-ink-faint)",
            }}
          >
            ⌘K
          </span>
        </button>
      </div>
    </div>
  );
}
