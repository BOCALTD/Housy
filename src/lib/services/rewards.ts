import { z } from "zod";

/** A whole number that may arrive as text from a form. */
const int = (min: number, max: number, minMessage?: string) => z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number({ invalid_type_error: "Enter a whole number" }).int("Enter a whole number").min(min, minMessage).max(max));
import { Prisma } from "@prisma/client";
import { prisma, withPlatformAdmin, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo, formatKobo } from "../money";
import { randomRef } from "../tokens";
import {
  addDays, monthBounds, monthKey, payableAt as holdEnd, rewardMoveProblem, type RewardStatusName,
} from "../reward-rules";
import { notify } from "./notifications";

// The reward engine shared by the referral and vacancy programmes. Every reward has one source, one policy version, one status,
// and a ledger of everything that ever happened to it. Only the engine and platform administrators write; a person reads their own.

export const SYSTEM = "system";
/** The engine's own context. Used only by code in this module and the programme modules, never with anything a visitor typed. */
export const system = <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(SYSTEM, fn);

async function adminOnly(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true, name: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  return u;
}
const adminName = async (tx: Tx, id: string | null) => (id && id !== SYSTEM ? (await tx.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "Administrator" : "Platform");

export const PROGRAMME_EVENTS = {
  REFERRAL: ["REFERRAL_REGISTERED", "REFERRAL_LISTING_PUBLISHED", "REFERRAL_SUBSCRIBED", "REFERRAL_CUSTOM"],
  VACANCY: ["VACANCY_VERIFIED", "VACANCY_LISTED", "VACANCY_TRANSACTION"],
} as const;
export const EVENT_LABELS: Record<string, string> = {
  REFERRAL_REGISTERED: "The person you referred signs up",
  REFERRAL_LISTING_PUBLISHED: "The company you referred has a listing approved and published",
  REFERRAL_SUBSCRIBED: "The person or company you referred starts a paid plan",
  REFERRAL_CUSTOM: "Another event the platform records",
  VACANCY_VERIFIED: "Your vacancy report is verified",
  VACANCY_LISTED: "The vacancy becomes an authorised, published listing",
  VACANCY_TRANSACTION: "A transaction on the vacancy is completed",
};

// ---------- Settings ----------

const SETTING_KEYS = { payoutThresholdKobo: "reward_payout_threshold_kobo", referralBurstPerDay: "referral_burst_per_day", vacancyReportsPerDay: "vacancy_reports_per_day", vacancyRejectFlag: "vacancy_reject_flag", duplicateRadiusM: "vacancy_duplicate_radius_m", duplicateWindowDays: "vacancy_duplicate_window_days" } as const;
export const REWARD_SETTING_DEFAULTS = { payoutThresholdKobo: 500_000, referralBurstPerDay: 10, vacancyReportsPerDay: 5, vacancyRejectFlag: 3, duplicateRadiusM: 50, duplicateWindowDays: 365 };
export type RewardSettings = typeof REWARD_SETTING_DEFAULTS;

export async function readRewardSettings(): Promise<RewardSettings> {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: Object.values(SETTING_KEYS) } } });
  const out = { ...REWARD_SETTING_DEFAULTS };
  for (const [name, key] of Object.entries(SETTING_KEYS)) {
    const v = rows.find((r) => r.key === key)?.value;
    if (v !== undefined && Number.isFinite(Number(v))) (out as Record<string, number>)[name] = Number(v);
  }
  return out;
}
const settingsSchema = z.object({
  payoutThreshold: z.string().trim().min(1, "Enter the smallest payout, in naira. Use 0 for none."),
  referralBurstPerDay: int(1, 1000),
  vacancyReportsPerDay: int(1, 200),
  vacancyRejectFlag: int(1, 50),
  duplicateRadiusM: int(5, 2000),
  duplicateWindowDays: int(1, 3650),
});
export async function saveRewardSettings(adminId: string, raw: z.input<typeof settingsSchema>) {
  await adminOnly(adminId);
  const d = settingsSchema.parse(raw);
  const kobo = d.payoutThreshold === "0" ? 0n : parseNairaToKobo(d.payoutThreshold);
  const entries: [string, string][] = [
    [SETTING_KEYS.payoutThresholdKobo, kobo.toString()], [SETTING_KEYS.referralBurstPerDay, String(d.referralBurstPerDay)], [SETTING_KEYS.vacancyReportsPerDay, String(d.vacancyReportsPerDay)],
    [SETTING_KEYS.vacancyRejectFlag, String(d.vacancyRejectFlag)], [SETTING_KEYS.duplicateRadiusM, String(d.duplicateRadiusM)], [SETTING_KEYS.duplicateWindowDays, String(d.duplicateWindowDays)],
  ];
  await withPlatformAdmin(adminId, async (tx) => {
    for (const [key, value] of entries) await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "rewards", action: "settings.rewards_updated", detail: Object.fromEntries(entries) });
  });
}

