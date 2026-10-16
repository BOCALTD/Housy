/**
 * Phase 11: plan levels (Basic, Silver, Gold), promotions with their payment and approval rules, the price display facts,
 * ranking, and the periodic platform rating, against a real PostgreSQL database through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { assignSubscription, cancelSubscription } from "../../src/lib/services/subscriptions";
import { tierOf } from "../../src/lib/services/tiers";
import {
  eligibleListings, listingExtras, livePromos, markPaymentReceived, myPromoEntries, promoQueue, requestPromo, reviewPromo, saveCampaign, searchListingsRanked, setCampaignActive, withdrawPromo,
} from "../../src/lib/services/promotions";
import {
  exportRatingsCsv, feedbackDue, feedbackSummary, listRatings, readFeedbackSettings, reviewRating, saveFeedbackSettings, snoozeFeedback, submitRating,
} from "../../src/lib/services/feedback";
import type { Ctx } from "../../src/lib/services/context";
import { newCompany, newPlatformAdmin, relativeDate, withRole, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const plan = (code: string) => withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code } }));
const subscribe = async (adminId: string, code: string, companyId: string, days = 60) => assignSubscription(adminId, { planId: (await plan(code)).id, periodEnd: relativeDate(days), companyId });

async function published(admin: { id: string }, co: Ctx, city: string, price = "10,000,000") {
  const asset = await createAsset(co, { name: `Flat ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: `Flat in ${city}`, purpose: "SALE", price, bedrooms: "2", city, state: `State ${city}` } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  return withPlatformAdmin(admin.id, (tx) => tx.listing.findUniqueOrThrow({ where: { id: l.id } }));
}
const sale = (adminId: string, o: Partial<{ name: string; fee: string; max: number; start: string; end: string }> = {}) =>
  saveCampaign(adminId, null, { name: o.name ?? `Black Friday ${uid()}`, tagline: "Big savings", theme: "RED", startsOn: o.start ?? relativeDate(-1), endsOn: o.end ?? relativeDate(10), fee: o.fee ?? "50,000", maxDiscountPct: (o.max ?? 40) as never });

test("a company's level follows its subscription, and falls back to Basic when the plan ends or is cancelled", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("tier");
  assert.equal(await tierOf(co.companyId), "BASIC");
  await subscribe(admin.id, "company-silver", co.companyId);
  assert.equal(await tierOf(co.companyId), "SILVER");
  await subscribe(admin.id, "company-gold", co.companyId);
  assert.equal(await tierOf(co.companyId), "GOLD");
  const sub = await withPlatformAdmin(admin.id, (tx) => tx.subscription.findFirstOrThrow({ where: { ownerCompanyId: co.companyId } }));
  await cancelSubscription(admin.id, sub.id, "ended");
  const t = await tierOf(co.companyId);
  assert.ok(t === "GOLD" || t === "BASIC", "a cancelled plan runs to the end of its period, then Basic");
  const lapsed = await newCompany("lapsed");
  await withPlatformAdmin(admin.id, (tx) => tx.companyTier.create({ data: { companyId: lapsed.companyId, tier: "GOLD", validUntil: new Date(Date.now() - 1000) } }));
  assert.equal(await tierOf(lapsed.companyId), "BASIC", "an expired tier earns nothing");
});

test("campaigns are the administrator's alone and must make sense", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("camp");
  await assert.rejects(sale(co.userId), /Only the platform administrator/);
  await assert.rejects(sale(admin.id, { start: relativeDate(5), end: relativeDate(1) }), /cannot end before/);
  await assert.rejects(sale(admin.id, { max: 95 }), /At most 90/);
  await assert.rejects(sale(admin.id, { name: "x" }), /Name the campaign/);
  const c = await sale(admin.id);
  assert.equal(c.feeKobo, 5_000_000n);
});

test("a Basic company pays per property and cannot be approved before the payment is confirmed; Silver and Gold join free", async () => {
  const admin = await newPlatformAdmin();
  const c = await sale(admin.id);
  const basic = await newCompany("basic");
  const l = await published(admin, basic, `B${uid()}`);

  await assert.rejects(requestPromo(withRole(basic, "OFFICER"), c.id, l.id, "8,000,000"), /not allowed|permission|cannot/i);
  await assert.rejects(requestPromo(basic, c.id, l.id, "10,000,000"), /lower than the listed price/);
  await assert.rejects(requestPromo(basic, c.id, l.id, "5,000,000"), /at most 40%/);
  await assert.rejects(requestPromo(basic, c.id, l.id, "abc"), /naira amount/);
  const e = await requestPromo(basic, c.id, l.id, "8,000,000");
  assert.equal(e.originalPriceKobo, 1_000_000_000n);
  await assert.rejects(requestPromo(basic, c.id, l.id, "8,500,000"), /already in this campaign/);

  const mine = await myPromoEntries(basic);
  assert.equal(mine[0].payment?.status, "PENDING");
  assert.equal(mine[0].payment?.feeKobo, 5_000_000n);

  await assert.rejects(reviewPromo(admin.id, e.id, "approve", ""), /Payment has not been confirmed/);
  await assert.rejects(markPaymentReceived(admin.id, e.id, "ab"), /at least 4/);
  await assert.rejects(markPaymentReceived(basic.userId, e.id, "BANK-1234"), /Only the platform administrator/);
  await markPaymentReceived(admin.id, e.id, "BANK-1234");
  await assert.rejects(markPaymentReceived(admin.id, e.id, "BANK-9999"), /does not need confirming/);
  assert.equal((await livePromos([l])).size, 0, "nothing is shown before approval");
  await reviewPromo(admin.id, e.id, "approve", "");
  const live = (await livePromos([l])).get(l.id)!;
  assert.equal(live.originalKobo, 1_000_000_000n);
  assert.equal(live.promoKobo, 800_000_000n);
  assert.equal(live.pct, 20);
  await assert.rejects(reviewPromo(admin.id, e.id, "reject", "late"), /already been decided/);

  for (const code of ["company-silver", "company-gold"]) {
    const co = await newCompany(code);
    await subscribe(admin.id, code, co.companyId);
    const li = await published(admin, co, `F${uid()}`);
    const en = await requestPromo(co, c.id, li.id, "9,000,000");
    const p = (await myPromoEntries(co))[0].payment!;
    assert.equal(p.status, "NOT_REQUIRED");
    assert.equal(p.feeKobo, 0n);
    await reviewPromo(admin.id, en.id, "approve", "");
  }
});

test("a company that upgrades after asking is not charged; rejection needs a reason; withdrawing and asking again works", async () => {
  const admin = await newPlatformAdmin();
  const c = await sale(admin.id);
  const co = await newCompany("upgrade");
  const l = await published(admin, co, `U${uid()}`);
  const e = await requestPromo(co, c.id, l.id, "9,000,000");
  await subscribe(admin.id, "company-silver", co.companyId);
  await reviewPromo(admin.id, e.id, "approve", "");
  const p = (await myPromoEntries(co)).find((x) => x.id === e.id)!.payment!;
  assert.equal(p.status, "NOT_REQUIRED");
  assert.match(p.note, /Waived/);

  const l2 = await published(admin, co, `U${uid()}`);
  const e2 = await requestPromo(co, c.id, l2.id, "9,000,000");
  await assert.rejects(reviewPromo(admin.id, e2.id, "reject", " "), /Say why/);
  await reviewPromo(admin.id, e2.id, "reject", "Photos missing");
  assert.equal((await livePromos([l2])).size, 0);

  const l3 = await published(admin, co, `U${uid()}`);
  const e3 = await requestPromo(co, c.id, l3.id, "9,000,000");
  await withdrawPromo(co, e3.id);
  await assert.rejects(withdrawPromo(co, e3.id), /still waiting/);
  const again = await requestPromo(co, c.id, l3.id, "8,800,000");
  assert.notEqual(again.id, e3.id);
  assert.equal(((await promoQueue(admin.id, "REQUESTED")).filter((q) => q.id === again.id)).length, 1);
});

test("a promotion is shown only while it is still true: the price unchanged, the property published, and the campaign running", async () => {
  const admin = await newPlatformAdmin();
  const c = await sale(admin.id);
  const co = await newCompany("stale");
  await subscribe(admin.id, "company-silver", co.companyId);
  const l = await published(admin, co, `S${uid()}`);
  const e = await requestPromo(co, c.id, l.id, "9,000,000");
  await reviewPromo(admin.id, e.id, "approve", "");
  assert.equal((await livePromos([l])).size, 1);

  // The listed price moves: the old "was" price would now be a lie, so the promotion pauses.
  await withTenant(co.companyId, co.userId, (tx) => tx.listing.update({ where: { id: l.id }, data: { priceKobo: 1_200_000_000n } }));
  const moved = await withPlatformAdmin(admin.id, (tx) => tx.listing.findUniqueOrThrow({ where: { id: l.id } }));
  assert.equal((await livePromos([moved])).size, 0, "a changed price pauses the promotion");
  await withTenant(co.companyId, co.userId, (tx) => tx.listing.update({ where: { id: l.id }, data: { priceKobo: l.priceKobo } }));

  await setCampaignActive(admin.id, c.id, false);
  assert.equal((await livePromos([l])).size, 0, "an ended campaign shows nothing");
  await setCampaignActive(admin.id, c.id, true);
  assert.equal((await livePromos([l])).size, 1);
  await assert.rejects(requestPromo(co, (await sale(admin.id, { start: relativeDate(-9), end: relativeDate(-5) })).id, (await published(admin, co, `S${uid()}`)).id, "9,000,000"), /not open/);

  const ex = await listingExtras(l);
  assert.equal(ex.tier, "SILVER");
  assert.ok(ex.promo);
  const other = await newCompany("thief");
  const mine = await eligibleListings(other, c.id);
  assert.ok(!mine.some((m) => m.id === l.id), "another company cannot see or promote this property");
  await assert.rejects(requestPromo(other, c.id, l.id, "8,000,000"), /Choose one of your properties/);
});

test("search results carry each company's level and live promotion, and Gold listings are lifted", async () => {
  const admin = await newPlatformAdmin();
  const city = `R${uid()}`;
  const gold = await newCompany("gold");
  await subscribe(admin.id, "company-gold", gold.companyId);
  const basic = await newCompany("plain");
  const plain: string[] = [];
  for (let i = 0; i < 5; i++) plain.push((await published(admin, basic, city)).id);
  const g = await published(admin, gold, city);
  const c = await sale(admin.id);
  await reviewPromo(admin.id, (await requestPromo(gold, c.id, g.id, "9,000,000")).id, "approve", "");
  const results = await searchListingsRanked({ city });
  assert.equal(results.length, 6);
  const at = results.findIndex((r) => r.id === g.id);
  assert.ok(at >= 0 && at < 3, "the Gold listing is in the first three places even though it was published last");
  assert.equal(results[at].tier, "GOLD");
  assert.equal(results[at].promo?.promoKobo, 900_000_000n);
  assert.ok(results.filter((r) => r.id !== g.id).every((r) => r.tier === "BASIC" && r.promo === null));
});

test("the platform rating is asked once per interval, can be postponed, and anonymous answers carry no name", async () => {
  const admin = await newPlatformAdmin();
  const before = await readFeedbackSettings();
  try {
    await assert.rejects(saveFeedbackSettings(admin.id, "0"), /1 to 365/);
    await assert.rejects(saveFeedbackSettings(admin.id, "400"), /1 to 365/);
    await assert.rejects(saveFeedbackSettings((await registerSeeker({ name: `Nope ${uid()}`, email: `nope-${uid()}@example.test`, password: PASSWORD })).userId, "30"), /Only the platform administrator/);
    await saveFeedbackSettings(admin.id, "30");
    assert.equal((await readFeedbackSettings()).intervalDays, 30);

    const name = `Reporter${uid()}`;
    const u = (await registerSeeker({ name, email: `rate-${uid()}@example.test`, password: PASSWORD })).userId;
    assert.equal(await feedbackDue(u), false, "a new member is not asked on day one");
    assert.equal(await feedbackDue(admin.id), false, "administrators are not asked");
    await prisma.user.update({ where: { id: u }, data: { createdAt: new Date(Date.now() - 40 * 864e5) } });
    assert.equal(await feedbackDue(u), true);
    await snoozeFeedback(u);
    assert.equal(await feedbackDue(u), false, "remind me later waits");
    assert.equal(await feedbackDue(u, new Date(Date.now() + 8 * 864e5)), true, "and asks again after a week");

    await assert.rejects(submitRating(u, { overall: "" as never, suggestion: "" }), /overall rating/);
    await assert.rejects(submitRating(u, { overall: "7" as never, suggestion: "" }), /1 to 5/);
    await submitRating(u, { overall: "4" as never, ease: "5" as never, trust: "" as never, suggestion: "Faster photo uploads please", anonymous: true });
    assert.equal(await feedbackDue(u), false, "after rating, not for another interval");
    assert.equal(await feedbackDue(u, new Date(Date.now() + 31 * 864e5)), true);

    const list = await listRatings(admin.id, { onlyComments: true });
    const mine = list.rows.find((r) => r.suggestion.includes("Faster photo uploads"))!;
    assert.equal(mine.who, "Anonymous");
    assert.ok(!JSON.stringify(list).includes(name), "an anonymous answer never carries the name");
    assert.ok(!("userId" in mine));
    const csv = await exportRatingsCsv(admin.id);
    assert.ok(!csv.includes(name));
    assert.match(csv, /Faster photo uploads/);

    const u2name = `Named${uid()}`;
    const u2 = (await registerSeeker({ name: u2name, email: `named-${uid()}@example.test`, password: PASSWORD })).userId;
    await submitRating(u2, { overall: "2" as never, suggestion: "Search is slow", anonymous: false });
    assert.equal((await listRatings(admin.id, { onlyComments: true })).rows.find((r) => r.suggestion === "Search is slow")!.who, u2name);

    await reviewRating(admin.id, mine.id, "REVIEWED", "Passed to the product team");
    await assert.rejects(reviewRating(admin.id, mine.id, "BOGUS", ""), /Choose a status/);
    await assert.rejects(listRatings(u2), /Only the platform administrator/);
    const sum = await feedbackSummary(admin.id);
    assert.ok(sum.total >= 2 && sum.overall !== null);
    assert.equal(sum.distribution.reduce((a, d) => a + d.count, 0), sum.total);
    assert.ok(sum.trend.length >= 1);
  } finally {
    await saveFeedbackSettings(admin.id, String(before.intervalDays));
  }
});
