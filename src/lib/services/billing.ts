import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { lockKey } from "../locks";
import { parseNairaToKobo } from "../money";
import { can, type Role } from "../permissions";
import { PERIOD_MONTHS, REVIEW_TEXT, checkReceived, newPeriodEnd, randomRef, renewalDue, reminderStage, sha256, type Period } from "../billing-rules";
import { configuredProvider, type ParsedEvent, type PaymentProvider } from "../payment-providers";
import { notify } from "./notifications";
import { system } from "./rewards";
import { syncCompanyTier } from "./tiers";
import { referralEvent } from "./referrals";
import type { Owner } from "./subscriptions";

// Payments for subscriptions (and, in ads.ts, advertising budgets). Three rules hold everywhere in this file:
//  1. Money is only counted as received from a verified provider message, from asking the provider directly, or from a person's recorded confirmation.
//  2. The same provider message or the same payment is never applied twice, however often or however quickly it arrives.
//  3. Every change to the books is an entry pointing at the event or the person that explains it.

/** Who is acting: a person for themselves, or a member for their company. */
export interface Payer { userId: string; companyId: string | null; role: Role | null }
export interface Deps { provider?: PaymentProvider | null; now?: Date }

const providerOf = (d?: Deps): PaymentProvider | null => (d && "provider" in d ? d.provider ?? null : configuredProvider());
const nowOf = (d?: Deps) => d?.now ?? new Date();

export const ownerOf = (p: Payer): Owner => (p.companyId ? { kind: "COMPANY", companyId: p.companyId } : { kind: "USER", userId: p.userId });
const ownerWhere = (o: Owner): Prisma.InvoiceWhereInput => (o.kind === "USER" ? { ownerUserId: o.userId } : { ownerCompanyId: o.companyId });

export function assertMayPay(p: Payer, action: "billing.view" | "billing.manage" = "billing.manage") {
  if (p.companyId && !(p.role && can(p.role, action))) throw new Error("Only your company administrator can manage plans and payments.");
}