// ---------- Policies (versioned) ----------

const policySchema = z.object({
  programme: z.enum(["REFERRAL", "VACANCY"]),
  event: z.enum(["REFERRAL_REGISTERED", "REFERRAL_LISTING_PUBLISHED", "REFERRAL_SUBSCRIBED", "REFERRAL_CUSTOM", "VACANCY_VERIFIED", "VACANCY_LISTED", "VACANCY_TRANSACTION"]),
  campaignId: z.string().trim().optional().transform((v) => v || null),
  name: z.string().trim().min(3, "Name the reward").max(120),
  amount: z.string().trim().min(1, "Enter the reward amount in naira"),
  holdDays: int(0, 365, "Use 0 or more days"),
  perPersonLimit: z.string().trim().optional().transform((v) => (v ? Number.parseInt(v, 10) : null)),
  terms: z.string().trim().max(2000).default(""),
});
export type PolicyInput = z.input<typeof policySchema>;

/** Set the reward for an event. The earlier version is retired, never edited, so every reward keeps the terms it was earned under. */
export async function savePolicy(adminId: string, raw: PolicyInput) {
  await adminOnly(adminId);
  const d = policySchema.parse(raw);
  if (!(PROGRAMME_EVENTS[d.programme] as readonly string[]).includes(d.event)) throw new Error("That event does not belong to this programme");
  if (d.perPersonLimit !== null && !(d.perPersonLimit >= 1)) throw new Error("The limit per person must be 1 or more");
  const amountKobo = d.amount === "0" ? 0n : parseNairaToKobo(d.amount);
  return withPlatformAdmin(adminId, async (tx) => {
    if (d.campaignId) {
      const c = await tx.referralCampaign.findUnique({ where: { id: d.campaignId } });
      if (!c) throw new Error("Campaign not found");
      if (c.event !== d.event) throw new Error("That campaign rewards a different event");
    } else if (d.programme === "REFERRAL") {
      throw new Error("A referral reward belongs to a campaign");
    }
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `reward-policy:${d.event}:${d.campaignId ?? ""}`);
    const current = await tx.rewardPolicy.findFirst({ where: { event: d.event, campaignId: d.campaignId, active: true }, orderBy: { version: "desc" } });
    const last = await tx.rewardPolicy.findFirst({ where: { event: d.event, campaignId: d.campaignId }, orderBy: { version: "desc" } });
    if (current) await tx.rewardPolicy.update({ where: { id: current.id }, data: { active: false, retiredAt: new Date() } });
    const p = await tx.rewardPolicy.create({ data: { programme: d.programme, event: d.event, campaignId: d.campaignId, version: (last?.version ?? 0) + 1, name: d.name, amountKobo, holdDays: d.holdDays, perPersonLimit: d.perPersonLimit, terms: d.terms, createdById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_policy", entityId: p.id, action: "reward_policy.saved", detail: { event: d.event, version: p.version, amountKobo: amountKobo.toString(), holdDays: d.holdDays } });
    return p;
  });
}
export async function retirePolicy(adminId: string, policyId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.rewardPolicy.findUnique({ where: { id: policyId } });
    if (!p || !p.active) throw new Error("That reward is not in force");
    await tx.rewardPolicy.update({ where: { id: policyId }, data: { active: false, retiredAt: new Date() } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_policy", entityId: policyId, action: "reward_policy.retired", detail: { event: p.event, version: p.version } });
  });
}
/** Active rewards, readable by anyone signed in, so the terms are never a secret. */
export async function activePolicies(userId: string, programme?: "REFERRAL" | "VACANCY") {
  return withUser(userId, (tx) => tx.rewardPolicy.findMany({ where: { active: true, ...(programme ? { programme } : {}) }, orderBy: [{ programme: "asc" }, { event: "asc" }] }));
}
export async function allPolicies(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, (tx) => tx.rewardPolicy.findMany({ orderBy: [{ programme: "asc" }, { event: "asc" }, { version: "desc" }], take: 300 }));
}

// ---------- Budgets ----------

export async function setBudget(adminId: string, programme: "REFERRAL" | "VACANCY", month: string, limit: string) {
  await adminOnly(adminId);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a month");
  const limitKobo = limit.trim() === "0" ? 0n : parseNairaToKobo(limit);
  return withPlatformAdmin(adminId, async (tx) => {
    const b = await tx.rewardBudget.upsert({ where: { programme_month: { programme, month } }, create: { programme, month, limitKobo, updatedById: adminId }, update: { limitKobo, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_budget", entityId: b.id, action: "reward_budget.set", detail: { programme, month, limitKobo: limitKobo.toString() } });
    return b;
  });
}
async function spentIn(tx: Tx, programme: "REFERRAL" | "VACANCY", month: string): Promise<bigint> {
  const { start, end } = monthBounds(month);
  const r = await tx.reward.aggregate({ _sum: { amountKobo: true }, where: { programme, status: { in: ["APPROVED", "PAYABLE", "PAID"] }, approvedAt: { gte: start, lt: end } } });
  return r._sum.amountKobo ?? 0n;
}
export async function budgets(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.rewardBudget.findMany({ orderBy: [{ month: "desc" }, { programme: "asc" }], take: 24 });
    return Promise.all(rows.map(async (b) => ({ ...b, spentKobo: await spentIn(tx, b.programme, b.month) })));
  });
}

// ---------- The reward and its ledger ----------

const REF_PREFIX = "RW";
interface Actor { id: string | null; name: string }

async function ledger(tx: Tx, r: { id: string; userId: string; amountKobo: bigint }, from: RewardStatusName | null, to: RewardStatusName, actor: Actor, note: string) {
  await tx.rewardLedgerEntry.create({ data: { rewardId: r.id, userId: r.userId, fromStatus: from, toStatus: to, amountKobo: r.amountKobo, actorId: actor.id, actorName: actor.name, note: note.slice(0, 500) } });
}
const LEDGER_TITLES: Partial<Record<RewardStatusName, string>> = {
  ELIGIBLE: "Your reward qualified", APPROVED: "Your reward was approved", PAYABLE: "Your reward is ready to be paid", PAID: "Your reward was paid",
  REJECTED: "Your reward was not approved", CANCELLED: "Your reward was cancelled", UNDER_REVIEW: "Your reward is being checked", DISPUTED: "We received your dispute",
};

type RewardRow = Prisma.RewardGetPayload<object>;

/** Change a reward's status, in the same transaction as its ledger entry. The old status is checked in the update, so two people cannot both move it. */
export async function moveReward(tx: Tx, r: RewardRow, to: RewardStatusName, actor: Actor, note: string, patch: Prisma.RewardUncheckedUpdateManyInput = {}, tell = true): Promise<RewardRow> {
  const problem = rewardMoveProblem(r.status, to);
  if (problem) throw new Error(problem);
  const reason = to === "REJECTED" || to === "CANCELLED" || to === "NOT_ELIGIBLE" ? { reason: note } : {};
  const done = await tx.reward.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, ...reason, ...patch } });
  if (done.count !== 1) throw new Error("This reward was just changed by someone else. Reload and try again.");
  await ledger(tx, r, r.status, to, actor, note);
  if (tell && LEDGER_TITLES[to]) await notify(tx, r.userId, { kind: "reward.updated", title: LEDGER_TITLES[to]!, body: `${r.ref}${note && to !== "PAID" ? `: ${note}` : ""}`.slice(0, 200), link: "/rewards" });
  return tx.reward.findUniqueOrThrow({ where: { id: r.id } });
}

