import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withPlatformAdmin, withUser, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly } from "../dates";
import { parseNairaToKobo } from "../money";
import { ENTITLEMENT_KEYS, accessFor, explainState, nextChange, subscriptionState, type Access, type EntitlementKey, type SubscriptionState } from "../subscription-rules";

export type Owner = { kind: "USER"; userId: string } | { kind: "COMPANY"; companyId: string };

async function assertPlatformAdmin(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

// ---------- Reading what someone holds ----------

export interface Entitlement {
  key: EntitlementKey;
  /** What the person can do with it now: use it fully, only look, or not at all. */
  access: Access;
  state: SubscriptionState;
  limit: number | null;
  planName: string | null;
  periodEnd: Date | null;
  explanation: string;
}

const whereOwner = (o: Owner): Prisma.SubscriptionWhereInput => (o.kind === "USER" ? { ownerUserId: o.userId } : { ownerCompanyId: o.companyId });

/**
 * What a subscription lets its owner do with one feature. Runs inside the caller's transaction. A plan that does not include the
 * feature, or no subscription at all, means no access. A subscription never widens what anyone may see; it only switches a feature on.
 */
export async function entitlementIn(tx: Tx, owner: Owner, key: EntitlementKey, now: Date = new Date()): Promise<Entitlement> {
  const sub = await tx.subscription.findFirst({ where: whereOwner(owner), include: { plan: { include: { entitlements: true } } } });
  const subject = owner.kind === "USER" ? "Your subscription" : "The company's subscription";
  if (!sub) return { key, access: "NONE", state: "NONE", limit: null, planName: null, periodEnd: null, explanation: explainState("NONE", subject) };
  const state = subscriptionState(sub, sub.plan, now);
  const e = sub.plan.entitlements.find((x) => x.key === key);
  const base = { key, state, planName: sub.plan.name, periodEnd: sub.periodEnd };
  if (!e) return { ...base, access: "NONE", limit: null, explanation: `The ${sub.plan.name} plan does not include this feature.` };
  return { ...base, access: accessFor(state), limit: e.limit, explanation: explainState(state, `${subject} (${sub.plan.name})`) };
}

/** A person's own subscription with its history and what will happen to access, in plain words. */
export async function mySubscription(userId: string) {
  return withUser(userId, async (tx) => describe(tx, { kind: "USER", userId }));
}
export async function companySubscription(companyId: string, userId: string) {
  return withTenant(companyId, userId, async (tx) => describe(tx, { kind: "COMPANY", companyId }));
}

async function describe(tx: Tx, owner: Owner) {
  const now = new Date();
  const sub = await tx.subscription.findFirst({ where: whereOwner(owner), include: { plan: { include: { entitlements: true } }, events: { orderBy: { createdAt: "desc" }, take: 30 } } });
  const subject = owner.kind === "USER" ? "Your subscription" : "The company's subscription";
  if (!sub) return { sub: null, state: "NONE" as SubscriptionState, explanation: explainState("NONE", subject), next: null, features: [] as { key: EntitlementKey; limit: number | null }[] };
  const state = subscriptionState(sub, sub.plan, now);
  const next = nextChange(sub, sub.plan, now);
  return {
    sub, state, next,
    explanation: explainState(state, `${subject} (${sub.plan.name})`),
    features: sub.plan.entitlements.filter((e) => (ENTITLEMENT_KEYS as readonly string[]).includes(e.key)).map((e) => ({ key: e.key as EntitlementKey, limit: e.limit })),
  };
}

// ---------- Platform administration ----------

const planSchema = z.object({
  code: z.string().trim().toLowerCase().optional(),
  name: z.string().trim().min(2, "Name the plan").max(80),
  audience: z.enum(["SEEKER", "AGENT", "COMPANY"]),
  price: z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null)),
  billingPeriod: z.enum(["NONE", "MONTHLY", "QUARTERLY", "YEARLY"]),
  trialDays: z.coerce.number().int().min(0).max(365).default(0),
  graceDays: z.coerce.number().int().min(0).max(365).default(7),
  readOnlyDays: z.coerce.number().int().min(0).max(730).default(30),
  active: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(100),
});

