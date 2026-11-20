/**
 * Automatic renewal with a saved card. A person (or a company's administrator) ticks "renew automatically" when choosing a
 * plan; after that card payment, the provider's reusable card is kept, sealed, and the plan renews by charging it on the
 * renewal day. They are reminded 3 days before with the amount and the card, can turn it off or remove the card at any time,
 * and a card that is declined is tried again the next day, at most 3 times, while they are told to pay from the invoice.
 */
import { prisma } from "../db";
import { logActivity } from "../audit";
import { randomRef, sha256 } from "../billing-rules";
import { formatKobo } from "../money";
import { openSecret, sealSecret } from "../totp";
import type { ParsedEvent, PaymentProvider } from "../payment-providers";
import { assertMayPay, billingLink, billingRecipients, markFailedIn, processEvent, type Deps, type Payer } from "./billing";
import { notify } from "./notifications";
import { system } from "./rewards";
import type { Owner } from "./subscriptions";

type ProviderName = "PAYSTACK" | "STRIPE";
const keyOfOwner = (o: Owner) => (o.kind === "COMPANY" ? `COMPANY:${o.companyId}` : `USER:${o.userId}`);
const ownerOfPayer = (p: Payer): Owner => (p.companyId ? { kind: "COMPANY", companyId: p.companyId } : { kind: "USER", userId: p.userId });
const providerFor = async (deps: Deps | undefined, name: ProviderName): Promise<PaymentProvider | null> =>
  deps && "provider" in deps ? deps.provider ?? null : (await import("./platform-config")).paymentProviderNamed(name);

/** Declined attempts on one invoice before the job stops trying and leaves it to the person. */
export const MAX_DECLINES = 3;
const NOT_REACHED = "The payment provider could not be reached";

/** "Visa ending 4242": how a card is named on pages and in messages. */
export const cardLabel = (c: { brand: string; last4: string }) => `${c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1).toLowerCase() : "Card"} ending ${c.last4}`;

/** Whether a card can still be charged on a date (cards work to the end of their expiry month). */
export const cardValidOn = (c: { expMonth: number; expYear: number }, on: Date) => c.expYear * 12 + (c.expMonth - 1) >= on.getUTCFullYear() * 12 + on.getUTCMonth();

/**
 * After a payment is settled: if the payer asked to renew automatically and the provider will let the card be charged again,
 * keep it and switch automatic renewal on. Never throws (the payment itself has already been counted).
 */
export async function rememberCard(provider: ProviderName, reference: string, deps?: Deps): Promise<boolean> {
  try {
    const pay = await system((tx) => tx.payment.findUnique({ where: { provider_providerRef: { provider, providerRef: reference } }, include: { invoice: true } }));
    if (!pay || pay.status !== "SUCCEEDED" || pay.automatic || pay.invoice.purpose !== "SUBSCRIPTION" || !pay.invoice.autoRenewConsent) return false;
    const p = await providerFor(deps, provider);
    const card = p?.cardFor ? await p.cardFor(reference) : null;
    if (!card || !/^\d{4}$/.test(card.last4) || card.expMonth < 1 || card.expMonth > 12) return false;
    const owner: Owner = pay.invoice.ownerUserId ? { kind: "USER", userId: pay.invoice.ownerUserId } : { kind: "COMPANY", companyId: pay.invoice.ownerCompanyId! };
    const ownerKey = keyOfOwner(owner);
    const email = card.email || (await prisma.user.findUnique({ where: { id: pay.initiatedById }, select: { email: true } }))?.email || "";
    const data = { provider, tokenSealed: sealSecret(card.token), customerSealed: card.customer ? sealSecret(card.customer) : "", email, last4: card.last4, brand: card.brand, expMonth: card.expMonth, expYear: card.expYear, failures: 0, createdById: pay.initiatedById };
    await system(async (tx) => {
      await tx.savedCard.upsert({ where: { ownerKey }, create: { ownerKey, ...data }, update: data });
      await tx.subscription.updateMany({ where: owner.kind === "USER" ? { ownerUserId: owner.userId } : { ownerCompanyId: owner.companyId }, data: { autoRenew: true } });
      await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: pay.initiatedById, entityType: "subscription", entityId: pay.invoiceId, action: "billing.auto_renew_on", detail: { card: cardLabel(card), provider } });
      await notify(tx, pay.initiatedById, { kind: "billing.auto_renew", title: "Automatic renewal is on", body: `Your plan will renew with your ${cardLabel(card)}. We remind you 3 days before each charge. Turn it off at any time in Billing.`, link: billingLink(owner), dedupeKey: `auto-on:${pay.id}` });
    });
    return true;
  } catch (e) {
    console.error("rememberCard", e instanceof Error ? e.message : e);
    return false;
  }
}