export interface NewReward {
  userId: string; programme: "REFERRAL" | "VACANCY"; event: RewardEvent; campaignId?: string | null;
  sourceType: string; sourceId: string; sourceLabel: string;
  needsReview?: boolean; notEligible?: string;
}
type RewardEvent = (typeof PROGRAMME_EVENTS)["REFERRAL"][number] | (typeof PROGRAMME_EVENTS)["VACANCY"][number];

/** Open a reward for something that just qualified. Safe to call twice: one source earns one reward per event. */
export async function openReward(tx: Tx, n: NewReward): Promise<RewardRow> {
  const existing = await tx.reward.findUnique({ where: { sourceType_sourceId_event: { sourceType: n.sourceType, sourceId: n.sourceId, event: n.event } } });
  if (existing) return existing;
  const policy = await tx.rewardPolicy.findFirst({ where: { event: n.event, campaignId: n.campaignId ?? null, active: true }, orderBy: { version: "desc" } });
  let status: RewardStatusName = n.needsReview ? "UNDER_REVIEW" : "ELIGIBLE";
  let reason = n.notEligible ?? "";
  if (!reason && !policy) reason = "No reward is set up for this yet.";
  if (!reason) {
    const restricted = await tx.rewardRestriction.findFirst({ where: { userId: n.userId, liftedAt: null } });
    if (restricted) reason = "Rewards are paused on this account.";
  }
  if (!reason && policy?.perPersonLimit) {
    const used = await tx.reward.count({ where: { userId: n.userId, event: n.event, policyId: { in: (await tx.rewardPolicy.findMany({ where: { event: n.event, campaignId: n.campaignId ?? null }, select: { id: true } })).map((p) => p.id) }, status: { notIn: ["NOT_ELIGIBLE", "REJECTED", "CANCELLED"] } } });
    if (used >= policy.perPersonLimit) reason = `The limit of ${policy.perPersonLimit} rewards for this has been reached.`;
  }
  if (reason) status = "NOT_ELIGIBLE";
  const r = await tx.reward.create({ data: { ref: randomRef(REF_PREFIX, 8), userId: n.userId, programme: n.programme, event: n.event, policyId: policy?.id ?? null, policyVersion: policy?.version ?? null, amountKobo: policy?.amountKobo ?? 0n, status, reason, sourceType: n.sourceType, sourceId: n.sourceId, sourceLabel: n.sourceLabel.slice(0, 200) } });
  await ledger(tx, r, null, status, { id: null, name: "Platform" }, reason || (n.needsReview ? "Held for a person to check" : "Qualified under the rules in force"));
  if (status !== "NOT_ELIGIBLE") await notify(tx, r.userId, { kind: "reward.updated", title: status === "UNDER_REVIEW" ? LEDGER_TITLES.UNDER_REVIEW! : LEDGER_TITLES.ELIGIBLE!, body: r.ref, link: "/rewards" });
  return r;
}

