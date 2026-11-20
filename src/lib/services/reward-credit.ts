/**
 * Rewards toward a plan. A person's payable rewards (referrals and others) can be taken off an open plan invoice instead of
 * waiting for a cash payout: no payout threshold, applied at once. The rewards used are recorded as a "plan credit" payout,
 * already verified, so the rewards books still agree (every paid reward has a paid payout behind it). Rewards are whole: those
 * that fit within the amount are used, oldest first, and the rest stay payable.
 */
import { randomRef } from "../tokens";
import { logActivity } from "../audit";
import { formatKobo } from "../money";
import { lockKey } from "../locks";
import { applyInvoice, assertMayPay, billingLink, type Payer } from "./billing";
import { notify } from "./notifications";
import { moveReward, releaseDue, sourceProblem, system, SYSTEM } from "./rewards";
import type { Owner } from "./subscriptions";

/** Rewards that fit within an amount, oldest first, never splitting one: the ones to use and their total. */
export function pickRewards<T extends { amountKobo: bigint }>(rewards: T[], limit: bigint): { use: T[]; total: bigint } {
  const use: T[] = [];
  let total = 0n;
  for (const r of rewards) if (r.amountKobo > 0n && total + r.amountKobo <= limit) { use.push(r); total += r.amountKobo; }
  return { use, total };
}

/** What a person could use now: payable rewards not already in a payout, unless their rewards are paused. Naira only. */
export async function rewardCredit(userId: string): Promise<{ availableKobo: bigint; paused: boolean }> {
  return system(async (tx) => {
    if (await tx.rewardRestriction.findFirst({ where: { userId, liftedAt: null } })) return { availableKobo: 0n, paused: true };
    const agg = await tx.reward.aggregate({ where: { userId, status: "PAYABLE", payoutId: null }, _sum: { amountKobo: true } });
    return { availableKobo: agg._sum.amountKobo ?? 0n, paused: false };
  });
}

/** Take the person's payable rewards off an open plan invoice they may pay. If they cover it all, the plan starts now. */
export async function applyRewardCredit(p: Payer, invoiceId: string, now = new Date()): Promise<{ usedKobo: bigint; leftKobo: bigint; paid: boolean }> {
  assertMayPay(p);
  await releaseDue(now);
  const result = await system(async (tx) => {
    await lockKey(tx, `invoice:${invoiceId}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `payout:${p.userId}`);
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, ...(p.companyId ? { ownerCompanyId: p.companyId } : { ownerUserId: p.userId }) } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "OPEN") throw new Error("This invoice is not open for payment");
    if (inv.purpose !== "SUBSCRIPTION") throw new Error("Rewards can be used toward plans only");
    if (inv.currency !== "NGN") throw new Error("Rewards are in naira and can be used on invoices in naira only");
    if (await tx.payment.findFirst({ where: { invoiceId: inv.id, status: "PENDING" } })) throw new Error("A payment for this invoice is still in progress. Finish it, or wait a few minutes and try again.");
    if (await tx.rewardRestriction.findFirst({ where: { userId: p.userId, liftedAt: null } })) throw new Error("Rewards on your account are paused, so they cannot be used right now.");
    const actor = { id: p.userId, name: "Plan credit" };
    const all = await tx.reward.findMany({ where: { userId: p.userId, status: "PAYABLE", payoutId: null }, orderBy: { createdAt: "asc" } });
    const ok: typeof all = [];
    for (const r of all) {
      const problem = await sourceProblem(tx, r);
      if (problem) await moveReward(tx, r, "CANCELLED", actor, `${problem} Cancelled before use.`);
      else ok.push(r);
    }
    const { use, total } = pickRewards(ok, inv.amountKobo);
    if (total <= 0n) throw new Error(ok.length ? "Each of your rewards is larger than what is left to pay, so none can be used on this invoice." : "You have no rewards ready to use yet.");
    const payout = await tx.rewardPayout.create({ data: { ref: randomRef("PO", 8), userId: p.userId, amountKobo: total, status: "PAID", method: "PLAN_CREDIT", reference: inv.ref, note: `Used toward ${inv.description}`.slice(0, 500), createdById: p.userId, createdByName: "Plan credit", verifiedById: SYSTEM, verifiedAt: now } });
    await tx.reward.updateMany({ where: { id: { in: use.map((r) => r.id) } }, data: { payoutId: payout.id } });
    for (const r of use) await moveReward(tx, { ...r, payoutId: payout.id }, "PAID", actor, `Used toward invoice ${inv.ref}`, { paidAt: now }, false);
    const left = inv.amountKobo - total;
    const list = inv.listAmountKobo ?? inv.amountKobo + inv.discountKobo + inv.creditKobo;
    const updated = await tx.invoice.update({ where: { id: inv.id }, data: { amountKobo: left, creditKobo: inv.creditKobo + total, listAmountKobo: list, ...(left === 0n ? { status: "PAID", paidAt: now } : {}) } });
    const owner: Owner = inv.ownerUserId ? { kind: "USER", userId: inv.ownerUserId } : { kind: "COMPANY", companyId: inv.ownerCompanyId! };
    if (left === 0n) await applyInvoice(tx, updated, now);
    await logActivity(tx, { companyId: inv.ownerCompanyId, actorId: p.userId, entityType: "invoice", entityId: inv.id, action: "invoice.reward_credit", detail: { ref: inv.ref, used: total.toString(), rewards: use.length, payout: payout.ref } });
    await notify(tx, p.userId, { kind: "billing.credit", title: left === 0n ? "Your rewards paid for your plan" : "Your rewards were used toward your plan", body: `${formatKobo(total)} of your rewards went toward ${inv.ref}.${left === 0n ? " Your plan is on." : ` ${formatKobo(left)} is left to pay.`}`, link: `${billingLink(owner)}/${inv.id}`, dedupeKey: `credit:${payout.id}` });
    return { usedKobo: total, leftKobo: left, paid: left === 0n };
  });
  return result;
}
