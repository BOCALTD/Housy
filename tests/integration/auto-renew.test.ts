/**
 * Automatic renewal with a saved card: kept only when the payer asked and the provider allows it, stored sealed, charged on the
 * renewal day through the normal settlement path, retried at most three times after a decline, and always under the owner's control.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { savePlan, setPlanEntitlements } from "../../src/lib/services/subscriptions";
import { cancelOwn, createSubscriptionInvoice, generateRenewalInvoices, setRenewConsent, startPayment, verifyPayment, type Deps, type Payer } from "../../src/lib/services/billing";
import { autoRenewStatus, chargeAutoRenewals, MAX_DECLINES, removeCard, setAutoRenew } from "../../src/lib/services/auto-renew";
import type { CardCharge, PaymentProvider, SavedCardInfo } from "../../src/lib/payment-providers";
import { newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => Math.random().toString(36).slice(2, 8);
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);

/** A stand-in card provider: checkouts succeed when told to, the card can be kept, and charges answer as scripted. */
function fakeProvider() {
  const paid = new Map<string, bigint>();
  const charges: { reference: string; amountKobo: bigint; token: string }[] = [];
  let next: CardCharge["ok"] extends true ? never : CardCharge | null = null;
  let card: SavedCardInfo | null = { token: `AUTH_${uid()}`, customer: `CUS_${uid()}`, last4: "4242", brand: "visa", expMonth: 12, expYear: 2099, email: "" };
  const saveAsked: string[] = [];
  const p: PaymentProvider = {
    name: "PAYSTACK",
    async initialize(i) { if (i.saveCard) saveAsked.push(i.reference); return { ok: true, checkoutUrl: `https://checkout.test/${i.reference}` }; },
    verifySignature: () => true,
    parseEvent: () => null,
    async verify(reference) { const a = paid.get(reference); return a ? { ok: true, status: "success", amountKobo: a, currency: "NGN", providerTxId: `tx-${reference}` } : { ok: true, status: "pending", amountKobo: 0n, currency: "NGN", providerTxId: "" }; },
    async refund() { return { ok: false, error: "not in this test", permanent: true }; },
    async cardFor() { return card; },
    async chargeCard(i) {
      charges.push({ reference: i.reference, amountKobo: i.amountKobo, token: i.card.token });
      const r = next ?? { ok: true as const, status: "success" as const, amountKobo: i.amountKobo, currency: i.currency, providerTxId: `auto-${i.reference}`, message: "Approved" };
      return r;
    },
  };
  return { p, paid, charges, saveAsked, setNext: (r: CardCharge | null) => { next = r as never; }, setCard: (c: SavedCardInfo | null) => { card = c; } };
}

async function setup(consent: boolean) {
  const admin = await newPlatformAdmin();
  const plan = await savePlan(admin.id, null, { code: `ar-${uid()}`, name: `Auto plan ${uid()}`, audience: "AGENT", price: "8,000", billingPeriod: "MONTHLY", trialDays: 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 100, tier: "BASIC" } as never);
  await setPlanEntitlements(admin.id, plan.id, [{ key: "COLLAB_SEEKER_AGENT", enabled: true, limit: 3 }]);
  const id = (await registerSeeker({ name: `Auto ${uid()}`, email: `ar-${uid()}@example.test`, password: PASSWORD })).userId;
  const payer: Payer = { userId: id, companyId: null, role: null };
  const f = fakeProvider();
  const deps = (now?: Date): Deps => ({ provider: f.p, now });
  const inv = await createSubscriptionInvoice(payer, plan.id, undefined, "", "plan", { autoRenew: consent });
  const pay = await startPayment(payer, inv.id, "https://app.test/billing/return", deps());
  f.paid.set(pay.paymentRef, inv.amountKobo);
  assert.equal(await verifyPayment(pay.paymentRef, deps()), "SUCCEEDED");
  return { admin, plan, payer, id, f, deps, inv, pay };
}

