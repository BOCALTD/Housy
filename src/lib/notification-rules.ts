import { createHash } from "node:crypto";

// Notification rules: pure, so they can be tested without a database or an email provider.

export type Category = "ESSENTIAL" | "ACTIVITY" | "PROMOTIONAL";

/** Kinds that concern the safety or standing of an account. These are always sent and cannot be switched off. */
const ESSENTIAL_KINDS = new Set(["security", "billing", "reward.restricted", "message.paused", "message.resumed", "collab.suspended", "collab.revoked", "verification", "legal"]);
const PROMOTIONAL_KINDS = new Set(["promo", "marketing", "campaign"]);
/** Kinds that people asked for by saving a search or following; they have their own switch. */
export const ALERT_KINDS = new Set(["alert.property", "alert.availability", "alert.agent"]);

export function categoryOf(kind: string): Category {
  if (ESSENTIAL_KINDS.has(kind) || kind.startsWith("security.")) return "ESSENTIAL";
  if (PROMOTIONAL_KINDS.has(kind) || kind.startsWith("promo.")) return "PROMOTIONAL";
  return "ACTIVITY";
}

export const DAILY_EMAIL_CAP = 5;                   // optional emails to one person in 24 hours before the rest wait for the digest
export const DIGEST_MIN_ITEMS = 1;
export const DIGEST_MAX_ITEMS = 25;
export const MAX_ATTEMPTS = 5;
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
export const MAX_ALERT_RECIPIENTS = 300;            // one approved property reaches at most this many people

export const backoff = (attempts: number) => BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1] * 60_000;

const LAGOS_OFFSET_H = 1;                           // Nigeria has no daylight saving: always UTC+1
export const lagosHour = (d: Date) => (d.getUTCHours() + LAGOS_OFFSET_H) % 24;
export const lagosDay = (d: Date) => new Date(d.getTime() + LAGOS_OFFSET_H * 3600_000).toISOString().slice(0, 10);

/** Quiet hours may wrap past midnight (22 to 7). The end hour itself is outside the quiet period. */
export function inQuiet(hour: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** The next moment the quiet period ends, on the hour, in Lagos time. */
export function quietEndsAt(now: Date, end: number): Date {
  const local = new Date(now.getTime() + LAGOS_OFFSET_H * 3600_000);
  const t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), end);
  const at = t > local.getTime() ? t : t + 864e5;
  return new Date(at - LAGOS_OFFSET_H * 3600_000);
}

/** Same person, same thing, same day: one email. Callers may pass their own key to widen or narrow that. */
export function dedupeKeyFor(userId: string, kind: string, ref: string, now: Date, explicit?: string): string {
  const basis = explicit ? `${userId}|${explicit}` : `${userId}|${kind}|${ref}|${lagosDay(now)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 40);
}

export interface PrefView { emailActivity: boolean; emailAlerts: boolean; emailPromotional: boolean; digest: "INSTANT" | "DAILY"; quietStart: number | null; quietEnd: number | null }
export const DEFAULT_PREFS: PrefView = { emailActivity: true, emailAlerts: true, emailPromotional: false, digest: "INSTANT", quietStart: null, quietEnd: null };

export type Decision =
  | { action: "SEND" }
  | { action: "SKIP"; reason: string }
  | { action: "DEFER"; until: Date }
  | { action: "HOLD"; reason: string };

/** What to do with one queued email, given the person's wishes and how much they have already been sent. */
export function decide(o: { kind: string; category: Category; pref: PrefView; now: Date; sentLast24h: number; hasAddress: boolean }): Decision {
  if (!o.hasAddress) return { action: "SKIP", reason: "no email address" };
  if (o.category === "ESSENTIAL") return { action: "SEND" };
  if (o.category === "PROMOTIONAL" && !o.pref.emailPromotional) return { action: "SKIP", reason: "has not opted in to promotional email" };
  if (o.category === "ACTIVITY") {
    if (ALERT_KINDS.has(o.kind) ? !o.pref.emailAlerts : !o.pref.emailActivity) return { action: "SKIP", reason: "switched off by the person" };
  }
  if (inQuiet(lagosHour(o.now), o.pref.quietStart, o.pref.quietEnd)) return { action: "DEFER", until: quietEndsAt(o.now, o.pref.quietEnd!) };
  if (o.pref.digest === "DAILY") return { action: "HOLD", reason: "daily digest" };
  if (o.sentLast24h >= DAILY_EMAIL_CAP) return { action: "HOLD", reason: "daily limit reached" };
  return { action: "SEND" };
}

// ---------- Unsubscribe links ----------

export type UnsubScope = "ACTIVITY" | "ALERTS" | "PROMOTIONAL" | "ALL_OPTIONAL";
const SCOPES: UnsubScope[] = ["ACTIVITY", "ALERTS", "PROMOTIONAL", "ALL_OPTIONAL"];
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const mac = (secret: string, body: string) => createHash("sha256").update(`${secret}|${body}`).digest("base64url").slice(0, 32);

export function signUnsub(secret: string, userId: string, scope: UnsubScope): string {
  const body = b64(`${userId}|${scope}`);
  return `${body}.${mac(secret, body)}`;
}
export function readUnsub(secret: string, token: string): { userId: string; scope: UnsubScope } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || sig !== mac(secret, body)) return null;
  const [userId, scope] = Buffer.from(body, "base64url").toString().split("|");
  return userId && SCOPES.includes(scope as UnsubScope) ? { userId, scope: scope as UnsubScope } : null;
}
export function unsubScopeFor(category: Category, kind: string): UnsubScope | null {
  if (category === "ESSENTIAL") return null;
  if (category === "PROMOTIONAL") return "PROMOTIONAL";
  return ALERT_KINDS.has(kind) ? "ALERTS" : "ACTIVITY";
}
