/**
 * Codex status pill — 5–7px filled dot + label, mono font, tone-colored.
 *
 * Port of the prototype's ``CxStatus`` in
 * ``design_handoff_aria_codex_redesign/direction-codex-part1.jsx:11``.
 * Default tone is ``neutral``. Set ``pulse`` for live / in-progress
 * states (animates the dot via the ``codex-pulse`` keyframe).
 *
 * Must live inside a ``theme-codex`` subtree so the CSS custom
 * properties (``--color-codex-accent``, etc.) resolve.
 */
import type { ReactNode } from "react";

export type CxStatusTone =
  | "neutral"
  | "accent"
  | "good"
  | "warn"
  | "bad"
  | "info"
  | "mute";

interface CxStatusProps {
  tone?: CxStatusTone;
  pulse?: boolean;
  children: ReactNode;
}

const TONE_VAR: Record<CxStatusTone, string> = {
  neutral: "var(--color-codex-ink-mute)",
  accent: "var(--color-codex-accent)",
  good: "var(--color-codex-good)",
  warn: "var(--color-codex-warn)",
  bad: "var(--color-codex-bad)",
  info: "var(--color-codex-info)",
  mute: "var(--color-codex-ink-faint)",
};

export function CxStatus({ tone = "neutral", pulse = false, children }: CxStatusProps) {
  const color = TONE_VAR[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono"
      style={{ color, fontSize: 11.5 }}
      data-tone={tone}
      data-testid="cx-status"
    >
      <span
        className={pulse ? "codex-dot-pulse" : undefined}
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
          display: "inline-block",
        }}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}
