/**
 * Phase 14c: refunds and the finance books. Money given back is reserved once, entered once, never exceeds what was paid (or, for adverts, what is unspent),
 * and the reconciliation shows when anything disagrees.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { assignSubscription, savePlan, setPlanEntitlements, entitlementIn } from "../../src/lib/services/subscriptions";
import { createSubscriptionInvoice, recordOfflinePayment, type Payer } from "../../src/lib/services/billing";
import { acceptReviewedPayment, cancelRefund, confirmRefund, refundLimit, requestRefund } from "../../src/lib/services/refunds";
import { createCampaign, recordClick, reviewCampaign, submitCampaign, type CampaignForm } from "../../src/lib/services/ads";
import { adjust, balances, entries, entriesCsv, reconcileFinance } from "../../src/lib/services/finance";
import { registerSeeker } from "../../src/lib/services/community";
import { addMember, newCompany, newPlatformAdmin, relativeDate, PASSWORD } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);
const HUMAN = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const payerOf = (c: Ctx): Payer => ({ userId: c.userId, companyId: c.companyId, role: c.role });

async function advertiser(admin: { id: string }, o: { limit?: number | null; plan?: boolean } = {}) {
  const co = await newCompany("adco");
  if (o.plan !== false) {
    const plan = await savePlan(admin.id, null, { code: `t14b-${uid()}`, name: `Ads ${uid()}`, audience: "COMPANY", price: "20,000", billingPeriod: "MONTHLY", trialDays: 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 100, tier: "BASIC" } as never);
    await setPlanEntitlements(admin.id, plan.id, [{ key: "ADVERTISING", enabled: true, limit: o.limit === undefined ? 2 : o.limit }]);
    await assignSubscription(admin.id, { planId: plan.id, periodEnd: relativeDate(60), companyId: co.companyId });
  }
  return co;
}
async function published(admin: { id: string }, co: Ctx, city = "Lekki") {
  const asset = await createAsset(co, { name: `Home ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: `Flat in ${city} ${uid()}`, purpose: "RENT", price: "2,000,000", bedrooms: "2", city, state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await sys((tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "");
  return { asset, listing: await sys((tx) => tx.listing.findUniqueOrThrow({ where: { id: l.id } })) };
}
const form = (ref: string, over: Partial<CampaignForm> = {}): CampaignForm => ({ name: `Camp ${uid()}`, listingRef: ref, placement: "HOME_FEATURED", headline: "", startsOn: relativeDate(0), endsOn: relativeDate(7), budget: "5,000", dailyCap: "", ...over });

/** Create, send, approve and pay for a campaign so it is running. */
async function runningCampaign(admin: { id: string }, co: Ctx, listingRef: string, over: Partial<CampaignForm> = {}) {
  const c = await createCampaign(payerOf(co), form(listingRef, over));
  await submitCampaign(payerOf(co), c.id);
  await reviewCampaign(admin.id, c.id, "approve", "");
  const fresh = await sys((tx) => tx.adCampaign.findUniqueOrThrow({ where: { id: c.id } }));
  await recordOfflinePayment(admin.id, fresh.invoiceId!, { amount: String(Number(fresh.budgetKobo) / 100), reference: `ADPAY-${uid()}` });
  return sys((tx) => tx.adCampaign.findUniqueOrThrow({ where: { id: c.id } }));
}
const get = (id: string) => sys((tx) => tx.adCampaign.findUniqueOrThrow({ where: { id } }));
const click = (r: string, who: string) => recordClick(r, { viewerKey: who, userId: null, ua: HUMAN });

async function subscriber(admin: { id: string }) {
  const email = `sub-${uid()}@example.test`;
  const id = (await registerSeeker({ name: `Sub ${uid()}`, email, password: PASSWORD })).userId;
  const plan = await savePlan(admin.id, null, { code: `t14c-${uid()}`, name: `Plan ${uid()}`, audience: "AGENT", price: "10,000", billingPeriod: "MONTHLY", trialDays: 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 100, tier: "BASIC" } as never);
  await setPlanEntitlements(admin.id, plan.id, [{ key: "COLLAB_SEEKER_AGENT", enabled: true, limit: 3 }]);
  const payer: Payer = { userId: id, companyId: null, role: null };
  const inv = await createSubscriptionInvoice(payer, plan.id);
  await recordOfflinePayment(admin.id, inv.id, { amount: "10,000", reference: `NIP-${uid()}` });
  const pay = await sys((tx) => tx.payment.findFirstOrThrow({ where: { invoiceId: inv.id } }));
  return { id, inv, pay };
}
const access = (userId: string) => withUser(userId, (tx) => entitlementIn(tx, { kind: "USER", userId }, "COLLAB_SEEKER_AGENT")).then((e) => e.access);
const ledgerSum = (where: object) => sys((tx) => tx.financeEntry.aggregate({ where, _sum: { amountKobo: true } })).then((r) => r._sum.amountKobo ?? 0n);

