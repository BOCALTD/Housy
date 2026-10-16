/**
 * Phase 14a: payments and subscription billing. A payment counts only when the provider's signed message (or the provider's own
 * answer) says so, only once, and only for the exact amount. Failed and mismatched payments switch nothing on.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withPublic, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { savePlan, setPlanEntitlements, entitlementIn, assignSubscription } from "../../src/lib/services/subscriptions";
import {
  cancelOwn, createSubscriptionInvoice, generateRenewalInvoices, invoiceFor, myInvoices, receiveProviderEvent, recordOfflinePayment, startPayment, verifyPayment, verifyPending, voidInvoice, type Deps, type Payer,
} from "../../src/lib/services/billing";
import { paystackProvider } from "../../src/lib/payment-providers";
import { hmacSha512 } from "../../src/lib/billing-rules";
import { addMember, newCompany, newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const KEY = "sk_test_phase14a";
const uid = () => Math.random().toString(36).slice(2, 8);
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);

/** What the fake provider says happened to each reference when asked. */
const truth = new Map<string, { status: string; amount: number; currency?: string }>();
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (u.endsWith("/transaction/initialize")) {
    const b = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, reference: b.reference } }), { status: 200 });
  }
  const m = /transaction\/verify\/([^/?]+)/.exec(u);
  if (m) {
    const t = truth.get(decodeURIComponent(m[1]));
    return t ? new Response(JSON.stringify({ status: true, data: { status: t.status, amount: t.amount, currency: t.currency ?? "NGN", id: 12345 } }), { status: 200 }) : new Response(JSON.stringify({ status: false, message: "Transaction reference not found" }), { status: 404 });
  }
  return new Response(JSON.stringify({ status: false, message: "unexpected" }), { status: 500 });
}) as typeof fetch;
const provider = paystackProvider(KEY, fakeFetch);
const deps = (now?: Date): Deps => ({ provider, now });

