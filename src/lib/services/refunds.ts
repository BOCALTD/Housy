import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { logActivity } from "../audit";
import { lockKey } from "../locks";
import { parseNairaToKobo } from "../money";
import { randomRef, refundable } from "../billing-rules";
import { configuredProvider, type ParsedEvent, type PaymentProvider } from "../payment-providers";
import { notify } from "./notifications";
import { system } from "./rewards";
import { syncCompanyTier } from "./tiers";
import { accountFor, applyInvoice, ledgerFor, payerOf, post, type Deps } from "./billing";

// Giving money back, and settling a payment that did not match. Nothing here changes the books except by adding entries,
// and a refund is always something a named person asked for or the provider confirmed.

const providerOf = (d?: Deps): PaymentProvider | null => (d && "provider" in d ? d.provider ?? null : configuredProvider());
const nowOf = (d?: Deps) => d?.now ?? new Date();

async function assertAdmin(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

type PaymentFull = Prisma.PaymentGetPayload<{ include: { invoice: true } }>;

/** How much of a payment can still go back. For advertising it is also limited to budget not yet spent. */
async function limitFor(tx: Tx, pay: PaymentFull): Promise<bigint> {
  const room = refundable(pay);
  if (pay.invoice.purpose !== "AD_CAMPAIGN" || pay.status === "REVIEW") return room;
  const { unspentFor } = await import("./ads");
  const cap = (await unspentFor(tx, pay.invoice.subjectId)) + (await suspenseOf(tx, pay.id));
  return cap < room ? cap : room;
}

/** Money held aside for a payment (an overpayment that was accepted, or a payment still under review). */
async function suspenseOf(tx: Tx, paymentId: string): Promise<bigint> {
  const r = await tx.financeEntry.aggregate({ where: { paymentId, account: "SUSPENSE" }, _sum: { amountKobo: true } });
  return r._sum.amountKobo ?? 0n;
}

export async function refundLimit(adminId: string, paymentId: string): Promise<bigint> {
  await assertAdmin(adminId);
  return system(async (tx) => {
    const pay = await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!pay || (pay.status !== "SUCCEEDED" && pay.status !== "REVIEW")) return 0n;
    const l = await limitFor(tx, pay);
    return l > 0n ? l : 0n;
  });
}

/**
 * Give money back. The amount is reserved at once under a lock, so two refunds started together cannot give back more than was paid.
 * Online payments are refunded through the provider; the refund counts as done when the provider says so. A payment taken outside
 * the platform is refunded outside it, and the administrator confirms that it was.
 */
export async function requestRefund(adminId: string, paymentId: string, input: { amount: string; reason: string }, deps?: Deps) {
  await assertAdmin(adminId);
  const amount = parseNairaToKobo(input.amount);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error("Give the reason for this refund");
  const now = nowOf(deps);
  const created = await system(async (tx) => {
    await lockKey(tx, `payment:${paymentId}`);
    const pay = await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!pay) throw new Error("Payment not found");
    if (pay.status !== "SUCCEEDED" && pay.status !== "REVIEW") throw new Error("Only a payment that was received can be refunded");
    const limit = await limitFor(tx, pay);
    if (amount > limit) throw new Error(limit <= 0n ? "Nothing is left to refund on this payment" : "That is more than can still be refunded on this payment");
    const refund = await tx.refund.create({ data: { ref: randomRef("RFD"), paymentId: pay.id, invoiceId: pay.invoiceId, amountKobo: amount, reason: reason.slice(0, 500), requestedById: adminId } });
    await tx.payment.update({ where: { id: pay.id }, data: { refundedKobo: pay.refundedKobo + amount } });
    await logActivity(tx, { companyId: pay.invoice.ownerCompanyId, actorId: adminId, entityType: "refund", entityId: refund.id, action: "refund.requested", detail: { ref: refund.ref, invoice: pay.invoice.ref, amountKobo: amount.toString() } });
    return { refund, pay };
  });
  const { refund, pay } = created;
  if (pay.provider === "MANUAL") return { refundId: refund.id, status: "PENDING" as const, note: "Return the money to the payer, then confirm it here." };
  const provider = providerOf(deps);
  if (!provider || !pay.providerRef) {
    await failRefund(refund.id, "No payment provider is connected, so the refund could not be sent");
    throw new Error("No payment provider is connected, so the refund could not be sent");
  }
  const r = await provider.refund({ reference: pay.providerRef, amountKobo: amount, reason });
  if (!r.ok) {
    await failRefund(refund.id, r.error);
    throw new Error(`The provider refused the refund: ${r.error}`);
  }
  await system((tx) => tx.refund.update({ where: { id: refund.id }, data: { providerRef: r.providerRef.slice(0, 100) } }));
  if (r.completed) {
    await system(async (tx) => { await completeRefundIn(tx, refund.id, { actorId: adminId, now }); });
    return { refundId: refund.id, status: "COMPLETED" as const, note: "Refunded." };
  }
  return { refundId: refund.id, status: "PENDING" as const, note: "The provider is processing the refund. It will show as complete when the provider confirms." };
}

