/**
 * Verification network, stage 7: what a case costs, how it is paid for, what the provider earns and how it is paid out.
 *
 *  - Housy quotes the customer a price; Housy's fee and the provider's share are fixed on the case at that moment, so the
 *    provider sees its share before accepting. The quote is an ordinary invoice: the customer pays it online (when online
 *    payment is set up) or by bank transfer that Housy's administrators confirm, through the platform's billing.
 *  - A paid invoice moves the case on to be offered to a provider. The money is held (FUNDS_HELD in the VERIFICATION ledger).
 *  - When the report is released the provider has an earning, PENDING until the customer confirms or the waiting time passes
 *    without a dispute; a dispute or revocation holds it. When it becomes payable, Housy's fee is recognised as revenue and the
 *    provider's share becomes a liability to the provider (PROVIDER_PAYABLE).
 *  - Housy prepares a payout of a provider's payable earnings to the bank account on record, makes the transfer from its bank
 *    and records the transfer reference. There is no automatic bank transfer: the screens say so.
 *  - A refund is possible while the money is still held; once it is the provider's earning, it is not refunded from here.
 *
 * Every amount is in kobo. Every write is checked again by database triggers (earnings and payouts move only as allowed and
 * never change once paid; a case's price is fixed once quoted).
 */
import { z } from "zod";
import { bankLines, checkBankDetails, currencyOf, isCountry, parseMoney } from "../regions";
import { payoutRate } from "../verification-finance-rules";
import { withPlatformAdmin, withUser, type Tx } from "../db";
import { lockKey } from "../locks";
import { parseNairaToKobo, formatKobo } from "../money";
import { logActivity } from "../audit";
import { notify } from "./notifications";
import { post } from "./billing";
import { vpCan } from "../verification-network-rules";
import { canMoveCase, type CaseStatus } from "../verification-case-rules";
import {
  MAX_PRICE_KOBO, MIN_PRICE_KOBO, PLATFORM_FEE_BPS, maskAccount, payableFrom, payoutDetailsProblem, payoutRef, splitPrice, canMoveEarning,
  type EarningStatus,
} from "../verification-finance-rules";
import type { VpCtx } from "./verification-network";

const SYSTEM = "system";
const system = <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(SYSTEM, fn);
const INVOICE_DAYS = 14;

/** Run one step as Housy inside a transaction a person started, after the person's right to take the action was checked. */
export async function asHousy<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.$queryRaw`SELECT set_config('app.platform_admin', 'on', true)`;
  // On failure the transaction is already aborted and rolls back with everything in it, so only reset on success.
  const out = await fn();
  await tx.$queryRaw`SELECT set_config('app.platform_admin', '', true)`;
  return out;
}

async function notifyProviderFinance(tx: Tx, providerId: string, n: Parameters<typeof notify>[2]) {
  const people = await tx.providerMember.findMany({ where: { providerId, status: "ACTIVE", role: { in: ["OWNER", "FINANCE"] } }, select: { userId: true } });
  for (const p of people) await notify(tx, p.userId, n);
}
async function notifyAdmins(tx: Tx, n: Parameters<typeof notify>[2]) {
  for (const a of await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 50 })) await notify(tx, a.id, n);
}
async function caseActivity(tx: Tx, caseId: string, providerId: string | null, actorId: string, action: string, note: string, from = "", to = "", visible = true) {
  await tx.vpCaseActivity.create({ data: { caseId, providerId, actorId, actorKind: "platform", action, fromStatus: from, toStatus: to, note: note.slice(0, 3000), visibleToCustomer: visible } });
}

// ---------- The quote and the invoice ----------

/**
 * Housy quotes the customer: the price is fixed with Housy's fee and the provider's share, an invoice is raised, and the case
 * waits for payment. Only a new request can be quoted, once.
 */