async function assertAdmin(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

async function ownerName(tx: Tx, o: Owner): Promise<string> {
  if (o.kind === "USER") { const u = await tx.user.findUnique({ where: { id: o.userId }, select: { name: true, email: true } }); return u ? `${u.name} (${u.email})` : "Unknown person"; }
  const c = await tx.company.findUnique({ where: { id: o.companyId }, select: { name: true } });
  return c?.name ?? "Unknown company";
}

/** The people who should hear about a company's bills: its administrators. */
async function billingRecipients(o: Owner, fallbackUserId: string): Promise<string[]> {
  if (o.kind === "USER") return [o.userId];
  const rows = await withTenant(o.companyId, "system", (tx) => tx.membership.findMany({ where: { companyId: o.companyId, role: "COMPANY_SUPER_ADMIN", status: "ACTIVE" }, select: { userId: true }, take: 10 }));
  const ids = rows.map((r) => r.userId);
  return ids.length ? ids : [fallbackUserId];
}

/** Who is told about a payment: the person who owns the plan, or for a company the person who paid (or raised the invoice, when the administrator recorded it). */
export const payerOf = (pay: { provider: string; initiatedById: string }, inv: { ownerUserId: string | null; createdById: string }) => inv.ownerUserId ?? (pay.provider === "MANUAL" ? inv.createdById : pay.initiatedById);

const billingLink = (o: Owner) => (o.kind === "USER" ? "/me/billing" : "/app/billing");

// ---------- The books ----------

export type Posting = {
  ledger: "SUBSCRIPTION" | "ADVERTISING"; kind: "PAYMENT" | "REFUND" | "SPEND" | "ADJUSTMENT"; account: "REVENUE" | "FUNDS_HELD" | "SUSPENSE";
  amountKobo: bigint; entryKey?: string; invoiceId?: string; paymentId?: string; refundId?: string; campaignId?: string; eventId?: string; actorId?: string; note?: string;
};

/** Add one entry. An entry with a key can be added once only: a second attempt fails and rolls the whole change back. */
export async function post(tx: Tx, e: Posting) {
  if (!e.eventId && !e.actorId) throw new Error("A ledger entry needs a verified event or an authorising person");
  return tx.financeEntry.create({ data: { ledger: e.ledger, kind: e.kind, account: e.account, amountKobo: e.amountKobo, entryKey: e.entryKey ?? null, invoiceId: e.invoiceId ?? null, paymentId: e.paymentId ?? null, refundId: e.refundId ?? null, campaignId: e.campaignId ?? null, eventId: e.eventId ?? null, actorId: e.actorId ?? null, note: (e.note ?? "").slice(0, 300) } });
}
export const ledgerFor = (purpose: "SUBSCRIPTION" | "AD_CAMPAIGN") => (purpose === "SUBSCRIPTION" ? "SUBSCRIPTION" : "ADVERTISING") as "SUBSCRIPTION" | "ADVERTISING";
export const accountFor = (purpose: "SUBSCRIPTION" | "AD_CAMPAIGN") => (purpose === "SUBSCRIPTION" ? "REVENUE" : "FUNDS_HELD") as "REVENUE" | "FUNDS_HELD";

// ---------- Raising an invoice ----------

export async function buyablePlans(p: Payer) {
  const audiences = p.companyId ? (["COMPANY"] as const) : (["SEEKER", "AGENT"] as const);
  return system((tx) => tx.subscriptionPlan.findMany({ where: { active: true, audience: { in: [...audiences] }, priceKobo: { gt: 0 }, billingPeriod: { not: "NONE" } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { entitlements: true } }));
}

/** An invoice for one period of a plan. Asking again for the same plan returns the invoice already open; asking for another plan replaces it. */
export async function createSubscriptionInvoice(p: Payer, planId: string, deps?: Deps) {
  assertMayPay(p);
  const owner = ownerOf(p);
  const now = nowOf(deps);
  return system(async (tx) => {
    const plan = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.active) throw new Error("That plan is not available");
    if ((plan.audience === "COMPANY") !== (owner.kind === "COMPANY")) throw new Error(owner.kind === "COMPANY" ? "This plan is for individuals, not companies" : "This plan is for companies, not individuals");
    if (!plan.priceKobo || plan.priceKobo <= 0n || plan.billingPeriod === "NONE") throw new Error("This plan cannot be bought online. Ask the platform administrator.");
    await lockKey(tx, `invoice-owner:${owner.kind}:${owner.kind === "USER" ? owner.userId : owner.companyId}`);
    const open = await tx.invoice.findFirst({ where: { ...ownerWhere(owner), purpose: "SUBSCRIPTION", status: "OPEN" } });
    if (open && open.subjectId === plan.id && open.amountKobo === plan.priceKobo) return open;
    if (open) await tx.invoice.update({ where: { id: open.id }, data: { status: "VOID", voidedAt: now, voidReason: "Replaced by an invoice for another plan" } });
    const months = PERIOD_MONTHS[plan.billingPeriod as Period];
    const inv = await tx.invoice.create({
      data: {
        ref: randomRef("INV"), purpose: "SUBSCRIPTION", ownerKind: owner.kind, ownerUserId: owner.kind === "USER" ? owner.userId : null, ownerCompanyId: owner.kind === "COMPANY" ? owner.companyId : null,
        ownerName: await ownerName(tx, owner), subjectId: plan.id, description: `${plan.name} plan for ${months} ${months === 1 ? "month" : "months"}`, amountKobo: plan.priceKobo, periodMonths: months, dueOn: now, createdById: p.userId,
      },
    });
    await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: p.userId, entityType: "invoice", entityId: inv.id, action: "invoice.created", detail: { ref: inv.ref, plan: plan.code } });
    return inv;
  });
}

export async function voidInvoice(adminId: string, invoiceId: string, reasonInput: string) {
  await assertAdmin(adminId);
  const reason = reasonInput.trim();
  if (reason.length < 5) throw new Error("Give the reason for cancelling this invoice");
  await system(async (tx) => {
    await lockKey(tx, `invoice:${invoiceId}`);
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "OPEN") throw new Error("Only an open invoice can be cancelled");
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason.slice(0, 300) } });
    await logActivity(tx, { companyId: inv.ownerCompanyId, actorId: adminId, entityType: "invoice", entityId: inv.id, action: "invoice.voided", detail: { reason } });
  });
}

// ---------- Paying ----------

export const NO_PROVIDER = "Online payment is not set up on this platform yet. Pay by bank transfer using the details on the invoice, and the platform administrator will confirm it.";