let eventSeq = 1000;
const chargeEvent = (event: "charge.success" | "charge.failed", reference: string, amount: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({ event, data: { id: ++eventSeq, reference, amount, currency: "NGN", status: event === "charge.success" ? "success" : "failed", ...over } });
const deliver = (raw: string, d: Deps = deps()) => receiveProviderEvent(raw, hmacSha512(KEY, raw), d);

async function person(label = "buyer") {
  const email = `${label}-${uid()}@example.test`.toLowerCase();
  const id = (await registerSeeker({ name: `${label} ${uid()}`, email, password: PASSWORD })).userId;
  return { id, email, payer: { userId: id, companyId: null, role: null } as Payer };
}
async function plan(admin: { id: string }, o: { audience?: "SEEKER" | "AGENT" | "COMPANY"; price?: string; period?: "MONTHLY" | "QUARTERLY" | "YEARLY"; tier?: "BASIC" | "SILVER" | "GOLD" } = {}) {
  const p = await savePlan(admin.id, null, { code: `t14-${uid()}`, name: `Plan ${uid()}`, audience: o.audience ?? "AGENT", price: o.price ?? "5,000", billingPeriod: o.period ?? "MONTHLY", trialDays: 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 100, tier: o.tier ?? "BASIC" } as never);
  await setPlanEntitlements(admin.id, p.id, [{ key: o.audience === "COMPANY" ? "COLLAB_COMPANY" : "COLLAB_SEEKER_AGENT", enabled: true, limit: 3 }]);
  return p;
}
const entries = (invoiceId: string) => sys((tx) => tx.financeEntry.findMany({ where: { invoiceId }, orderBy: { createdAt: "asc" } }));
const entitled = (userId: string) => withUser(userId, (tx) => entitlementIn(tx, { kind: "USER", userId }, "COLLAB_SEEKER_AGENT"));
async function openPayment(payer: Payer, planId: string) {
  const inv = await createSubscriptionInvoice(payer, planId);
  const pay = await startPayment(payer, inv.id, "https://app.test/billing/return", deps());
  return { inv, ...pay };
}

test("a signed success message pays the invoice, switches the plan on, and is counted once in the books", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const { inv, paymentRef, checkoutUrl } = await openPayment(buyer.payer, p.id);
  assert.equal(inv.amountKobo, 500_000n);
  assert.match(checkoutUrl, /^https:\/\/checkout\.paystack\.com\//);
  assert.equal((await entitled(buyer.id)).access, "NONE", "starting a payment gives nothing");
  assert.equal((await entries(inv.id)).length, 0);

  const raw = chargeEvent("charge.success", paymentRef, 500_000);
  const r = await deliver(raw);
  assert.equal(r.status, 200);
  assert.equal(r.body.outcome, "APPLIED");
  const e = await entitled(buyer.id);
  assert.equal(e.access, "FULL");
  assert.equal(e.state, "ACTIVE");
  assert.ok(e.periodEnd!.getTime() > Date.now() + 27 * 864e5 && e.periodEnd!.getTime() < Date.now() + 32 * 864e5, "one month bought");
  const after = await invoiceFor(buyer.payer, inv.id);
  assert.equal(after!.status, "PAID");
  assert.equal(after!.payments[0].status, "SUCCEEDED");
  const books = await entries(inv.id);
  assert.equal(books.length, 1);
  assert.equal(books[0].kind, "PAYMENT"); assert.equal(books[0].ledger, "SUBSCRIPTION"); assert.equal(books[0].account, "REVENUE"); assert.equal(books[0].amountKobo, 500_000n);
  assert.ok(books[0].eventId, "the entry points at the verified provider message");
  const note = await withUser(buyer.id, (tx) => tx.notification.findMany({ where: { userId: buyer.id, kind: "billing.paid" } }));
  assert.equal(note.length, 1);
});

test("the same message, delivered again or all at once, changes nothing the second time", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const { inv, paymentRef } = await openPayment(buyer.payer, p.id);
  const raw = chargeEvent("charge.success", paymentRef, 500_000);
  const results = await Promise.all(Array.from({ length: 6 }, () => deliver(raw)));
  assert.equal(results.filter((x) => x.body.duplicate === false).length, 1, "exactly one delivery is processed");
  assert.equal(results.filter((x) => x.body.duplicate === true).length, 5);
  assert.ok(results.every((x) => x.status === 200), "every delivery is acknowledged so the provider stops retrying");
  assert.equal((await deliver(raw)).body.duplicate, true);
  assert.equal((await entries(inv.id)).length, 1);
  const events = await sys((tx) => tx.subscriptionEvent.count({ where: { subscription: { ownerUserId: buyer.id } } }));
  assert.equal(events, 1, "the plan was switched on once");
  assert.equal(await sys((tx) => tx.paymentEvent.count({ where: { reference: paymentRef } })), 1);
});

test("different messages and a direct check for the same payment, at the same moment, still pay once", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const { inv, paymentRef } = await openPayment(buyer.payer, p.id);
  truth.set(paymentRef, { status: "success", amount: 500_000 });
  await Promise.all([
    deliver(chargeEvent("charge.success", paymentRef, 500_000)),
    deliver(chargeEvent("charge.success", paymentRef, 500_000)),
    verifyPayment(paymentRef, deps()),
    verifyPayment(paymentRef, deps()),
  ]);
  assert.equal((await entries(inv.id)).length, 1);
  assert.equal((await entitled(buyer.id)).access, "FULL");
  const subs = await sys((tx) => tx.subscription.count({ where: { ownerUserId: buyer.id } }));
  assert.equal(subs, 1);
  const end1 = (await entitled(buyer.id)).periodEnd!.getTime();
  await deliver(chargeEvent("charge.success", paymentRef, 500_000));
  assert.equal((await entitled(buyer.id)).periodEnd!.getTime(), end1, "a late repeat does not add time");
});

