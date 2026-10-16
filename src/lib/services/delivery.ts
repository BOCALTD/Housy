import { z } from "zod";
import { prisma, withUser } from "../db";
import { logActivity } from "../audit";
import { configuredDriver, type EmailDriver } from "../email-drivers";
import { renderEmail, type Layout } from "../email-templates";
import {
  BACKOFF_MINUTES, DEFAULT_PREFS, DIGEST_MAX_ITEMS, MAX_ATTEMPTS, backoff, decide, inQuiet, lagosHour, readUnsub, signUnsub, unsubScopeFor,
  type Category, type PrefView, type UnsubScope,
} from "../notification-rules";
import { system } from "./rewards";

// Email delivery: preferences, the queue, retries and the figures the administrator sees. An email is judged when it is processed:
// security mail always goes; everything else follows the person's choices, quiet hours and daily limit. With no provider
// connected nothing is sent and nothing is marked as sent.

const secret = () => process.env.UNSUBSCRIBE_SECRET || process.env.APP_DB_PASSWORD || "development-only-secret";
export const baseUrl = () => (process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/+$/, "");
export const unsubscribeUrl = (userId: string, scope: UnsubScope) => `${baseUrl()}/unsubscribe?t=${encodeURIComponent(signUnsub(secret(), userId, scope))}`;

async function adminOnly(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

// ---------- Preferences ----------

export async function getPrefs(userId: string) {
  const p = await withUser(userId, (tx) => tx.notificationPref.findUnique({ where: { userId } }));
  return { ...DEFAULT_PREFS, areas: [] as string[], ...(p ? { emailActivity: p.emailActivity, emailAlerts: p.emailAlerts, emailPromotional: p.emailPromotional, digest: p.digest, quietStart: p.quietStart, quietEnd: p.quietEnd, areas: p.areas } : {}) };
}

const hour = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).max(23).nullable());
const prefSchema = z.object({
  emailActivity: z.boolean(), emailAlerts: z.boolean(), emailPromotional: z.boolean(), digest: z.enum(["INSTANT", "DAILY"]),
  quietStart: hour, quietEnd: hour, areas: z.string().default(""),
}).superRefine((d, ctx) => {
  if ((d.quietStart == null) !== (d.quietEnd == null)) ctx.addIssue({ code: "custom", message: "Set both the start and the end of your quiet hours, or neither" });
  else if (d.quietStart != null && d.quietStart === d.quietEnd) ctx.addIssue({ code: "custom", message: "Quiet hours cannot start and end at the same time" });
});