async function failRefund(refundId: string, reason: string) {
  await system((tx) => failRefundIn(tx, refundId, reason));
}

async function failRefundIn(tx: Tx, refundId: string, reason: string): Promise<string> {
  const r = await tx.refund.findUnique({ where: { id: refundId } });
  if (!r) return "UNKNOWN";
  await lockKey(tx, `payment:${r.paymentId}`);
  const fresh = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  if (fresh.status !== "PENDING") return "ALREADY";
  await tx.refund.update({ where: { id: fresh.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500) } });
  const pay = await tx.payment.findUniqueOrThrow({ where: { id: fresh.paymentId } });
  await tx.payment.update({ where: { id: pay.id }, data: { refundedKobo: pay.refundedKobo - fresh.amountKobo } });
  return "FAILED_RECORDED";
}

/** The person (or the provider's message) confirms the money has gone back. Adds the entry once, and takes back what the payment bought. */
export async function completeRefundIn(tx: Tx, refundId: string, by: { actorId?: string; eventId?: string; now: Date }): Promise<"COMPLETED" | "ALREADY"> {
  const r0 = await tx.refund.findUnique({ where: { id: refundId } });
  if (!r0) throw new Error("Refund not found");
  await lockKey(tx, `payment:${r0.paymentId}`);
  const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  if (refund.status !== "PENDING") return "ALREADY";
  const pay = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId }, include: { invoice: true } });
  const inv = pay.invoice;
  await tx.refund.update({ where: { id: refund.id }, data: { status: "COMPLETED", completedAt: by.now } });
  // Money held in suspense for this payment goes back first; the rest comes out of what was earned or held for the advertiser.
  const held = await suspenseOf(tx, pay.id);
  const fromSuspense = held > 0n ? (held < refund.amountKobo ? held : refund.amountKobo) : 0n;
  const rest = refund.amountKobo - fromSuspense;
  const base = { ledger: ledgerFor(inv.purpose), kind: "REFUND" as const, invoiceId: inv.id, paymentId: pay.id, refundId: refund.id, note: refund.reason, eventId: by.eventId, actorId: by.actorId };
  if (fromSuspense > 0n) await post(tx, { ...base, account: "SUSPENSE", amountKobo: -fromSuspense, entryKey: `refund:${refund.id}:s` });
  if (rest > 0n) await post(tx, { ...base, account: accountFor(inv.purpose), amountKobo: -rest, entryKey: `refund:${refund.id}:m` });
  const full = pay.refundedKobo >= (pay.receivedKobo ?? pay.amountKobo);
  if (pay.status === "REVIEW" && full) await tx.payment.update({ where: { id: pay.id }, data: { status: "FAILED", failureReason: "Refunded in full after review" } });
  if (inv.purpose === "SUBSCRIPTION" && pay.status === "SUCCEEDED" && full) await revokeSubscriptionTime(tx, inv, by.now);
  if (inv.purpose === "AD_CAMPAIGN" && pay.status === "SUCCEEDED" && rest > 0n) {
    const { applyCampaignRefund } = await import("./ads");
    await applyCampaignRefund(tx, inv.subjectId, rest, by.now);
  }
  await logActivity(tx, { companyId: inv.ownerCompanyId, actorId: by.actorId ?? "system", entityType: "refund", entityId: refund.id, action: "refund.completed", detail: { ref: refund.ref, invoice: inv.ref } });
  await notify(tx, payerOf(pay, inv), { kind: "billing.refund", title: "A refund has been issued", body: `${inv.description}. The money is on its way back to you.`, link: inv.ownerUserId ? "/me/billing" : "/app/billing", dedupeKey: `refund:${refund.id}` });
  return "COMPLETED";
}

/** A full refund takes back the time it bought. Time paid for earlier stays. A later payment that extended the period is left alone. */
async function revokeSubscriptionTime(tx: Tx, inv: Prisma.InvoiceGetPayload<object>, now: Date) {
  if (!inv.appliedAt || !inv.coversTo) return;
  const sub = await tx.subscription.findFirst({ where: inv.ownerUserId ? { ownerUserId: inv.ownerUserId } : { ownerCompanyId: inv.ownerCompanyId } });
  if (!sub || sub.periodEnd.getTime() !== inv.coversTo.getTime()) return;
  const keep = inv.previousEnd && inv.previousEnd.getTime() > now.getTime() ? inv.previousEnd : new Date(now.getTime() - 1);
  await tx.subscription.update({ where: { id: sub.id }, data: { periodEnd: keep, status: "CANCELLED", cancelledAt: now } });
  await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, kind: "CANCELLED", fromPlanId: sub.planId, toPlanId: sub.planId, periodEnd: keep, note: `Refunded in full, invoice ${inv.ref}`, actorId: "system" } });
  if (sub.ownerCompanyId) await syncCompanyTier(tx, sub.ownerCompanyId);
}

