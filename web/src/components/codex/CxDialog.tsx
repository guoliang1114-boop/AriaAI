/**
 * Codex modal dialog — portal-rendered, focus-trapped, Escape-dismissable.
 *
 * Shape follows the prototype password dialog in
 * ``direction-codex-settings.jsx:485`` and the per-feature ad-hoc
 * dialogs that were sprinkled across the app (ProfileSettings
 * password, Clients create form, Skill load/save…). Those each
 * rolled their own backdrop / z-index / focus rules; this primitive
 * unifies them.
 *
 * Why a portal: the V0.0.5-era dialogs rendered inline next to their
 * trigger button, which meant any ancestor that set ``overflow:
 * hidden`` (the Codex settings shell does, on the right column) clipped
 * the backdrop. ``createPortal`` into ``document.body`` sidesteps
 * that entirely and also keeps the modal above every other
 * positioned element.
 *
 * Why a focus trap: without one, Tab walks out of the modal into the
 * page behind it and screen-readers happily follow. The trap is
 * forwards + backwards (Shift+Tab) and falls back to the dialog
 * surface itself when there are no focusable children.
 *
 * Why Escape: matches OS conventions. Disabled while ``busy`` is
 * true so users can't dismiss a dialog mid-save and lose the message
 * about whether the save succeeded.
 *
 * The companion ``CxConfirmDialog`` wraps this with a fixed
 * cancel/confirm shape so the dozens of ``confirm()`` call sites can
 * port over without re-implementing buttons each time.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AlertTriangle, Check, Loader2, X } from "lucide-react";

export type CxDialogTone = "neutral" | "warn" | "danger" | "info" | "success";

export type CxDialogSize = "sm" | "md" | "lg";

interface CxDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Optional one-line subtitle under the title (12px ink-mute). */
  description?: ReactNode;
  /** Color of the title icon and the focused-button ring. */
  tone?: CxDialogTone;
  /** Override the title icon — defaults to the tone's icon. */
  icon?: ReactNode;
  /** sm = 360px, md = 480px (default), lg = 620px. */
  size?: CxDialogSize;
  /**
   * Block Escape / backdrop dismissal while the dialog is in the
   * middle of an async action — prevents accidental data loss.
   */
  busy?: boolean;
  /** Footer node (typically a button row). If omitted, no footer renders. */
  footer?: ReactNode;
  children?: ReactNode;
}

const SIZE_PX: Record<CxDialogSize, number> = {
  sm: 360,
  md: 480,
  lg: 620,
};

function toneIcon(tone: CxDialogTone) {
  switch (tone) {
    case "warn":
      return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
    case "danger":
      return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
    case "success":
      return <Check className="h-3.5 w-3.5" aria-hidden="true" />;
    case "info":
    case "neutral":
    default:
      return null;
  }
}