// ---------- Approval ----------

export async function approveReward(adminId: string, rewardId: string, note = "") {
  const who = await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!r) throw new Error("Reward not found");
    if (r.userId === adminId) throw new Error("You cannot approve your own reward. Another administrator must.");
    if (r.status !== "ELIGIBLE") throw new Error(`Only a reward that is eligible can be approved. This one is ${r.status.replace(/_/g, " ").toLowerCase()}.`);
    const now = new Date();
    const month = monthKey(now);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `reward-budget:${r.programme}:${month}`);
    const b = await tx.rewardBudget.findUnique({ where: { programme_month: { programme: r.programme, month } } });
    if (!b) throw new Error(`No budget has been set for ${r.programme.toLowerCase()} rewards in ${month}. Set one first.`);
    const spent = await spentIn(tx, r.programme, month);
    if (spent + r.amountKobo > b.limitKobo) throw new Error(`This would take ${r.programme.toLowerCase()} rewards past the ${month} budget (${formatKobo(b.limitKobo)}; ${formatKobo(spent)} already approved).`);
    const policy = r.policyId ? await tx.rewardPolicy.findUnique({ where: { id: r.policyId } }) : null;
    const moved = await moveReward(tx, r, "APPROVED", { id: adminId, name: who.name }, note || "Approved", { approvedAt: now, approvedById: adminId, payableAt: holdEnd(now, policy?.holdDays ?? 14) });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward", entityId: r.id, action: "reward.approved", detail: { ref: r.ref, amountKobo: r.amountKobo.toString() } });
    return moved;
  });
}

export async function rejectReward(adminId: string, rewardId: string, reasonRaw: string) {
  const who = await adminOnly(adminId);
  const reason = z.string().trim().min(5, "Give a reason the person can read").max(500).parse(reasonRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!r) throw new Error("Reward not found");
    if (!["ELIGIBLE", "UNDER_REVIEW"].includes(r.status)) throw new Error("Only a reward waiting for a decision can be rejected");
    const moved = await moveReward(tx, r, "REJECTED", { id: adminId, name: who.name }, reason);
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward", entityId: r.id, action: "reward.rejected", detail: { ref: r.ref, reason } });
    return moved;
  });
}

/** A person has checked a held reward and is satisfied. */
export async function clearReward(adminId: string, rewardId: string, note: string) {
  const who = await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!r || r.status !== "UNDER_REVIEW") throw new Error("That reward is not under review");
    return moveReward(tx, r, "ELIGIBLE", { id: adminId, name: who.name }, note || "Checked and cleared");
  });
}

