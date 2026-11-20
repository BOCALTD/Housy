import { loadRuntimeEnv } from "../runtime-env";
import { z } from "zod";
import { withPlatformAdmin, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { randomRef } from "../billing-rules";
import { configuredDriver, type EmailDriver } from "../email-drivers";
import { PLATFORM_NAME } from "../labels";
import { BACKOFF_MINUTES, MAX_ATTEMPTS } from "../notification-rules";
import {
  BODY_MAX, DEFAULT_MONTHLY_RECIPIENTS, SENDS_PER_DAY, SUBJECT_MAX, emailIn, normEmail, pickRecipients, readBulkUnsub, renderBulkEmail, sendProblem, signBulkUnsub,
} from "../bulk-rules";
import { entitlementIn } from "./subscriptions";
import { system } from "./rewards";
import { baseUrl } from "./delivery";
import { assertCan, type Ctx } from "./context";

// Bulk messaging: a plan feature ("Bulk messaging"). A company writes one message and it goes by email, one email per person, to
// its clients who agreed to marketing or to the tenants of its current leases (optionally of one property). Everyone gets a link
// to stop messages from that company, and people who used it are never written to again. Sends are limited per day and per month.

const secret = () => process.env.UNSUBSCRIBE_SECRET || process.env.APP_DB_PASSWORD || "development-only-secret";
export const bulkUnsubscribeUrl = (companyId: string, email: string) => `${baseUrl()}/unsubscribe/company?t=${encodeURIComponent(signBulkUnsub(secret(), companyId, email))}`;

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const dayStart = (now: Date) => new Date(now.getTime() - 864e5);

/**
 * Whether the business's plan includes bulk messaging, and its monthly number of recipients: the workspace's own plan, or for an
 * agent working for themselves, the agent's personal plan.
 */
export async function bulkAllowance(companyId: string, now = new Date()): Promise<{ allowed: boolean; monthly: number; planName: string | null; explanation: string }> {
  const own = await withPlatformAdmin("system", (tx) => entitlementIn(tx, { kind: "COMPANY", companyId }, "BULK_MESSAGING", now));
  let e = own;
  if (own.access !== "FULL") {
    const owner = await system(async (tx) => {
      const co = await tx.company.findUnique({ where: { id: companyId }, select: { businessType: true } });
      if (co?.businessType !== "INDEPENDENT_AGENT") return null;
      return (await tx.membership.findFirst({ where: { companyId, role: "COMPANY_SUPER_ADMIN", status: "ACTIVE" }, select: { userId: true } }))?.userId ?? null;
    });
    if (owner) {
      const mine = await withPlatformAdmin("system", (tx) => entitlementIn(tx, { kind: "USER", userId: owner }, "BULK_MESSAGING", now));
      if (mine.access === "FULL") e = mine;
    }
  }
  return { allowed: e.access === "FULL", monthly: e.limit && e.limit > 0 ? e.limit : DEFAULT_MONTHLY_RECIPIENTS, planName: e.planName, explanation: e.explanation };
}

type Audience = "CLIENTS" | "TENANTS";
type Candidate = { email: string | null; name: string; source: "CLIENT" | "TENANT"; sourceId: string };

async function candidates(tx: Tx, companyId: string, audience: Audience, assetId: string | null): Promise<Candidate[]> {
  if (audience === "CLIENTS") {
    const rows = await tx.client.findMany({ where: { companyId, marketingConsent: true, archivedAt: null, mergedIntoId: null }, select: { id: true, name: true, email: true }, orderBy: { createdAt: "asc" }, take: 50_000 });
    return rows.map((c) => ({ email: c.email ? normEmail(c.email) : null, name: c.name, source: "CLIENT", sourceId: c.id }));
  }
  const rows = await tx.lease.findMany({ where: { companyId, status: "ACTIVE", ...(assetId ? { assetId } : {}) }, select: { id: true, occupantName: true, occupantContact: true }, orderBy: { startDate: "asc" }, take: 50_000 });
  return rows.map((l) => ({ email: emailIn(l.occupantContact), name: l.occupantName, source: "TENANT", sourceId: l.id }));
}

async function optedOutSet(tx: Tx, companyId: string) {
  return new Set((await tx.bulkOptOut.findMany({ where: { companyId }, select: { email: true }, take: 100_000 })).map((o) => o.email));
}

const audienceSchema = z.object({
  audience: z.enum(["CLIENTS", "TENANTS"], { message: "Choose who the message goes to" }),
  assetId: z.string().optional().transform((v) => v || null),
});
const sendSchema = audienceSchema.extend({
  subject: z.string().trim().min(3, "Write a subject").max(SUBJECT_MAX, `Keep the subject under ${SUBJECT_MAX} characters`),
  body: z.string().trim().min(10, "Write the message").max(BODY_MAX, `Keep the message under ${BODY_MAX.toLocaleString("en-NG")} characters`),
});

/** How many people a message to this group would reach, and why the rest would not get it. */
export async function previewAudience(ctx: Ctx, raw: z.input<typeof audienceSchema>) {
  assertCan(ctx, "message.bulk");
  const d = audienceSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = pickRecipients(await candidates(tx, ctx.companyId, d.audience, d.assetId), await optedOutSet(tx, ctx.companyId));
    return { recipients: r.send.length, noEmail: r.noEmail, optedOut: r.optedOut };
  });
}