async function authoriseInvoice(p: Payer, invoiceId: string, action: "billing.view" | "billing.manage") {
  assertMayPay(p, action);
  const owner = ownerOf(p);
  const inv = await system((tx) => tx.invoice.findFirst({ where: { id: invoiceId, ...ownerWhere(owner) } }));
  if (!inv) throw new Error("Invoice not found");
  return inv;
}

/** Begin an online payment. Returns where to send the person. A payment started a few minutes ago is reused, so a double click does not make two. */
export async function startPayment(p: Payer, invoiceId: string, callbackUrl: string, deps?: Deps): Promise<{ paymentRef: string; checkoutUrl: string }> {
  const provider = providerOf(deps);
  if (!provider) throw new Error(NO_PROVIDER);
  const inv = await authoriseInvoice(p, invoiceId, "billing.manage");
  const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { email: true } });
  if (!user) throw new Error("Account not found");
  const now = nowOf(deps);
  const pay = await system(async (tx) => {
    await lockKey(tx, `invoice:${inv.id}`);
    const fresh = await tx.invoice.findUnique({ where: { id: inv.id } });
    if (!fresh || fresh.status !== "OPEN") throw new Error("This invoice is not open for payment");
    const recent = await tx.payment.findFirst({ where: { invoiceId: inv.id, provider: "PAYSTACK", status: "PENDING", checkoutUrl: { not: "" }, createdAt: { gt: new Date(now.getTime() - 30 * 60_000) } }, orderBy: { createdAt: "desc" } });
    if (recent) return { payment: recent, reused: true };
    const ref = randomRef("PAY");
    const payment = await tx.payment.create({ data: { ref, invoiceId: inv.id, provider: "PAYSTACK", providerRef: ref, amountKobo: fresh.amountKobo, initiatedById: p.userId } });
    return { payment, reused: false };
  });
  if (pay.reused) return { paymentRef: pay.payment.ref, checkoutUrl: pay.payment.checkoutUrl };
  const started = await provider.initialize({ reference: pay.payment.ref, amountKobo: pay.payment.amountKobo, email: user.email, callbackUrl: `${callbackUrl}${callbackUrl.includes("?") ? "&" : "?"}ref=${encodeURIComponent(pay.payment.ref)}`, metadata: { invoice: inv.ref } });
  if (!started.ok) {
    await system((tx) => tx.payment.update({ where: { id: pay.payment.id }, data: { status: "FAILED", failureReason: started.error.slice(0, 500) } }));
    throw new Error(started.error);
  }
  await system((tx) => tx.payment.update({ where: { id: pay.payment.id }, data: { checkoutUrl: started.checkoutUrl } }));
  return { paymentRef: pay.payment.ref, checkoutUrl: started.checkoutUrl };
}

type SettleInput = { received: bigint; currency: string; providerTxId?: string; eventId?: string; actorId?: string; now: Date };
export type SettleResult = "APPLIED" | "ALREADY" | "REVIEW";

/**
 * Count a payment as received. Safe to call any number of times, from any number of requests at once: the payment is locked,
 * a payment that is already settled is left alone, and the books accept one entry per payment. If what arrived is not exactly what
 * was asked for, nothing is applied: the money is held in suspense and a person decides.
 */
