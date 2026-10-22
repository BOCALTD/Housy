// iCalendar (.ics) files for inspections (RFC 5545): one event to download, or a feed a calendar app subscribes to.
// Google Calendar, Apple Calendar and Outlook all read these. Times are written in UTC, so every app shows them in the
// viewer's own time zone; the same UID on every copy lets a calendar update an event instead of adding a second one.

export type IcsEvent = {
  uid: string;
  start: Date;
  minutes: number;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  cancelled?: boolean;
  sequence?: number;
  updated?: Date;
  /** Minutes before the start to remind; omit for no reminder. */
  alarmMinutes?: number;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escape text values: backslash, semicolon, comma and new lines. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line so no line is longer than 75 bytes (continuation lines start with a space). Never splits a character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + b > limit) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function icsCalendar(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Housy//Inspections//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name)}`, "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const e of events) {
    const end = new Date(e.start.getTime() + Math.max(1, e.minutes) * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(end)}`,
      `SEQUENCE:${e.sequence ?? 0}`,
      `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      `SUMMARY:${icsEscape(e.cancelled ? `Cancelled: ${e.title}` : e.title)}`,
    );
    if (e.updated) lines.push(`LAST-MODIFIED:${stamp(e.updated)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.alarmMinutes && !e.cancelled) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(e.title)}`, `TRIGGER:-PT${Math.round(e.alarmMinutes)}M`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
