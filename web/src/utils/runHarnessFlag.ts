/**
 * Feature flag for the Run Harness v1 frontend (Product Run Event consumer +
 * Run Activity Timeline UI). Off by default everywhere; can be turned on by:
 *
 *   1. ``localStorage['aria.run_harness_v1'] === 'true'`` (per-device override),
 *      flippable from the browser console while iterating.
 *   2. The build-time env var ``VITE_ENABLE_RUN_HARNESS_V1=true``.
 *
 * Both checks default to off so production stays on the legacy event path
 * until A1 inside-event wiring is merged and the timeline UI is validated.
 */

const STORAGE_KEY = "aria.run_harness_v1";

export function isRunHarnessV1Enabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "true") return true;
    } catch {
      // Some browsers throw on localStorage access — treat as off.
    }
  }
  const envValue = (import.meta.env as Record<string, string | undefined> | undefined)?.[
    "VITE_ENABLE_RUN_HARNESS_V1"
  ];
  return String(envValue ?? "").toLowerCase() === "true";
}

export function setRunHarnessV1Override(value: boolean | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
    }
  } catch {
    // Ignore quota/permission errors — flag stays at its previous resolved value.
  }
}