export async function quoteCase(adminId: string, ref: string, priceInput: string, note: string) {
  let priceKobo: bigint;
  try { priceKobo = parseNairaToKobo(priceInput); } catch { throw new Error("Enter the price in naira, for example 150,000."); }
  if (priceKobo < MIN_PRICE_KOBO || priceKobo > MAX_PRICE_KOBO) throw new Error(`The price must be between ${formatKobo(MIN_PRICE_KOBO)} and ${formatKobo(MAX_PRICE_KOBO)}.`);
  const { feeKobo } = splitPrice(priceKobo, PLATFORM_FEE_BPS);
  const text = note.trim().slice(0, 1000);
  return withPlatformAdmin(adminId, async (tx) => {
    await lockKey(tx, `vr-quote:${ref}`);
    const c = await tx.vpCase.findUnique({ where: { ref }, select: { id: true, status: true, requesterId: true, priceKobo: true, services: true, propertyAddress: true } });
    if (!c) throw new Error("That case was not found.");
    if (c.priceKobo !== null) throw new Error("This case has already been quoted. Its price cannot change.");
    if (!canMoveCase(c.status as CaseStatus, "PENDING_PAYMENT", { kind: "platform" })) throw new Error("Only a new request can be quoted.");
    const requester = await tx.user.findUniqueOrThrow({ where: { id: c.requesterId }, select: { name: true } });
    const year = new Date().getFullYear();
    await lockKey(tx, "vr-invoice-ref");
    const n = await tx.invoice.count({ where: { ref: { startsWith: `INV-VR-${year}-` } } });
    const inv = await tx.invoice.create({ data: {
      ref: `INV-VR-${year}-${String(n + 1).padStart(6, "0")}`, purpose: "VERIFICATION", ownerKind: "USER", ownerUserId: c.requesterId, ownerName: requester.name,
      subjectId: c.id, description: `Property verification ${ref}: ${c.propertyAddress.slice(0, 120)}`, amountKobo: priceKobo,
      dueOn: new Date(Date.now() + INVOICE_DAYS * 86_400_000), createdById: adminId,
    } });
    await tx.vpCase.update({ where: { id: c.id }, data: { status: "PENDING_PAYMENT", priceKobo, feeKobo, invoiceId: inv.id } });
    await caseActivity(tx, c.id, null, adminId, "quoted", `${formatKobo(priceKobo)}${text ? `. ${text}` : ""}`, c.status, "PENDING_PAYMENT");
    await notify(tx, c.requesterId, { kind: "verification.case", title: `Verification ${ref}: ${formatKobo(priceKobo)}`, body: "Pay the invoice and Housy will offer your case to a qualified provider.", link: `/me/billing/${inv.id}` });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_case", entityId: c.id, action: "verification.quoted", detail: { ref, invoice: inv.ref, priceKobo: priceKobo.toString(), feeKobo: feeKobo.toString() } });
    return inv.id;
  });
}

/** Called by billing when a verification invoice is paid, inside the payment's transaction. */
export async function applyVerificationPayment(tx: Tx, inv: { id: string; ref: string; subjectId: string }, now: Date) {
  const c = await tx.vpCase.findUnique({ where: { id: inv.subjectId }, select: { id: true, ref: true, status: true, invoiceId: true } });
  if (!c || c.invoiceId !== inv.id) {
    await notifyAdmins(tx, { kind: "verification.case", title: `Payment for ${inv.ref} matches no case`, body: "Look into it and refund the customer if needed.", link: "/admin/payments" });
    return;
  }
  await tx.invoice.update({ where: { id: inv.id }, data: { appliedAt: now } });
  if (c.status === "PENDING_PAYMENT") {
    await tx.vpCase.update({ where: { id: c.id }, data: { status: "READY_FOR_ASSIGNMENT" } });
    await caseActivity(tx, c.id, null, SYSTEM, "payment_received", `Invoice ${inv.ref} paid.`, "PENDING_PAYMENT", "READY_FOR_ASSIGNMENT");
    await notifyAdmins(tx, { kind: "verification.case", title: `Case ${c.ref} paid`, body: "Offer it to a provider.", link: `/admin/verification/cases/${c.ref}` });
  } else {
    await caseActivity(tx, c.id, null, SYSTEM, "payment_received", `Invoice ${inv.ref} paid while the case was "${c.status.toLowerCase().replace(/_/g, " ")}".`, "", "", false);
    await notifyAdmins(tx, { kind: "verification.case", title: `Case ${c.ref} was paid after it closed`, body: "Refund the customer from Payments.", link: `/admin/verification/cases/${c.ref}` });
  }
}