/** The page: what the plan allows, what is used, the groups and past sends. */
export async function bulkOverview(ctx: Ctx, now = new Date()) {
  assertCan(ctx, "message.bulk");
  const allowance = await bulkAllowance(ctx.companyId, now);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [used, sendsToday, history, assets, clients, tenants, optOuts] = await Promise.all([
      tx.bulkRecipient.count({ where: { companyId: ctx.companyId, createdAt: { gte: monthStart(now) }, NOT: { skipReason: "cancelled" } } }),
      tx.bulkMessage.count({ where: { companyId: ctx.companyId, createdAt: { gte: dayStart(now) } } }),
      tx.bulkMessage.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 50 }),
      tx.asset.findMany({ where: { companyId: ctx.companyId, leases: { some: { status: "ACTIVE" } } }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" }, take: 500 }),
      candidates(tx, ctx.companyId, "CLIENTS", null),
      candidates(tx, ctx.companyId, "TENANTS", null),
      optedOutSet(tx, ctx.companyId),
    ]);
    const counts = await tx.bulkRecipient.groupBy({ by: ["bulkId", "status"], where: { bulkId: { in: history.map((h) => h.id) } }, _count: { _all: true } });
    const tally = (id: string) => Object.fromEntries(counts.filter((c) => c.bulkId === id).map((c) => [c.status, c._count._all])) as Partial<Record<"QUEUED" | "SENDING" | "SENT" | "SKIPPED" | "FAILED" | "DEAD", number>>;
    return {
      allowance, used, sendsToday, sendsPerDay: SENDS_PER_DAY, assets, emailConnected: !!configuredDriver(),
      groups: { CLIENTS: pickRecipients(clients, optOuts), TENANTS: pickRecipients(tenants, optOuts) },
      history: history.map((h) => ({ ...h, tally: tally(h.id) })),
    };
  });
}