export async function settlePaymentIn(tx: Tx, paymentId: string, s: SettleInput): Promise<{ result: SettleResult; notifyUserId?: string; referral?: { companyId: string | null; userId: string | null; planName: string; invoiceId: string } }> {
  await lockKey(tx, `payment:${paymentId}`);
  const pay = await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!pay) throw new Error("Payment not found");
  if (pay.status === "SUCCEEDED" || pay.status === "REVIEW") return { result: "ALREADY" };
  await lockKey(tx, `invoice:${pay.invoiceId}`);
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: pay.invoiceId } });
  const ledger = ledgerFor(inv.purpose);
  const trace = { eventId: s.eventId, actorId: s.actorId };
  const verdict = checkReceived({ expectedKobo: pay.amountKobo, receivedKobo: s.received, currency: s.currency, invoiceStatus: inv.status });
  if (!verdict.ok) {
    await tx.payment.update({ where: { id: pay.id }, data: { status: "REVIEW", receivedKobo: s.received, settledAt: s.now, reviewNote: REVIEW_TEXT[verdict.reason], providerTxId: s.providerTxId ?? pay.providerTxId } });
    await post(tx, { ledger, kind: "PAYMENT", account: "SUSPENSE", amountKobo: s.received, entryKey: `pay:${pay.id}`, invoiceId: inv.id, paymentId: pay.id, note: REVIEW_TEXT[verdict.reason], ...trace });
    const admins = await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 50 });
    for (const a of admins) await notify(tx, a.id, { kind: "billing.review", title: "A payment needs a decision", body: `${inv.ref}: ${REVIEW_TEXT[verdict.reason]}`, link: "/admin/payments", dedupeKey: `review:${pay.id}` });
    return { result: "REVIEW" };
  }
  await tx.payment.update({ where: { id: pay.id }, data: { status: "SUCCEEDED", receivedKobo: s.received, settledAt: s.now, providerTxId: s.providerTxId ?? pay.providerTxId } });
  await post(tx, { ledger, kind: "PAYMENT", account: accountFor(inv.purpose), amountKobo: s.received, entryKey: `pay:${pay.id}`, invoiceId: inv.id, paymentId: pay.id, ...trace });
  await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: s.now } });
  const applied = await applyInvoice(tx, inv, s.now);
  const owner: Owner = inv.ownerUserId ? { kind: "USER", userId: inv.ownerUserId } : { kind: "COMPANY", companyId: inv.ownerCompanyId! };
  await notify(tx, payerOf(pay, inv), { kind: "billing.paid", title: "Payment received", body: `${inv.description}. Thank you.`, link: billingLink(owner), dedupeKey: `paid:${pay.id}` });
  return { result: "APPLIED", notifyUserId: payerOf(pay, inv), referral: applied.planName ? { companyId: inv.ownerCompanyId, userId: inv.ownerUserId, planName: applied.planName, invoiceId: inv.id } : undefined };
}

/** What a paid invoice switches on. */
export async function applyInvoice(tx: Tx, inv: Prisma.InvoiceGetPayload<object>, now: Date): Promise<{ planName: string | null }> {
  if (inv.purpose === "SUBSCRIPTION") return applySubscription(tx, inv, now);
  const { fundCampaign } = await import("./ads");
  await fundCampaign(tx, inv, now);
  return { planName: null };
}

async function applySubscription(tx: Tx, inv: Prisma.InvoiceGetPayload<object>, now: Date): Promise<{ planName: string }> {
  const plan = await tx.subscriptionPlan.findUnique({ where: { id: inv.subjectId } });
  if (!plan) throw new Error("The plan on this invoice no longer exists");
  const existing = await tx.subscription.findFirst({ where: inv.ownerUserId ? { ownerUserId: inv.ownerUserId } : { ownerCompanyId: inv.ownerCompanyId } });
  const samePlan = existing?.planId === plan.id;
  const periodEnd = newPeriodEnd({ now, currentEnd: existing?.periodEnd ?? null, samePlan, months: inv.periodMonths });
  const note = `Paid online, invoice ${inv.ref}`;
  let subId: string;
  if (existing) {
    await tx.subscription.update({ where: { id: existing.id }, data: { planId: plan.id, status: "ACTIVE", periodEnd, cancelledAt: null } });
    subId = existing.id;
    await tx.subscriptionEvent.create({ data: { subscriptionId: subId, kind: samePlan ? "RENEWED" : "PLAN_CHANGED", fromPlanId: existing.planId, toPlanId: plan.id, periodEnd, note, actorId: inv.createdById } });
  } else {
    const sub = await tx.subscription.create({ data: { ownerKind: inv.ownerKind, ownerUserId: inv.ownerUserId, ownerCompanyId: inv.ownerCompanyId, planId: plan.id, status: "ACTIVE", periodEnd, createdById: inv.createdById } });
    subId = sub.id;
    await tx.subscriptionEvent.create({ data: { subscriptionId: subId, kind: "ASSIGNED", toPlanId: plan.id, periodEnd, note, actorId: inv.createdById } });
  }
  await tx.invoice.update({ where: { id: inv.id }, data: { appliedAt: now, previousEnd: existing?.periodEnd ?? null, coversTo: periodEnd } });
  if (inv.ownerCompanyId) await syncCompanyTier(tx, inv.ownerCompanyId);
  await logActivity(tx, { companyId: inv.ownerCompanyId, actorId: inv.createdById, entityType: "subscription", entityId: subId, action: samePlan ? "subscription.renewed" : "subscription.assigned", detail: { invoice: inv.ref, periodEnd: periodEnd.toISOString() } });
  return { planName: plan.name };
}

// ---------- Provider messages ----------

