/**
 * Promotion fees paid online or by recorded transfer through invoices, and paid boosts for single properties.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus, listingWhere } from "../../src/lib/services/listings";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import { decorateListings, myPromoEntries, requestPromo, reviewPromo, saveCampaign, withdrawPromo } from "../../src/lib/services/promotions";
import { boostedMatching, boostedNow, cancelBoost, myBoosts, requestBoost, saveBoostPrice } from "../../src/lib/services/boosts";
import { receiveProviderEvent, recordOfflinePayment, startPayment, type Deps } from "../../src/lib/services/billing";
import { paystackProvider } from "../../src/lib/payment-providers";
import { hmacSha512 } from "../../src/lib/billing-rules";
import type { Ctx } from "../../src/lib/services/context";
import { newCompany, newPlatformAdmin, relativeDate, withRole } from "./helpers";

after(() => prisma.$disconnect());

const KEY = "sk_test_promo_boosts";
const uid = () => Math.random().toString(36).slice(2, 8);
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).endsWith("/transaction/initialize")) {
    const b = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, reference: b.reference } }), { status: 200 });
  }
  return new Response(JSON.stringify({ status: false, message: "unexpected" }), { status: 500 });
}) as typeof fetch;
const deps: Deps = { provider: paystackProvider(KEY, fakeFetch) };
let seq = 5000;
const paidEvent = (reference: string, amount: bigint) => JSON.stringify({ event: "charge.success", data: { id: ++seq, reference, amount: Number(amount), currency: "NGN", status: "success" } });
const payer = (c: Ctx) => ({ userId: c.userId, companyId: c.companyId, role: c.role });

async function published(admin: { id: string }, co: Ctx, city: string, price = "10,000,000") {
  const asset = await createAsset(co, { name: `Flat ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: `Flat in ${city}`, purpose: "RENT", price, bedrooms: "2", city, state: `State ${city}` } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  return withPlatformAdmin(admin.id, (tx) => tx.listing.findUniqueOrThrow({ where: { id: l.id } }));
}

test("a Basic company's promotion fee is an invoice: paid online it is confirmed by the provider's message and booked", async () => {
  const admin = await newPlatformAdmin();
  const c = await saveCampaign(admin.id, null, { name: `Sale ${uid()}`, tagline: "", theme: "RED", startsOn: relativeDate(-1), endsOn: relativeDate(10), fee: "25,000", maxDiscountPct: 40 as never });
  const co = await newCompany("promofee");
  const l = await published(admin, co, `P${uid()}`);
  const e = await requestPromo(co, c.id, l.id, "9,000,000");
  assert.ok(e.invoiceId);
  const inv = await sys((tx) => tx.invoice.findUniqueOrThrow({ where: { id: e.invoiceId! } }));
  assert.equal(inv.purpose, "PROMOTION");
  assert.equal(inv.amountKobo, 2_500_000n);
  assert.equal(inv.ownerCompanyId, co.companyId);
  assert.equal((await myPromoEntries(co))[0].invoice?.ref, inv.ref);
  await assert.rejects(reviewPromo(admin.id, e.id, "approve", ""), /fee has not been paid/);

  // Only the company administrator pays; the payment counts only on the provider's signed message.
  await assert.rejects(startPayment(payer(withRole(co, "MANAGER")), inv.id, "https://app.test/r", deps), /company administrator/);
  const pay = await startPayment(payer(co), inv.id, "https://app.test/r", deps);
  const raw = paidEvent(pay.paymentRef, inv.amountKobo);
  assert.equal((await receiveProviderEvent(raw, hmacSha512(KEY, raw), deps)).status, 200);
  const p = (await myPromoEntries(co))[0].payment!;
  assert.equal(p.status, "VERIFIED");
  assert.equal(p.reference, inv.ref);
  const books = await sys((tx) => tx.financeEntry.findMany({ where: { invoiceId: inv.id } }));
  assert.deepEqual(books.map((b) => [b.ledger, b.account, b.amountKobo]), [["ADVERTISING", "REVENUE", 2_500_000n]]);
  await reviewPromo(admin.id, e.id, "approve", "");

  // A withdrawn or turned-down request's unpaid invoice is cancelled.
  const l2 = await published(admin, co, `P${uid()}`);
  const e2 = await requestPromo(co, c.id, l2.id, "9,000,000");
  await withdrawPromo(co, e2.id);
  assert.equal((await sys((tx) => tx.invoice.findUniqueOrThrow({ where: { id: e2.invoiceId! } }))).status, "VOID");
  const l3 = await published(admin, co, `P${uid()}`);
  const e3 = await requestPromo(co, c.id, l3.id, "9,000,000");
  await reviewPromo(admin.id, e3.id, "reject", "Photos are missing");
  assert.equal((await sys((tx) => tx.invoice.findUniqueOrThrow({ where: { id: e3.invoiceId! } }))).status, "VOID");

  // Upgrading before approval waives the fee and cancels its invoice.
  const l4 = await published(admin, co, `P${uid()}`);
  const e4 = await requestPromo(co, c.id, l4.id, "9,000,000");
  const silver = await withPlatformAdmin(admin.id, (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-silver" } }));
  await assignSubscription(admin.id, { planId: silver.id, periodEnd: relativeDate(60), companyId: co.companyId });
  await reviewPromo(admin.id, e4.id, "approve", "");
  assert.equal((await sys((tx) => tx.invoice.findUniqueOrThrow({ where: { id: e4.invoiceId! } }))).status, "VOID");
  // Free promotions make no invoice at all.
  const l5 = await published(admin, co, `P${uid()}`);
  assert.equal((await requestPromo(co, c.id, l5.id, "9,000,000")).invoiceId, null);
});

test("a boost is bought per property, starts when paid, follows on from a running boost, and is labelled and lifted", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("booster");
  const city = `Boost${uid()}`;
  const l = await published(admin, co, city);
  const plain = await published(admin, co, city);
  await saveBoostPrice(admin.id, "0");
  await assert.rejects(requestBoost(co, { listingId: l.id, days: "7" }), /not on sale/);
  await assert.rejects(saveBoostPrice(co.userId, "2,000"), /platform administrator/);
  await saveBoostPrice(admin.id, "2,000");
  await assert.rejects(requestBoost(withRole(co, "OFFICER"), { listingId: l.id, days: "7" }), /permission|not allowed/i);
  await assert.rejects(requestBoost(co, { listingId: l.id, days: "5" }), /how many days/);
  const other = await newCompany("notmine");
  await assert.rejects(requestBoost(other, { listingId: l.id, days: "7" }), /one of your properties/);

  const first = await requestBoost(co, { listingId: l.id, days: "7" });
  assert.equal(first.invoice.purpose, "BOOST");
  assert.equal(first.invoice.amountKobo, 1_400_000n);
  // Asking again before paying replaces the first request and cancels its invoice.
  const second = await requestBoost(co, { listingId: l.id, days: "3" });
  const mine = await myBoosts(co);
  assert.equal(mine.boosts.find((b) => b.id === first.boost.id)!.status, "CANCELLED");
  assert.equal(mine.boosts.find((b) => b.id === first.boost.id)!.invoice?.status, "VOID");
  assert.equal((await boostedNow([l.id])).size, 0, "nothing is lifted before payment");

  await recordOfflinePayment(admin.id, second.invoice.id, { amount: "6,000", reference: `TRF-${uid()}` });
  const active = (await myBoosts(co)).boosts.find((b) => b.id === second.boost.id)!;
  assert.equal(active.status, "ACTIVE");
  assert.equal(Math.round((active.endsAt!.getTime() - active.startsAt!.getTime()) / 864e5), 3);
  assert.ok((await boostedNow([l.id, plain.id])).has(l.id));
  await assert.rejects(cancelBoost(co, second.boost.id), /waiting for payment/);
  await assert.rejects(cancelBoost(other, second.boost.id), /not found/);

  // Shown first among the newest and in the labelled row for matching searches; never for searches it does not match.
  const ranked = await decorateListings([plain, l].map((x) => ({ ...x })), true);
  assert.equal(ranked[0].id, l.id);
  assert.equal(ranked[0].boosted, true);
  assert.equal(ranked[1].boosted, false);
  const base = { types: [], amenities: [], sort: "newest" as const, page: 1 };
  assert.deepEqual((await boostedMatching(listingWhere({ ...base, city }))).map((x) => x.id), [l.id]);
  assert.equal((await boostedMatching(listingWhere({ ...base, city: `Nowhere${uid()}` }))).length, 0);

  // A second paid boost follows on from the first.
  const more = await requestBoost(co, { listingId: l.id, days: "7" });
  await recordOfflinePayment(admin.id, more.invoice.id, { amount: "14,000", reference: `TRF-${uid()}` });
  const next = (await myBoosts(co)).boosts.find((b) => b.id === more.boost.id)!;
  assert.equal(next.startsAt!.getTime(), active.endsAt!.getTime());

  // Unpaid boosts can be cancelled; the database refuses a company starting its own boost.
  const unpaid = await requestBoost(co, { listingId: plain.id, days: "3" });
  await cancelBoost(co, unpaid.boost.id);
  assert.equal((await sys((tx) => tx.invoice.findUniqueOrThrow({ where: { id: unpaid.invoice.id } }))).status, "VOID");
  const { withTenant } = await import("../../src/lib/db");
  await assert.rejects(withTenant(co.companyId, co.userId, (tx) => tx.listingBoost.create({ data: { ref: `BST-${uid()}`, companyId: co.companyId, listingId: plain.id, days: 3, priceKobo: 1n, status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 864e5), createdById: co.userId } })));
  await assert.rejects(withTenant(co.companyId, co.userId, (tx) => tx.listingBoost.update({ where: { id: unpaid.boost.id }, data: { status: "ACTIVE" } })));
  await saveBoostPrice(admin.id, "0");
});