export async function listPlans(adminId: string) {
  await assertPlatformAdmin(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const plans = await tx.subscriptionPlan.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { entitlements: true, _count: { select: { subscriptions: true } } } });
    return plans;
  });
}

export async function savePlan(adminId: string, id: string | null, raw: z.input<typeof planSchema>) {
  await assertPlatformAdmin(adminId);
  const d = planSchema.parse(raw);
  return withPlatformAdmin(adminId, async (tx) => {
    const data = { name: d.name, audience: d.audience, priceKobo: d.price, billingPeriod: d.billingPeriod, trialDays: d.trialDays, graceDays: d.graceDays, readOnlyDays: d.readOnlyDays, active: d.active, sortOrder: d.sortOrder };
    if (id) {
      const existing = await tx.subscriptionPlan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true } } } });
      if (!existing) throw new Error("Plan not found");
      if (existing.audience !== d.audience && existing._count.subscriptions > 0) throw new Error("This plan has subscribers, so who it is for cannot change");
      const plan = await tx.subscriptionPlan.update({ where: { id }, data });
      await logActivity(tx, { companyId: null, actorId: adminId, entityType: "plan", entityId: id, action: "plan.updated", detail: { name: d.name } });
      return plan;
    }
    if (!d.code || !/^[a-z0-9-]{3,40}$/.test(d.code)) throw new Error("Use 3 to 40 letters, numbers or hyphens for the plan code");
    if (await tx.subscriptionPlan.findUnique({ where: { code: d.code } })) throw new Error("A plan with that code already exists");
    const plan = await tx.subscriptionPlan.create({ data: { ...data, code: d.code } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "plan", entityId: plan.id, action: "plan.created", detail: { name: d.name } });
    return plan;
  });
}

/** Set which features a plan includes, and how many (where a feature is counted). */
export async function setPlanEntitlements(adminId: string, planId: string, entries: { key: string; enabled: boolean; limit?: string | number | null }[]) {
  await assertPlatformAdmin(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const plan = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error("Plan not found");
    for (const e of entries) {
      if (!(ENTITLEMENT_KEYS as readonly string[]).includes(e.key)) throw new Error(`Unknown feature ${e.key}`);
      const limitRaw = e.limit === undefined || e.limit === null || e.limit === "" ? null : Number(e.limit);
      if (limitRaw !== null && (!Number.isInteger(limitRaw) || limitRaw < 0)) throw new Error("A limit is a whole number, or empty for no limit");
      if (e.enabled) {
        await tx.planEntitlement.upsert({ where: { planId_key: { planId, key: e.key } }, create: { planId, key: e.key, limit: limitRaw }, update: { limit: limitRaw } });
      } else {
        await tx.planEntitlement.deleteMany({ where: { planId, key: e.key } });
      }
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "plan", entityId: planId, action: "plan.entitlements", detail: { entries } });
  });
}

const endOfDay = (dateOnly: string) => new Date(parseDateOnly(dateOnly).getTime() + 864e5 - 1);

export interface AssignInput { planId: string; periodEnd: string; trial?: boolean; note?: string; email?: string; companyId?: string }