export type EventResult = { status: number; body: { received: boolean; duplicate?: boolean; outcome?: string } };

/** A message from the provider arrives here. It is accepted only if the signature proves it came from the provider and was not altered. */
export async function receiveProviderEvent(rawBody: string, signature: string | null, deps?: Deps): Promise<EventResult> {
  const provider = providerOf(deps);
  if (!provider) return { status: 503, body: { received: false } };
  if (!provider.verifySignature(rawBody, signature)) return { status: 401, body: { received: false } };
  const ev = provider.parseEvent(rawBody);
  if (!ev) return { status: 400, body: { received: false } };
  const r = await processEvent(ev, sha256(rawBody), deps);
  return { status: 200, body: { received: true, duplicate: r.duplicate, outcome: r.outcome } };
}

/**
 * Apply one provider event, once. The event is recorded in the same transaction as its effects, and the pair (provider, event id) is
 * unique, so a message delivered twice, or two copies handled at the same moment, change nothing the second time.
 */
export async function processEvent(ev: ParsedEvent, payloadHash: string, deps?: Deps): Promise<{ duplicate: boolean; outcome: string }> {
  const now = nowOf(deps);
  const { refundEventIn } = await import("./refunds");
  const out = await system(async (tx) => {
    await lockKey(tx, `event:PAYSTACK:${ev.eventId}`);
    if (await tx.paymentEvent.findUnique({ where: { provider_eventId: { provider: "PAYSTACK", eventId: ev.eventId } } })) return { duplicate: true, outcome: "DUPLICATE", settled: null as Awaited<ReturnType<typeof settlePaymentIn>> | null };
    const id = randomUUID();
    let outcome: string = "IGNORED", note = "", settled: Awaited<ReturnType<typeof settlePaymentIn>> | null = null, paymentRef = ev.reference;
    if (ev.kind === "PAYMENT_SUCCEEDED" || ev.kind === "PAYMENT_FAILED") {
      const pay = ev.reference ? await tx.payment.findUnique({ where: { provider_providerRef: { provider: "PAYSTACK", providerRef: ev.reference } } }) : null;
      if (!pay) { outcome = "UNKNOWN_REFERENCE"; note = "No payment has this reference"; }
      else if (ev.kind === "PAYMENT_SUCCEEDED") {
        if (ev.amountKobo === null || ev.amountKobo <= 0n) { outcome = "MALFORMED"; note = "The message had no amount"; }
        else {
          settled = await settlePaymentIn(tx, pay.id, { received: ev.amountKobo, currency: ev.currency, providerTxId: ev.providerTxId, eventId: id, now });
          outcome = settled.result;
        }
      } else {
        outcome = await markFailedIn(tx, pay.id, "The provider reported that the payment failed.");
      }
    } else if (ev.kind === "REFUND_COMPLETED" || ev.kind === "REFUND_FAILED") {
      const r = await refundEventIn(tx, ev, id, now);
      outcome = r.outcome; note = r.note;
    }
    await tx.paymentEvent.create({ data: { id, provider: "PAYSTACK", eventId: ev.eventId, kind: ev.rawKind.slice(0, 100), reference: paymentRef.slice(0, 200), amountKobo: ev.amountKobo, outcome, note: note.slice(0, 500), payloadHash } });
    return { duplicate: false, outcome, settled };
  });
  if (out.settled?.referral) {
    const r = out.settled.referral;
    await referralEvent("REFERRAL_SUBSCRIBED", { companyId: r.companyId, userId: r.userId }, { type: "subscription", id: r.invoiceId, label: `${r.planName} plan` });
  }
  return { duplicate: out.duplicate, outcome: out.outcome };
}

/** A payment the provider says did not go through. Only a payment still waiting can fail; the invoice stays open so the person can try again. */
async function markFailedIn(tx: Tx, paymentId: string, reason: string): Promise<string> {
  await lockKey(tx, `payment:${paymentId}`);
  const pay = await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!pay || pay.status !== "PENDING") return "ALREADY";
  await tx.payment.update({ where: { id: pay.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500) } });
  const owner: Owner = pay.invoice.ownerUserId ? { kind: "USER", userId: pay.invoice.ownerUserId } : { kind: "COMPANY", companyId: pay.invoice.ownerCompanyId! };
  await notify(tx, payerOf(pay, pay.invoice), { kind: "billing.failed", title: "Your payment did not go through", body: `${pay.invoice.description}. No money was taken for it. You can try again.`, link: billingLink(owner), dedupeKey: `failed:${pay.id}` });
  return "FAILED_RECORDED";
}