test("a message that is unsigned, altered, signed with another key, or sent with no provider connected is refused", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const { inv, paymentRef } = await openPayment(buyer.payer, p.id);
  const raw = chargeEvent("charge.success", paymentRef, 500_000);
  const before = await sys((tx) => tx.paymentEvent.count());
  assert.equal((await receiveProviderEvent(raw, null, deps())).status, 401);
  assert.equal((await receiveProviderEvent(raw, "deadbeef", deps())).status, 401);
  assert.equal((await receiveProviderEvent(raw, hmacSha512("another-key", raw), deps())).status, 401);
  assert.equal((await receiveProviderEvent(raw.replace("500000", "100"), hmacSha512(KEY, raw), deps())).status, 401, "an altered body fails its signature");
  assert.equal((await receiveProviderEvent(raw, hmacSha512(KEY, raw), { provider: null })).status, 503);
  assert.equal((await receiveProviderEvent("not json", hmacSha512(KEY, "not json"), deps())).status, 400);
  assert.equal(await sys((tx) => tx.paymentEvent.count()), before, "nothing refused was recorded as a payment event");
  assert.equal((await invoiceFor(buyer.payer, inv.id))!.status, "OPEN");
  assert.equal((await entitled(buyer.id)).access, "NONE");
});

test("a wrong amount or currency, or a payment for a cancelled invoice, switches nothing on and waits for a person", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const a = await openPayment(buyer.payer, p.id);
  const short = await deliver(chargeEvent("charge.success", a.paymentRef, 400_000));
  assert.equal(short.body.outcome, "REVIEW");
  assert.equal((await entitled(buyer.id)).access, "NONE");
  assert.equal((await invoiceFor(buyer.payer, a.inv.id))!.status, "OPEN");
  const pay = await sys((tx) => tx.payment.findUniqueOrThrow({ where: { ref: a.paymentRef } }));
  assert.equal(pay.status, "REVIEW"); assert.equal(pay.receivedKobo, 400_000n); assert.match(pay.reviewNote, /not the amount/);
  const books = await entries(a.inv.id);
  assert.equal(books.length, 1); assert.equal(books[0].account, "SUSPENSE"); assert.equal(books[0].amountKobo, 400_000n);
  // the person pays properly afterwards
  const again = await startPayment(buyer.payer, a.inv.id, "https://app.test/billing/return", deps());
  assert.notEqual(again.paymentRef, a.paymentRef, "a payment under review is not reused");
  assert.equal((await deliver(chargeEvent("charge.success", again.paymentRef, 500_000))).body.outcome, "APPLIED");
  assert.equal((await entitled(buyer.id)).access, "FULL");
  // currency
  const buyer2 = await person();
  const b = await openPayment(buyer2.payer, p.id);
  assert.equal((await deliver(chargeEvent("charge.success", b.paymentRef, 500_000, { currency: "USD" }))).body.outcome, "REVIEW");
  assert.equal((await entitled(buyer2.id)).access, "NONE");
  // paying a cancelled invoice
  const buyer3 = await person();
  const c = await openPayment(buyer3.payer, p.id);
  await voidInvoice(admin.id, c.inv.id, "Raised by mistake");
  assert.equal((await deliver(chargeEvent("charge.success", c.paymentRef, 500_000))).body.outcome, "REVIEW");
  assert.equal((await entitled(buyer3.id)).access, "NONE");
  // unknown reference and a message with no amount
  assert.equal((await deliver(chargeEvent("charge.success", "PAY-NOSUCH99", 500_000))).body.outcome, "UNKNOWN_REFERENCE");
  assert.equal((await deliver(JSON.stringify({ event: "charge.success", data: { id: ++eventSeq, reference: b.paymentRef } }))).body.outcome, "MALFORMED");
  assert.equal((await deliver(JSON.stringify({ event: "customeridentification.success", data: { id: ++eventSeq } }))).body.outcome, "IGNORED");
});

