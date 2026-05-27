export const APP_FONT_SIZE_STORAGE_KEY = "aria-font-size";
export const APP_FONT_SIZE_SETTING_KEY = "font_size";

export type AppFontSize = "small" | "medium" | "large";

export const DEFAULT_APP_FONT_SIZE: AppFontSize = "medium";

// Root font-size drives every rem-based size in the app, so changing it scales
// the whole UI proportionally (the .app-ui / .project-ui / .settings-ui scales
// are all rem-based). 16px is the design baseline defined in index.css.
const FONT_SIZE_PX: Record<AppFontSize, string> = {
  small: "15px",
  medium: "16px",
  large: "18px",
};

export function isAppFontSize(value: unknown): value is AppFontSize {
  return value === "small" || value === "medium" || value === "large";
}

export function getStoredAppFontSize(): AppFontSize {
  if (typeof window === "undefined") return DEFAULT_APP_FONT_SIZE;
  const value = window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY);
  return isAppFontSize(value) ? value : DEFAULT_APP_FONT_SIZE;
}

export function applyAppFontSize(value: AppFontSize) {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = FONT_SIZE_PX[value];
}

export function setAppFontSize(value: AppFontSize) {
  if (typeof window === "undefined") return;
  const next = isAppFontSize(value) ? value : DEFAULT_APP_FONT_SIZE;
  window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, next);
  applyAppFontSize(next);
}

export function bootstrapAppFontSize() {
  applyAppFontSize(getStoredAppFontSize());
}
