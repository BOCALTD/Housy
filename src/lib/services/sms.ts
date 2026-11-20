import { toDateOnlyString, todayInLagos as lagosToday } from "../dates";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma, withPlatformAdmin, type Tx } from "../db";
import { logActivity } from "../audit";
import { openSecret, sealSecret } from "../totp";
import { toE164 } from "../phone-rules";
import { BACKOFF_MINUTES, MAX_ATTEMPTS, inQuiet, lagosHour } from "../notification-rules";
import { system } from "./rewards";

// Text messages. The platform administrator connects one provider in Admin, Settings, Text messages: Termii (built for Nigeria
// and Africa) or Twilio (worldwide). Messages are queued and sent by the scheduled job with the email, retried on temporary
// failures, and never sent during the person's quiet hours. Who gets texts:
//  - people who turned on "Text me important notices" (security, inspections, review requests, plan renewals) and have a phone;
//  - a client a company chooses to text a review link to (the company presses the button; nothing is sent automatically).
// Without a provider nothing is sent and nothing is marked as sent: messages wait, and the admin page says so.

export const SMS_PROVIDERS = ["none", "termii", "twilio"] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];
export const SMS_PROVIDER_LABELS: Record<SmsProvider, string> = { none: "Off", termii: "Termii (Nigeria and Africa)", twilio: "Twilio (worldwide)" };
/** Notices worth a text message, for people who turned SMS on. */
export const SMS_KINDS = ["security.", "inspection.confirmed", "inspection.cancelled", "inspection.reminder", "review.request", "billing.failed", "billing.renewal"] as const;
export const smsWorthy = (kind: string) => SMS_KINDS.some((k) => (k.endsWith(".") ? kind.startsWith(k) : kind === k));
export const SMS_MAX = 320;

const K = { provider: "sms_provider", termiiKey: "sms_termii_key", termiiSender: "sms_termii_sender", twilioSid: "sms_twilio_sid", twilioToken: "sms_twilio_token", twilioFrom: "sms_twilio_from" } as const;
const open = (v?: string) => { if (!v) return ""; try { return openSecret(v); } catch { return ""; } };

export type SmsConfig = { provider: SmsProvider; termii: { key: string; sender: string }; twilio: { sid: string; token: string; from: string } };

export async function smsConfig(): Promise<SmsConfig> {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: Object.values(K) } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const provider = (SMS_PROVIDERS as readonly string[]).includes(v(K.provider)) ? (v(K.provider) as SmsProvider) : "none";
  return { provider, termii: { key: open(v(K.termiiKey)), sender: v(K.termiiSender) }, twilio: { sid: v(K.twilioSid), token: open(v(K.twilioToken)), from: v(K.twilioFrom) } };
}

/** For the settings page: never a whole secret. */
export async function smsConfigForAdmin() {
  const c = await smsConfig();
  const tail = (s: string) => (s ? `…${s.slice(-4)}` : "");
  return { provider: c.provider, termiiSender: c.termii.sender, termiiKeyTail: tail(c.termii.key), twilioSid: c.twilio.sid, twilioFrom: c.twilio.from, twilioTokenTail: tail(c.twilio.token) };
}

const schema = z.object({
  provider: z.enum(SMS_PROVIDERS),
  termiiKey: z.string().trim().max(200).default(""),
  termiiSender: z.string().trim().max(11).default(""),
  twilioSid: z.string().trim().max(64).default(""),
  twilioToken: z.string().trim().max(128).default(""),
  twilioFrom: z.string().trim().max(40).default(""),
});

/** Save the text message provider. Empty secret fields keep the saved ones. */
export async function saveSmsConfig(adminId: string, raw: z.input<typeof schema>) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  const d = schema.parse(raw);
  const cur = await smsConfig();
  if (d.provider === "termii") {
    if (!d.termiiKey && !cur.termii.key) throw new Error("Enter the Termii API key (Termii dashboard, API Settings).");
    if (!/^[A-Za-z0-9 ]{3,11}$/.test(d.termiiSender)) throw new Error("Enter the sender ID approved in your Termii account (3 to 11 letters or numbers).");
  }
  if (d.provider === "twilio") {
    if (!/^AC[0-9a-f]{32}$/.test(d.twilioSid)) throw new Error("Enter the Twilio Account SID (starts with AC, from the Twilio console).");
    if (!d.twilioToken && !cur.twilio.token) throw new Error("Enter the Twilio auth token.");
    if (!/^(\+[1-9]\d{6,14}|MG[0-9a-f]{32})$/.test(d.twilioFrom)) throw new Error("Enter the Twilio phone number to send from (+ and digits) or a Messaging Service SID (starts with MG).");
  }
  const entries: [string, string][] = [[K.provider, d.provider], [K.termiiSender, d.termiiSender], [K.twilioSid, d.twilioSid], [K.twilioFrom, d.twilioFrom]];
  if (d.termiiKey) entries.push([K.termiiKey, sealSecret(d.termiiKey)]);
  if (d.twilioToken) entries.push([K.twilioToken, sealSecret(d.twilioToken)]);
  await withPlatformAdmin(adminId, async (tx) => {
    for (const [key, value] of entries) await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "sms", action: "settings.sms", detail: { provider: d.provider } });
  });
}