/**
 * Ask the provider what became of a payment, rather than trusting a browser that came back from checkout or waiting for a message
 * that may have been lost. A payment is settled only on the provider's own answer.
 */
export async function verifyPayment(paymentRef: string, deps?: Deps): Promise<"SUCCEEDED" | "FAILED" | "PENDING" | "REVIEW" | "UNKNOWN"> {
  const provider = providerOf(deps);
  const pay = await system((tx) => tx.payment.findUnique({ where: { ref: paymentRef } }));
  if (!pay) return "UNKNOWN";
  if (pay.status !== "PENDING") return pay.status;
  if (!provider || pay.provider !== "PAYSTACK" || !pay.providerRef) return "PENDING";
  const v = await provider.verify(pay.providerRef);
  if (!v.ok || v.status === "pending") return "PENDING";
  const ev: ParsedEvent = { eventId: `verify:${pay.ref}:${v.status}`, kind: v.status === "success" ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED", rawKind: `verify.${v.status}`, reference: pay.providerRef, amountKobo: v.amountKobo, currency: v.currency, providerTxId: v.providerTxId };
  await processEvent(ev, sha256(JSON.stringify({ ref: pay.ref, status: v.status, amount: v.amountKobo.toString() })), deps);
  const after = await system((tx) => tx.payment.findUnique({ where: { ref: paymentRef }, select: { status: true } }));
  return after?.status ?? "UNKNOWN";
}

/** Payments still waiting after a few minutes: ask the provider. Covers a message that was lost or a person who closed the page. */
export async function verifyPending(deps?: Deps): Promise<{ checked: number; settled: number; failed: number }> {
  const now = nowOf(deps);
  const waiting = await system((tx) => tx.payment.findMany({ where: { status: "PENDING", provider: "PAYSTACK", createdAt: { lt: new Date(now.getTime() - 10 * 60_000), gt: new Date(now.getTime() - 3 * 864e5) } }, orderBy: { createdAt: "asc" }, take: 100, select: { ref: true } }));
  let settled = 0, failed = 0;
  for (const w of waiting) {
    const r = await verifyPayment(w.ref, deps);
    if (r === "SUCCEEDED" || r === "REVIEW") settled++; else if (r === "FAILED") failed++;
  }
  // Never confirmed in three days: the person abandoned it.
  await system((tx) => tx.payment.updateMany({ where: { status: "PENDING", provider: "PAYSTACK", createdAt: { lt: new Date(now.getTime() - 3 * 864e5) } }, data: { status: "FAILED", failureReason: "Never confirmed by the provider within three days" } }));
  return { checked: waiting.length, settled, failed };
}

// ---------- Money paid outside the platform ----------

const BANK_KEY = "bank_instructions";
export async function readBankInstructions(): Promise<string> {
  return (await prisma.platformSetting.findUnique({ where: { key: BANK_KEY } }))?.value ?? "";
}
export async function saveBankInstructions(adminId: string, text: string) {
  await assertAdmin(adminId);
  const v = text.trim().slice(0, 600);
  await system(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: BANK_KEY }, create: { key: BANK_KEY, value: v, updatedById: adminId }, update: { value: v, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: BANK_KEY, action: "settings.updated", detail: {} });
  });
}

/**
 * A bank transfer or cash payment that the administrator has checked against the bank statement. The amount must be exactly the
 * invoice amount, and the bank reference can be used once, so the same transfer cannot be recorded twice.
 */
