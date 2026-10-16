/**
 * Phase 14b: advertising. Adverts need a plan that allows them and a review; they run only when paid, inside their dates, with a
 * published property; clicks are charged once per real visitor and spending never passes the budget, even when clicks arrive together.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createEnquiry, reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { assignSubscription, savePlan, setPlanEntitlements } from "../../src/lib/services/subscriptions";
import { recordOfflinePayment, type Payer } from "../../src/lib/services/billing";
import {
  campaignReport, createCampaign, deleteDraft, endCampaign, evaluateCampaigns, liftSuspension, pauseCampaign, readAdConfig, recordClick, recordView, reportCsv, resumeCampaign, reviewCampaign, saveAdConfig,
  sponsoredFor, submitCampaign, suspendCampaign, updateCampaign, viewerKeyFor, type CampaignForm,
} from "../../src/lib/services/ads";
import { DEFAULT_AD_CONFIG } from "../../src/lib/ad-rules";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";
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
const ref = (c: { ref: string }) => c.ref;
const click = (r: string, who: string, extra: { userId?: string | null; ua?: string } = {}) => recordClick(r, { viewerKey: who, userId: extra.userId ?? null, ua: extra.ua ?? HUMAN });
const get = (id: string) => sys((tx) => tx.adCampaign.findUniqueOrThrow({ where: { id } }));

test("advertising is a plan feature with a limit, and a campaign is checked before it is accepted", async () => {
  const admin = await newPlatformAdmin();
  const none = await advertiser(admin, { plan: false });
  const { listing: l0 } = await published(admin, none);
  await assert.rejects(createCampaign(payerOf(none), form(l0.publicRef)), /does not include advertising/);

  const co = await advertiser(admin, { limit: 2 });
  const { listing } = await published(admin, co);
  const manager = await addMember(co, "MANAGER", "mgr");
  await assert.rejects(createCampaign(payerOf(manager), form(listing.publicRef)), /company administrator/);
  const bad = async (over: Partial<CampaignForm>, re: RegExp) => assert.rejects(createCampaign(payerOf(co), form(listing.publicRef, over)), re);
  await bad({ startsOn: relativeDate(-1) }, /past/);
  await bad({ endsOn: relativeDate(-1), startsOn: relativeDate(0) }, /before it starts/);
  await bad({ endsOn: relativeDate(200) }, /at most 90 days/);
  await bad({ budget: "10" }, /at least/);
  await bad({ budget: "9,000,000" }, /at most/);
  await bad({ dailyCap: "1" }, /daily limit/);
  await bad({ dailyCap: "6,000" }, /daily limit/);
  await bad({ headline: "Call 08012345678 now" }, /phone numbers/);
  await bad({ headline: "see www.example.com" }, /links/);
  await bad({ headline: "x".repeat(61) }, /60 characters/);
  await bad({ placement: "BANNER" }, /where the advert/);
  await bad({ name: " " }, /Name the campaign/);
  const other = await advertiser(admin);
  await assert.rejects(createCampaign(payerOf(other), form(listing.publicRef)), /published property of yours/, "another company's property cannot be advertised");
  await setListingStatus(co, (await sys((tx) => tx.listing.findUniqueOrThrow({ where: { id: listing.id } }))).assetId, "UNAVAILABLE");
  await assert.rejects(createCampaign(payerOf(co), form(listing.publicRef)), /published property of yours/, "an unpublished property cannot be advertised");

  // limit of two at a time, counted when sent
  const co2 = await advertiser(admin, { limit: 2 });
  const { listing: l2 } = await published(admin, co2);
  const cs = [];
  for (let i = 0; i < 3; i++) cs.push(await createCampaign(payerOf(co2), form(l2.publicRef)));
  await submitCampaign(payerOf(co2), cs[0].id); await submitCampaign(payerOf(co2), cs[1].id);
  await assert.rejects(submitCampaign(payerOf(co2), cs[2].id), /allows 2 campaigns at a time/);
  // a plan that has run out can look but not add
  await sys((tx) => tx.subscription.updateMany({ where: { ownerCompanyId: co2.companyId }, data: { startedAt: new Date(Date.now() - 200 * 864e5), periodEnd: new Date(Date.now() - 20 * 864e5) } }));
  await assert.rejects(createCampaign(payerOf(co2), form(l2.publicRef)), /run out/);
  await sys((tx) => tx.subscription.updateMany({ where: { ownerCompanyId: co2.companyId }, data: { startedAt: new Date(Date.now() - 200 * 864e5), periodEnd: new Date(Date.now() - 60 * 864e5) } }));
  await assert.rejects(createCampaign(payerOf(co2), form(l2.publicRef)), /does not include advertising|run out/);
});

test("a campaign needs review, is invoiced for its budget when approved, and runs only once paid", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { listing } = await published(admin, co);
  const c = await createCampaign(payerOf(co), form(listing.publicRef, { headline: "Bright two-bedroom flat" }));
  assert.equal(c.status, "DRAFT");
  assert.equal(c.cpcKobo, BigInt(DEFAULT_AD_CONFIG.cpcKobo.HOME_FEATURED));
  assert.equal((await sponsoredFor("HOME_FEATURED")).filter((x) => x.ref === c.ref).length, 0, "a draft is never shown");
  await assert.rejects(reviewCampaign(admin.id, c.id, "approve", ""), /not waiting for review/);
  await submitCampaign(payerOf(co), c.id);
  await assert.rejects(submitCampaign(payerOf(co), c.id), /already sent/);
  await assert.rejects(updateCampaign(payerOf(co), c.id, form(listing.publicRef)), /not been approved/);
  const peer = await advertiser(admin);
  await assert.rejects(pauseCampaign(payerOf(peer), c.id), /not found/i, "another company cannot touch it");
  await assert.rejects(reviewCampaign(co.userId, c.id, "approve", ""), /administrator/);
  await assert.rejects(reviewCampaign(admin.id, c.id, "reject", "no"), /Say why/);
  await reviewCampaign(admin.id, c.id, "reject", "The picture does not match the property");
  assert.equal((await get(c.id)).status, "REJECTED");
  const told = await withUser(co.userId, (tx) => tx.notification.count({ where: { userId: co.userId, kind: "billing.ad_rejected" } }));
  assert.equal(told, 1);
  assert.equal(await sys((tx) => tx.invoice.count({ where: { subjectId: c.id } })), 0, "nothing is billed for a campaign that was not approved");
  // change and send again
  const changed = await updateCampaign(payerOf(co), c.id, form(listing.publicRef, { name: "Changed", budget: "6,000", headline: "Bright two-bedroom flat" }));
  assert.equal(changed.status, "DRAFT");
  await submitCampaign(payerOf(co), c.id);
  await reviewCampaign(admin.id, c.id, "approve", "Looks good");
  await assert.rejects(reviewCampaign(admin.id, c.id, "approve", ""), /not waiting for review/);
  const approved = await get(c.id);
  assert.equal(approved.status, "APPROVED");
  const inv = await sys((tx) => tx.invoice.findMany({ where: { subjectId: c.id } }));
  assert.equal(inv.length, 1); assert.equal(inv[0].purpose, "AD_CAMPAIGN"); assert.equal(inv[0].amountKobo, 600_000n); assert.equal(inv[0].status, "OPEN");
  assert.equal((await sponsoredFor("HOME_FEATURED")).filter((x) => x.ref === c.ref).length, 0, "approved but unpaid: not shown");
  const r0 = await click(c.ref, "early-visitor");
  assert.equal(r0.to, `/properties/${listing.publicRef}?ad=${c.ref}`, "a click always reaches the property");
  assert.equal((await get(c.id)).spentKobo, 0n, "an unpaid advert charges nobody");
  // pay it
  await recordOfflinePayment(admin.id, inv[0].id, { amount: "6,000", reference: `AD-${uid()}` });
  const funded = await get(c.id);
  assert.equal(funded.fundedKobo, 600_000n);
  const shown = (await sponsoredFor("HOME_FEATURED")).find((x) => x.ref === c.ref);
  assert.ok(shown, "approved, paid and inside its dates: shown");
  assert.equal(shown!.headline, "Bright two-bedroom flat");
  assert.equal(shown!.listing.publicRef, listing.publicRef);
  assert.equal((await get(c.id)).impressions, 1);
  // a draft that was never approved can be deleted; an approved one cannot
  await assert.rejects(deleteDraft(payerOf(co), c.id), /never approved/);
  const d = await createCampaign(payerOf(co), form(listing.publicRef));
  await deleteDraft(payerOf(co), d.id);
  assert.equal(await sys((tx) => tx.adCampaign.count({ where: { id: d.id } })), 0);
});

test("clicks are charged once per real visitor a day, never for bots or the advertiser's own people, and respect the daily limit", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { listing } = await published(admin, co);
  const c = await runningCampaign(admin, co, listing.publicRef, { dailyCap: "4,000", budget: "10,000" });
  const cpc = c.cpcKobo;
  await sponsoredFor("HOME_FEATURED", { bot: true });
  assert.equal((await get(c.id)).impressions, 0, "a robot looking at the page is not an impression");
  await sponsoredFor("HOME_FEATURED");
  assert.equal((await get(c.id)).impressions, 1);

  await click(c.ref, "visitor-a");
  assert.equal((await get(c.id)).spentKobo, cpc, "first click from a visitor is charged");
  await click(c.ref, "visitor-a");
  assert.equal((await get(c.id)).spentKobo, cpc, "the same visitor again the same day is free");
  await click(c.ref, "visitor-bot", { ua: "Googlebot/2.1" });
  await click(c.ref, "visitor-empty", { ua: "" });
  await click(c.ref, "visitor-curl", { ua: "curl/8.0" });
  assert.equal((await get(c.id)).spentKobo, cpc, "robots are never charged");
  assert.equal((await get(c.id)).clicks, 2, "robots are not counted as clicks either");
  await click(c.ref, "visitor-own", { userId: co.userId });
  const mgr = await addMember(co, "OFFICER", "off");
  await click(c.ref, "visitor-own2", { userId: mgr.userId });
  assert.equal((await get(c.id)).spentKobo, cpc, "the advertiser's own people are never charged");
  await click(c.ref, "visitor-b");
  assert.equal((await get(c.id)).spentKobo, 2n * cpc);
  const reasons = (await sys((tx) => tx.adClick.findMany({ where: { campaignId: c.id } }))).map((x) => x.reason);
  assert.ok(reasons.includes("REPEAT") && reasons.includes("BOT") && reasons.includes("OWN"), "every free click says why");
  // daily limit: 4,000 allows 26 clicks at 150; push past it by raising nothing but spend: set today's spend near the limit
  const day = await sys((tx) => tx.adDay.findFirstOrThrow({ where: { campaignId: c.id } }));
  await sys((tx) => tx.adDay.update({ where: { campaignId_day: { campaignId: c.id, day: day.day } }, data: { spentKobo: 400_000n - cpc + 1n } }));
  await click(c.ref, "visitor-late");
  assert.equal((await get(c.id)).spentKobo, 2n * cpc, "past the daily limit nothing more is charged");
  assert.equal((await sys((tx) => tx.adClick.findFirstOrThrow({ where: { campaignId: c.id, viewerKey: "visitor-late" } }))).reason, "DAILY_LIMIT");
  // unknown advert: the visitor goes home, nothing happens
  assert.equal((await click("AD-NOSUCH99", "someone")).to, "/");
});

test("two clicks at the same moment can never spend the same money: the budget is never passed", async () => {
  const admin = await newPlatformAdmin();
  await saveAdConfig(admin.id, { homeCpc: "1,500", searchCpc: "100", minBudget: "5,000", maxBudget: "5,000,000", maxDays: "90" });
  try {
    const co = await advertiser(admin);
    const { listing } = await published(admin, co);
    const c = await runningCampaign(admin, co, listing.publicRef, { budget: "5,000" });
    assert.equal(c.cpcKobo, 150_000n, "the price at the time the campaign was made");
    const r = await Promise.all(Array.from({ length: 12 }, (_, i) => click(c.ref, `rush-${i}`)));
    assert.ok(r.every((x) => x.to === `/properties/${listing.publicRef}?ad=${c.ref}`), "everyone still reaches the property");
    const after = await get(c.id);
    assert.equal(after.billedClicks, 3, "five thousand naira buys three clicks at 1,500");
    assert.equal(after.spentKobo, 450_000n);
    assert.ok(after.spentKobo <= after.fundedKobo);
    assert.equal(after.status, "ENDED"); assert.match(after.endedReason, /budget was used up/);
    assert.equal((await sponsoredFor("HOME_FEATURED")).filter((x) => x.ref === c.ref).length, 0, "an exhausted advert is no longer shown");
    const paid = await sys((tx) => tx.adClick.count({ where: { campaignId: c.id, billed: true } }));
    assert.equal(paid, 3);
    // what was spent has moved into the books exactly once
    assert.equal(after.postedKobo, after.spentKobo);
    await evaluateCampaigns(); await evaluateCampaigns();
    const book = await sys((tx) => tx.financeEntry.findMany({ where: { campaignId: c.id } }));
    assert.equal(book.filter((e) => e.kind === "SPEND" && e.account === "REVENUE").reduce((n, e) => n + e.amountKobo, 0n), 450_000n);
    assert.equal(book.filter((e) => e.kind === "SPEND" && e.account === "FUNDS_HELD").reduce((n, e) => n + e.amountKobo, 0n), -450_000n);
    // the database itself refuses to overspend
    await assert.rejects(sys((tx) => tx.adCampaign.update({ where: { id: c.id }, data: { spentKobo: after.fundedKobo + 1n } })), /ad_money|check constraint/i);
  } finally {
    await saveAdConfig(admin.id, { homeCpc: "150", searchCpc: "100", minBudget: "5,000", maxBudget: "5,000,000", maxDays: "90" });
  }
  const cfg = await readAdConfig();
  assert.equal(cfg.cpcKobo.HOME_FEATURED, 15_000);
});

test("search placement shows only adverts for properties that match the search, and prices come from the administrator", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { listing } = await published(admin, co, "Ikoyi");
  const c = await runningCampaign(admin, co, listing.publicRef, { placement: "SEARCH_TOP" });
  assert.equal(c.cpcKobo, 10_000n);
  const has = async (filters: Record<string, string>) => (await sponsoredFor("SEARCH_TOP", { filters })).some((x) => x.ref === c.ref);
  assert.equal(await has({ city: "Ikoyi" }), true);
  assert.equal(await has({ city: "Ikoyi", purpose: "RENT", minBeds: "2", maxPrice: "3,000,000" }), true);
  assert.equal(await has({ city: "Abuja" }), false, "a different area");
  assert.equal(await has({ purpose: "SALE" }), false, "a different purpose");
  assert.equal(await has({ maxPrice: "1,000,000" }), false, "over the budget the visitor set");
  assert.equal(await has({ minBeds: "5" }), false);
  assert.equal(await has({}), false, "a search with nothing set matches nothing, so adverts are not shown for it");
  assert.equal((await sponsoredFor("HOME_FEATURED")).some((x) => x.ref === c.ref), false, "it is only in the place it was bought for");
  await assert.rejects(saveAdConfig(co.userId, { homeCpc: "1", searchCpc: "1", minBudget: "5,000", maxBudget: "5,000,000", maxDays: "90" }), /administrator/);
  await assert.rejects(saveAdConfig(admin.id, { homeCpc: "0.10", searchCpc: "100", minBudget: "5,000", maxBudget: "5,000,000", maxDays: "90" }), /must be between/);
});

test("adverts stop by themselves when the property is withdrawn, the plan runs out or the dates pass, and restart when the cause goes", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { asset, listing } = await published(admin, co);
  const c = await runningCampaign(admin, co, listing.publicRef);
  const shown = async () => (await sponsoredFor("HOME_FEATURED")).some((x) => x.ref === c.ref);
  assert.equal(await shown(), true);

  // 1. the property is withdrawn: nothing is shown or charged at once, and the check records why
  await setListingStatus(co, asset.id, "UNAVAILABLE");
  assert.equal(await shown(), false, "no waiting for the next scheduled check");
  const before = (await get(c.id)).spentKobo;
  await click(c.ref, "v-withdrawn");
  assert.equal((await get(c.id)).spentKobo, before, "a click on an advert for a withdrawn property is free");
  const r1 = await evaluateCampaigns();
  assert.ok(r1.suspended >= 1);
  const s1 = await get(c.id);
  assert.equal(s1.status, "SUSPENDED"); assert.equal(s1.suspendedBy, "SYSTEM"); assert.match(s1.suspendReason, /no longer published/);
  assert.equal(await withUser(co.userId, (tx) => tx.notification.count({ where: { userId: co.userId, kind: "billing.ad_suspended" } })), 1);
  await evaluateCampaigns();
  assert.equal(await withUser(co.userId, (tx) => tx.notification.count({ where: { userId: co.userId, kind: "billing.ad_suspended" } })), 1, "told once");
  // the property comes back: the advert resumes
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  await reviewListing(admin.id, listing.id, "approve", "");
  const r2 = await evaluateCampaigns();
  assert.ok(r2.resumed >= 1);
  assert.equal((await get(c.id)).status, "APPROVED");
  assert.equal(await shown(), true);

  // 2. the plan runs out beyond its grace period
  const sub = await sys((tx) => tx.subscription.findFirstOrThrow({ where: { ownerCompanyId: co.companyId } }));
  await sys((tx) => tx.subscription.update({ where: { id: sub.id }, data: { startedAt: new Date(Date.now() - 200 * 864e5), periodEnd: new Date(Date.now() - 12 * 864e5) } }));
  assert.equal(await shown(), false, "read-only access does not allow adverts to run");
  await evaluateCampaigns();
  const s2 = await get(c.id);
  assert.equal(s2.status, "SUSPENDED"); assert.match(s2.suspendReason, /plan/);
  await sys((tx) => tx.subscription.update({ where: { id: sub.id }, data: { periodEnd: new Date(Date.now() + 30 * 864e5) } }));
  await evaluateCampaigns();
  assert.equal((await get(c.id)).status, "APPROVED", "renewing the plan restarts it");

  // 3. an administrator suspends: the check does not undo that
  await suspendCampaign(admin.id, c.id, "Complaint about the photos");
  assert.equal(await shown(), false);
  await evaluateCampaigns();
  assert.equal((await get(c.id)).status, "SUSPENDED");
  await assert.rejects(suspendCampaign(admin.id, c.id, "again please"), /Only a running/);
  await liftSuspension(admin.id, c.id);
  assert.equal(await shown(), true);
  await assert.rejects(liftSuspension(admin.id, c.id), /not suspended/);
  await assert.rejects(suspendCampaign(admin.id, c.id, "x"), /reason/);

  // 4. paused by the advertiser
  await pauseCampaign(payerOf(co), c.id);
  assert.equal(await shown(), false);
  await evaluateCampaigns();
  assert.equal((await get(c.id)).status, "PAUSED", "a pause is the advertiser's choice and is left alone");
  await resumeCampaign(payerOf(co), c.id);
  assert.equal(await shown(), true);

  // 5. the dates pass
  await sys((tx) => tx.adCampaign.update({ where: { id: c.id }, data: { startsOn: new Date(Date.now() - 10 * 864e5), endsOn: new Date(Date.now() - 3 * 864e5) } }));
  assert.equal(await shown(), false);
  const r5 = await evaluateCampaigns();
  assert.ok(r5.ended >= 1);
  const s5 = await get(c.id);
  assert.equal(s5.status, "ENDED"); assert.match(s5.endedReason, /end date/);
  await assert.rejects(endCampaign(payerOf(co), c.id), /already ended/);
});

test("a campaign scheduled for later is not shown yet, and one the advertiser ends keeps its unspent budget on record", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { listing } = await published(admin, co);
  const later = await runningCampaign(admin, co, listing.publicRef, { startsOn: relativeDate(3), endsOn: relativeDate(10) });
  assert.equal((await sponsoredFor("HOME_FEATURED")).some((x) => x.ref === later.ref), false);
  const rep = await campaignReport({ payer: payerOf(co) }, later.ref);
  assert.equal(rep!.phase, "SCHEDULED");
  const live = await runningCampaign(admin, co, listing.publicRef);
  await click(live.ref, "v1");
  await endCampaign(payerOf(co), live.id);
  const e = await get(live.id);
  assert.equal(e.status, "ENDED"); assert.equal(e.postedKobo, e.spentKobo, "what was spent is booked when it ends");
  assert.equal(e.fundedKobo - e.spentKobo > 0n, true, "the rest is still the advertiser's");
  assert.equal((await sponsoredFor("HOME_FEATURED")).some((x) => x.ref === live.ref), false);
});

test("results keep paid and organic attention apart: visits, enquiries, cost per click and per enquiry", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { listing } = await published(admin, co);
  const c = await runningCampaign(admin, co, listing.publicRef);
  await sponsoredFor("HOME_FEATURED"); await sponsoredFor("HOME_FEATURED");
  await click(c.ref, "p1"); await click(c.ref, "p2"); await click(c.ref, "p3");
  await recordView(listing.id, "p1", c.ref); await recordView(listing.id, "p2", c.ref);
  await recordView(listing.id, "o1", null); await recordView(listing.id, "o2", null); await recordView(listing.id, "o3", null); await recordView(listing.id, "o1", null);
  await recordView(listing.id, "p3", "AD-FAKE0000");
  await recordView(listing.id, "p1", null);
  const key = (n: string) => n;
  await createEnquiry(listing.publicRef, { name: "Ada", contact: "ada@example.test", message: "Is it available?" }, `ip-${uid()}`, { adRef: c.ref, viewerKey: key("p1") });
  await createEnquiry(listing.publicRef, { name: "Bayo", contact: "bayo@example.test", message: "Is it available?" }, `ip-${uid()}`, { adRef: c.ref, viewerKey: key("never-clicked") });
  await createEnquiry(listing.publicRef, { name: "Chi", contact: "chi@example.test", message: "Is it available?" }, `ip-${uid()}`);
  const r = (await campaignReport({ payer: payerOf(co) }, c.ref))!;
  assert.equal(r.paid.impressions, 2);
  assert.equal(r.paid.clicks, 3); assert.equal(r.paid.billedClicks, 3); assert.equal(r.paid.ctr, 150);
  assert.equal(r.paid.spentKobo, 3n * c.cpcKobo); assert.equal(r.paid.costPerClickKobo, c.cpcKobo);
  assert.equal(r.paid.views, 2, "only visits that came through the advert");
  assert.equal(r.organic.views, 4, "o1, o2, o3, and p3 whose advert reference was not real");
  assert.equal(r.paid.enquiries, 1, "only the visitor who really clicked counts as paid");
  assert.equal(r.organic.enquiries, 2);
  assert.equal(r.paid.costPerEnquiryKobo, 3n * c.cpcKobo);
  assert.equal(r.period.started, true);
  assert.ok(r.daily.length === 1 && r.daily[0].paidViews === 2 && r.daily[0].organicViews === 4);
  const csv = reportCsv(r);
  assert.match(csv, /Paid: billed clicks,3/); assert.match(csv, /Organic: visits,4/);
  // only the advertiser and the platform can see it
  const peer = await advertiser(admin);
  assert.equal(await campaignReport({ payer: payerOf(peer) }, c.ref), null);
  assert.ok(await campaignReport({ admin: admin.id }, c.ref));
  await assert.rejects(campaignReport({ admin: co.userId }, c.ref), /administrator/);
  // visitor identity is a daily hash, never an address
  const k = viewerKeyFor("203.0.113.9", HUMAN);
  assert.match(k, /^[0-9a-f]{32}$/);
  assert.notEqual(k, viewerKeyFor("203.0.113.10", HUMAN));
  assert.equal(JSON.stringify(await sys((tx) => tx.adClick.findMany({ where: { campaignId: c.id } }))).includes("203.0.113"), false);
});

test("an advert for a property that has stopped being published, or was never paid, can never be charged however it is reached", async () => {
  const admin = await newPlatformAdmin();
  const co = await advertiser(admin);
  const { listing } = await published(admin, co);
  const c = await createCampaign(payerOf(co), form(listing.publicRef));
  for (const who of ["a", "b"]) await click(c.ref, who);
  assert.equal((await get(c.id)).spentKobo, 0n);
  assert.equal((await get(c.id)).clicks, 1 * 2 - 0, "clicks on a draft are counted but cost nothing");
  const rows = await sys((tx) => tx.adClick.findMany({ where: { campaignId: c.id } }));
  assert.ok(rows.every((x) => !x.billed && x.reason === "NOT_LIVE"));
});