/** Housy cannot refund money that has become the provider's earning. Checked before any refund of a verification payment. */
export async function assertVerificationRefundable(tx: Tx, invoiceId: string) {
  const e = await tx.vpEarning.findFirst({ where: { invoiceId }, select: { recognisedAt: true, status: true } });
  if (e?.recognisedAt) throw new Error("This verification fee has already become the provider's earning, so it cannot be refunded from here. Settle it with the provider first, then record an adjustment.");
}

/** After a refund of a verification payment: an earning not yet the provider's is cancelled. */
export async function applyVerificationRefund(tx: Tx, inv: { id: string; subjectId: string; ref: string }, full: boolean, actorId: string, now: Date) {
  const e = await tx.vpEarning.findFirst({ where: { invoiceId: inv.id } });
  const c = await tx.vpCase.findUnique({ where: { id: inv.subjectId }, select: { id: true, providerId: true } });
  if (e && full && !e.recognisedAt && canMoveEarning(e.status as EarningStatus, "VOID")) {
    await tx.vpEarning.update({ where: { id: e.id }, data: { status: "VOID", voidedAt: now, voidReason: `Refunded to the customer (${inv.ref})` } });
    await notifyProviderFinance(tx, e.providerId, { kind: "verification.finance", title: "An earning was cancelled", body: `The customer was refunded for invoice ${inv.ref}.`, link: "/provider" });
  }
  if (c) await caseActivity(tx, c.id, c.providerId, actorId, "refunded", full ? "The customer was refunded in full." : "The customer was refunded in part.", "", "", true);
}

// ---------- Earnings follow the case ----------

/** The report was released: the provider has an earning (once per case), waiting for the customer. A re-release after a correction restarts the wait. */
export async function earningOnRelease(tx: Tx, caseId: string, now: Date) {
  const c = await tx.vpCase.findUniqueOrThrow({ where: { id: caseId }, select: { id: true, providerId: true, invoiceId: true, priceKobo: true, feeKobo: true } });
  if (!c.invoiceId || c.priceKobo === null || c.feeKobo === null || !c.providerId) return;
  const inv = await tx.invoice.findUnique({ where: { id: c.invoiceId }, select: { status: true } });
  if (inv?.status !== "PAID") return;
  const e = await tx.vpEarning.findUnique({ where: { caseId } });
  if (!e) {
    await tx.vpEarning.create({ data: { caseId, providerId: c.providerId, invoiceId: c.invoiceId, grossKobo: c.priceKobo, feeKobo: c.feeKobo, netKobo: c.priceKobo - c.feeKobo, payableFrom: payableFrom(now) } });
  } else if (e.status === "HELD" && !e.recognisedAt) {
    await tx.vpEarning.update({ where: { id: e.id }, data: { status: "PENDING", heldReason: "", payableFrom: payableFrom(now) } });
  } else if (e.status === "HELD") {
    await tx.vpEarning.update({ where: { id: e.id }, data: { status: "PAYABLE", heldReason: "" } });
  }
}

/** A dispute or a revocation holds the earning until Housy decides. One already in a payout or paid is reported to Housy instead. */
export async function holdEarning(tx: Tx, caseId: string, reason: string) {
  const e = await tx.vpEarning.findUnique({ where: { caseId } });
  if (!e) return;
  if (canMoveEarning(e.status as EarningStatus, "HELD")) await tx.vpEarning.update({ where: { id: e.id }, data: { status: "HELD", heldReason: reason.slice(0, 500) } });
  else if (e.status === "IN_PAYOUT" || e.status === "PAID") await notifyAdmins(tx, { kind: "verification.finance", title: "A disputed case's earning is already being paid out", body: reason.slice(0, 200), link: "/admin/verification/payouts" });
}

/** Recognise an earning in the books: Housy's fee is revenue, the provider's share is owed to the provider. Once per earning. */
async function recognise(tx: Tx, e: { id: string; invoiceId: string; grossKobo: bigint; feeKobo: bigint; netKobo: bigint; recognisedAt: Date | null }, actorId: string, now: Date) {
  if (e.recognisedAt) return;
  // Booked like advertising spend: held money is used up, part as Housy's revenue and part owed onward to the provider.
  const base = { ledger: "VERIFICATION" as const, kind: "SPEND" as const, invoiceId: e.invoiceId, actorId, note: "Verification delivered" };
  await post(tx, { ...base, account: "FUNDS_HELD", amountKobo: -e.grossKobo, entryKey: `vr-earn:${e.id}:held` });
  if (e.feeKobo > 0n) await post(tx, { ...base, account: "REVENUE", amountKobo: e.feeKobo, entryKey: `vr-earn:${e.id}:fee` });
  await post(tx, { ...base, account: "PROVIDER_PAYABLE", amountKobo: e.netKobo, entryKey: `vr-earn:${e.id}:net` });
  await tx.vpEarning.update({ where: { id: e.id }, data: { recognisedAt: now } });
}