export async function recordOfflinePayment(adminId: string, invoiceId: string, input: { amount: string; reference: string; note?: string }, deps?: Deps) {
  await assertAdmin(adminId);
  const amount = parseNairaToKobo(input.amount);
  const reference = input.reference.trim().toUpperCase().replace(/\s+/g, " ");
  if (reference.length < 3 || reference.length > 80) throw new Error("Enter the bank reference or receipt number");
  const now = nowOf(deps);
  const out = await system(async (tx) => {
    await lockKey(tx, `invoice:${invoiceId}`);
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "OPEN") throw new Error("This invoice is not open for payment");
    if (amount !== inv.amountKobo) throw new Error("The amount must be exactly the invoice amount. Record a different amount as a refund or an adjustment instead.");
    if (await tx.payment.findUnique({ where: { provider_providerRef: { provider: "MANUAL", providerRef: reference } } })) throw new Error("That bank reference has already been recorded");
    const pay = await tx.payment.create({ data: { ref: randomRef("PAY"), invoiceId: inv.id, provider: "MANUAL", providerRef: reference, amountKobo: inv.amountKobo, initiatedById: adminId } });
    const s = await settlePaymentIn(tx, pay.id, { received: amount, currency: "NGN", actorId: adminId, now });
    await logActivity(tx, { companyId: inv.ownerCompanyId, actorId: adminId, entityType: "payment", entityId: pay.id, action: "payment.recorded_offline", detail: { invoice: inv.ref, reference, note: (input.note ?? "").slice(0, 200) } });
    return s;
  });
  if (out.referral) await referralEvent("REFERRAL_SUBSCRIBED", { companyId: out.referral.companyId, userId: out.referral.userId }, { type: "subscription", id: out.referral.invoiceId, label: `${out.referral.planName} plan` });
}

// ---------- Renewals, cancelling and reading ----------

/**
 * Ask for the next period's payment. A subscription that is close to its end (or inside its grace period) and not cancelled gets one
 * open invoice, and a reminder at each stage: advance notice, last day, overdue. Nothing is charged without the person's action.
 */
export async function generateRenewalInvoices(deps?: Deps): Promise<{ invoices: number; reminders: number }> {
  const now = nowOf(deps);
  const subs = await system((tx) => tx.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] }, plan: { priceKobo: { gt: 0 }, billingPeriod: { not: "NONE" } }, periodEnd: { lt: new Date(now.getTime() + 8 * 864e5) } },
    include: { plan: true }, take: 1000,
  }));
  let invoices = 0, reminders = 0;
  for (const s of subs) {
    if (!renewalDue({ periodEnd: s.periodEnd, graceDays: s.plan.graceDays, now, cancelled: s.status === "CANCELLED" })) continue;
    const owner: Owner = s.ownerUserId ? { kind: "USER", userId: s.ownerUserId } : { kind: "COMPANY", companyId: s.ownerCompanyId! };
    const recipients = await billingRecipients(owner, s.createdById);
    const stage = reminderStage(s.periodEnd, now);
    const made = await system(async (tx) => {
      await lockKey(tx, `invoice-owner:${owner.kind}:${owner.kind === "USER" ? owner.userId : owner.companyId}`);
      const sub = await tx.subscription.findUnique({ where: { id: s.id }, include: { plan: true } });
      if (!sub || sub.status === "CANCELLED") return null;
      let inv = await tx.invoice.findFirst({ where: { ...ownerWhere(owner), purpose: "SUBSCRIPTION", status: "OPEN" } });
      let created = false;
      if (inv && (inv.subjectId !== sub.planId || inv.amountKobo !== sub.plan.priceKobo)) return null; // the person chose something else; leave it
      if (!inv) {
        const months = PERIOD_MONTHS[sub.plan.billingPeriod as Period];
        inv = await tx.invoice.create({ data: { ref: randomRef("INV"), purpose: "SUBSCRIPTION", ownerKind: owner.kind, ownerUserId: owner.kind === "USER" ? owner.userId : null, ownerCompanyId: owner.kind === "COMPANY" ? owner.companyId : null, ownerName: await ownerName(tx, owner), subjectId: sub.planId, description: `${sub.plan.name} plan renewal for ${months} ${months === 1 ? "month" : "months"}`, amountKobo: sub.plan.priceKobo!, periodMonths: months, renewal: true, dueOn: sub.periodEnd, createdById: sub.createdById } });
        created = true;
      }
      // Each stage is told once, however often this job runs.
      if (inv.reminderStage === stage) return { created, sent: 0 };
      const text = stage === "OVERDUE" ? "has run out. Pay now to keep your features." : stage === "LAST_DAY" ? "ends today." : "ends soon.";
      let sent = 0;
      for (const uid of recipients) {
        await notify(tx, uid, { kind: "billing.renewal", title: `Your ${sub.plan.name} plan ${text}`, body: `${inv.description}. Pay to continue without a break.`, link: billingLink(owner), dedupeKey: `renewal:${inv.id}:${stage}` });
        sent++;
      }
      await tx.invoice.update({ where: { id: inv.id }, data: { reminderStage: stage } });
      return { created, sent };
    });
    if (made) { if (made.created) invoices++; reminders += made.sent; }
  }
  return { invoices, reminders };
}

