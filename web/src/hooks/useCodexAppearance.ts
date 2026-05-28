/**
 * React hook for reading + mutating the user's Codex appearance.
 *
 * - Initializes state from ``localStorage`` (synchronous, no flicker).
 * - On change: persists to ``localStorage``, applies DOM classes,
 *   dispatches a ``CODEX_APPEARANCE_EVENT`` so other hook consumers
 *   across the app stay in sync.
 * - Subscribes to that same event so a change in one tab / one
 *   component reflects in every mounted ``useCodexAppearance`` consumer.
 *
 * Use ``setAppearance`` to overwrite all four fields at once, or
 * ``patchAppearance`` to update one field while keeping the rest.
 */
import { useCallback, useEffect, useState } from "react";

import {
  CODEX_APPEARANCE_EVENT,
  type CodexAppearance,
  applyAppearance,
  readSavedAppearance,
  writeSavedAppearance,
} from "../utils/codexAppearance";

export function useCodexAppearance() {
  const [appearance, setAppearanceState] = useState<CodexAppearance>(() =>
    readSavedAppearance(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CodexAppearance>).detail;
      if (detail) setAppearanceState(detail);
    };
    window.addEventListener(CODEX_APPEARANCE_EVENT, handler);
    return () => window.removeEventListener(CODEX_APPEARANCE_EVENT, handler);
  }, []);

  const setAppearance = useCallback((next: CodexAppearance) => {
    setAppearanceState(next);
    applyAppearance(next);
    writeSavedAppearance(next);
  }, []);

  const patchAppearance = useCallback((patch: Partial<CodexAppearance>) => {
    setAppearanceState((current) => {
      const next = { ...current, ...patch };
      applyAppearance(next);
      writeSavedAppearance(next);
      return next;
    });
  }, []);

  return { appearance, setAppearance, patchAppearance };
}
