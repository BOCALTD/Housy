import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import { parseNairaToKobo } from "../money";
import { allocate, COMMISSION_APPLIES, COMMISSION_METHODS, commissionAmount, parsePercentToBps, payoutStatus, rulesApplyTo, SPLIT_ROLES, splitProblem } from "../commission-rules";
import { can } from "../permissions";
import { assertCan, type Ctx } from "./context";
import { activeAgent, visibleOwners } from "./crm";
import { canChangeDeal, dealVisibleWhere, lockDeal } from "./deal";

// Commission (master prompt Phase 8). The company sets its own rules; nothing here knows a rate. A commission is proposed on a
// completed deal, approved by a manager who is neither the proposer nor one of the people sharing it, and paid person by person
// by someone who is not the proposer or the recipient. A disputed deal withholds approval and payment.

export { COMMISSION_APPLIES, COMMISSION_METHODS, SPLIT_ROLES };

// ---------- Rules ----------

const ruleSchema = z.object({
  name: z.string().trim().min(2, "Name the rule").max(100),
  applies: z.enum(COMMISSION_APPLIES).default("ALL"),
  method: z.enum(COMMISSION_METHODS),
  rate: z.string().trim().optional(),
  fixed: z.string().trim().optional(),
});

export async function addCommissionRule(ctx: Ctx, raw: z.input<typeof ruleSchema>) {
  assertCan(ctx, "crm.configure");
  const d = ruleSchema.parse(raw);
  let rateBps: number | null = null;
  let fixedKobo: bigint | null = null;
  if (d.method === "PERCENT") {
    if (!d.rate) throw new Error("Enter the percentage");
    rateBps = parsePercentToBps(d.rate);
  } else {
    if (!d.fixed) throw new Error("Enter the fixed amount");
    fixedKobo = parseNairaToKobo(d.fixed);
    if (fixedKobo <= 0n) throw new Error("The fixed amount must be more than zero");
  }
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (await tx.commissionRule.findFirst({ where: { companyId: ctx.companyId, name: { equals: d.name, mode: "insensitive" } } })) throw new Error("A rule with that name already exists");
    const r = await tx.commissionRule.create({ data: { companyId: ctx.companyId, name: d.name, applies: d.applies, method: d.method, rateBps, fixedKobo, createdById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "commission_rule", entityId: r.id, action: "commission.rule_added", detail: { name: d.name, method: d.method } });
    return r;
  });
}

export async function setCommissionRuleActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "crm.configure");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.commissionRule.updateMany({ where: { id, companyId: ctx.companyId }, data: { active } });
    if (r.count === 0) throw new Error("Rule not found");
  });
}

export async function listCommissionRules(ctx: Ctx) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.commissionRule.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ active: "desc" }, { name: "asc" }] }));
}

// ---------- Proposing, deciding and paying ----------

const proposalSchema = z.object({
  ruleId: z.string().min(1, "Choose the commission rule"),
  splits: z.array(z.object({ membershipId: z.string().min(1, "Choose a person"), role: z.enum(SPLIT_ROLES), share: z.string() })).min(1, "Add at least one person to share the commission"),
});

