/**
 * Codex brand logo — small dark square with lowercase mono "a" + Aria wordmark.
 *
 * Port of the prototype's ``CxLogo`` in
 * ``design_handoff_aria_codex_redesign/direction-codex-part1.jsx:66``.
 *
 * The monogram uses ``--color-codex-ink`` background + ``--color-codex-bg-elev``
 * text so it reads as a small embossed mark on both light and dark themes
 * (the tokens swap places under ``.theme-codex.dark``).
 *
 * Use ``showWordmark={false}`` for tight nav corners where the "Aria"
 * wordmark would compete with adjacent labels.
 */

interface CxLogoProps {
  size?: number;
  showWordmark?: boolean;
  wordmarkSize?: number;
}

export function CxLogo({ size = 22, showWordmark = true, wordmarkSize }: CxLogoProps) {
  const ws = wordmarkSize ?? (size > 22 ? 17 : 15);
  return (
    <span
      className="inline-flex items-center gap-2"
      data-testid="cx-logo"
      aria-label="Aria"
    >
      <span
        className="inline-flex items-center justify-center font-mono shrink-0"
        style={{
          width: size,
          height: size,
          background: "var(--color-codex-ink)",
          color: "var(--color-codex-bg-elev)",
          borderRadius: 5,
          fontWeight: 600,
          fontSize: Math.round(size * 0.58),
          lineHeight: 1,
          letterSpacing: "-0.04em",
        }}
        aria-hidden="true"
      >
        a
      </span>
      {showWordmark && (
        <span
          style={{
            fontSize: ws,
            color: "var(--color-codex-ink)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          Aria
        </span>
      )}
    </span>
  );
}
