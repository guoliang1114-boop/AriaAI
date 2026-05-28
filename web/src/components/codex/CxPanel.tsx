/**
 * Codex titled card — bordered, hairline 1px line, no shadow.
 *
 * Port of the prototype's ``CxPanel`` in
 * ``design_handoff_aria_codex_redesign/direction-codex-project-1.jsx:102``.
 *
 * Layout: title + optional subtitle on the left, optional action on
 * the right (typically a ``CxStatus`` or a small link). Children fill
 * the rest of the panel.
 */
import type { ReactNode } from "react";

interface CxPanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function CxPanel({
  title,
  subtitle,
  action,
  className,
  children,
}: CxPanelProps) {
  const showHeader = title || subtitle || action;
  return (
    <section
      className={[
        "border bg-codex-bg-elev",
        "border-codex-line",
        className ?? "",
      ]
        .join(" ")
        .trim()}
      style={{
        borderRadius: "var(--codex-r-md, 6px)",
        padding: "18px 20px",
      }}
      data-testid="cx-panel"
    >
      {showHeader && (
        <header className="mb-3.5 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h3
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 12,
                  color: "var(--color-codex-ink-mute)",
                  lineHeight: 1.5,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