const subOf = (id: string) => sys((tx) => tx.subscription.findFirstOrThrow({ where: { ownerUserId: id } }));
/** The renewal job serves everyone due, so each test looks only at its own customer's automatic payments and card. */
const autos = (id: string) => sys((tx) => tx.payment.findMany({ where: { invoice: { ownerUserId: id }, automatic: true }, orderBy: { createdAt: "asc" } }));
const mine = (f: ReturnType<typeof fakeProvider>, token: string) => f.charges.filter((c) => c.token === token);

test("the card is kept, sealed, only when the payer asked; then the plan renews by itself on the renewal day", async () => {
  const s = await setup(true);
  assert.deepEqual(s.f.saveAsked, [s.pay.paymentRef], "the checkout asked the provider to keep the card");
  const card = await sys((tx) => tx.savedCard.findUniqueOrThrow({ where: { ownerKey: `USER:${s.id}` } }));
  assert.equal(card.last4, "4242");
  assert.ok(card.tokenSealed.startsWith("v1.") && !card.tokenSealed.includes("AUTH_"), "the provider's token is never stored in the clear");
  const status = await autoRenewStatus(s.payer);
  assert.equal(status.on, true);
  assert.equal(status.card?.label, "Visa ending 4242");
  assert.equal((status.card as Record<string, unknown>).tokenSealed, undefined, "the page never gets the token");

  const sub = await subOf(s.id);
  // Three days before: the reminder names the card and the amount.
  const notice = new Date(sub.periodEnd.getTime() - 2.5 * 864e5);
  await generateRenewalInvoices({ now: notice });
  const told = await withUser(s.id, (tx) => tx.notification.findFirstOrThrow({ where: { userId: s.id, kind: "billing.renewal" }, orderBy: { createdAt: "desc" } }));
  assert.match(told.title, /renews in 3 days/);
  assert.match(told.body, /₦8,000 to your Visa ending 4242/);
  // Nothing is charged before the renewal day.
  await chargeAutoRenewals(s.deps(notice));
  assert.equal((await autos(s.id)).length, 0);
  // On the renewal day the card is charged once, the invoice is paid and the plan runs another month.
  const day = new Date(sub.periodEnd.getTime() - 6 * 3600_000);
  await generateRenewalInvoices({ now: day });
  const token = (await s.f.p.cardFor!("x"))!.token;
  await chargeAutoRenewals(s.deps(day));
  const charged = mine(s.f, token);
  assert.equal(charged.length, 1);
  assert.equal(charged[0].amountKobo, 800_000n);
  assert.ok(charged[0].token.startsWith("AUTH_"), "the sealed token is opened only to charge");
  const renewed = await subOf(s.id);
  assert.ok(renewed.periodEnd.getTime() > sub.periodEnd.getTime() + 27 * 864e5);
  const pays = await autos(s.id);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].status, "SUCCEEDED");
  // Running the job again changes nothing.
  await chargeAutoRenewals(s.deps(day));
  assert.equal((await autos(s.id)).length, 1);
  assert.equal(mine(s.f, token).length, 1);
});

test("without the payer's consent no card is kept", async () => {
  const s = await setup(false);
  assert.deepEqual(s.f.saveAsked, []);
  assert.equal(await sys((tx) => tx.savedCard.count({ where: { ownerKey: `USER:${s.id}` } })), 0);
  assert.equal((await autoRenewStatus(s.payer)).on, false);
  await assert.rejects(setAutoRenew(s.payer, true), /no saved card/);
});