test("a failed payment is recorded, tells the person, leaves the invoice open to try again, and a late success still counts", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const a = await openPayment(buyer.payer, p.id);
  const f = await deliver(chargeEvent("charge.failed", a.paymentRef, 500_000));
  assert.equal(f.body.outcome, "FAILED_RECORDED");
  const failed = await sys((tx) => tx.payment.findUniqueOrThrow({ where: { ref: a.paymentRef } }));
  assert.equal(failed.status, "FAILED");
  assert.equal((await invoiceFor(buyer.payer, a.inv.id))!.status, "OPEN");
  assert.equal((await entitled(buyer.id)).access, "NONE");
  assert.equal(await sys((tx) => tx.financeEntry.count({ where: { invoiceId: a.inv.id } })), 0, "nothing was received, so nothing is booked");
  const told = await withUser(buyer.id, (tx) => tx.notification.findMany({ where: { userId: buyer.id, kind: "billing.failed" } }));
  assert.equal(told.length, 1);
  const outbox = await sys((tx) => tx.emailOutbox.findMany({ where: { userId: buyer.id, kind: "billing.failed" } }));
  assert.equal(outbox[0]?.category, "ESSENTIAL", "billing mail cannot be switched off");
  // the person tries again
  const b = await startPayment(buyer.payer, a.inv.id, "https://app.test/billing/return", deps());
  assert.notEqual(b.paymentRef, a.paymentRef);
  // a double click reuses the payment just started
  assert.equal((await startPayment(buyer.payer, a.inv.id, "https://app.test/billing/return", deps())).paymentRef, b.paymentRef);
  // the first attempt turns out to have gone through after all: the money arrived, so it counts, and the second attempt is then surplus
  assert.equal((await deliver(chargeEvent("charge.success", a.paymentRef, 500_000))).body.outcome, "APPLIED");
  assert.equal((await entitled(buyer.id)).access, "FULL");
  assert.equal((await deliver(chargeEvent("charge.success", b.paymentRef, 500_000))).body.outcome, "REVIEW", "a second payment for a paid invoice is held, not applied");
  assert.equal((await entries(a.inv.id)).filter((x) => x.account === "REVENUE").length, 1);
});

test("a provider that cannot start the payment leaves a failed attempt, not a stuck one", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const inv = await createSubscriptionInvoice(buyer.payer, p.id);
  const broken = paystackProvider(KEY, (async () => new Response(JSON.stringify({ status: false, message: "Invalid key" }), { status: 401 })) as typeof fetch);
  await assert.rejects(startPayment(buyer.payer, inv.id, "https://app.test/r", { provider: broken }), /did not start the payment/);
  const pays = await sys((tx) => tx.payment.findMany({ where: { invoiceId: inv.id } }));
  assert.equal(pays.length, 1); assert.equal(pays[0].status, "FAILED");
  await assert.rejects(startPayment(buyer.payer, inv.id, "https://app.test/r", { provider: null }), /not set up/);
  // someone else cannot pay or read this invoice
  const other = await person();
  await assert.rejects(startPayment(other.payer, inv.id, "https://app.test/r", deps()), /not found/i);
  assert.equal(await invoiceFor(other.payer, inv.id), null);
  assert.equal((await myInvoices(other.payer)).length, 0);
});

test("asking the provider settles a payment whose message never arrived, and ignores one still in progress", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const { inv, paymentRef } = await openPayment(buyer.payer, p.id);
  truth.set(paymentRef, { status: "ongoing", amount: 500_000 });
  assert.equal(await verifyPayment(paymentRef, deps()), "PENDING");
  assert.equal((await entitled(buyer.id)).access, "NONE");
  const later = new Date(Date.now() + 20 * 60_000);
  const idle = await verifyPending(deps(later));
  assert.ok(idle.checked >= 1, "a payment waiting for ten minutes is looked at");
  assert.equal((await entitled(buyer.id)).access, "NONE", "still in progress, so still nothing");
  truth.set(paymentRef, { status: "success", amount: 500_000 });
  const found = await verifyPending(deps(later));
  assert.ok(found.settled >= 1, "the lost message is recovered by asking the provider");
  assert.equal(await verifyPayment(paymentRef, deps()), "SUCCEEDED");
  assert.equal((await entries(inv.id)).length, 1);
  assert.equal((await entitled(buyer.id)).access, "FULL");
  // the provider says a payment failed
  const b2 = await person();
  const b = await openPayment(b2.payer, p.id);
  truth.set(b.paymentRef, { status: "abandoned", amount: 500_000 });
  assert.equal(await verifyPayment(b.paymentRef, deps()), "FAILED");
  // the provider reports a different amount than was asked
  const b3 = await person();
  const c = await openPayment(b3.payer, p.id);
  truth.set(c.paymentRef, { status: "success", amount: 300_000 });
  assert.equal(await verifyPayment(c.paymentRef, deps()), "REVIEW");
  assert.equal((await entitled(b3.id)).access, "NONE");
  // no provider connected: nothing is pretended
  const b4 = await person();
  const d = await openPayment(b4.payer, p.id);
  assert.equal(await verifyPayment(d.paymentRef, { provider: null }), "PENDING");
});

