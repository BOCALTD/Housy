/**
 * Upgrades: what keeps Housy paid for. Free trials people start themselves, promo codes the administrator runs, the cheapest plan
 * that unlocks a feature (for "upgrade" prompts where a feature is locked), and the numbers that show how upgrades are going.
 */
import { z } from "zod";
import { prisma } from "../db";
import { logActivity } from "../audit";
import { normaliseCode } from "../promo-rules";
import { parseMoney, isCurrency } from "../regions";
import { assertMayPay, ownerOf, type Payer } from "./billing";
import { notify } from "./notifications";
import { system } from "./rewards";
import { syncCompanyTier } from "./tiers";
import type { EntitlementKey } from "../subscription-rules";

const keyOf = (p: Payer) => (p.companyId ? `COMPANY:${p.companyId}` : `USER:${p.userId}`);

// ---------- Free trials ----------

/** Plans this payer can still try for free (a trial length set, a price, not tried before). */
export async function trialsAvailable(p: Payer): Promise<Record<string, number>> {
  const audiences = p.companyId ? ["COMPANY"] : ["SEEKER", "AGENT"];
  return system(async (tx) => {
    const plans = await tx.subscriptionPlan.findMany({ where: { active: true, trialDays: { gt: 0 }, priceKobo: { gt: 0 }, billingPeriod: { not: "NONE" }, audience: { in: audiences as ("COMPANY")[] } }, select: { id: true, trialDays: true } });
    if (!plans.length) return {};
    const used = await tx.trialUse.findMany({ where: { ownerKey: keyOf(p) }, select: { planId: true } });
    const sub = await tx.subscription.findFirst({ where: p.companyId ? { ownerCompanyId: p.companyId } : { ownerUserId: p.userId }, include: { plan: { select: { priceKobo: true } } } });
    // Someone already paying for a plan that is still running does not get a trial (they can still upgrade).
    if (sub && sub.status === "ACTIVE" && (sub.plan.priceKobo ?? 0n) > 0n && sub.periodEnd > new Date()) return {};
    const out: Record<string, number> = {};
    for (const pl of plans) if (!used.some((u) => u.planId === pl.id)) out[pl.id] = pl.trialDays;
    return out;
  });
}

/** Start a free trial of a plan: once per person or company per plan. The plan's features switch on straight away. */
export async function startTrial(p: Payer, planId: string, now = new Date()) {
  assertMayPay(p);
  const avail = await trialsAvailable(p);
  const days = avail[planId];
  if (!days) throw new Error("A free trial of this plan is not available to you. You can still choose the plan.");
  const owner = ownerOf(p);
  return system(async (tx) => {
    const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } });
    const endsAt = new Date(now.getTime() + days * 864e5);
    // The unique (owner, plan) row makes a second trial impossible even if two clicks arrive together.
    await tx.trialUse.create({ data: { ownerKey: keyOf(p), planId, endsAt, startedById: p.userId } });
    const existing = await tx.subscription.findFirst({ where: owner.kind === "COMPANY" ? { ownerCompanyId: owner.companyId } : { ownerUserId: owner.userId } });
    let subId: string;
    if (existing) {
      await tx.subscription.update({ where: { id: existing.id }, data: { planId, status: "TRIAL", periodEnd: endsAt, cancelledAt: null } });
      subId = existing.id;
      await tx.subscriptionEvent.create({ data: { subscriptionId: subId, kind: "PLAN_CHANGED", fromPlanId: existing.planId, toPlanId: planId, periodEnd: endsAt, note: `Free trial for ${days} days`, actorId: p.userId } });
    } else {
      const sub = await tx.subscription.create({ data: { ownerKind: owner.kind, ownerUserId: owner.kind === "USER" ? owner.userId : null, ownerCompanyId: owner.kind === "COMPANY" ? owner.companyId : null, planId, status: "TRIAL", periodEnd: endsAt, createdById: p.userId } });
      subId = sub.id;
      await tx.subscriptionEvent.create({ data: { subscriptionId: subId, kind: "ASSIGNED", toPlanId: planId, periodEnd: endsAt, note: `Free trial for ${days} days`, actorId: p.userId } });
    }
    if (owner.kind === "COMPANY") await syncCompanyTier(tx, owner.companyId);
    await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: p.userId, entityType: "subscription", entityId: subId, action: "subscription.trial_started", detail: { plan: plan.code, days } });
    await notify(tx, p.userId, { kind: "billing.trial", title: `Your ${days}-day ${plan.name} trial has started`, body: `Everything in ${plan.name} is on until ${endsAt.toDateString()}. Choose the plan before then to keep it.`, link: p.companyId ? "/app/billing" : "/me/billing" });
    return { plan: plan.name, days, endsAt };
  });
}