export async function proposeCommission(ctx: Ctx, dealId: string, raw: z.input<typeof proposalSchema>) {
  assertCan(ctx, "crm.manage");
  const d = proposalSchema.parse(raw);
  const shares = d.splits.map((s) => ({ ...s, bps: parsePercentToBps(s.share) }));
  const problem = splitProblem(shares.map((s) => ({ key: s.membershipId, bps: s.bps })));
  if (problem) throw new Error(problem);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    if (!canChangeDeal(ctx, deal)) throw new Error("Only the deal's owner or a manager can propose the commission");
    if (deal.stage !== "COMPLETED" || deal.agreedKobo === null) throw new Error("Commission can be proposed only on a completed deal");
    if (deal.status === "DISPUTED") throw new Error("The deal is disputed, so its commission is withheld until the dispute is settled");
    const rule = await tx.commissionRule.findFirst({ where: { id: d.ruleId, companyId: ctx.companyId, active: true } });
    if (!rule) throw new Error("Choose an active commission rule");
    if (!rulesApplyTo(rule.applies, deal.type)) throw new Error(`That rule does not apply to a ${deal.type.toLowerCase()}`);
    for (const s of shares) await activeAgent(tx, ctx.companyId, s.membershipId);
    const existing = await tx.dealCommission.findFirst({ where: { dealId, companyId: ctx.companyId } });
    if (existing && !["REJECTED", "CANCELLED"].includes(existing.status)) throw new Error("This deal already has a commission");
    const total = commissionAmount(rule, deal.agreedKobo);
    const amounts = allocate(total, shares.map((s) => s.bps));
    const base = { ruleId: rule.id, ruleName: rule.name, method: rule.method, rateBps: rule.rateBps, fixedKobo: rule.fixedKobo, basisKobo: deal.agreedKobo, totalKobo: total, status: "SUBMITTED" as const, submittedById: ctx.userId, submittedAt: new Date(), decidedById: null, decidedAt: null, decisionNote: "" };
    let id: string;
    if (existing) {
      await tx.commissionSplit.deleteMany({ where: { commissionId: existing.id, companyId: ctx.companyId } });
      await tx.dealCommission.update({ where: { id: existing.id }, data: base });
      id = existing.id;
    } else {
      id = (await tx.dealCommission.create({ data: { companyId: ctx.companyId, dealId, ...base } })).id;
    }
    await tx.commissionSplit.createMany({ data: shares.map((s, i) => ({ companyId: ctx.companyId, commissionId: id, membershipId: s.membershipId, role: s.role, shareBps: s.bps, amountKobo: amounts[i] })) });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "commission.proposed", detail: { rule: rule.name, totalKobo: String(total), people: shares.length } });
    return { id, totalKobo: total };
  });
}