/** Send a message to a group. It is queued at once and goes out over the next few minutes. */
export async function sendBulk(ctx: Ctx, raw: z.input<typeof sendSchema>, now = new Date()) {
  assertCan(ctx, "message.bulk");
  const d = sendSchema.parse(raw);
  const allowance = await bulkAllowance(ctx.companyId, now);
  if (!allowance.allowed) throw new Error("Bulk messaging is not on your plan. Upgrade to a plan that includes it.");
  const made = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    // One send at a time per company, so two people cannot both use the last of the month's allowance.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bulk:${ctx.companyId}`}))`;
    if (d.assetId && !(await tx.asset.findFirst({ where: { id: d.assetId, companyId: ctx.companyId }, select: { id: true } }))) throw new Error("Choose one of your properties");
    const r = pickRecipients(await candidates(tx, ctx.companyId, d.audience, d.assetId), await optedOutSet(tx, ctx.companyId));
    const used = await tx.bulkRecipient.count({ where: { companyId: ctx.companyId, createdAt: { gte: monthStart(now) }, NOT: { skipReason: "cancelled" } } });
    const sendsToday = await tx.bulkMessage.count({ where: { companyId: ctx.companyId, createdAt: { gte: dayStart(now) } } });
    const problem = sendProblem({ recipients: r.send.length, usedThisMonth: used, monthlyLimit: allowance.monthly, sendsToday });
    if (problem) throw new Error(problem);
    const bulk = await tx.bulkMessage.create({ data: { ref: randomRef("BLK"), companyId: ctx.companyId, audience: d.audience, assetId: d.assetId, subject: d.subject, body: d.body, recipients: r.send.length, createdById: ctx.userId } });
    for (let i = 0; i < r.send.length; i += 1000) {
      await tx.bulkRecipient.createMany({ data: r.send.slice(i, i + 1000).map((c) => ({ bulkId: bulk.id, companyId: ctx.companyId, email: c.email, name: c.name.slice(0, 120), source: c.source, sourceId: c.sourceId })) });
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "bulk_message", entityId: bulk.id, action: "bulk.sent", detail: { ref: bulk.ref, audience: d.audience, recipients: r.send.length, skippedNoEmail: r.noEmail, skippedOptedOut: r.optedOut } });
    return bulk;
  });
  return made;
}

/** Stop a send: emails not yet sent are not sent. */
export async function cancelBulk(ctx: Ctx, bulkId: string) {
  assertCan(ctx, "message.bulk");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const b = await tx.bulkMessage.findFirst({ where: { id: bulkId, companyId: ctx.companyId } });
    if (!b) throw new Error("Message not found");
    if (b.status !== "SENDING") throw new Error("This message has finished sending");
    const stopped = await tx.bulkRecipient.updateMany({ where: { bulkId, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "SKIPPED", skipReason: "cancelled" } });
    await tx.bulkMessage.update({ where: { id: bulkId }, data: { status: "CANCELLED", cancelledAt: new Date(), finishedAt: new Date() } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "bulk_message", entityId: bulkId, action: "bulk.cancelled", detail: { notSent: stopped.count } });
    return stopped.count;
  });
}

/** From the link in an email: stop messages from that company to this address, including any still waiting to go. */
export async function optOutBulk(token: string) {
  const t = readBulkUnsub(secret(), token);
  if (!t) throw new Error("This link is not valid.");
  return system(async (tx) => {
    const co = await tx.company.findUnique({ where: { id: t.companyId }, select: { name: true } });
    if (!co) throw new Error("This link is not valid.");
    await tx.bulkOptOut.upsert({ where: { companyId_email: { companyId: t.companyId, email: t.email } }, create: { companyId: t.companyId, email: t.email }, update: {} });
    await tx.bulkRecipient.updateMany({ where: { companyId: t.companyId, email: t.email, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "SKIPPED", skipReason: "unsubscribed" } });
    return { company: co.name, email: t.email };
  });
}

/** What the unsubscribe page shows before the person confirms. */
export async function readOptOutLink(token: string) {
  const t = readBulkUnsub(secret(), token);
  if (!t) return null;
  const co = await system((tx) => tx.company.findUnique({ where: { id: t.companyId }, select: { name: true } }));
  return co ? { company: co.name, email: t.email } : null;
}

export interface BulkRun { configured: boolean; sent: number; skipped: number; retrying: number; dead: number; waiting: number }