/** Give a person or a company a plan, or move them to another one, until the end of a day. Payment is recorded by hand for now. */
export async function assignSubscription(adminId: string, input: AssignInput) {
  await assertPlatformAdmin(adminId);
  const periodEnd = endOfDay(input.periodEnd);
  if (periodEnd.getTime() <= Date.now()) throw new Error("Choose an end date in the future");
  const note = (input.note ?? "").trim().slice(0, 300);
  return withPlatformAdmin(adminId, async (tx) => {
    const plan = await tx.subscriptionPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new Error("Plan not found");
    if (!plan.active) throw new Error("That plan is not active");
    let owner: Owner;
    if (input.companyId) {
      if (plan.audience !== "COMPANY") throw new Error("This plan is for individuals, not companies");
      owner = { kind: "COMPANY", companyId: input.companyId };
      if (!(await tx.company.findUnique({ where: { id: input.companyId } }))) throw new Error("Company not found");
    } else {
      if (plan.audience === "COMPANY") throw new Error("This plan is for companies, not individuals");
      const email = (input.email ?? "").trim().toLowerCase();
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) throw new Error("No account has that email address");
      owner = { kind: "USER", userId: user.id };
    }
    const existing = await tx.subscription.findFirst({ where: whereOwner(owner) });
    const status = input.trial ? "TRIAL" : "ACTIVE";
    const ownerData = owner.kind === "USER" ? { ownerKind: "USER" as const, ownerUserId: owner.userId } : { ownerKind: "COMPANY" as const, ownerCompanyId: owner.companyId };
    let sub;
    if (existing) {
      sub = await tx.subscription.update({ where: { id: existing.id }, data: { planId: plan.id, status, periodEnd, cancelledAt: null } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, kind: "PLAN_CHANGED", fromPlanId: existing.planId, toPlanId: plan.id, periodEnd, note, actorId: adminId } });
    } else {
      sub = await tx.subscription.create({ data: { ...ownerData, planId: plan.id, status, periodEnd, createdById: adminId } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, kind: "ASSIGNED", toPlanId: plan.id, periodEnd, note, actorId: adminId } });
    }
    await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: adminId, entityType: "subscription", entityId: sub.id, action: existing ? "subscription.plan_changed" : "subscription.assigned", detail: { plan: plan.code, periodEnd: periodEnd.toISOString() } });
    return sub;
  });
}

export async function renewSubscription(adminId: string, subscriptionId: string, newEnd: string, noteInput = "") {
  await assertPlatformAdmin(adminId);
  const periodEnd = endOfDay(newEnd);
  if (periodEnd.getTime() <= Date.now()) throw new Error("Choose an end date in the future");
  return withPlatformAdmin(adminId, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new Error("Subscription not found");
    if (periodEnd.getTime() <= sub.periodEnd.getTime()) throw new Error("The new end date must be later than the current one");
    await tx.subscription.update({ where: { id: sub.id }, data: { periodEnd, status: "ACTIVE", cancelledAt: null } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, kind: "RENEWED", fromPlanId: sub.planId, toPlanId: sub.planId, periodEnd, note: noteInput.trim().slice(0, 300), actorId: adminId } });
    await logActivity(tx, { companyId: sub.ownerCompanyId, actorId: adminId, entityType: "subscription", entityId: sub.id, action: "subscription.renewed", detail: { periodEnd: periodEnd.toISOString() } });
  });
}

/** Stop a subscription at the end of the period already paid for. */
export async function cancelSubscription(adminId: string, subscriptionId: string, noteInput = "") {
  await assertPlatformAdmin(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new Error("Subscription not found");
    if (sub.status === "CANCELLED") throw new Error("This subscription is already cancelled");
    await tx.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, kind: "CANCELLED", fromPlanId: sub.planId, toPlanId: sub.planId, periodEnd: sub.periodEnd, note: noteInput.trim().slice(0, 300), actorId: adminId } });
    await logActivity(tx, { companyId: sub.ownerCompanyId, actorId: adminId, entityType: "subscription", entityId: sub.id, action: "subscription.cancelled", detail: {} });
  });
}

export async function listSubscriptions(adminId: string, limit = 200) {
  await assertPlatformAdmin(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const subs = await tx.subscription.findMany({ orderBy: { periodEnd: "asc" }, take: limit, include: { plan: true } });
    const users = await tx.user.findMany({ where: { id: { in: subs.map((s) => s.ownerUserId).filter((x): x is string => !!x) } }, select: { id: true, email: true, name: true } });
    const companies = await tx.company.findMany({ where: { id: { in: subs.map((s) => s.ownerCompanyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const now = new Date();
    return subs.map((s) => ({
      ...s,
      state: subscriptionState(s, s.plan, now),
      ownerName: s.ownerUserId ? (users.find((u) => u.id === s.ownerUserId)?.email ?? "") : (companies.find((c) => c.id === s.ownerCompanyId)?.name ?? ""),
    }));
  });
}

export async function companyChoices(adminId: string) {
  await assertPlatformAdmin(adminId);
  return withPlatformAdmin(adminId, (tx) => tx.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }));
}