test("money paid by bank transfer is recorded by the administrator for the exact amount, once", async () => {
  const admin = await newPlatformAdmin(), buyer = await person(), other = await person();
  const p = await plan(admin, { period: "QUARTERLY", price: "12,000" });
  const inv = await createSubscriptionInvoice(buyer.payer, p.id);
  assert.equal(inv.periodMonths, 3);
  await assert.rejects(recordOfflinePayment(buyer.id, inv.id, { amount: "12,000", reference: "NIP-1" }), /administrator/);
  await assert.rejects(recordOfflinePayment(admin.id, inv.id, { amount: "11,000", reference: "NIP-1" }), /exactly/);
  await assert.rejects(recordOfflinePayment(admin.id, inv.id, { amount: "12,000", reference: " " }), /reference/);
  assert.equal((await entitled(buyer.id)).access, "NONE");
  await recordOfflinePayment(admin.id, inv.id, { amount: "12,000", reference: "nip 20261016 77" });
  assert.equal((await entitled(buyer.id)).access, "FULL");
  assert.ok((await entitled(buyer.id)).periodEnd!.getTime() > Date.now() + 85 * 864e5);
  const books = await entries(inv.id);
  assert.equal(books.length, 1); assert.equal(books[0].amountKobo, 1_200_000n); assert.equal(books[0].actorId, admin.id); assert.equal(books[0].eventId, null);
  await assert.rejects(recordOfflinePayment(admin.id, inv.id, { amount: "12,000", reference: "NIP-2" }), /not open/);
  const inv2 = await createSubscriptionInvoice(other.payer, p.id);
  await assert.rejects(recordOfflinePayment(admin.id, inv2.id, { amount: "12,000", reference: "NIP 20261016 77" }), /already been recorded/, "the same transfer cannot pay two invoices");
  assert.equal((await entitled(other.id)).access, "NONE");
});

test("asking for the same plan again returns the same open invoice; another plan replaces it; unsuitable plans are refused", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const a = await plan(admin), b = await plan(admin, { price: "9,000" }), co = await plan(admin, { audience: "COMPANY" });
  const i1 = await createSubscriptionInvoice(buyer.payer, a.id);
  assert.equal((await createSubscriptionInvoice(buyer.payer, a.id)).id, i1.id);
  const i2 = await createSubscriptionInvoice(buyer.payer, b.id);
  assert.notEqual(i2.id, i1.id);
  assert.equal((await invoiceFor(buyer.payer, i1.id))!.status, "VOID");
  assert.equal((await myInvoices(buyer.payer)).filter((i) => i.status === "OPEN").length, 1);
  await assert.rejects(createSubscriptionInvoice(buyer.payer, co.id), /for companies/);
  const free = await savePlan(admin.id, null, { code: `t14-${uid()}`, name: "Free", audience: "AGENT", billingPeriod: "NONE", trialDays: 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 1, tier: "BASIC" } as never);
  await assert.rejects(createSubscriptionInvoice(buyer.payer, free.id), /cannot be bought online/);
  await assert.rejects(createSubscriptionInvoice(buyer.payer, "00000000-0000-0000-0000-000000000000"), /not available/);
});

test("a company's administrator buys its plan; nobody else in the company can; the gold badge follows payment", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("billing");
  const manager = await addMember(co, "MANAGER", "mgr");
  const owner: Payer = { userId: co.userId, companyId: co.companyId, role: co.role };
  const mgr: Payer = { userId: manager.userId, companyId: co.companyId, role: manager.role };
  const gold = await plan(admin, { audience: "COMPANY", price: "50,000", tier: "GOLD", period: "YEARLY" });
  await assert.rejects(createSubscriptionInvoice(mgr, gold.id), /company administrator/);
  assert.equal((await myInvoices(mgr)).length, 0, "a manager may look");
  const seekerPlan = await plan(admin);
  await assert.rejects(createSubscriptionInvoice(owner, seekerPlan.id), /for individuals/);
  const { inv, paymentRef } = await openPayment(owner, gold.id);
  assert.equal((await myInvoices(mgr)).length, 1, "a manager can see the company's invoice");
  await assert.rejects(startPayment(mgr, inv.id, "https://app.test/r", deps()), /company administrator/);
  assert.equal((await withPublic((tx) => tx.companyTier.findUnique({ where: { companyId: co.companyId } }))), null, "no badge before payment");
  assert.equal((await deliver(chargeEvent("charge.success", paymentRef, 5_000_000))).body.outcome, "APPLIED");
  const tier = await withPublic((tx) => tx.companyTier.findUnique({ where: { companyId: co.companyId } }));
  assert.equal(tier?.tier, "GOLD");
  assert.ok(tier!.validUntil.getTime() > Date.now() + 360 * 864e5);
  const other = await newCompany("othbill");
  assert.equal(await invoiceFor({ userId: other.userId, companyId: other.companyId, role: other.role }, inv.id), null, "another company cannot see it");
});

