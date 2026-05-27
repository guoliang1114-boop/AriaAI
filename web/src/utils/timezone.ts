export const APP_TIMEZONE_STORAGE_KEY = "aria-timezone";
export const APP_TIMEZONE_EVENT = "app:timezone-changed";
export const DEFAULT_APP_TIMEZONE = "Asia/Shanghai";
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
  if (typeof window === "undefined") return DEFAULT_APP_TIMEZONE;
  const value = window.localStorage.getItem(APP_TIMEZONE_STORAGE_KEY) || DEFAULT_APP_TIMEZONE;
  if (value === BROWSER_TIMEZONE_VALUE) return value;
  return isValidTimeZone(value) ? value : DEFAULT_APP_TIMEZONE;
}

export function getResolvedAppTimeZone() {
  const stored = getStoredAppTimeZone();
  return stored === BROWSER_TIMEZONE_VALUE ? getBrowserTimeZone() : stored;
}

export function setAppTimeZone(value: string) {
  if (typeof window === "undefined") return;
  const nextValue =
    value === BROWSER_TIMEZONE_VALUE
      ? BROWSER_TIMEZONE_VALUE
      : value && isValidTimeZone(value)
        ? value
        : DEFAULT_APP_TIMEZONE;
  window.localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, nextValue);
  window.dispatchEvent(new CustomEvent(APP_TIMEZONE_EVENT, { detail: nextValue }));
}

function getFormatterTimeZone(timeZone?: string) {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : getResolvedAppTimeZone();
}

const ISO_DATETIME_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

export function parseAppDateTime(input: string | number | Date) {
  if (input instanceof Date) return input;
  if (typeof input === "string") {
    const value = input.trim();
    if (ISO_DATETIME_WITHOUT_ZONE.test(value)) {
      return new Date(`${value}Z`);
    }
    return new Date(value);
  }
  return new Date(input);
}

export function formatDatePartsKey(input: string | number | Date, timeZone?: string) {
  const value = parseAppDateTime(input);
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
  const value = parseAppDateTime(input);
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
    timeZone: getFormatterTimeZone(timeZone),
  });
}

export function formatDateOnly(input: string | number | Date, options?: Intl.DateTimeFormatOptions, timeZone?: string) {
  const value = parseAppDateTime(input);
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
  const value = parseAppDateTime(input);
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