test("a refund is reserved once, cannot pass what was paid, and a full subscription refund takes back the time bought", async () => {
  const admin = await newPlatformAdmin();
  const s = await subscriber(admin);
  assert.equal(await access(s.id), "FULL");
  await assert.rejects(requestRefund(s.id, s.pay.id, { amount: "1,000", reason: "please" }), /administrator/);
  await assert.rejects(requestRefund(admin.id, s.pay.id, { amount: "1,000", reason: "x" }), /reason/);
  await assert.rejects(requestRefund(admin.id, s.pay.id, { amount: "10,001", reason: "too much" }), /more than/);
  // four requests at once for 4,000: only two can fit in 10,000
  const r = await Promise.allSettled(Array.from({ length: 4 }, () => requestRefund(admin.id, s.pay.id, { amount: "4,000", reason: "Duplicate charge" })));
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 2, "10,000 holds two refunds of 4,000, not three");
  assert.equal((await sys((tx) => tx.payment.findUniqueOrThrow({ where: { id: s.pay.id } }))).refundedKobo, 800_000n);
  assert.equal(await refundLimit(admin.id, s.pay.id), 200_000n);
  const pending = await sys((tx) => tx.refund.findMany({ where: { paymentId: s.pay.id }, orderBy: { createdAt: "asc" } }));
  assert.equal(await ledgerSum({ paymentId: s.pay.id, kind: "REFUND" }), 0n, "nothing is entered until the money has gone back");
  // cancel one: its amount is free again
  await cancelRefund(admin.id, pending[0].id);
  assert.equal(await refundLimit(admin.id, s.pay.id), 600_000n);
  assert.equal(await access(s.id), "FULL", "a part refund keeps the plan");
  await confirmRefund(admin.id, pending[1].id);
  assert.equal(await confirmRefund(admin.id, pending[1].id), "ALREADY", "confirming twice enters it once");
  assert.equal(await ledgerSum({ paymentId: s.pay.id }), 600_000n, "ledger equals received less refunded");
  // refund the rest: the plan stops
  const rest = await requestRefund(admin.id, s.pay.id, { amount: "6,000", reason: "Full refund asked for" });
  await confirmRefund(admin.id, rest.refundId);
  assert.equal(await ledgerSum({ paymentId: s.pay.id }), 0n);
  assert.equal(await access(s.id), "NONE", "time bought is taken back once everything is refunded");
  assert.equal(await refundLimit(admin.id, s.pay.id), 0n);
  const inv = await sys((tx) => tx.subscription.findFirst({ where: { ownerUserId: s.id } }));
  assert.equal(inv?.status, "CANCELLED");
});

test("an advert refund is limited to the budget not yet spent, and ends the campaign", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { listing } = await published(admin, co);
  const c = await runningCampaign(admin, co, listing.publicRef, { budget: "10,000" });
  for (let i = 0; i < 4; i++) await click(c.ref, `v${i}`);
  const spent = (await get(c.id)).spentKobo;
  assert.equal(spent, 4n * c.cpcKobo);
  const pay = await sys((tx) => tx.payment.findFirstOrThrow({ where: { invoiceId: c.invoiceId! } }));
  const limit = await refundLimit(admin.id, pay.id);
  assert.equal(limit, 1_000_000n - spent, "only what has not been spent");
  await assert.rejects(requestRefund(admin.id, pay.id, { amount: "10,000", reason: "Want it all back" }), /more than/);
  const r = await requestRefund(admin.id, pay.id, { amount: String(Number(limit) / 100), reason: "Advertiser stopped early" });
  await confirmRefund(admin.id, r.refundId);
  const after = await get(c.id);
  assert.equal(after.status, "ENDED"); assert.match(after.endedReason, /refunded/);
  assert.equal(after.fundedKobo, spent);
  assert.equal(after.postedKobo, after.spentKobo);
  assert.equal((await click(c.ref, "late")).to, `/properties/${listing.publicRef}?ad=${c.ref}`);
  assert.equal((await get(c.id)).spentKobo, spent, "an ended advert charges nobody");
  assert.equal(await ledgerSum({ campaignId: c.id, account: "REVENUE", kind: "SPEND" }), spent);
  assert.equal(await ledgerSum({ paymentId: pay.id }), spent, "what remains of the payment is what was spent");
});