/** The customer confirmed the report, or a dispute was closed with the report standing: the earning is payable now. */
export async function earningPayable(tx: Tx, caseId: string, actorId: string, now: Date) {
  const e = await tx.vpEarning.findUnique({ where: { caseId } });
  if (!e || !canMoveEarning(e.status as EarningStatus, "PAYABLE")) return;
  // A refund under way decides first: the money may be going back to the customer.
  if (await tx.refund.findFirst({ where: { invoiceId: e.invoiceId, status: "PENDING" } })) return;
  await recognise(tx, e, actorId, now);
  await tx.vpEarning.update({ where: { id: e.id }, data: { status: "PAYABLE", heldReason: "" } });
  await notifyProviderFinance(tx, e.providerId, { kind: "verification.finance", title: `${formatKobo(e.netKobo)} ready to be paid out`, body: "It will be included in your next payout from Housy.", link: "/provider" });
}

/** Earnings whose waiting time has passed without a dispute become payable. Runs on a schedule and when finance pages load. */
export async function matureEarnings(now = new Date()) {
  const due = await system((tx) => tx.vpEarning.findMany({ where: { status: "PENDING", payableFrom: { lte: now } }, select: { caseId: true }, take: 200 }));
  for (const d of due) {
    await system(async (tx) => {
      await lockKey(tx, `vr-earning:${d.caseId}`);
      const c = await tx.vpCase.findUnique({ where: { id: d.caseId }, select: { status: true } });
      if (c && (c.status === "DELIVERED" || c.status === "COMPLETED")) await earningPayable(tx, d.caseId, SYSTEM, now);
    });
  }
  return due.length;
}

// ---------- Payouts ----------

/** What Housy owes each provider: payable earnings, what is in prepared payouts, and the bank account on record. */
export async function payoutOverview(adminId: string) {
  await matureEarnings();
  return withPlatformAdmin(adminId, async (tx) => {
    const [groups, payouts, held] = await Promise.all([
      tx.vpEarning.groupBy({ by: ["providerId"], where: { status: "PAYABLE" }, _sum: { netKobo: true }, _count: { _all: true } }),
      tx.vpPayout.findMany({ orderBy: { preparedAt: "desc" }, take: 50 }),
      tx.vpEarning.findMany({ where: { status: "HELD" }, select: { id: true, caseId: true, providerId: true, netKobo: true, heldReason: true } }),
    ]);
    const ids = [...new Set([...groups.map((g) => g.providerId), ...payouts.map((p) => p.providerId), ...held.map((h) => h.providerId)])];
    const providers = new Map((await tx.serviceProvider.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, providerCode: true } })).map((p) => [p.id, p]));
    const accounts = new Map((await tx.vpPayoutAccount.findMany({ where: { providerId: { in: ids } } })).map((a) => [a.providerId, a]));
    const cases = new Map((await tx.vpCase.findMany({ where: { id: { in: held.map((h) => h.caseId) } }, select: { id: true, ref: true } })).map((c) => [c.id, c.ref]));
    return {
      payable: groups.map((g) => {
        const p = providers.get(g.providerId);
        const acct = accounts.get(g.providerId);
        return { providerId: g.providerId, name: p?.name ?? "", code: p?.providerCode ?? "", totalKobo: g._sum.netKobo ?? 0n, count: g._count._all, account: acct && !payoutDetailsProblem(acct) ? `${acct.bankName} · ${acct.accountName} · ${maskAccount(acct.accountNumber)}` : null };
      }),
      payouts: payouts.map((p) => ({ ...p, providerName: providers.get(p.providerId)?.name ?? "" })),
      held: held.map((h) => ({ ...h, providerName: providers.get(h.providerId)?.name ?? "", caseRef: cases.get(h.caseId) ?? "" })),
    };
  });
}