/** Stop renewing. Everything paid for keeps working until the period ends. */
export async function cancelOwn(p: Payer) {
  assertMayPay(p);
  const owner = ownerOf(p);
  await system(async (tx) => {
    const sub = await tx.subscription.findFirst({ where: owner.kind === "USER" ? { ownerUserId: owner.userId } : { ownerCompanyId: owner.companyId } });
    if (!sub) throw new Error("There is no subscription to cancel");
    if (sub.status === "CANCELLED") throw new Error("This subscription is already cancelled");
    await tx.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, kind: "CANCELLED", fromPlanId: sub.planId, toPlanId: sub.planId, periodEnd: sub.periodEnd, note: "Cancelled by the owner", actorId: p.userId } });
    await tx.invoice.updateMany({ where: { ...ownerWhere(owner), purpose: "SUBSCRIPTION", status: "OPEN", renewal: true }, data: { status: "VOID", voidedAt: new Date(), voidReason: "The subscription was cancelled" } });
    if (owner.kind === "COMPANY") await syncCompanyTier(tx, owner.companyId);
    await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: p.userId, entityType: "subscription", entityId: sub.id, action: "subscription.cancelled", detail: { by: "owner" } });
  });
}

export async function myInvoices(p: Payer, take = 30) {
  assertMayPay(p, "billing.view");
  const owner = ownerOf(p);
  return system((tx) => tx.invoice.findMany({ where: ownerWhere(owner), orderBy: { createdAt: "desc" }, take, include: { payments: { orderBy: { createdAt: "desc" } } } }));
}

export async function invoiceFor(p: Payer, id: string) {
  assertMayPay(p, "billing.view");
  const owner = ownerOf(p);
  return system((tx) => tx.invoice.findFirst({ where: { id, ...ownerWhere(owner) }, include: { payments: { orderBy: { createdAt: "desc" } }, refunds: { orderBy: { createdAt: "desc" } } } }));
}

/** What a person sees when they come back from checkout. Only their own payments are shown. */
export async function returnInfo(userId: string, paymentRef: string) {
  return system((tx) => tx.payment.findFirst({ where: { ref: paymentRef, initiatedById: userId }, include: { invoice: true } }));
}

export async function paymentStatusFor(p: Payer, paymentRef: string) {
  assertMayPay(p, "billing.view");
  const owner = ownerOf(p);
  return system((tx) => tx.payment.findFirst({ where: { ref: paymentRef, invoice: ownerWhere(owner) }, include: { invoice: true } }));
}

export const PAGE = 20;
export async function adminInvoices(adminId: string, o: { status?: string; page?: number } = {}) {
  await assertAdmin(adminId);
  const where: Prisma.InvoiceWhereInput = o.status === "OPEN" || o.status === "PAID" || o.status === "VOID" ? { status: o.status } : {};
  const page = Math.max(0, o.page ?? 0);
  return system(async (tx) => {
    const [rows, total] = await Promise.all([
      tx.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE, take: PAGE, include: { payments: { orderBy: { createdAt: "desc" } } } }),
      tx.invoice.count({ where }),
    ]);
    return { rows, total, page };
  });
}

export async function adminPayments(adminId: string, o: { status?: string; page?: number } = {}) {
  await assertAdmin(adminId);
  const where: Prisma.PaymentWhereInput = o.status === "PENDING" || o.status === "SUCCEEDED" || o.status === "FAILED" || o.status === "REVIEW" ? { status: o.status } : {};
  const page = Math.max(0, o.page ?? 0);
  return system(async (tx) => {
    const [rows, total, review] = await Promise.all([
      tx.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE, take: PAGE, include: { invoice: true, refunds: true } }),
      tx.payment.count({ where }),
      tx.payment.count({ where: { status: "REVIEW" } }),
    ]);
    return { rows, total, page, review };
  });
}

export async function adminEvents(adminId: string, page = 0) {
  await assertAdmin(adminId);
  return system(async (tx) => {
    const [rows, total] = await Promise.all([
      tx.paymentEvent.findMany({ orderBy: { receivedAt: "desc" }, skip: Math.max(0, page) * PAGE, take: PAGE }),
      tx.paymentEvent.count(),
    ]);
    return { rows, total, page };
  });
}