async function lockCommission(tx: Tx, ctx: Ctx, dealId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM deal_commissions WHERE deal_id = $1 AND company_id = $2 FOR UPDATE`, dealId, ctx.companyId);
  if (rows.length === 0) throw new Error("There is no commission on this deal");
  return tx.dealCommission.findFirstOrThrow({ where: { id: rows[0].id, companyId: ctx.companyId }, include: { splits: true } });
}

export async function decideCommission(ctx: Ctx, dealId: string, decision: "approve" | "reject", noteInput = "") {
  assertCan(ctx, "crm.approve");
  const note = z.string().trim().max(1000).parse(noteInput);
  if (decision === "reject" && note.length < 3) throw new Error("Say why the commission is rejected");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    const c = await lockCommission(tx, ctx, dealId);
    if (c.status !== "SUBMITTED") throw new Error("This commission is not waiting for a decision");
    if (c.submittedById === ctx.userId) throw new Error("Someone other than the person who proposed the commission must decide it");
    if (c.splits.some((s) => s.membershipId === ctx.membershipId)) throw new Error("A person who shares in the commission cannot decide it");
    if (deal.ownerId === ctx.membershipId) throw new Error("The deal's owner cannot decide the commission on their own deal");
    if (deal.status === "DISPUTED") throw new Error("The deal is disputed, so its commission is withheld until the dispute is settled");
    await tx.dealCommission.update({ where: { id: c.id }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: `commission.${decision === "approve" ? "approved" : "rejected"}`, detail: { note, totalKobo: String(c.totalKobo) } });
  });
}

export async function cancelCommission(ctx: Ctx, dealId: string, reasonInput: string) {
  assertCan(ctx, "crm.manage");
  const reason = z.string().trim().min(3, "Say why the commission is cancelled").max(1000).parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    const c = await lockCommission(tx, ctx, dealId);
    if (!can(ctx.role, "crm.approve") && !(c.status === "SUBMITTED" && c.submittedById === ctx.userId && canChangeDeal(ctx, deal))) throw new Error("Only a manager, or the person who proposed it before it is decided, can cancel a commission");
    if (!["SUBMITTED", "APPROVED"].includes(c.status)) throw new Error("This commission can no longer be cancelled");
    if (c.splits.some((s) => s.paidAt)) throw new Error("Part of this commission has already been paid, so it cannot be cancelled");
    await tx.dealCommission.update({ where: { id: c.id }, data: { status: "CANCELLED", decisionNote: reason } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "commission.cancelled", detail: { reason } });
  });
}

export async function payCommissionSplit(ctx: Ctx, splitId: string, raw: { paidOn: string; reference: string }) {
  assertCan(ctx, "crm.approve");
  const paidOn = parseDateOnly(z.string().trim().min(1, "Enter the date paid").parse(raw.paidOn));
  const reference = z.string().trim().min(2, "Enter the payment reference").max(200).parse(raw.reference);
  if (paidOn.getTime() > todayInLagos().getTime()) throw new Error("The payment date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const sp = await tx.commissionSplit.findFirst({ where: { id: splitId, companyId: ctx.companyId } });
    if (!sp) throw new Error("Payment not found");
    const parent = await tx.dealCommission.findFirstOrThrow({ where: { id: sp.commissionId, companyId: ctx.companyId } });
    const deal = await lockDeal(tx, ctx, parent.dealId);
    const c = await lockCommission(tx, ctx, parent.dealId);
    const split = c.splits.find((s) => s.id === splitId)!;
    if (c.status !== "APPROVED") throw new Error("Only an approved commission can be paid");
    if (split.paidAt) throw new Error("This share has already been paid");
    if (deal.status === "DISPUTED") throw new Error("The deal is disputed, so its commission is withheld until the dispute is settled");
    if (split.membershipId === ctx.membershipId) throw new Error("You cannot pay your own share");
    if (c.submittedById === ctx.userId) throw new Error("Someone other than the person who proposed the commission must pay it");
    await tx.commissionSplit.update({ where: { id: splitId }, data: { paidAt: paidOn, paidById: ctx.userId, payReference: reference } });
    const left = c.splits.filter((s) => s.id !== splitId && !s.paidAt).length;
    if (left === 0) await tx.dealCommission.update({ where: { id: c.id }, data: { status: "PAID", paidAt: new Date() } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: c.dealId, action: "commission.paid", detail: { splitId, amountKobo: String(split.amountKobo), reference } });
  });
}

// ---------- Reading ----------

/** Who may see a deal's commission: managers, the deal's owner, and the people sharing it. */
export async function getDealCommission(ctx: Ctx, dealId: string) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const visible = await tx.deal.findFirst({ where: { id: dealId, companyId: ctx.companyId, AND: [dealVisibleWhere(ctx, owners)] } });
    const c = await tx.dealCommission.findFirst({ where: { dealId, companyId: ctx.companyId }, include: { splits: { orderBy: { createdAt: "asc" } } } });
    // Someone who shares in the commission may see it even when the deal itself is not theirs to see.
    const sharing = !!c?.splits.some((s) => s.membershipId === ctx.membershipId);
    const deal = visible ?? (sharing ? await tx.deal.findFirst({ where: { id: dealId, companyId: ctx.companyId } }) : null);
    if (!deal) throw new Error("Deal not found");
    const members = await tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } });
    const names = Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>;
    const userNames = Object.fromEntries(members.map((m) => [m.userId, m.user.name])) as Record<string, string>;
    const rules = await tx.commissionRule.findMany({ where: { companyId: ctx.companyId, active: true }, orderBy: { name: "asc" } });
    const people = members.filter((m) => m.status === "ACTIVE" && ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"].includes(m.role)).map((m) => ({ id: m.id, name: m.user.name }));
    const manager = can(ctx.role, "crm.approve");
    const mine = !!c?.splits.some((s) => s.membershipId === ctx.membershipId);
    if (c && !manager && deal.ownerId !== ctx.membershipId && !mine) return { deal, commission: null, hidden: true, names, userNames, rules: [], people: [], payout: "NOT_DUE" as const };
    return { deal, commission: c, hidden: false, names, userNames, rules: rules.filter((r) => rulesApplyTo(r.applies, deal.type)), people, payout: c ? payoutStatus(c.status, c.splits) : ("NOT_DUE" as const) };
  });
}

/** Commissions waiting for a decision or for payment (managers), or the person's own shares. */
export async function commissionQueue(ctx: Ctx) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const manager = can(ctx.role, "crm.approve");
    const rows = await tx.dealCommission.findMany({
      where: { companyId: ctx.companyId, status: { in: ["SUBMITTED", "APPROVED", "PAID"] }, ...(manager ? {} : { splits: { some: { membershipId: ctx.membershipId } } }) },
      orderBy: { submittedAt: "desc" }, take: 200, include: { splits: true, deal: { select: { id: true, ref: true, title: true, status: true } } },
    });
    const members = await tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } });
    return { rows: rows.map((r) => ({ ...r, payout: payoutStatus(r.status, r.splits) })), names: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>, manager };
  });
}