export async function cancelReward(adminId: string, rewardId: string, reasonRaw: string) {
  const who = await adminOnly(adminId);
  const reason = z.string().trim().min(5, "Give a reason").max(500).parse(reasonRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!r) throw new Error("Reward not found");
    if (r.payoutId) throw new Error("This reward is in a payout. Mark the payout as failed first.");
    const moved = await moveReward(tx, r, "CANCELLED", { id: adminId, name: who.name }, reason);
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward", entityId: r.id, action: "reward.cancelled", detail: { ref: r.ref, reason } });
    return moved;
  });
}

// ---------- Checking the source again before money moves ----------

/** Whether the thing that earned a reward still stands. Returns the reason it does not, or null. */
export async function sourceProblem(tx: Tx, r: Pick<RewardRow, "sourceType" | "sourceId">): Promise<string | null> {
  switch (r.sourceType) {
    case "listing": {
      const l = await tx.listing.findUnique({ where: { id: r.sourceId }, select: { status: true } });
      return l?.status === "PUBLISHED" ? null : "The listing is no longer published.";
    }
    case "subscription": {
      const s = await tx.subscription.findUnique({ where: { id: r.sourceId }, select: { status: true, cancelledAt: true } });
      return s && !s.cancelledAt && s.status !== "CANCELLED" ? null : "The subscription was cancelled.";
    }
    case "vacancy_lead": {
      const l = await tx.vacancyLead.findUnique({ where: { id: r.sourceId }, select: { status: true } });
      return l && l.status !== "DECLINED" && l.status !== "WITHDRAWN" ? null : "The owner withdrew or declined.";
    }
    default: return null;
  }
}

/** Approved rewards whose safety period has passed become payable, unless their source has been reversed in the meantime. */
export async function releaseDue(now = new Date()): Promise<{ released: number; cancelled: number }> {
  return system(async (tx) => {
    const due = await tx.reward.findMany({ where: { status: "APPROVED", payableAt: { lte: now } }, take: 200 });
    let released = 0, cancelled = 0;
    for (const r of due) {
      const problem = await sourceProblem(tx, r);
      if (problem) { await moveReward(tx, r, "CANCELLED", { id: null, name: "Platform" }, `${problem} The reward was cancelled before it became payable.`); cancelled++; }
      else { await moveReward(tx, r, "PAYABLE", { id: null, name: "Platform" }, "Safety period over; the source still stands"); released++; }
    }
    return { released, cancelled };
  });
}

// ---------- Payouts ----------

export async function createPayout(adminId: string, userId: string, noteRaw = "", method = "BANK_TRANSFER") {
  const who = await adminOnly(adminId);
  const note = z.string().trim().max(500).parse(noteRaw);
  await releaseDue();
  const { payoutThresholdKobo } = await readRewardSettings();
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `payout:${userId}`);
    if (await tx.rewardPayout.findFirst({ where: { userId, status: "PENDING" } })) throw new Error("This person already has a payout waiting to be verified");
    let rewards = await tx.reward.findMany({ where: { userId, status: "PAYABLE", payoutId: null }, orderBy: { createdAt: "asc" } });
    const keep: RewardRow[] = [];
    for (const r of rewards) {
      const problem = await sourceProblem(tx, r);
      if (problem) await moveReward(tx, r, "CANCELLED", { id: adminId, name: who.name }, `${problem} Cancelled before payment.`);
      else keep.push(r);
    }
    rewards = keep;
    const total = rewards.reduce((s, r) => s + r.amountKobo, 0n);
    if (total <= 0n) throw new Error("This person has nothing payable");
    if (total < BigInt(payoutThresholdKobo)) throw new Error(`The payable balance (${formatKobo(total)}) is below the payout threshold of ${formatKobo(BigInt(payoutThresholdKobo))}.`);
    const p = await tx.rewardPayout.create({ data: { ref: randomRef("PO", 8), userId, amountKobo: total, method, note, createdById: adminId, createdByName: who.name } });
    await tx.reward.updateMany({ where: { id: { in: rewards.map((r) => r.id) } }, data: { payoutId: p.id } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_payout", entityId: p.id, action: "reward_payout.created", detail: { ref: p.ref, amountKobo: total.toString(), rewards: rewards.length } });
    return p;
  });
}