/** The administrator confirms that money paid outside the platform has been returned (or that the provider's dashboard shows the refund done). */
export async function confirmRefund(adminId: string, refundId: string, deps?: Deps) {
  await assertAdmin(adminId);
  const now = nowOf(deps);
  return system((tx) => completeRefundIn(tx, refundId, { actorId: adminId, now }));
}

/** The administrator abandons a refund that was never sent. The reserved amount becomes refundable again. */
export async function cancelRefund(adminId: string, refundId: string) {
  await assertAdmin(adminId);
  return system((tx) => failRefundIn(tx, refundId, "Cancelled by the administrator"));
}

/** A refund message from the provider. Matched to the refund we asked for; a refund we did not ask for is recorded and flagged, never ignored. */
export async function refundEventIn(tx: Tx, ev: ParsedEvent, eventId: string, now: Date): Promise<{ outcome: string; note: string }> {
  const pay = ev.reference ? await tx.payment.findUnique({ where: { provider_providerRef: { provider: "PAYSTACK", providerRef: ev.reference } } }) : null;
  if (!pay) return { outcome: "UNKNOWN_REFERENCE", note: "No payment has this reference" };
  const pending = await tx.refund.findMany({ where: { paymentId: pay.id, status: "PENDING" }, orderBy: { createdAt: "asc" } });
  const match = pending.find((r) => ev.amountKobo !== null && r.amountKobo === ev.amountKobo) ?? (pending.length === 1 && ev.amountKobo === null ? pending[0] : undefined);
  if (!match) return { outcome: "UNMATCHED_REFUND", note: "The provider reported a refund that no one asked for here. Check the provider's dashboard." };
  if (ev.kind === "REFUND_FAILED") return { outcome: await failRefundIn(tx, match.id, "The provider reported that the refund failed"), note: "" };
  return { outcome: await completeRefundIn(tx, match.id, { eventId, now }), note: "" };
}

// ---------- A payment that did not match ----------

/**
 * Decide a payment held for review. Accept it when more than enough arrived and the invoice is still open: the invoice is paid and
 * any extra stays in suspense to be refunded. Otherwise refund it.
 */
export async function acceptReviewedPayment(adminId: string, paymentId: string, noteInput: string, deps?: Deps) {
  await assertAdmin(adminId);
  const note = noteInput.trim();
  if (note.length < 5) throw new Error("Give the reason for accepting this payment");
  const now = nowOf(deps);
  await system(async (tx) => {
    await lockKey(tx, `payment:${paymentId}`);
    const pay = await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!pay || pay.status !== "REVIEW") throw new Error("This payment is not waiting for a decision");
    const received = pay.receivedKobo ?? 0n;
    if (pay.refundedKobo > 0n) throw new Error("Part of this payment was already refunded. Refund the rest instead.");
    if (received < pay.amountKobo) throw new Error("Less than the invoice amount arrived, so it cannot be accepted. Refund it, or ask the payer to pay the rest.");
    await lockKey(tx, `invoice:${pay.invoiceId}`);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: pay.invoiceId } });
    if (inv.status !== "OPEN") throw new Error("The invoice is no longer open. Refund this payment instead.");
    const ledger = ledgerFor(inv.purpose);
    await post(tx, { ledger, kind: "ADJUSTMENT", account: "SUSPENSE", amountKobo: -pay.amountKobo, invoiceId: inv.id, paymentId: pay.id, actorId: adminId, note: `Accepted after review: ${note}` });
    await post(tx, { ledger, kind: "ADJUSTMENT", account: accountFor(inv.purpose), amountKobo: pay.amountKobo, invoiceId: inv.id, paymentId: pay.id, actorId: adminId, note: `Accepted after review: ${note}` });
    await tx.payment.update({ where: { id: pay.id }, data: { status: "SUCCEEDED", reviewNote: `${pay.reviewNote} Accepted: ${note}`.slice(0, 500) } });
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: now } });
    await applyInvoice(tx, inv, now);
    await logActivity(tx, { companyId: inv.ownerCompanyId, actorId: adminId, entityType: "payment", entityId: pay.id, action: "payment.review_accepted", detail: { invoice: inv.ref, note } });
  });
}


export async function pendingRefunds(adminId: string) {
  await assertAdmin(adminId);
  return system((tx) => tx.refund.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 50, include: { invoice: { select: { ref: true, description: true } }, payment: { select: { ref: true, provider: true } } } }));
}