export async function savePrefs(userId: string, raw: z.input<typeof prefSchema>) {
  const d = prefSchema.parse(raw);
  const areas = [...new Set(d.areas.split(/[,\n]/).map((a) => a.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  if (areas.some((a) => a.length > 60)) throw new Error("An area name is too long");
  const data = { emailActivity: d.emailActivity, emailAlerts: d.emailAlerts, emailPromotional: d.emailPromotional, digest: d.digest, quietStart: d.quietStart, quietEnd: d.quietEnd, areas };
  await withUser(userId, (tx) => tx.notificationPref.upsert({ where: { userId }, create: { userId, ...data }, update: data }));
}

/** Apply an unsubscribe link. Returns what was switched off, or null when the link is not valid. */
export async function applyUnsubscribe(token: string) {
  const t = readUnsub(secret(), token);
  if (!t) return null;
  const off = { ACTIVITY: { emailActivity: false }, ALERTS: { emailAlerts: false }, PROMOTIONAL: { emailPromotional: false }, ALL_OPTIONAL: { emailActivity: false, emailAlerts: false, emailPromotional: false } }[t.scope];
  await withUser(t.userId, (tx) => tx.notificationPref.upsert({ where: { userId: t.userId }, create: { userId: t.userId, ...off }, update: off }));
  return t.scope;
}

// ---------- The queue ----------

export interface RunSummary { configured: boolean; waiting: number; sent: number; retrying: number; dead: number; skipped: number; deferred: number; held: number; digests: number }

const layoutFor = (u: { id: string; name: string }, category: Category, kind: string): Layout => {
  const scope = unsubScopeFor(category, kind);
  return { baseUrl: baseUrl(), platform: process.env.NEXT_PUBLIC_PLATFORM_NAME || "The platform", recipientName: u.name.split(/\s+/)[0] || "there", unsubscribeUrl: scope ? unsubscribeUrl(u.id, scope) : null, settingsUrl: `${baseUrl()}/me/notification-settings` };
};

async function log(userId: string | null, kind: string, outcome: string, detail = "") {
  await system((tx) => tx.notificationLog.createMany({ data: [{ userId, kind, outcome, detail: detail.slice(0, 200) }] }));
}

/** Work through the emails that are due. Pass a driver to override the configured one (tests do). */
export async function processOutbox(o: { now?: Date; driver?: EmailDriver | null; limit?: number } = {}): Promise<RunSummary> {
  const now = o.now ?? new Date();
  const driver = o.driver === undefined ? configuredDriver() : o.driver;
  const sum: RunSummary = { configured: !!driver, waiting: 0, sent: 0, retrying: 0, dead: 0, skipped: 0, deferred: 0, held: 0, digests: 0 };
  const dueWhere = { status: { in: ["QUEUED", "FAILED"] as ("QUEUED" | "FAILED")[] }, nextAttemptAt: { lte: now } };
  if (!driver) { sum.waiting = await system((tx) => tx.emailOutbox.count({ where: dueWhere })); return sum; }

  // An email left "sending" by a run that stopped halfway goes back in the queue after 15 minutes.
  await system((tx) => tx.emailOutbox.updateMany({ where: { status: "SENDING", nextAttemptAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, data: { status: "QUEUED" } }));
  const due = await system((tx) => tx.emailOutbox.findMany({ where: dueWhere, orderBy: { createdAt: "asc" }, take: o.limit ?? 200 }));
  for (const item of due) {
    const claimed = await system((tx) => tx.emailOutbox.updateMany({ where: { id: item.id, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "SENDING", nextAttemptAt: now } }));
    if (claimed.count === 0) continue;
    const user = await prisma.user.findUnique({ where: { id: item.userId }, select: { id: true, email: true, name: true } });
    const prefRow = await system((tx) => tx.notificationPref.findUnique({ where: { userId: item.userId } }));
    const pref: PrefView = prefRow ? { emailActivity: prefRow.emailActivity, emailAlerts: prefRow.emailAlerts, emailPromotional: prefRow.emailPromotional, digest: prefRow.digest, quietStart: prefRow.quietStart, quietEnd: prefRow.quietEnd } : DEFAULT_PREFS;
    const sentLast24h = await system((tx) => tx.emailOutbox.count({ where: { userId: item.userId, status: "SENT", category: { not: "ESSENTIAL" }, template: { not: "digest" }, sentAt: { gte: new Date(now.getTime() - 864e5) } } }));
    const d = decide({ kind: item.kind, category: item.category, pref, now, sentLast24h, hasAddress: !!user?.email });
    if (d.action === "SKIP") { await system((tx) => tx.emailOutbox.update({ where: { id: item.id }, data: { status: "SKIPPED", skipReason: d.reason } })); await log(item.userId, item.kind, "SKIPPED", d.reason); sum.skipped++; continue; }
    if (d.action === "DEFER") { await system((tx) => tx.emailOutbox.update({ where: { id: item.id }, data: { status: "QUEUED", nextAttemptAt: d.until } })); await log(item.userId, item.kind, "DEFERRED", "quiet hours"); sum.deferred++; continue; }
    if (d.action === "HOLD") { await system((tx) => tx.emailOutbox.update({ where: { id: item.id }, data: { status: "HELD", skipReason: d.reason } })); await log(item.userId, item.kind, "HELD", d.reason); sum.held++; continue; }

    const msg = renderEmail(item.template, (item.vars ?? {}) as Record<string, unknown>, layoutFor(user!, item.category, item.kind));
    const link = unsubScopeFor(item.category, item.kind);
    const res = await driver.send({
      to: user!.email, ...msg, idempotencyKey: item.id,
      headers: link ? { "List-Unsubscribe": `<${unsubscribeUrl(user!.id, link)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    });
    await settle(item.id, item.userId, item.kind, item.attempts, driver.name, res, now, sum);
  }
  await sendDigests(driver, now, sum);
  return sum;
}

async function settle(id: string, userId: string, kind: string, attempts: number, provider: string, res: Awaited<ReturnType<EmailDriver["send"]>>, now: Date, sum: RunSummary) {
  if (res.ok) {
    await system((tx) => tx.emailOutbox.update({ where: { id }, data: { status: "SENT", sentAt: now, provider, providerMessageId: res.id.slice(0, 120), attempts: attempts + 1, lastError: "" } }));
    await log(userId, kind, "SENT"); sum.sent++; return;
  }
  const n = attempts + 1;
  if (res.permanent || n >= MAX_ATTEMPTS) {
    await system((tx) => tx.emailOutbox.update({ where: { id }, data: { status: "DEAD", attempts: n, lastError: res.error, provider } }));
    await log(userId, kind, "DEAD", res.error); sum.dead++; return;
  }
  await system((tx) => tx.emailOutbox.update({ where: { id }, data: { status: "FAILED", attempts: n, lastError: res.error, provider, nextAttemptAt: new Date(now.getTime() + backoff(n)) } }));
  await log(userId, kind, "RETRY", res.error); sum.retrying++;
}

/** Held emails go out together as one digest, not more than once in 12 hours (24 for people who chose a daily digest). */
async function sendDigests(driver: EmailDriver, now: Date, sum: RunSummary) {
  const people = await system((tx) => tx.emailOutbox.groupBy({ by: ["userId"], where: { status: "HELD" } }));
  for (const { userId } of people) {
    const prefRow = await system((tx) => tx.notificationPref.findUnique({ where: { userId } }));
    if (inQuiet(lagosHour(now), prefRow?.quietStart ?? null, prefRow?.quietEnd ?? null)) continue;
    const gap = (prefRow?.digest === "DAILY" ? 24 : 12) * 3600_000;
    const last = await system((tx) => tx.emailOutbox.findFirst({ where: { userId, template: "digest", status: { in: ["SENT", "FAILED"] } }, orderBy: { createdAt: "desc" } }));
    if (last && now.getTime() - (last.sentAt ?? last.createdAt).getTime() < (last.status === "FAILED" ? 30 * 60_000 : gap)) continue;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
    const items = await system((tx) => tx.emailOutbox.findMany({ where: { userId, status: "HELD" }, orderBy: { createdAt: "asc" }, take: DIGEST_MAX_ITEMS }));
    if (!user || !items.length) continue;
    const digest = await system((tx) => tx.emailOutbox.create({ data: { userId, kind: "digest", category: "ACTIVITY", template: "digest", vars: { items: items.map((i) => ({ title: (i.vars as { title?: string }).title ?? "", body: (i.vars as { body?: string }).body ?? "", link: (i.vars as { link?: string }).link ?? "" })) } as never, dedupeKey: `digest:${userId}:${now.toISOString()}`, status: "SENDING" } }));
    const msg = renderEmail("digest", digest.vars as Record<string, unknown>, layoutFor(user, "ACTIVITY", "digest"));
    const res = await driver.send({ to: user.email, ...msg, idempotencyKey: digest.id, headers: { "List-Unsubscribe": `<${unsubscribeUrl(user.id, "ACTIVITY")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    if (res.ok) {
      await system((tx) => tx.emailOutbox.update({ where: { id: digest.id }, data: { status: "SENT", sentAt: now, provider: driver.name, providerMessageId: res.id.slice(0, 120), attempts: 1 } }));
      await system((tx) => tx.emailOutbox.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { status: "DIGESTED", digestId: digest.id } }));
      await log(userId, "digest", "SENT", `${items.length} items`); sum.digests++;
    } else {
      await system((tx) => tx.emailOutbox.update({ where: { id: digest.id }, data: { status: "FAILED", attempts: 1, lastError: res.error, provider: driver.name } }));
      await log(userId, "digest", "RETRY", res.error);
    }
  }
}

// ---------- Administrator ----------

export async function retryEmails(adminId: string, which: "DEAD" | "FAILED" | string[]) {
  await adminOnly(adminId);
  return system(async (tx) => {
    const where = Array.isArray(which) ? { id: { in: which }, status: { in: ["DEAD", "FAILED"] as ("DEAD" | "FAILED")[] } } : { status: which };
    const r = await tx.emailOutbox.updateMany({ where, data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), lastError: "" } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "email_outbox", entityId: "retry", action: "email.retried", detail: { count: r.count } });
    return r.count;
  });
}

export const FAILURE_PAGE = 10;
export async function failureList(adminId: string, page = 0) {
  await adminOnly(adminId);
  const where = { OR: [{ status: "DEAD" as const }, { status: "FAILED" as const }] };
  return system(async (tx) => {
    const [total, rows] = await Promise.all([tx.emailOutbox.count({ where }), tx.emailOutbox.findMany({ where, orderBy: { createdAt: "desc" }, skip: Math.max(0, page) * FAILURE_PAGE, take: FAILURE_PAGE })]);
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, email: true } });
    return { total, page, pages: Math.max(1, Math.ceil(total / FAILURE_PAGE)), rows: rows.map((r) => ({ ...r, email: users.find((u) => u.id === r.userId)?.email ?? "" })) };
  });
}

export async function deliveryStats(adminId: string, days = 7, now = new Date()) {
  await adminOnly(adminId);
  const since = new Date(now.getTime() - days * 864e5);
  return system(async (tx) => {
    const [byStatus, byCategory, byTemplate, outcomes, sentRows] = await Promise.all([
      tx.emailOutbox.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
      tx.emailOutbox.groupBy({ by: ["category", "status"], where: { createdAt: { gte: since } }, _count: true }),
      tx.emailOutbox.groupBy({ by: ["template"], where: { createdAt: { gte: since } }, _count: true }),
      tx.notificationLog.groupBy({ by: ["outcome"], where: { createdAt: { gte: since } }, _count: true }),
      tx.emailOutbox.findMany({ where: { status: "SENT", sentAt: { gte: since } }, select: { sentAt: true }, take: 5000 }),
    ]);
    const perDay = new Map<string, number>();
    for (const r of sentRows) { const k = r.sentAt!.toISOString().slice(0, 10); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
    const n = (rows: { status: string; _count: number }[], s: string) => rows.find((r) => r.status === s)?._count ?? 0;
    const total = byStatus.reduce((a, r) => a + r._count, 0), sent = n(byStatus, "SENT"), dead = n(byStatus, "DEAD");
    return {
      days, total, sent, dead, retrying: n(byStatus, "FAILED"), waiting: n(byStatus, "QUEUED"), held: n(byStatus, "HELD"), skipped: n(byStatus, "SKIPPED"), digested: n(byStatus, "DIGESTED"),
      successRate: sent + dead > 0 ? sent / (sent + dead) : null,
      byCategory: byCategory.map((r) => ({ category: r.category, status: r.status, count: r._count })),
      byTemplate: byTemplate.map((r) => ({ template: r.template, count: r._count })).sort((a, b) => b.count - a.count),
      outcomes: Object.fromEntries(outcomes.map((r) => [r.outcome, r._count])) as Record<string, number>,
      perDay: [...perDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, count]) => ({ day, count })),
      configured: !!configuredDriver(),
      backoff: BACKOFF_MINUTES,
    };
  });
}