/** A second administrator confirms the money really left, with the bank reference. Only then are the rewards marked paid. */
export async function verifyPayout(adminId: string, payoutId: string, referenceRaw: string, noteRaw = "") {
  const who = await adminOnly(adminId);
  const reference = z.string().trim().min(4, "Enter the bank or transfer reference").max(120).parse(referenceRaw);
  const note = z.string().trim().max(500).parse(noteRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.rewardPayout.findUnique({ where: { id: payoutId } });
    if (!p) throw new Error("Payout not found");
    if (p.status !== "PENDING") throw new Error(`This payout is already ${p.status.toLowerCase()}`);
    if (p.createdById === adminId) throw new Error("A different administrator must verify this payout.");
    const rewards = await tx.reward.findMany({ where: { payoutId } });
    const sum = rewards.reduce((s, r) => s + r.amountKobo, 0n);
    if (sum !== p.amountKobo) throw new Error("The rewards in this payout no longer add up to its amount. Mark it as failed and start again.");
    if (rewards.some((r) => r.status !== "PAYABLE")) throw new Error("A reward in this payout is no longer payable. Mark it as failed and start again.");
    if (rewards.some((r) => r.flag)) throw new Error("A reward in this payout was flagged after it was queued. Mark it as failed and start again.");
    for (const r of rewards) {
      const problem = await sourceProblem(tx, r);
      if (problem) throw new Error(`${r.ref}: ${problem} Mark the payout as failed and start again.`);
    }
    const now = new Date();
    await tx.rewardPayout.update({ where: { id: payoutId }, data: { status: "PAID", reference, note: note || p.note, verifiedById: adminId, verifiedAt: now } });
    for (const r of rewards) await moveReward(tx, r, "PAID", { id: adminId, name: who.name }, `Paid in ${p.ref}, reference ${reference}`, { paidAt: now });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_payout", entityId: payoutId, action: "reward_payout.verified", detail: { ref: p.ref, reference } });
  });
}

/** The payment did not go through. The rewards go back to payable, nothing is lost, and the reason is on record. */
export async function failPayout(adminId: string, payoutId: string, reasonRaw: string) {
  const who = await adminOnly(adminId);
  const reason = z.string().trim().min(5, "Say what went wrong").max(500).parse(reasonRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.rewardPayout.findUnique({ where: { id: payoutId } });
    if (!p) throw new Error("Payout not found");
    if (p.status !== "PENDING") throw new Error(`This payout is already ${p.status.toLowerCase()}`);
    await tx.rewardPayout.update({ where: { id: payoutId }, data: { status: "FAILED", failureReason: reason } });
    const rewards = await tx.reward.findMany({ where: { payoutId } });
    await tx.reward.updateMany({ where: { payoutId }, data: { payoutId: null } });
    for (const r of rewards) await ledger(tx, r, r.status, r.status, { id: adminId, name: who.name }, `Payment ${p.ref} failed: ${reason}. Still payable.`);
    await notify(tx, p.userId, { kind: "reward.updated", title: "A payment did not go through", body: `${p.ref}: we will try again.`, link: "/rewards" });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_payout", entityId: payoutId, action: "reward_payout.failed", detail: { ref: p.ref, reason } });
  });
}

// ---------- Reconciliation ----------

export interface Finding { code: string; message: string; refs: string[] }
/** Checks that the money and the ledger agree. An empty list of findings means they do. */
export async function reconcile(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const [rewards, payouts] = await Promise.all([tx.reward.findMany({ take: 5000 }), tx.rewardPayout.findMany({ take: 5000 })]);
    const payoutById = new Map(payouts.map((p) => [p.id, p]));
    const findings: Finding[] = [];
    const add = (code: string, message: string, refs: string[]) => { if (refs.length) findings.push({ code, message, refs: refs.slice(0, 20) }); };
    add("PAID_WITHOUT_PAYMENT", "Rewards marked paid with no verified payout behind them.", rewards.filter((r) => r.status === "PAID" && payoutById.get(r.payoutId ?? "")?.status !== "PAID").map((r) => r.ref));
    const byPayout = new Map<string, bigint>();
    for (const r of rewards) if (r.payoutId) byPayout.set(r.payoutId, (byPayout.get(r.payoutId) ?? 0n) + r.amountKobo);
    add("PAYOUT_TOTAL_MISMATCH", "Payouts whose rewards do not add up to the amount paid.", payouts.filter((p) => p.status !== "FAILED" && (byPayout.get(p.id) ?? 0n) !== p.amountKobo).map((p) => p.ref));
    add("PAYABLE_IN_DEAD_PAYOUT", "Payable rewards attached to a payout that is not waiting.", rewards.filter((r) => r.payoutId && r.status === "PAYABLE" && payoutById.get(r.payoutId)?.status !== "PENDING").map((r) => r.ref));
    add("STALE_PAYOUT", "Payouts waiting more than 7 days for verification.", payouts.filter((p) => p.status === "PENDING" && p.createdAt.getTime() < addDays(new Date(), -7).getTime()).map((p) => p.ref));
    add("PAID_THEN_REVERSED", "Paid rewards whose source was later reversed. Recover the money outside the platform.", rewards.filter((r) => r.status === "PAID" && r.flag).map((r) => r.ref));
    const last = await tx.rewardLedgerEntry.findMany({ distinct: ["rewardId"], orderBy: [{ rewardId: "asc" }, { createdAt: "desc" }], select: { rewardId: true, toStatus: true }, take: 5000 });
    const lastBy = new Map(last.map((l) => [l.rewardId, l.toStatus]));
    add("LEDGER_DISAGREES", "Rewards whose latest ledger entry does not match their status.", rewards.filter((r) => lastBy.get(r.id) !== r.status).map((r) => r.ref));
    const totals: Record<string, { count: number; kobo: bigint }> = {};
    for (const r of rewards) { const k = `${r.programme}:${r.status}`; totals[k] = { count: (totals[k]?.count ?? 0) + 1, kobo: (totals[k]?.kobo ?? 0n) + r.amountKobo }; }
    const paidOut = payouts.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amountKobo, 0n);
    const paidRewards = rewards.filter((r) => r.status === "PAID").reduce((s, r) => s + r.amountKobo, 0n);
    return { findings, totals, paidOutKobo: paidOut, paidRewardsKobo: paidRewards, balanced: paidOut === paidRewards && findings.length === 0 };
  });
}