function toneAccent(tone: CxDialogTone) {
  switch (tone) {
    case "warn":
      return {
        bg: "color-mix(in oklab, var(--color-codex-warn) 14%, var(--color-codex-bg-elev))",
        ink: "var(--color-codex-warn)",
      };
    case "danger":
      return {
        bg: "color-mix(in oklab, var(--color-codex-bad) 14%, var(--color-codex-bg-elev))",
        ink: "var(--color-codex-bad)",
      };
    case "success":
      return {
        bg: "color-mix(in oklab, var(--color-codex-good) 14%, var(--color-codex-bg-elev))",
        ink: "var(--color-codex-good)",
      };
    case "info":
    case "neutral":
    default:
      return {
        bg: "var(--color-codex-accent-bg)",
        ink: "var(--color-codex-accent-ink)",
      };
  }
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function CxDialog({
  open,
  onClose,
  title,
  description,
  tone = "neutral",
  icon,
  size = "md",
  busy = false,
  footer,
  children,
}: CxDialogProps) {
  const titleId = useId();
  const descId = useId();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // Restore focus to whatever held it before the dialog opened — keeps
  // keyboard users from getting dropped at the top of the page after
  // they cancel/confirm.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const surface = surfaceRef.current;
    if (surface) {
      const first = surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      // If there's no focusable child, focus the surface itself so the
      // screen reader still announces the dialog instead of staying
      // attached to whatever button opened it.
      (first ?? surface).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = surfaceRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("data-cx-dialog-untrap"));
      if (focusables.length === 0) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    // Lock the body scroll while the modal is up — without this,
    // wheel events leak through to the page behind the backdrop.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open, handleClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const accent = toneAccent(tone);
  const titleIcon = icon ?? toneIcon(tone);

  const surfaceStyle: CSSProperties = {
    maxWidth: SIZE_PX[size],
    width: "100%",
    background: "var(--color-codex-bg-elev)",
    border: "1px solid var(--color-codex-line)",
    borderRadius: "var(--codex-r-md, 6px)",
    overflow: "hidden",
    boxShadow:
      "0 12px 36px -8px rgba(0,0,0,0.22), 0 0 0 1px var(--color-codex-line)",
    outline: "none",
  };

  return createPortal(
    <div
      role="presentation"
      onClick={handleClose}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.45)", padding: 16 }}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="theme-codex"
        style={surfaceStyle}
        data-testid="cx-dialog"
      >
        <header
          className="flex items-start justify-between"
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--color-codex-line-soft)",
            gap: 12,
          }}
        >
          <div className="flex items-start gap-2.5">
            {titleIcon && (
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "var(--codex-r-sm, 3px)",
                  background: accent.bg,
                  color: accent.ink,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {titleIcon}
              </span>
            )}
            <div>
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 500,
                  color: "var(--color-codex-ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </h2>
              {description && (
                <p
                  id={descId}
                  style={{
                    margin: "3px 0 0",
                    fontSize: 12,
                    color: "var(--color-codex-ink-mute)",
                    lineHeight: 1.55,
                  }}
                >
                  {description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label="Close dialog"
            className="disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              color: "var(--color-codex-ink-mute)",
              padding: 4,
              borderRadius: "var(--codex-r-sm, 3px)",
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {children !== undefined && (
          <div style={{ padding: 18 }}>{children}</div>
        )}

        {footer && (
          <footer
            className="flex items-center justify-end gap-2"
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--color-codex-line-soft)",
              background: "var(--color-codex-bg)",
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---- Confirm wrapper ---------------------------------------------------------

interface CxConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  /** Confirm button label — default 确认 / Confirm. */
  confirmLabel?: ReactNode;
  /** Cancel button label — default 取消 / Cancel. */
  cancelLabel?: ReactNode;
  /** Visual tone — danger paints the confirm button red, neutral keeps it ink. */
  tone?: CxDialogTone;
  /**
   * When true, the dialog stays open and the confirm button shows a
   * spinner while the parent runs the action. The caller is expected
   * to close the dialog after the async work finishes. Use this for
   * destructive actions that hit the network.
   */
  busy?: boolean;
}

const CONFIRM_BUTTON_STYLE_INK: CSSProperties = {
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 500,
  borderRadius: "var(--codex-r-sm, 3px)",
  background: "var(--color-codex-ink)",
  color: "var(--color-codex-bg-elev)",
};

const CONFIRM_BUTTON_STYLE_DANGER: CSSProperties = {
  ...CONFIRM_BUTTON_STYLE_INK,
  background: "var(--color-codex-bad)",
};

const CANCEL_BUTTON_STYLE: CSSProperties = {
  padding: "7px 14px",
  fontSize: 12.5,
  color: "var(--color-codex-ink-soft)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  background: "var(--color-codex-bg-elev)",
};

export function CxConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "neutral",
  busy = false,
}: CxConfirmDialogProps) {
  const handleConfirm = () => {
    void onConfirm();
  };
  const confirmStyle =
    tone === "danger" ? CONFIRM_BUTTON_STYLE_DANGER : CONFIRM_BUTTON_STYLE_INK;
  return (
    <CxDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      tone={tone}
      size="sm"
      busy={busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="disabled:cursor-not-allowed disabled:opacity-50"
            style={CANCEL_BUTTON_STYLE}
          >
            {cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={confirmStyle}
          >
            {busy && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            )}
            {confirmLabel ?? "确认"}
          </button>
        </>
      }
    />
  );
}