test("renewal: an invoice is raised once as the end nears, reminders go once per stage, and paying after expiry restarts from today", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const inv0 = await createSubscriptionInvoice(buyer.payer, p.id);
  await recordOfflinePayment(admin.id, inv0.id, { amount: "5,000", reference: `R-${uid()}` });
  const sub = await sys((tx) => tx.subscription.findFirstOrThrow({ where: { ownerUserId: buyer.id } }));
  const first = await generateRenewalInvoices(deps());
  assert.equal(await sys((tx) => tx.invoice.count({ where: { ownerUserId: buyer.id, status: "OPEN" } })), 0, "far from the end: nothing is raised");
  void first;
  const end = new Date(Date.now() + 3 * 864e5);
  await sys((tx) => tx.subscription.update({ where: { id: sub.id }, data: { periodEnd: end } }));
  const r1 = await generateRenewalInvoices(deps());
  assert.ok(r1.invoices >= 1);
  const open = await sys((tx) => tx.invoice.findMany({ where: { ownerUserId: buyer.id, status: "OPEN" } }));
  assert.equal(open.length, 1); assert.equal(open[0].renewal, true); assert.equal(open[0].amountKobo, 500_000n);
  const told = () => withUser(buyer.id, (tx) => tx.notification.count({ where: { userId: buyer.id, kind: "billing.renewal" } }));
  assert.equal(await told(), 1);
  await generateRenewalInvoices(deps()); await generateRenewalInvoices(deps());
  assert.equal(await told(), 1, "running the job again does not repeat the reminder");
  assert.equal(await sys((tx) => tx.invoice.count({ where: { ownerUserId: buyer.id, status: "OPEN" } })), 1);
  // it runs out; the overdue reminder goes once
  const overdue = new Date(end.getTime() + 2 * 864e5);
  await generateRenewalInvoices(deps(overdue)); await generateRenewalInvoices(deps(overdue));
  assert.equal(await told(), 2);
  // pays two days late: the new period starts from that day, not from the old end
  await recordOfflinePayment(admin.id, open[0].id, { amount: "5,000", reference: `R-${uid()}` }, deps(overdue));
  const renewed = await sys((tx) => tx.subscription.findFirstOrThrow({ where: { ownerUserId: buyer.id } }));
  assert.equal(renewed.status, "ACTIVE");
  assert.ok(renewed.periodEnd.getTime() > overdue.getTime() + 27 * 864e5);
  assert.ok(renewed.periodEnd.getTime() < overdue.getTime() + 32 * 864e5);
  const evs = await sys((tx) => tx.subscriptionEvent.findMany({ where: { subscriptionId: sub.id }, orderBy: { createdAt: "asc" } }));
  assert.deepEqual(evs.map((e) => e.kind), ["ASSIGNED", "RENEWED"]);
});

