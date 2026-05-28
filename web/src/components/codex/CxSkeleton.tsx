/**
 * Codex shimmer skeleton — animated placeholder block for loading rows.
 *
 * Port of the prototype's ``CxSkeleton`` in
 * ``design_handoff_aria_codex_redesign/direction-codex-states.jsx:6``.
 *
 * Uses the ``codex-shimmer`` keyframe registered in
 * ``web/src/styles/codex.css``. Stack multiple instances at different
 * widths to match the page layout the user will eventually see (see
 * the prototype's ``CxLoading`` for an example skeleton arrangement).
 */
import type { CSSProperties } from "react";

interface CxSkeletonProps {
  w?: number | string;
  h?: number | string;
  /** Override the small (3px) default corner radius. */
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Optional ARIA label for screen readers (defaults to "Loading"). */
  "aria-label"?: string;
}

export function CxSkeleton({
  w = "100%",
  h = 12,
  radius,
  className,
  style,
  ...aria
}: CxSkeletonProps) {
  return (
    <span
      role="status"
      aria-label={aria["aria-label"] ?? "Loading"}
      aria-busy="true"
      className={["inline-block", className ?? ""].join(" ").trim()}
      style={{
        width: w,
        height: h,
        background:
          "linear-gradient(90deg, var(--color-codex-bg-tint) 0%, var(--color-codex-bg-sunken) 50%, var(--color-codex-bg-tint) 100%)",
        backgroundSize: "200% 100%",
        borderRadius: radius ?? "var(--codex-r-sm, 3px)",
        animation: "codex-shimmer 1.6s ease-in-out infinite",
        ...style,
      }}
      data-testid="cx-skeleton"
    />
  );
}
