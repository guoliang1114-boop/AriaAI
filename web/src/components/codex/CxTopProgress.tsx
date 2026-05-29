/**
 * Codex top-of-page progress bar — 2px accent slider that animates
 * across a bg-tint track. Drop it at the very top of a page that's
 * waiting for data to give the impression of "something's happening"
 * without committing to a spinner.
 *
 * Port of the prototype's top progress bar in
 * ``design_handoff_aria_codex_redesign/direction-codex-states.jsx:26``.
 *
 * Uses the ``codex-progress`` keyframe registered in
 * ``web/src/styles/codex.css``.
 */
import type { CSSProperties } from "react";

interface CxTopProgressProps {
  height?: number;
  /** Width of the moving accent slider as a percentage. */
  sliderWidth?: string;
  className?: string;
  style?: CSSProperties;
}

export function CxTopProgress({
  height = 2,
  sliderWidth = "40%",
  className,
  style,
}: CxTopProgressProps) {
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label="Loading"
      className={["overflow-hidden", className ?? ""].join(" ").trim()}
      style={{
        height,
        background: "var(--color-codex-bg-tint)",
        flexShrink: 0,
        ...style,
      }}
    >
      <div
        style={{
          height: "100%",
          width: sliderWidth,
          background: "var(--color-codex-accent)",
          animation: "codex-progress 1.8s ease-in-out infinite",
        }}
      />
    </div>
  );
}
