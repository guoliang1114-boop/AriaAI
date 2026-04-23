export const APP_TIMEZONE_STORAGE_KEY = "aria-timezone";
export const APP_TIMEZONE_EVENT = "app:timezone-changed";
export const BROWSER_TIMEZONE_VALUE = "browser";

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function getStoredAppTimeZone() {
  if (typeof window === "undefined") return BROWSER_TIMEZONE_VALUE;
  const value = window.localStorage.getItem(APP_TIMEZONE_STORAGE_KEY) || BROWSER_TIMEZONE_VALUE;
  if (value === BROWSER_TIMEZONE_VALUE) return value;
  return isValidTimeZone(value) ? value : BROWSER_TIMEZONE_VALUE;
}

export function getResolvedAppTimeZone() {
  const stored = getStoredAppTimeZone();
  return stored === BROWSER_TIMEZONE_VALUE ? getBrowserTimeZone() : stored;
}

export function setAppTimeZone(value: string) {
  if (typeof window === "undefined") return;
  const nextValue = value && isValidTimeZone(value) ? value : BROWSER_TIMEZONE_VALUE;
  window.localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, nextValue);
  window.dispatchEvent(new CustomEvent(APP_TIMEZONE_EVENT, { detail: nextValue }));
}

function getFormatterTimeZone(timeZone?: string) {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : getResolvedAppTimeZone();
}

export function formatDatePartsKey(input: string | number | Date, timeZone?: string) {
  const value = input instanceof Date ? input : new Date(input);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: getFormatterTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

export function formatTimeOnly(input: string | number | Date, options?: Intl.DateTimeFormatOptions, timeZone?: string) {
  const value = input instanceof Date ? input : new Date(input);
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
    timeZone: getFormatterTimeZone(timeZone),
  });
}

export function formatDateOnly(input: string | number | Date, options?: Intl.DateTimeFormatOptions, timeZone?: string) {
  const value = input instanceof Date ? input : new Date(input);
  return value.toLocaleDateString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options,
    timeZone: getFormatterTimeZone(timeZone),
  });
}

export function formatDateTime(
  input: string | number | Date,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
  timeZone?: string,
) {
  const value = input instanceof Date ? input : new Date(input);
  return value.toLocaleString(locale || undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
    timeZone: getFormatterTimeZone(timeZone),
  });
}