// ---------- Restrictions and disputes ----------

export async function restrictRewards(adminId: string, userId: string, reasonRaw: string) {
  await adminOnly(adminId);
  const reason = z.string().trim().min(5, "Say why").max(500).parse(reasonRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.rewardRestriction.upsert({ where: { userId }, create: { userId, reason, setById: adminId }, update: { reason, setById: adminId, liftedAt: null, liftedById: null, createdAt: new Date() } });
    await notify(tx, userId, { kind: "reward.restricted", title: "Rewards on your account are paused", body: reason, link: "/rewards" });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_restriction", entityId: userId, action: "reward_restriction.set", detail: { reason } });
  });
}
export async function liftRewardRestriction(adminId: string, userId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.rewardRestriction.findFirst({ where: { userId, liftedAt: null } });
    if (!r) throw new Error("Nothing to lift");
    await tx.rewardRestriction.update({ where: { userId }, data: { liftedAt: new Date(), liftedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_restriction", entityId: userId, action: "reward_restriction.lifted", detail: {} });
  });
}

const disputeText = z.string().trim().min(10, "Tell us in a sentence or two why you disagree").max(1000);

/** A person asks for a second look at a reward that was rejected or never qualified. */
export async function disputeReward(userId: string, rewardId: string, reasonRaw: string) {
  const reason = disputeText.parse(reasonRaw);
  return system(async (tx) => {
    const r = await tx.reward.findFirst({ where: { id: rewardId, userId } });
    if (!r) throw new Error("Reward not found");
    if (!["REJECTED", "NOT_ELIGIBLE"].includes(r.status)) throw new Error("Only a reward that was not approved can be disputed");
    if (await tx.rewardDispute.findFirst({ where: { subjectType: "REWARD", subjectId: rewardId } })) throw new Error("This reward has already been disputed. Each decision can be disputed once.");
    const d = await tx.rewardDispute.create({ data: { subjectType: "REWARD", subjectId: rewardId, userId, reason } });
    await moveReward(tx, r, "DISPUTED", { id: userId, name: await adminName(tx, userId) }, `Disputed: ${reason}`);
    return d;
  });
}

export async function resolveRewardDispute(adminId: string, disputeId: string, decision: "uphold" | "deny", resolutionRaw: string) {
  const who = await adminOnly(adminId);
  const resolution = z.string().trim().min(5, "Explain the decision").max(1000).parse(resolutionRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const d = await tx.rewardDispute.findUnique({ where: { id: disputeId } });
    if (!d || d.subjectType !== "REWARD") throw new Error("Dispute not found");
    if (d.status !== "OPEN") throw new Error("This dispute is already decided");
    const r = await tx.reward.findUnique({ where: { id: d.subjectId } });
    if (!r) throw new Error("Reward not found");
    if (r.userId === adminId) throw new Error("You cannot decide a dispute about your own reward");
    await tx.rewardDispute.update({ where: { id: d.id }, data: { status: decision === "uphold" ? "UPHELD" : "DENIED", resolution, resolvedById: adminId, resolvedAt: new Date() } });
    await moveReward(tx, r, decision === "uphold" ? "ELIGIBLE" : "REJECTED", { id: adminId, name: who.name }, decision === "uphold" ? `Dispute upheld: ${resolution}` : resolution);
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reward_dispute", entityId: d.id, action: `reward_dispute.${decision}`, detail: { ref: r.ref } });
  });
}

