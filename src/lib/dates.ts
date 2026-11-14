// Date-only values (lease dates, due dates) are handled as UTC midnight to avoid time-zone drift.
// Timestamps are stored in UTC and shown in the request's time zone: the signed-in person's own, otherwise their workspace's,
// otherwise their country's usual one (money-context.ts). Visitors and scheduled jobs use Lagos time (West Africa Time).
import { requestTimeZone } from "./money-context";

export const DISPLAY_TIME_ZONE = "Africa/Lagos";
/** The time zone dates are shown in for this request. */
export const currentTimeZone = () => requestTimeZone();

/** Minutes a time zone is ahead of UTC at a moment (negative behind), daylight saving included. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** A wall-clock time in a zone ("2026-11-20T09:30") as the moment it is. */
export function zonedToUtc(local: string, timeZone: string): Date {
  const m = local.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d{1,3})?)?$/);
  if (!m) return new Date(NaN);
  const guess = Date.parse(`${m[1]}T${m[2]}${m[3] ?? ":00"}Z`);
  const first = guess - zoneOffsetMinutes(timeZone, new Date(guess)) * 60000;
  const second = guess - zoneOffsetMinutes(timeZone, new Date(first)) * 60000;
  return new Date(second);
}

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

/**
 * Today's date where this request is (the person's or workspace's time zone; Lagos for visitors and scheduled jobs), as a
 * UTC-midnight date-only value. The name is from when Housy only worked in Lagos.
 */
export function todayInLagos(now: Date = new Date(), timeZone: string = requestTimeZone()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return parseDateOnly(parts);
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: requestTimeZone(),
  }).format(date);
}

/** The short name of this request's time zone at a moment ("WAT", "GMT", "EST"), for saying which time a time is in. */
export function zoneLabel(date: Date = new Date(), timeZone: string = requestTimeZone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * A date and time typed in a form (an <input type="datetime-local"> value, which has no zone) read in this request's time zone
 * (Lagos for visitors). The name is from when Housy only worked in Lagos.
 */
export function fromLagosLocal(value: string, timeZone: string = requestTimeZone()): Date {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value.trim()) ? zonedToUtc(value, timeZone) : new Date(NaN);
}

/** The value for an <input type="datetime-local"> showing this moment in this request's time zone. */
export function toLagosLocal(d: Date, timeZone: string = requestTimeZone()): string {
  return new Date(d.getTime() + zoneOffsetMinutes(timeZone, d) * 60000).toISOString().slice(0, 16);
}

/** The last moment of a calendar day in this request's time zone. "Valid until 3 May" means until midnight there, not in London. */
export function endOfLagosDay(dateOnly: string, timeZone: string = requestTimeZone()): Date {
  const next = new Date(parseDateOnly(dateOnly).getTime() + 864e5).toISOString().slice(0, 10);
  return new Date(zonedToUtc(`${next}T00:00`, timeZone).getTime() - 1);
}
