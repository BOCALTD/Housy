/** A message as the chat screen receives it (plain values only, so it can cross from the server to the browser). */
export type ChatMsg = { id: string; senderId: string; senderName: string; kind: string; body: string; details: Record<string, unknown>; masked: boolean; at: string };

export function chatMessage(m: { id: string; senderId: string; senderName: string; kind: string; body: string; details: unknown; masked: boolean; createdAt: Date }): ChatMsg {
  return { id: m.id, senderId: m.senderId, senderName: m.senderName, kind: m.kind, body: m.body, details: (m.details ?? {}) as Record<string, unknown>, masked: m.masked, at: m.createdAt.toISOString() };
}

/** "Today", "Yesterday", a weekday this week, or a date: the separators between days in a chat (in the reader's time zone). */
export function dayLabel(iso: string, now = new Date(), tz = "Africa/Lagos"): string {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const d = new Date(iso);
  const today = key(now), yest = key(new Date(now.getTime() - 864e5));
  if (key(d) === today) return "Today";
  if (key(d) === yest) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString("en-NG", { weekday: "long", timeZone: tz });
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric", timeZone: tz });
}

/** "14:05" in the reader's time zone. */
export function timeLabel(iso: string, tz = "Africa/Lagos"): string {
  return new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
}