// ---------- The cheapest plan that unlocks a feature ----------

/** The cheapest plan (for this kind of account) that includes a feature, for "upgrade to unlock" prompts. */
export async function planFor(feature: EntitlementKey, audience: "COMPANY" | "SEEKER" | "AGENT") {
  const plans = await system((tx) => tx.subscriptionPlan.findMany({ where: { active: true, audience, priceKobo: { gt: 0 }, billingPeriod: { not: "NONE" }, entitlements: { some: { key: feature } } }, orderBy: [{ priceKobo: "asc" }, { sortOrder: "asc" }], take: 1, select: { id: true, name: true, priceKobo: true, billingPeriod: true, trialDays: true } }));
  return plans[0] ?? null;
}

// ---------- Promo codes (platform administrator) ----------

async function adminOnly(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

const promoSchema = z.object({
  code: z.string().trim().min(1, "Enter the code"),
  description: z.string().trim().max(200).default(""),
  kind: z.enum(["percent", "amount"]),
  percentOff: z.string().trim().default(""),
  amountOff: z.string().trim().default(""),
  currency: z.string().trim().default("NGN"),
  planIds: z.array(z.string().uuid()).default([]),
  maxRedemptions: z.string().trim().default(""),
  perOwnerOnce: z.boolean().default(true),
  newCustomersOnly: z.boolean().default(false),
  startsAt: z.string().trim().default(""),
  endsAt: z.string().trim().default(""),
});

export async function savePromoCode(adminId: string, raw: z.input<typeof promoSchema>) {
  await adminOnly(adminId);
  const d = promoSchema.parse(raw);
  const code = normaliseCode(d.code);
  if (code.length < 4) throw new Error("Make the code at least 4 letters or digits, such as WELCOME25");
  let percentOff: number | null = null, amountOffMinor: bigint | null = null;
  if (d.kind === "percent") {
    percentOff = Number(d.percentOff);
    if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) throw new Error("Enter a percentage from 1 to 100");
  } else {
    if (!isCurrency(d.currency)) throw new Error("Choose the currency");
    amountOffMinor = parseMoney(d.amountOff, d.currency);
    if (amountOffMinor <= 0n) throw new Error("Enter the amount the code takes off");
  }
  const max = d.maxRedemptions ? Number(d.maxRedemptions) : null;
  if (max != null && (!Number.isInteger(max) || max < 1 || max > 1_000_000)) throw new Error("Enter how many times it can be used, or leave it empty for no limit");
  const startsAt = d.startsAt ? new Date(`${d.startsAt}T00:00:00+01:00`) : null;
  const endsAt = d.endsAt ? new Date(`${d.endsAt}T23:59:59+01:00`) : null;
  if (startsAt && endsAt && endsAt < startsAt) throw new Error("The end date is before the start date");
  if (endsAt && endsAt < new Date()) throw new Error("The end date has already passed");
  return system(async (tx) => {
    if (await tx.promoCode.findUnique({ where: { code } })) throw new Error(`${code} already exists. Choose another code, or switch the old one off.`);
    const row = await tx.promoCode.create({ data: { code, description: d.description, percentOff, amountOffMinor, currency: d.kind === "amount" ? d.currency : "NGN", planIds: d.planIds, maxRedemptions: max, perOwnerOnce: d.perOwnerOnce, newCustomersOnly: d.newCustomersOnly, startsAt, endsAt, createdById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "promo_code", entityId: row.id, action: "promo.created", detail: { code, percentOff, amountOff: amountOffMinor?.toString() ?? null } });
    return row;
  });
}

export async function setPromoActive(adminId: string, id: string, active: boolean) {
  await adminOnly(adminId);
  await system(async (tx) => {
    await tx.promoCode.update({ where: { id }, data: { active } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "promo_code", entityId: id, action: active ? "promo.on" : "promo.off", detail: {} });
  });
}

export async function promoCodes(adminId: string) {
  await adminOnly(adminId);
  return system(async (tx) => {
    const rows = await tx.promoCode.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    const counts = await tx.promoRedemption.groupBy({ by: ["promoCodeId", "currency"], _count: { _all: true }, _sum: { discountMinor: true } });
    return rows.map((r) => ({ ...r, uses: counts.filter((c) => c.promoCodeId === r.id).reduce((n, c) => n + c._count._all, 0), given: counts.filter((c) => c.promoCodeId === r.id).map((c) => ({ currency: c.currency, minor: c._sum.discountMinor ?? 0n })) }));
  });
}

// ---------- How upgrades are going ----------

/** Paying subscribers by plan, trials running, trials that turned into payments, and plan revenue in the last 30 days. */
export async function upgradeStats(adminId: string, now = new Date()) {
  await adminOnly(adminId);
  const since = new Date(now.getTime() - 30 * 864e5);
  return system(async (tx) => {
    const [subs, trials, trialUses, paid] = await Promise.all([
      tx.subscription.groupBy({ by: ["planId", "status"], where: { periodEnd: { gt: now } }, _count: { _all: true } }),
      tx.subscription.count({ where: { status: "TRIAL", periodEnd: { gt: now } } }),
      tx.trialUse.findMany({ where: { endsAt: { lt: now, gt: new Date(now.getTime() - 90 * 864e5) } }, select: { ownerKey: true, planId: true, endsAt: true } }),
      tx.invoice.groupBy({ by: ["currency"], where: { purpose: "SUBSCRIPTION", status: "PAID", paidAt: { gte: since } }, _sum: { amountKobo: true }, _count: { _all: true } }),
    ]);
    // A finished trial converted if the same owner paid for any plan afterwards.
    let converted = 0;
    for (const t of trialUses) {
      const [kind, id] = t.ownerKey.split(":");
      const n = await tx.invoice.count({ where: { purpose: "SUBSCRIPTION", status: "PAID", paidAt: { gte: new Date(t.endsAt.getTime() - 30 * 864e5) }, ...(kind === "COMPANY" ? { ownerCompanyId: id } : { ownerUserId: id }) } });
      if (n) converted++;
    }
    const plans = await tx.subscriptionPlan.findMany({ select: { id: true, name: true } });
    const name = (id: string) => plans.find((p) => p.id === id)?.name ?? "Plan";
    const byPlan = new Map<string, { plan: string; active: number; trial: number }>();
    for (const s of subs) {
      const row = byPlan.get(s.planId) ?? { plan: name(s.planId), active: 0, trial: 0 };
      if (s.status === "ACTIVE") row.active += s._count._all;
      if (s.status === "TRIAL") row.trial += s._count._all;
      byPlan.set(s.planId, row);
    }
    return { byPlan: [...byPlan.values()].sort((a, b) => b.active - a.active), trials, finishedTrials: trialUses.length, converted, revenue: paid.map((p) => ({ currency: p.currency, minor: p._sum.amountKobo ?? 0n, count: p._count._all })) };
  });
}