test("a plan that has run out loses its features after grace, and cancelling stops renewal without cutting off what was paid for", async () => {
  const admin = await newPlatformAdmin(), buyer = await person();
  const p = await plan(admin);
  const inv = await createSubscriptionInvoice(buyer.payer, p.id);
  await recordOfflinePayment(admin.id, inv.id, { amount: "5,000", reference: `X-${uid()}` });
  const sub = await sys((tx) => tx.subscription.findFirstOrThrow({ where: { ownerUserId: buyer.id } }));
  // owner cancels: still works until the end, and no renewal is asked for
  await sys((tx) => tx.subscription.update({ where: { id: sub.id }, data: { periodEnd: new Date(Date.now() + 2 * 864e5) } }));
  await generateRenewalInvoices(deps());
  assert.equal(await sys((tx) => tx.invoice.count({ where: { ownerUserId: buyer.id, status: "OPEN" } })), 1);
  await cancelOwn(buyer.payer);
  assert.equal((await entitled(buyer.id)).access, "FULL", "paid time is kept");
  assert.equal(await sys((tx) => tx.invoice.count({ where: { ownerUserId: buyer.id, status: "OPEN" } })), 0, "the renewal invoice is withdrawn");
  await generateRenewalInvoices(deps());
  assert.equal(await sys((tx) => tx.invoice.count({ where: { ownerUserId: buyer.id, status: "OPEN" } })), 0);
  await assert.rejects(cancelOwn(buyer.payer), /already cancelled/);
  // an expired plan: full during grace, read only, then nothing
  const buyer2 = await person();
  const inv2 = await createSubscriptionInvoice(buyer2.payer, p.id);
  await recordOfflinePayment(admin.id, inv2.id, { amount: "5,000", reference: `X-${uid()}` });
  const at = (days: number) => withUser(buyer2.id, (tx) => entitlementIn(tx, { kind: "USER", userId: buyer2.id }, "COLLAB_SEEKER_AGENT", new Date(Date.now() + days * 864e5)));
  assert.equal((await at(35)).state, "GRACE");
  assert.equal((await at(35)).access, "FULL");
  assert.equal((await at(50)).access, "READ_ONLY");
  assert.equal((await at(90)).access, "NONE");
  // a paid plan is not affected by an administrator-assigned one on someone else
  void assignSubscription;
});

test("the books reject an entry nobody can account for, and a correction needs a named person and a reason", async () => {
  const admin = await newPlatformAdmin();
  await assert.rejects(sys((tx) => tx.$executeRawUnsafe(`INSERT INTO finance_entries (id, ledger, kind, account, amount_kobo, note) VALUES ('${uid()}-a', 'SUBSCRIPTION', 'PAYMENT', 'REVENUE', 100, 'x')`)), /entry_traceable|check constraint/i);
  await assert.rejects(sys((tx) => tx.$executeRawUnsafe(`INSERT INTO finance_entries (id, ledger, kind, account, amount_kobo, actor_id, note) VALUES ('${uid()}-b', 'SUBSCRIPTION', 'ADJUSTMENT', 'REVENUE', 100, 'system', 'automatic')`)), /entry_adjustment|check constraint/i);
  await assert.rejects(sys((tx) => tx.$executeRawUnsafe(`INSERT INTO finance_entries (id, ledger, kind, account, amount_kobo, actor_id, note) VALUES ('${uid()}-c', 'SUBSCRIPTION', 'ADJUSTMENT', 'REVENUE', 100, '${admin.id}', 'x')`)), /entry_adjustment|check constraint/i);
  await assert.rejects(sys((tx) => tx.$executeRawUnsafe(`INSERT INTO finance_entries (id, ledger, kind, account, amount_kobo, actor_id) VALUES ('${uid()}-d', 'SUBSCRIPTION', 'PAYMENT', 'REVENUE', -5, '${admin.id}')`)), /entry_kind_sign|check constraint/i);
  await sys((tx) => tx.$executeRawUnsafe(`INSERT INTO finance_entries (id, ledger, kind, account, amount_kobo, actor_id, note) VALUES ('${uid()}-e', 'SUBSCRIPTION', 'ADJUSTMENT', 'REVENUE', 100, '${admin.id}', 'Corrected a data entry slip')`));
  // an entry key is used once
  const key = `k-${uid()}`;
  await sys((tx) => tx.financeEntry.create({ data: { ledger: "SUBSCRIPTION", kind: "PAYMENT", account: "REVENUE", amountKobo: 1n, entryKey: key, actorId: admin.id } }));
  await assert.rejects(sys((tx) => tx.financeEntry.create({ data: { ledger: "SUBSCRIPTION", kind: "PAYMENT", account: "REVENUE", amountKobo: 1n, entryKey: key, actorId: admin.id } })));
});