test("a declined card is tried once a day, at most three times, and the owner is told to pay from the invoice", async () => {
  const s = await setup(true);
  const sub = await subOf(s.id);
  const day = new Date(sub.periodEnd.getTime() - 6 * 3600_000);
  await generateRenewalInvoices({ now: day });
  s.f.setNext({ ok: true, status: "failed", amountKobo: 0n, currency: "NGN", providerTxId: "", message: "Insufficient funds" });
  await chargeAutoRenewals(s.deps(day));
  assert.deepEqual((await autos(s.id)).map((p) => p.status), ["FAILED"]);
  await chargeAutoRenewals(s.deps(new Date(day.getTime() + 3600_000)));
  assert.equal((await autos(s.id)).length, 1, "not twice in a day");
  const told = await withUser(s.id, (tx) => tx.notification.findFirstOrThrow({ where: { userId: s.id, kind: "billing.failed" }, orderBy: { createdAt: "desc" } }));
  assert.match(told.title, /could not renew/);
  assert.match(told.body, /Visa ending 4242 was declined.*try again tomorrow/);
  assert.match(told.link, /^\/me\/billing\/[0-9a-f-]{36}$/);
  for (let d = 1; d < MAX_DECLINES; d++) await chargeAutoRenewals(s.deps(new Date(day.getTime() + d * 864e5)));
  assert.equal((await autos(s.id)).length, MAX_DECLINES);
  await chargeAutoRenewals(s.deps(new Date(day.getTime() + 5 * 864e5)));
  assert.equal((await autos(s.id)).length, MAX_DECLINES, "no fourth try");
  const last = await withUser(s.id, (tx) => tx.notification.findFirstOrThrow({ where: { userId: s.id, kind: "billing.failed" }, orderBy: { createdAt: "desc" } }));
  assert.match(last.body, /will not try the card again/);
  assert.equal((await subOf(s.id)).periodEnd.getTime(), sub.periodEnd.getTime(), "nothing was switched on");
});

test("the owner can turn it off and on, remove the card, and stopping renewal stops charges", async () => {
  const s = await setup(true);
  await setAutoRenew(s.payer, false);
  assert.equal((await subOf(s.id)).autoRenew, false);
  const sub = await subOf(s.id);
  const day = new Date(sub.periodEnd.getTime() - 6 * 3600_000);
  await generateRenewalInvoices({ now: day });
  await chargeAutoRenewals(s.deps(day));
  assert.equal((await autos(s.id)).length, 0, "off means no charge");
  await setAutoRenew(s.payer, true);
  await cancelOwn(s.payer);
  assert.equal((await subOf(s.id)).autoRenew, false, "stopping renewal turns automatic renewal off");
  await assert.rejects(setAutoRenew(s.payer, true), /set not to renew/);
  await removeCard(s.payer);
  assert.equal(await sys((tx) => tx.savedCard.count({ where: { ownerKey: `USER:${s.id}` } })), 0);
  await assert.rejects(removeCard(s.payer), /no saved card/);
});

test("an expired card is not charged, and paying a renewal invoice can turn it on", async () => {
  const s = await setup(false);
  await setRenewConsent(s.payer, s.inv.id, true); // invoice already paid: no change, no error
  const f2 = fakeProvider();
  f2.setCard({ token: "AUTH_OLD", customer: "", last4: "1111", brand: "mastercard", expMonth: 1, expYear: 2020, email: "" });
  const sub = await subOf(s.id);
  const day = new Date(sub.periodEnd.getTime() - 6 * 3600_000);
  await generateRenewalInvoices({ now: day });
  const renewal = await sys((tx) => tx.invoice.findFirstOrThrow({ where: { ownerUserId: s.id, status: "OPEN", renewal: true } }));
  await setRenewConsent(s.payer, renewal.id, true);
  const pay = await startPayment(s.payer, renewal.id, "https://app.test/billing/return", { provider: f2.p });
  f2.paid.set(pay.paymentRef, renewal.amountKobo);
  await verifyPayment(pay.paymentRef, { provider: f2.p });
  const st = await autoRenewStatus(s.payer);
  assert.equal(st.card?.last4, "1111");
  assert.equal(st.card?.expired, true);
  await assert.rejects(setAutoRenew(s.payer, true), /expired/);
  const later = await subOf(s.id);
  await chargeAutoRenewals({ provider: f2.p, now: new Date(later.periodEnd.getTime() - 6 * 3600_000) });
  assert.equal((await autos(s.id)).length, 0, "an expired card is never charged");
});