/** The saved card and whether automatic renewal is on, for the billing page. Never the token. */
export async function autoRenewStatus(p: Payer) {
  assertMayPay(p, "billing.view");
  const owner = ownerOfPayer(p);
  return system(async (tx) => {
    const [card, sub] = await Promise.all([
      tx.savedCard.findUnique({ where: { ownerKey: keyOfOwner(owner) }, select: { brand: true, last4: true, expMonth: true, expYear: true, provider: true, failures: true } }),
      tx.subscription.findFirst({ where: owner.kind === "USER" ? { ownerUserId: owner.userId } : { ownerCompanyId: owner.companyId }, select: { autoRenew: true, status: true, periodEnd: true } }),
    ]);
    return { card: card ? { ...card, label: cardLabel(card), expired: !cardValidOn(card, new Date()) } : null, on: !!(sub?.autoRenew && card), subscription: sub };
  });
}

/** Turn automatic renewal on (needs a saved card) or off. */
export async function setAutoRenew(p: Payer, on: boolean) {
  assertMayPay(p);
  const owner = ownerOfPayer(p);
  await system(async (tx) => {
    const card = await tx.savedCard.findUnique({ where: { ownerKey: keyOfOwner(owner) } });
    if (on && !card) throw new Error("There is no saved card yet. Choose your plan and tick “renew automatically” when you pay by card.");
    if (on && card && !cardValidOn(card, new Date())) throw new Error("Your saved card has expired. Pay your next invoice with a new card and tick “renew automatically”.");
    const sub = await tx.subscription.findFirst({ where: owner.kind === "USER" ? { ownerUserId: owner.userId } : { ownerCompanyId: owner.companyId } });
    if (!sub) throw new Error("You have no plan to renew yet. Choose a plan first.");
    if (on && sub.status === "CANCELLED") throw new Error("Your plan is set not to renew. Choose the plan again to keep it, then turn automatic renewal on.");
    await tx.subscription.update({ where: { id: sub.id }, data: { autoRenew: on } });
    await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: p.userId, entityType: "subscription", entityId: sub.id, action: on ? "billing.auto_renew_on" : "billing.auto_renew_off", detail: {} });
  });
}

/** Remove the saved card (and with it automatic renewal). */
export async function removeCard(p: Payer) {
  assertMayPay(p);
  const owner = ownerOfPayer(p);
  await system(async (tx) => {
    const n = await tx.savedCard.deleteMany({ where: { ownerKey: keyOfOwner(owner) } });
    if (!n.count) throw new Error("There is no saved card to remove.");
    await tx.subscription.updateMany({ where: owner.kind === "USER" ? { ownerUserId: owner.userId } : { ownerCompanyId: owner.companyId }, data: { autoRenew: false } });
    await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: p.userId, entityType: "subscription", entityId: keyOfOwner(owner), action: "billing.card_removed", detail: {} });
  });
}

/**
 * Charge saved cards for renewals that are due: on the renewal day (the period ends within a day) or during grace, for the open
 * renewal invoice of the same plan. One attempt per invoice per day; at most MAX_DECLINES declined attempts per invoice.
 * A success is settled through the same path as any provider message, so the books and the plan update exactly once.
 */