/** Send what is due. Run by the scheduled job with the other emails. With no email provider connected, nothing is sent. */
export async function processBulk(o: { now?: Date; driver?: EmailDriver | null; limit?: number } = {}): Promise<BulkRun> {
  const now = o.now ?? new Date();
  await loadRuntimeEnv();
  const driver = o.driver === undefined ? configuredDriver() : o.driver;
  const due = { status: { in: ["QUEUED", "FAILED"] as ("QUEUED" | "FAILED")[] }, nextAttemptAt: { lte: now } };
  const out: BulkRun = { configured: !!driver, sent: 0, skipped: 0, retrying: 0, dead: 0, waiting: 0 };
  if (!driver) { out.waiting = await system((tx) => tx.bulkRecipient.count({ where: due })); return out; }
  await system((tx) => tx.bulkRecipient.updateMany({ where: { status: "SENDING", nextAttemptAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, data: { status: "QUEUED" } }));
  const items = await system((tx) => tx.bulkRecipient.findMany({ where: due, orderBy: { createdAt: "asc" }, take: o.limit ?? 500, include: { bulk: true } }));
  const companies = new Map<string, { name: string; replyTo: string; closed: boolean }>();
  const touched = new Set<string>();
  for (const it of items) {
    const claimed = await system((tx) => tx.bulkRecipient.updateMany({ where: { id: it.id, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "SENDING", nextAttemptAt: now } }));
    if (!claimed.count) continue;
    touched.add(it.bulkId);
    if (!companies.has(it.companyId)) {
      const c = await system((tx) => tx.company.findUnique({ where: { id: it.companyId }, select: { name: true, contactEmail: true, suspendedAt: true } }));
      companies.set(it.companyId, { name: c?.name ?? "A company", replyTo: c?.contactEmail ?? "", closed: !c || !!c.suspendedAt });
    }
    const co = companies.get(it.companyId)!;
    const opted = await system((tx) => tx.bulkOptOut.findUnique({ where: { companyId_email: { companyId: it.companyId, email: it.email } } }));
    const skip = it.bulk.status === "CANCELLED" ? "cancelled" : opted ? "unsubscribed" : co.closed ? "workspace closed" : "";
    if (skip) { await system((tx) => tx.bulkRecipient.update({ where: { id: it.id }, data: { status: "SKIPPED", skipReason: skip } })); out.skipped++; continue; }
    const unsub = bulkUnsubscribeUrl(it.companyId, it.email);
    const msg = renderBulkEmail({ company: co.name, subject: it.bulk.subject, body: it.bulk.body, recipientName: it.name, audience: it.bulk.audience, unsubscribeUrl: unsub, platform: PLATFORM_NAME, baseUrl: baseUrl() });
    const res = await driver.send({
      to: it.email, ...msg, idempotencyKey: `bulk:${it.id}`, replyTo: /@/.test(co.replyTo) ? co.replyTo : undefined,
      headers: { "List-Unsubscribe": `<${unsub.replace("/unsubscribe/company?", "/api/unsubscribe/company?")}>, <${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", Precedence: "bulk" },
    });
    if (res.ok) { await system((tx) => tx.bulkRecipient.update({ where: { id: it.id }, data: { status: "SENT", sentAt: now, attempts: it.attempts + 1, providerMessageId: res.id.slice(0, 120), lastError: "" } })); out.sent++; continue; }
    const n = it.attempts + 1;
    if (res.permanent || n >= MAX_ATTEMPTS) { await system((tx) => tx.bulkRecipient.update({ where: { id: it.id }, data: { status: "DEAD", attempts: n, lastError: res.error.slice(0, 500) } })); out.dead++; continue; }
    const wait = (BACKOFF_MINUTES[Math.min(n - 1, BACKOFF_MINUTES.length - 1)] ?? 30) * 60_000;
    await system((tx) => tx.bulkRecipient.update({ where: { id: it.id }, data: { status: "FAILED", attempts: n, lastError: res.error.slice(0, 500), nextAttemptAt: new Date(now.getTime() + wait) } }));
    out.retrying++;
  }
  // A message is finished once nothing of it is waiting.
  for (const id of touched) {
    await system(async (tx) => {
      const left = await tx.bulkRecipient.count({ where: { bulkId: id, status: { in: ["QUEUED", "SENDING", "FAILED"] } } });
      if (!left) await tx.bulkMessage.updateMany({ where: { id, status: "SENDING" }, data: { status: "SENT", finishedAt: now } });
    });
  }
  return out;
}

