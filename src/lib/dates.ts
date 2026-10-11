// Date-only values (lease dates, due dates) are handled as UTC midnight to avoid time-zone drift.
// Timestamps are stored in UTC and displayed in West Africa Time.

export const DISPLAY_TIME_ZONE = "Africa/Lagos";

export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a date as YYYY-MM-DD");
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error("That date does not exist");
  }
  return date;
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Add whole months to a date-only value, clamping to the last day of the target month (31 Jan + 1 = 28/29 Feb). */
export function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}

/** Today's date in West Africa Time, as a UTC-midnight date-only value. */
export function todayInLagos(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return parseDateOnly(parts);
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}