export async function chargeAutoRenewals(deps?: Deps): Promise<{ tried: number; paid: number; declined: number }> {
  const now = deps?.now ?? new Date();
  const subs = await system((tx) => tx.subscription.findMany({
    where: { autoRenew: true, status: "ACTIVE", periodEnd: { lt: new Date(now.getTime() + 864e5) } },
    include: { plan: { select: { name: true, graceDays: true } } }, take: 500,
  }));
  let tried = 0, paid = 0, declined = 0;
  for (const s of subs) {
    if (now.getTime() > s.periodEnd.getTime() + s.plan.graceDays * 864e5) continue;
    const owner: Owner = s.ownerUserId ? { kind: "USER", userId: s.ownerUserId } : { kind: "COMPANY", companyId: s.ownerCompanyId! };
    const ownerWhere = owner.kind === "USER" ? { ownerUserId: owner.userId } : { ownerCompanyId: owner.companyId };
    const prepared = await system(async (tx) => {
      const card = await tx.savedCard.findUnique({ where: { ownerKey: keyOfOwner(owner) } });
      if (!card || !cardValidOn(card, now)) return null;
      const inv = await tx.invoice.findFirst({ where: { ...ownerWhere, purpose: "SUBSCRIPTION", status: "OPEN", subjectId: s.planId, renewal: true } });
      if (!inv) return null;
      const autos = await tx.payment.findMany({ where: { invoiceId: inv.id, automatic: true }, select: { status: true, createdAt: true, failureReason: true } });
      if (autos.some((a) => a.status === "PENDING" || a.status === "SUCCEEDED" || a.status === "REVIEW")) return null;
      if (autos.filter((a) => a.status === "FAILED" && !a.failureReason.startsWith(NOT_REACHED)).length >= MAX_DECLINES) return null;
      if (autos.some((a) => now.getTime() - a.createdAt.getTime() < 20 * 3600_000)) return null; // once a day
      const ref = randomRef("PAY");
      const payment = await tx.payment.create({ data: { ref, invoiceId: inv.id, provider: card.provider, providerRef: ref, amountKobo: inv.amountKobo, initiatedById: card.createdById, automatic: true, createdAt: now } });
      return { card, inv, payment };
    });
    if (!prepared) continue;
    const { card, inv, payment } = prepared;
    const provider = await providerFor(deps, card.provider as ProviderName);
    tried++;
    if (!provider?.chargeCard) {
      await system((tx) => tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: `${NOT_REACHED}: no online payment provider is connected` } }));
      continue;
    }
    const r = await provider.chargeCard({ reference: payment.ref, amountKobo: inv.amountKobo, currency: inv.currency, card: { token: openSecret(card.tokenSealed), customer: card.customerSealed ? openSecret(card.customerSealed) : "", email: card.email }, description: inv.description });
    if (r.ok && r.status === "success") {
      const ev: ParsedEvent = { eventId: `auto:${payment.ref}:success`, kind: "PAYMENT_SUCCEEDED", rawKind: "auto.success", reference: payment.ref, amountKobo: r.amountKobo, currency: r.currency, providerTxId: r.providerTxId };
      await processEvent(ev, sha256(JSON.stringify({ ref: payment.ref, amount: r.amountKobo.toString(), tx: r.providerTxId })), deps, card.provider as ProviderName);
      await system((tx) => tx.savedCard.update({ where: { id: card.id }, data: { failures: 0 } }));
      paid++;
      continue;
    }
    if (r.ok && r.status === "pending") continue; // the provider's message, or the next check, settles it
    if (!r.ok && !r.permanent) {
      await system((tx) => tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: `${NOT_REACHED}: ${r.error}`.slice(0, 500) } }));
      continue;
    }
    declined++;
    const reason = r.ok ? r.message : r.error;
    const attempts = await system(async (tx) => {
      await markFailedIn(tx, payment.id, `Automatic renewal: the card was declined${reason ? ` (${reason})` : ""}.`);
      await tx.savedCard.update({ where: { id: card.id }, data: { failures: { increment: 1 } } });
      return tx.payment.count({ where: { invoiceId: inv.id, automatic: true, status: "FAILED", NOT: { failureReason: { startsWith: NOT_REACHED } } } });
    });
    const last = attempts >= MAX_DECLINES;
    const recipients = await billingRecipients(owner, s.createdById);
    await system(async (tx) => {
      for (const uid of recipients) await notify(tx, uid, {
        kind: "billing.failed", title: `We could not renew your ${s.plan.name} plan`,
        body: `Your ${cardLabel(card)} was declined for ${formatKobo(inv.amountKobo, inv.currency)}. ${last ? "We will not try the card again for this renewal." : "We will try again tomorrow."} Pay from the invoice to keep your plan without a break.`,
        link: `${billingLink(owner)}/${inv.id}`, dedupeKey: `auto-declined:${payment.id}`,
      });
    });
  }
  return { tried, paid, declined };
}