/** Gather a provider's payable earnings into a payout to the bank account on record now. */
export async function preparePayout(adminId: string, providerId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    await lockKey(tx, `vr-payout:${providerId}`);
    const provider = await tx.serviceProvider.findUnique({ where: { id: providerId }, select: { name: true } });
    if (!provider) throw new Error("That provider was not found.");
    const acct = await tx.vpPayoutAccount.findUnique({ where: { providerId } });
    const p = { payoutBankName: acct?.bankName ?? "", payoutAccountName: acct?.accountName ?? "", payoutAccountNumber: acct?.accountNumber ?? "" };
    if (!acct || payoutDetailsProblem(acct)) throw new Error("This provider has not recorded a complete bank account for payouts. Its owner or finance staff add it on their Finance page.");
    if (await tx.vpPayout.findFirst({ where: { providerId, status: "PREPARED" } })) throw new Error("A payout for this provider is already prepared. Record it as paid or cancel it first.");
    const earnings = await tx.vpEarning.findMany({ where: { providerId, status: "PAYABLE" }, select: { id: true, netKobo: true } });
    if (!earnings.length) throw new Error("Nothing is ready to pay this provider.");
    const total = earnings.reduce((n, e) => n + e.netKobo, 0n);
    const year = new Date().getFullYear();
    await lockKey(tx, "vr-payout-ref");
    const n = await tx.vpPayout.count({ where: { ref: { startsWith: `HVO-${year}-` } } });
    const payout = await tx.vpPayout.create({ data: { ref: payoutRef(year, n + 1), providerId, totalKobo: total, currency: currencyOf(acct.country), bankName: p.payoutBankName, accountName: p.payoutAccountName, accountNumber: p.payoutAccountNumber, preparedById: adminId } });
    await tx.vpEarning.updateMany({ where: { id: { in: earnings.map((e) => e.id) }, status: "PAYABLE" }, data: { status: "IN_PAYOUT", payoutId: payout.id } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_payout", entityId: payout.id, action: "verification.payout_prepared", detail: { ref: payout.ref, providerId, totalKobo: total.toString(), earnings: earnings.length } });
    await notifyProviderFinance(tx, providerId, { kind: "verification.finance", title: `Payout ${payout.ref} prepared: ${formatKobo(total)}`, body: `To ${p.payoutBankName}, ${maskAccount(p.payoutAccountNumber)}. Housy will record the transfer once it is made.`, link: "/provider" });
    return payout.ref;
  });
}

/** Housy's finance team made the bank transfer: record its reference. The payout and its earnings are then final. */
/**
 * Record a payout as paid once the transfer is made. Earnings are in naira; for an account outside Nigeria, the amount actually
 * sent in the account's currency is recorded too, so the organisation sees what arrived and the rate used.
 */
