/**
 * Codex toggle switch — pill-shaped, accent fill when on.
 *
 * The prototype version in
 * ``design_handoff_aria_codex_redesign/direction-codex-settings.jsx:81``
 * is display-only (``CxSwitch({ on })``). Production needs interaction
 * + keyboard + ARIA, so we expose a controlled-component API and
 * render a ``<button role="switch">``.
 */
import { useCallback, type KeyboardEvent } from "react";

interface CxSwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible label. Required when not paired with a visible label via id. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
}

export function CxSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  ...aria
}: CxSwitchProps) {
  const handleClick = useCallback(() => {
    if (disabled) return;
    onCheckedChange(!checked);
  }, [checked, disabled, onCheckedChange]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      // ARIA APG: Space toggles a switch (Enter is also a click; the
      // browser dispatches a click for that automatically).
      if (event.key === " ") {
        event.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="inline-flex items-center transition-colors"
      style={{
        width: 34,
        height: 19,
        padding: 2,
        borderRadius: 999,
        background: checked
          ? "var(--color-codex-accent)"
          : "var(--color-codex-line-strong)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      data-testid="cx-switch"
    >
      <span
        aria-hidden="true"
        style={{
          width: 15,
          height: 15,
          borderRadius: 999,
          background: "var(--color-codex-bg-elev)",
          transform: checked ? "translateX(15px)" : "translateX(0)",
          transition: "transform 0.15s",
        }}
      />
    </button>
  );
}