// ---------- Reading ----------

export const REWARD_PAGE = 10;

export async function myRewards(userId: string, page = 1, programme?: "REFERRAL" | "VACANCY") {
  await releaseDue().catch(() => undefined);
  return withUser(userId, async (tx) => {
    const where = { userId, ...(programme ? { programme } : {}) };
    const [rows, groups, payouts, restriction] = await Promise.all([
      tx.reward.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * REWARD_PAGE, take: REWARD_PAGE + 1, include: { ledger: { orderBy: { createdAt: "asc" } } } }),
      tx.reward.groupBy({ by: ["status"], where: { userId }, _count: { _all: true }, _sum: { amountKobo: true } }),
      tx.rewardPayout.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
      tx.rewardRestriction.findFirst({ where: { userId, liftedAt: null } }),
    ]);
    const disputes = await tx.rewardDispute.findMany({ where: { userId, subjectType: "REWARD", subjectId: { in: rows.map((r) => r.id) } } });
    const by = Object.fromEntries(groups.map((g) => [g.status, { count: g._count._all, kobo: g._sum.amountKobo ?? 0n }]));
    return { items: rows.slice(0, REWARD_PAGE), more: rows.length > REWARD_PAGE, by, payouts, restricted: restriction?.reason ?? null, disputes: new Map(disputes.map((d) => [d.subjectId, d])) };
  });
}

/** The waiting lists an administrator works through. */
export async function adminRewardQueue(adminId: string, status: RewardStatusName = "ELIGIBLE", page = 1) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.reward.findMany({ where: { status }, orderBy: { createdAt: "asc" }, skip: (page - 1) * REWARD_PAGE, take: REWARD_PAGE + 1 });
    const names = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const counts = await tx.reward.groupBy({ by: ["status"], _count: { _all: true } });
    return { items: rows.slice(0, REWARD_PAGE).map((r) => ({ ...r, userName: names.get(r.userId) ?? "Unknown" })), more: rows.length > REWARD_PAGE, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  });
}
export async function adminPayouts(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.rewardPayout.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    const names = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const owed = await tx.reward.groupBy({ by: ["userId"], where: { status: "PAYABLE", payoutId: null }, _sum: { amountKobo: true } });
    const ownedNames = new Map((await tx.user.findMany({ where: { id: { in: owed.map((o) => o.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return { payouts: rows.map((p) => ({ ...p, userName: names.get(p.userId) ?? "Unknown" })), owed: owed.map((o) => ({ userId: o.userId, name: ownedNames.get(o.userId) ?? "Unknown", kobo: o._sum.amountKobo ?? 0n })) };
  });
}
export async function adminDisputes(adminId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.rewardDispute.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 100 });
    const rewards = await tx.reward.findMany({ where: { id: { in: rows.filter((r) => r.subjectType === "REWARD").map((r) => r.subjectId) } } });
    const byId = new Map(rewards.map((r) => [r.id, r]));
    return rows.map((d) => ({ ...d, reward: byId.get(d.subjectId) ?? null }));
  });
}

// ---------- Reversal ----------

/** The thing that earned rewards was undone (a subscription cancelled, a listing taken down). Unpaid rewards end; paid ones are flagged for a person. */
export async function reverseSource(sourceType: string, sourceId: string, why: string): Promise<{ ended: number; flagged: number }> {
  return system(async (tx) => {
    const rewards = await tx.reward.findMany({ where: { sourceType, sourceId } });
    let ended = 0, flagged = 0;
    const platform = { id: null, name: "Platform" };
    for (const r of rewards) {
      if (r.status === "ELIGIBLE" || r.status === "UNDER_REVIEW") { await moveReward(tx, r, "REJECTED", platform, `${why} The reward no longer applies.`); ended++; }
      else if ((r.status === "APPROVED" || r.status === "PAYABLE") && !r.payoutId) { await moveReward(tx, r, "CANCELLED", platform, `${why} The reward was cancelled.`); ended++; }
      else if (r.status === "PAID" || r.payoutId) { await tx.reward.update({ where: { id: r.id }, data: { flag: `${why} Review: this reward ${r.status === "PAID" ? "was already paid" : "is in a payout"}.` } }); await ledger(tx, r, r.status, r.status, platform, `Flagged for review: ${why}`); flagged++; }
    }
    return { ended, flagged };
  });
}