test("the reconciliation shows when the books agree and catches a payment changed without the books", async () => {
  const admin = await newPlatformAdmin();
  const s = await subscriber(admin);
  const co = await advertiser(admin);
  const { listing } = await published(admin, co);
  const c = await runningCampaign(admin, co, listing.publicRef);
  await click(c.ref, "z1");
  const clean = await reconcileFinance(admin.id);
  const mine = (refs: string[]) => refs.includes(s.pay.ref) || refs.includes(c.ref);
  assert.ok(!clean.findings.some((f) => (f.code.startsWith("PAYMENT_") && f.code !== "PAYMENT_NEEDS_DECISION") || f.code.startsWith("CAMPAIGN_") || f.code === "FUNDS_HELD_MISMATCH" || f.code === "REFUND_MISMATCH"), JSON.stringify(clean.findings));
  void mine;
  await assert.rejects(reconcileFinance(co.userId), /administrator/);
  // someone changes a payment's figures without the books: it is caught
  await sys((tx) => tx.payment.update({ where: { id: s.pay.id }, data: { refundedKobo: 100_000n } }));
  const bad = await reconcileFinance(admin.id);
  assert.ok(bad.findings.find((f) => f.code === "PAYMENT_TOTAL_MISMATCH")?.refs.includes(s.pay.ref));
  assert.equal(bad.balanced, false);
  await sys((tx) => tx.payment.update({ where: { id: s.pay.id }, data: { refundedKobo: 0n } }));
  assert.ok(!(await reconcileFinance(admin.id)).findings.some((f) => f.refs.includes(s.pay.ref)), "put right, it is no longer reported");
});

test("corrections need a named administrator and a reason, add an entry, and show in the ledger and the export", async () => {
  const admin = await newPlatformAdmin();
  const before = await balances(admin.id);
  await assert.rejects(adjust(admin.id, { ledger: "SUBSCRIPTION", account: "REVENUE", amount: "500", note: "no" }), /Say why/);
  await assert.rejects(adjust(admin.id, { ledger: "SUBSCRIPTION", account: "BANK", amount: "500", note: "Bank charge" }), /account/);
  await assert.rejects(adjust(admin.id, { ledger: "SUBSCRIPTION", account: "REVENUE", amount: "0", note: "Nothing at all" }), /greater than zero/);
  await assert.rejects(adjust(admin.id, { ledger: "SUBSCRIPTION", account: "REVENUE", amount: "abc", note: "Not a number" }), /amount/);
  const co = await newCompany("fin");
  await assert.rejects(adjust(co.userId, { ledger: "SUBSCRIPTION", account: "REVENUE", amount: "500", note: "Bank charge" }), /administrator/);
  const e = await adjust(admin.id, { ledger: "SUBSCRIPTION", account: "REVENUE", amount: "-750.50", note: "=Bank charge reversal" });
  assert.equal(e.amountKobo, -75_050n); assert.equal(e.actorId, admin.id); assert.equal(e.kind, "ADJUSTMENT");
  const after = await balances(admin.id);
  const rev = (b: typeof before) => b.find((x) => x.ledger === "SUBSCRIPTION")!.accounts.find((a) => a.account === "REVENUE")!.kobo;
  assert.equal(rev(after) - rev(before), -75_050n);
  const list = await entries(admin.id, { ledger: "SUBSCRIPTION", page: 0 });
  assert.ok(list.rows.length > 0 && list.rows.length <= list.pageSize);
  assert.ok(list.rows.every((r) => r.ledger === "SUBSCRIPTION"));
  const csv = await entriesCsv(admin.id, "SUBSCRIPTION");
  assert.match(csv, /"Ledger","Kind"/);
  assert.match(csv, /"'=Bank charge reversal"/, "a note that looks like a formula is made safe for spreadsheets");
  // entries can never be rewritten or removed
  await assert.rejects(sys((tx) => tx.financeEntry.update({ where: { id: e.id }, data: { amountKobo: 1n } })), /append|permission|denied|not allowed/i);
  await assert.rejects(sys((tx) => tx.financeEntry.delete({ where: { id: e.id } })), /append|permission|denied|not allowed/i);
});
