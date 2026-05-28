/**
 * Codex form row — 180px label column + flexible control column,
 * separated by a hairline ``line-soft`` bottom border.
 *
 * Port of the prototype's ``CxFormRow`` in
 * ``design_handoff_aria_codex_redesign/direction-codex-settings.jsx:65``.
 *
 * Used by every settings page. Stack multiple rows inside any
 * scrolling card / panel.
 */
import type { ReactNode } from "react";

interface CxFormRowProps {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  /** Pass ``false`` to suppress the bottom hairline on the last row. */
  divider?: boolean;
}

export function CxFormRow({
  label,
  hint,
  htmlFor,
  children,
  divider = true,
}: CxFormRowProps) {
  return (
    <div
      className="grid items-start gap-7"
      style={{
        gridTemplateColumns: "180px 1fr",
        padding: "16px 0",
        borderBottom: divider ? "1px solid var(--color-codex-line-soft)" : undefined,
      }}
      data-testid="cx-form-row"
    >
      <div>
        <label
          htmlFor={htmlFor}
          style={{ fontSize: 13.5, color: "var(--color-codex-ink)", fontWeight: 500 }}
        >
          {label}
        </label>
        {hint && (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--color-codex-ink-mute)",
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
