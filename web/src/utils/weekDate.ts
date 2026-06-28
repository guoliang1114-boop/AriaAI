// Week math for weekly focus items. Weeks start on Monday. All values are
// plain "YYYY-MM-DD" strings so they round-trip cleanly with the backend
// (which snaps any date to its Monday in the app timezone).
import { formatDatePartsKey, getResolvedAppTimeZone } from "./timezone";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(dt: Date): string {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Today's date ("YYYY-MM-DD") in the resolved app timezone. */
export function isoTodayInAppTz(): string {
  return formatDatePartsKey(new Date(), getResolvedAppTimeZone());
}

/** The Monday on or before the given ISO date. */
export function mondayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d); // local midnight — weekday is tz-stable here
  const daysSinceMonday = (dt.getDay() + 6) % 7; // getDay(): 0=Sun … 6=Sat
  dt.setDate(dt.getDate() - daysSinceMonday);
  return toIso(dt);
}

/** Monday of the current week, in the app timezone. */
export function currentWeekStart(): string {
  return mondayOf(isoTodayInAppTz());
}

/** Shift a week-start by N weeks (negative = earlier). */
export function shiftWeek(weekStart: string, weeks: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + weeks * 7);
  return toIso(dt);
}

/** Human label for a week, e.g. "6月29日 – 7月5日" (zh) / "Jun 29 – Jul 5" (en). */
export function weekRangeLabel(weekStart: string, isZh: boolean): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  if (isZh) {
    return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[start.getMonth()]} ${start.getDate()} – ${months[end.getMonth()]} ${end.getDate()}`;
}