export async function markPayoutPaid(adminId: string, payoutRefValue: string, input: { reference: string; paidOn: string; sent?: string }) {
  const reference = input.reference.trim().toUpperCase().replace(/\s+/g, " ");
  if (reference.length < 3 || reference.length > 80) throw new Error("Enter the bank transfer reference.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) throw new Error("Enter the date the transfer was made.");
  const paidAt = new Date(`${input.paidOn}T12:00:00+01:00`);
  if (paidAt.getTime() > Date.now() + 86_400_000) throw new Error("The transfer date cannot be in the future.");
  await withPlatformAdmin(adminId, async (tx) => {
    const payout = await tx.vpPayout.findUnique({ where: { ref: payoutRefValue } });
    if (!payout) throw new Error("That payout was not found.");
    await lockKey(tx, `vr-payout:${payout.providerId}`);
    if (payout.status !== "PREPARED") throw new Error("Only a prepared payout can be recorded as paid.");
    if (await tx.vpPayout.findFirst({ where: { transferReference: reference, status: "PAID" } })) throw new Error("That transfer reference has already been recorded for another payout.");
    let sentMinor: bigint | null = null;
    if (payout.currency !== "NGN") {
      try { sentMinor = parseMoney(input.sent ?? "", payout.currency); } catch { throw new Error(`Enter the amount sent in ${payout.currency}, as the bank transfer shows it.`); }
      if (sentMinor <= 0n) throw new Error(`Enter the amount sent in ${payout.currency}, as the bank transfer shows it.`);
    }
    const earnings = await tx.vpEarning.findMany({ where: { payoutId: payout.id, status: "IN_PAYOUT" }, select: { id: true, netKobo: true } });
    if (earnings.reduce((n, e) => n + e.netKobo, 0n) !== payout.totalKobo) throw new Error("This payout's earnings no longer add up to its total. Cancel it and prepare it again.");
    await tx.vpPayout.update({ where: { id: payout.id }, data: { status: "PAID", transferReference: reference, paidById: adminId, paidAt, sentMinor } });
    await tx.vpEarning.updateMany({ where: { payoutId: payout.id, status: "IN_PAYOUT" }, data: { status: "PAID", paidAt } });
    await post(tx, { ledger: "VERIFICATION", kind: "SPEND", account: "PROVIDER_PAYABLE", amountKobo: -payout.totalKobo, entryKey: `vr-payout:${payout.id}`, actorId: adminId, note: `Payout ${payout.ref}, transfer ${reference}` });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_payout", entityId: payout.id, action: "verification.payout_paid", detail: { ref: payout.ref, reference, totalKobo: payout.totalKobo.toString(), ...(sentMinor !== null ? { currency: payout.currency, sentMinor: sentMinor.toString() } : {}) } });
    const sentText = sentMinor !== null ? ` as ${formatKobo(sentMinor, payout.currency)} (${payoutRate(payout.totalKobo, sentMinor, payout.currency)})` : "";
    await notifyProviderFinance(tx, payout.providerId, { kind: "verification.finance", title: `Payout ${payout.ref} paid: ${formatKobo(payout.totalKobo, "NGN")}${sentText}`, body: `Transfer reference ${reference}, to ${payout.bankName} ${maskAccount(payout.accountNumber)}.`, link: "/provider" });
  });
}

export async function cancelPayout(adminId: string, payoutRefValue: string, reason: string) {
  const text = z.string().trim().min(5, "Give the reason (5 characters or more)").max(500).parse(reason);
  await withPlatformAdmin(adminId, async (tx) => {
    const payout = await tx.vpPayout.findUnique({ where: { ref: payoutRefValue } });
    if (!payout) throw new Error("That payout was not found.");
    await lockKey(tx, `vr-payout:${payout.providerId}`);
    if (payout.status !== "PREPARED") throw new Error("Only a prepared payout can be cancelled.");
    await tx.vpEarning.updateMany({ where: { payoutId: payout.id, status: "IN_PAYOUT" }, data: { status: "PAYABLE", payoutId: null } });
    await tx.vpPayout.update({ where: { id: payout.id }, data: { status: "CANCELLED", cancelledById: adminId, cancelledAt: new Date(), cancelReason: text } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_payout", entityId: payout.id, action: "verification.payout_cancelled", detail: { ref: payout.ref, reason: text } });
    await notifyProviderFinance(tx, payout.providerId, { kind: "verification.finance", title: `Payout ${payout.ref} cancelled`, body: `${text} Its earnings will be in the next payout.`, link: "/provider" });
  });
}

/** Release a held earning (back to waiting or payable), or cancel it after the customer has been refunded. */
export async function decideHeldEarning(adminId: string, earningId: string, release: boolean, note: string) {
  const text = z.string().trim().min(5, "Record the reason (5 characters or more)").max(500).parse(note);
  await withPlatformAdmin(adminId, async (tx) => {
    const e = await tx.vpEarning.findUnique({ where: { id: earningId } });
    if (!e || e.status !== "HELD") throw new Error("That earning is not held.");
    if (release) {
      if (e.recognisedAt) await tx.vpEarning.update({ where: { id: e.id }, data: { status: "PAYABLE", heldReason: "" } });
      else await earningPayable(tx, e.caseId, adminId, new Date());
    } else {
      if (e.recognisedAt) throw new Error("This earning is already the provider's money in the books; it cannot be cancelled here. Record an adjustment with the provider's agreement instead.");
      const refunded = await tx.payment.findFirst({ where: { invoiceId: e.invoiceId, refundedKobo: { gt: 0n } } });
      if (!refunded) throw new Error("Refund the customer from Payments first; the earning is then cancelled automatically.");
      await tx.vpEarning.update({ where: { id: e.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: text } });
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_earning", entityId: e.id, action: release ? "verification.earning_released" : "verification.earning_cancelled", detail: { note: text } });
  });
}

// ---------- The provider's side ----------

/**
 * The bank account Housy pays this organisation to, in the organisation's country (a NUBAN in Nigeria; a sort code, routing
 * number, IBAN and so on elsewhere: see regions.ts). Owner and finance staff only; not while a payout to the old account is
 * being prepared. Earnings are in naira; Housy converts when it pays an account abroad.
 */
export async function setPayoutDetails(ctx: VpCtx, input: Record<string, string | undefined>) {
  if (!vpCan(ctx.role, "finance.manage")) throw new Error("Only the organisation's owner or finance staff can change where payouts go.");
  const country = input.country && isCountry(input.country) ? input.country : "NG";
  const raw = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, (v ?? "").trim()]));
  let details: Record<string, string>;
  if (country === "NG") {
    const d = { bankName: raw.bankName ?? "", accountName: raw.accountName ?? "", accountNumber: (raw.accountNumber ?? "").replace(/\s+/g, "") };
    const problem = payoutDetailsProblem(d);
    if (problem) throw new Error(problem);
    details = d;
  } else {
    const r = checkBankDetails(country, raw);
    if (!r.ok) throw new Error(r.problem);
    details = r.details;
  }
  const summary = { bankName: (details.bankName ?? "").slice(0, 80), accountName: (details.accountName ?? "").slice(0, 120), accountNumber: details.accountNumber ?? details.iban ?? "" };
  await system(async (tx) => {
    await lockKey(tx, `vr-payout:${ctx.providerId}`);
    if (await tx.vpPayout.findFirst({ where: { providerId: ctx.providerId, status: "PREPARED" } })) throw new Error("A payout to your current account is being prepared. Change the account after it has been paid.");
    const data = { ...summary, country, bankDetails: details, updatedById: ctx.userId };
    await tx.vpPayoutAccount.upsert({ where: { providerId: ctx.providerId }, create: { providerId: ctx.providerId, ...data }, update: data });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.payout_account_changed", detail: { bank: summary.bankName, account: maskAccount(summary.accountNumber), country } });
    // Everyone who handles the organisation's money hears about a change of account, so a wrong change is noticed.
    await notifyProviderFinance(tx, ctx.providerId, { kind: "verification.finance", title: "Payout bank account changed", body: `Payouts now go to ${summary.bankName}, ${maskAccount(summary.accountNumber)}. If you did not expect this, tell Housy at once.`, link: `/provider/${ctx.code}/finance` });
  });
}

/** The organisation's money: what it has earned, what is waiting, held, ready or paid, its payouts, and where they go. */
export async function providerFinance(ctx: VpCtx) {
  if (!vpCan(ctx.role, "finance.view")) throw new Error("Your role in this organisation does not allow that.");
  await matureEarnings();
  return withUser(ctx.userId, async (tx) => {
    const [earnings, payouts] = await Promise.all([
      tx.vpEarning.findMany({ where: { providerId: ctx.providerId }, orderBy: { createdAt: "desc" }, take: 500 }),
      tx.vpPayout.findMany({ where: { providerId: ctx.providerId }, orderBy: { preparedAt: "desc" }, take: 100 }),
    ]);
    const cases = new Map((await system((t2) => t2.vpCase.findMany({ where: { id: { in: earnings.map((e) => e.caseId) }, providerId: ctx.providerId }, select: { id: true, ref: true, propertyAddress: true } }))).map((c) => [c.id, c]));
    const sum = (st: string[]) => earnings.filter((e) => st.includes(e.status)).reduce((n, e) => n + e.netKobo, 0n);
    const a = await tx.vpPayoutAccount.findUnique({ where: { providerId: ctx.providerId } });
    const p = { payoutBankName: a?.bankName ?? "", payoutAccountName: a?.accountName ?? "", payoutAccountNumber: a?.accountNumber ?? "", payoutUpdatedAt: a?.updatedAt ?? null };
    const manageMoney = vpCan(ctx.role, "finance.manage");
    const details = (a?.bankDetails ?? null) as Record<string, string> | null;
    return {
      totals: { pending: sum(["PENDING"]), held: sum(["HELD"]), payable: sum(["PAYABLE"]), inPayout: sum(["IN_PAYOUT"]), paid: sum(["PAID"]) },
      earnings: earnings.map((e) => ({ ...e, caseRef: cases.get(e.caseId)?.ref ?? "", property: cases.get(e.caseId)?.propertyAddress ?? "" })),
      payouts,
      account: { bankName: p.payoutBankName, accountName: p.payoutAccountName, accountNumber: vpCan(ctx.role, "finance.manage") ? p.payoutAccountNumber : maskAccount(p.payoutAccountNumber), updatedAt: p.payoutUpdatedAt,
        complete: !!a && !payoutDetailsProblem(a), country: a?.country ?? "NG", details: manageMoney ? details : null,
        lines: a && details ? bankLines(a.country, details).map((l) => (manageMoney || !/number|IBAN/i.test(l.label) ? l : { ...l, value: maskAccount(l.value) })) : [] },
    };
  });
}

const csvCell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
/** A statement of the organisation's earnings, for its accounts. */
export async function providerStatementCsv(ctx: VpCtx) {
  const f = await providerFinance(ctx);
  const payoutRefs = new Map(f.payouts.map((p) => [p.id, p]));
  const head = ["Case", "Property", "Price (NGN)", "Housy fee (NGN)", "Your share (NGN)", "Status", "Payable from", "Payout", "Transfer reference", "Paid on"];
  const rows = f.earnings.map((e) => {
    const p = e.payoutId ? payoutRefs.get(e.payoutId) : undefined;
    return [e.caseRef, e.property, (Number(e.grossKobo) / 100).toFixed(2), (Number(e.feeKobo) / 100).toFixed(2), (Number(e.netKobo) / 100).toFixed(2), e.status, e.payableFrom?.toISOString().slice(0, 10) ?? "", p?.ref ?? "", p?.transferReference ?? "", e.paidAt?.toISOString().slice(0, 10) ?? ""];
  });
  return [head, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(",")).join("\r\n") + "\r\n";
}

// ---------- The books agree ----------

type Entry = { ledger: string; account: string; amountKobo: bigint; invoiceId: string | null; entryKey: string | null };

/** Checks run with the platform's reconciliation: money held equals paid fees not yet delivered; owed to providers equals payable earnings not yet paid. */
export async function reconcileVerification(adminId: string, entries: Entry[]) {
  const v = entries.filter((e) => e.ledger === "VERIFICATION");
  const findings: { code: string; message: string; refs: string[] }[] = [];
  const data = await withPlatformAdmin(adminId, async (tx) => ({
    earnings: await tx.vpEarning.findMany({ take: 20000 }),
    payouts: await tx.vpPayout.findMany({ where: { status: "PAID" }, take: 20000 }),
  }));
  const owed = v.filter((e) => e.account === "PROVIDER_PAYABLE").reduce((n, e) => n + e.amountKobo, 0n);
  const expectedOwed = data.earnings.filter((e) => e.recognisedAt && e.status !== "PAID").reduce((n, e) => n + e.netKobo, 0n);
  if (owed !== expectedOwed) findings.push({ code: "VERIFICATION_PAYABLE_MISMATCH", message: `Owed to verification providers is ${formatKobo(owed)} in the books but ${formatKobo(expectedOwed)} by their earnings.`, refs: [] });
  const notBooked = data.payouts.filter((p) => !v.some((e) => e.entryKey === `vr-payout:${p.id}`));
  if (notBooked.length) findings.push({ code: "VERIFICATION_PAYOUT_NOT_BOOKED", message: "Paid provider payouts that are not in the books.", refs: notBooked.map((p) => p.ref).slice(0, 20) });
  const unrecognisedPaid = data.earnings.filter((e) => !e.recognisedAt && ["PAYABLE", "IN_PAYOUT", "PAID"].includes(e.status));
  if (unrecognisedPaid.length) findings.push({ code: "VERIFICATION_EARNING_NOT_RECOGNISED", message: "Earnings being paid that were never recognised in the books.", refs: unrecognisedPaid.map((e) => e.id).slice(0, 20) });
  const held = v.filter((e) => e.account === "FUNDS_HELD").reduce((n, e) => n + e.amountKobo, 0n);
  if (held < 0n) findings.push({ code: "VERIFICATION_HELD_NEGATIVE", message: `Money held for verifications is negative (${formatKobo(held)}).`, refs: [] });
  return findings;
}