// ---------- Drivers ----------

export type SmsResult = { ok: true; id: string } | { ok: false; permanent: boolean; error: string };
export interface SmsDriver { name: string; send(to: string, body: string): Promise<SmsResult> }

export function termiiDriver(key: string, sender: string, fetcher: typeof fetch = fetch): SmsDriver {
  return {
    name: "termii",
    async send(to, body) {
      try {
        const r = await fetcher("https://api.ng.termii.com/api/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key, to: to.replace(/^\+/, ""), from: sender, sms: body, type: "plain", channel: "generic" }) });
        const j = (await r.json().catch(() => ({}))) as { message_id?: string; message?: string; code?: string };
        if (r.ok && (j.message_id || j.code === "ok")) return { ok: true, id: String(j.message_id ?? "") };
        return { ok: false, permanent: r.status === 400 || r.status === 401 || r.status === 403, error: `${r.status} ${j.message ?? ""}`.trim() };
      } catch (e) { return { ok: false, permanent: false, error: String(e).slice(0, 200) }; }
    },
  };
}

export function twilioDriver(sid: string, token: string, from: string, fetcher: typeof fetch = fetch): SmsDriver {
  return {
    name: "twilio",
    async send(to, body) {
      try {
        const form = new URLSearchParams({ To: to, Body: body, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
        const r = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
        const j = (await r.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
        if (r.ok && j.sid) return { ok: true, id: j.sid };
        // 21211 invalid number, 21610 unsubscribed, 21614 not a mobile: no point retrying.
        return { ok: false, permanent: r.status === 400 || r.status === 401 || [21211, 21610, 21614].includes(Number(j.code)), error: `${r.status} ${j.message ?? ""}`.trim() };
      } catch (e) { return { ok: false, permanent: false, error: String(e).slice(0, 200) }; }
    },
  };
}

export async function configuredSmsDriver(): Promise<SmsDriver | null> {
  const c = await smsConfig();
  if (c.provider === "termii" && c.termii.key && c.termii.sender) return termiiDriver(c.termii.key, c.termii.sender);
  if (c.provider === "twilio" && c.twilio.sid && c.twilio.token && c.twilio.from) return twilioDriver(c.twilio.sid, c.twilio.token, c.twilio.from);
  return null;
}

// ---------- Queue ----------

const dedupe = (parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");

/**
 * Queue a text for an important notice, in the same transaction as the notice. Whether the person turned SMS on, and their phone
 * number, are checked when it is sent (they may change their mind). The same notice to the same person on the same day goes once.
 */
export async function queueSmsForUser(tx: Pick<Tx, "smsOutbox">, userId: string, kind: string, text: string, ref = "") {
  if (!smsWorthy(kind)) return false;
  const day = toDateOnlyString(lagosToday());
  const r = await tx.smsOutbox.createMany({ data: [{ userId, toPhone: "", body: text.slice(0, SMS_MAX), kind, dedupeKey: dedupe([userId, kind, ref, day]) }], skipDuplicates: true });
  return r.count === 1;
}

/** Queue a text a company chose to send to one of its clients (a review link). */
export async function queueSmsForClient(o: { companyId: string; phone: string; country?: string; kind: string; text: string; ref: string }) {
  const to = toE164(o.phone, o.country || "NG");
  if (!to) throw new Error("That phone number does not look right. Check it on the client's record, with the country code if it is not Nigerian.");
  return system((tx) => tx.smsOutbox.createMany({ data: [{ companyId: o.companyId, toPhone: to, body: o.text.slice(0, SMS_MAX), kind: o.kind, dedupeKey: dedupe([o.companyId, o.kind, o.ref, to]) }], skipDuplicates: true })).then((r) => r.count === 1);
}

export type SmsRun = { configured: boolean; sent: number; retrying: number; dead: number; held: number; waiting: number };

/** Send what is due. Quiet hours (the person's own) hold a text until they end. */
export async function processSms(o: { now?: Date; driver?: SmsDriver | null; limit?: number } = {}): Promise<SmsRun> {
  const now = o.now ?? new Date();
  const driver = o.driver === undefined ? await configuredSmsDriver() : o.driver;
  const due = { status: { in: ["QUEUED", "FAILED"] as ("QUEUED" | "FAILED")[] }, nextAttemptAt: { lte: now } };
  const out: SmsRun = { configured: !!driver, sent: 0, retrying: 0, dead: 0, held: 0, waiting: 0 };
  // A text that could not go out within two days is no longer useful (a reminder for a visit that has passed).
  await system((tx) => tx.smsOutbox.updateMany({ where: { status: { in: ["QUEUED", "FAILED"] }, createdAt: { lt: new Date(now.getTime() - 2 * 864e5) } }, data: { status: "SKIPPED", skipReason: "too old to send" } }));
  // Phone numbers are not kept longer than needed: finished texts go after 90 days.
  await system((tx) => tx.smsOutbox.deleteMany({ where: { status: { in: ["SENT", "SKIPPED", "DEAD"] }, createdAt: { lt: new Date(now.getTime() - 90 * 864e5) } } }));
  if (!driver) { out.waiting = await system((tx) => tx.smsOutbox.count({ where: due })); return out; }
  const items = await system((tx) => tx.smsOutbox.findMany({ where: due, orderBy: { createdAt: "asc" }, take: o.limit ?? 200 }));
  for (const it of items) {
    let to = it.toPhone;
    if (it.userId) {
      const [p, u] = await system((tx) => Promise.all([tx.notificationPref.findUnique({ where: { userId: it.userId! } }), tx.user.findUnique({ where: { id: it.userId! }, select: { timeZone: true, phone: true, country: true } })]));
      if (!p?.smsImportant) { await system((tx) => tx.smsOutbox.update({ where: { id: it.id }, data: { status: "SKIPPED", skipReason: "SMS turned off" } })); continue; }
      to = u?.phone ? toE164(u.phone, u.country || "NG") ?? "" : "";
      if (!to) { await system((tx) => tx.smsOutbox.update({ where: { id: it.id }, data: { status: "SKIPPED", skipReason: "no phone number" } })); continue; }
      if (!it.kind.startsWith("security.") && inQuiet(lagosHour(now, u?.timeZone || undefined), p.quietStart, p.quietEnd)) {
        await system((tx) => tx.smsOutbox.update({ where: { id: it.id }, data: { nextAttemptAt: new Date(now.getTime() + 30 * 60_000) } }));
        out.held++; continue;
      }
    }
    const claimed = await system((tx) => tx.smsOutbox.updateMany({ where: { id: it.id, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "SENDING", toPhone: to } }));
    if (!claimed.count) continue;
    const r = await driver.send(to, it.body);
    const n = it.attempts + 1;
    if (r.ok) { await system((tx) => tx.smsOutbox.update({ where: { id: it.id }, data: { status: "SENT", sentAt: now, attempts: n, provider: driver.name, providerMessageId: r.id.slice(0, 120), lastError: "" } })); out.sent++; continue; }
    if (r.permanent || n >= MAX_ATTEMPTS) { await system((tx) => tx.smsOutbox.update({ where: { id: it.id }, data: { status: "DEAD", attempts: n, provider: driver.name, lastError: r.error.slice(0, 500) } })); out.dead++; continue; }
    const wait = (BACKOFF_MINUTES[Math.min(n - 1, BACKOFF_MINUTES.length - 1)] ?? 30) * 60_000;
    await system((tx) => tx.smsOutbox.update({ where: { id: it.id }, data: { status: "FAILED", attempts: n, provider: driver.name, lastError: r.error.slice(0, 500), nextAttemptAt: new Date(now.getTime() + wait) } }));
    out.retrying++;
  }
  return out;
}

/** For the admin page: what is waiting, sent and failed in the last day. */
export async function smsSummary(now = new Date()) {
  const since = new Date(now.getTime() - 864e5);
  return system(async (tx) => {
    const [waiting, sent, dead] = await Promise.all([
      tx.smsOutbox.count({ where: { status: { in: ["QUEUED", "FAILED"] } } }),
      tx.smsOutbox.count({ where: { status: "SENT", sentAt: { gte: since } } }),
      tx.smsOutbox.count({ where: { status: "DEAD", createdAt: { gte: since } } }),
    ]);
    return { waiting, sent, dead };
  });
}
