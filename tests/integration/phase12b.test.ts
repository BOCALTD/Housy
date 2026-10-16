/**
 * Phase 12b: monthly Top Agent ranking (reproducible from recorded facts, unaffected by payment, frozen after the correction period)
 * and the Recently Sold, Rented and Leased sections (verified, consent-based, private, and never stale).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant, withUser } from "../../src/lib/db";
import { registerSeeker, saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { createClient } from "../../src/lib/services/crm";
import { createDeal } from "../../src/lib/services/deal";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import { issueInvite, submitReview } from "../../src/lib/services/reviews";
import {
  awardsFor, computeMonth, currentRun, decideAwardDispute, freezeRun, leaderboard, openAwardDispute, publishRun, readAwardConfig, saveAwardConfig, verifyRun, adminAwardOverview,
} from "../../src/lib/services/awards";
import { companyDesk, displayQueue, homeSections, recentlyCompleted, requestDisplay, reviewDisplay, withdrawDisplay } from "../../src/lib/services/completed";
import { monthKey, monthRange } from "../../src/lib/award-rules";
import type { Ctx } from "../../src/lib/services/context";
import { addMember, newCompany, newPlatformAdmin, relativeDate, withRole, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const seeker = async (label = "p") => (await registerSeeker({ name: `${label} Person ${uid()}`, email: `${label}-${uid()}@example.test`, password: PASSWORD })).userId;
const THIS = monthKey(new Date());
const AFTER = new Date(monthRange(THIS).end.getTime() + 864e5);          // a day after this month ends
const MUCH_LATER = new Date(monthRange(THIS).end.getTime() + 30 * 864e5);  // well past any correction period

async function agentCo(label: string) {
  const co = await newCompany(label);
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `${label} Homes ${uid()}`, tagline: "Homes", listed: true });
  await saveAgentProfile(co, { displayName: `${label} Agent ${uid()}`, headline: "Sales", bio: "", listed: true, acceptsMessages: true });
  return co;
}
async function completedSale(co: Ctx, type: "SALE" | "RENT" | "LEASE" = "SALE", place?: { city: string; state: string }) {
  const asset = await createAsset(co, { name: `House ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER", ...(place ?? {}) } as never);
  const client = await createClient(co, { name: `Secret Client ${uid()}`, phone: "08030000000" } as never);
  const deal = await createDeal(co, { clientId: client.id, assetId: asset.id, type, asking: "50,000,000" });
  await withTenant(co.companyId, co.userId, (tx) => tx.deal.update({ where: { id: deal.id }, data: { stage: "COMPLETED", status: "COMPLETED", agreedKobo: 4_800_000_000n, completedAt: new Date(), completedById: co.membershipId } }));
  return { deal, asset, client };
}
async function publishListing(admin: { id: string }, co: Ctx) {
  const asset = await createAsset(co, { name: `Listed ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: `Flat ${uid()}`, purpose: "RENT", price: "2,000,000", bedrooms: "2", city: "Ikeja", state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  return l;
}
async function review(agent: Ctx, deal: { id: string }, reviewer: string, overall: number) {
  const inv = await issueInvite(agent, { basis: "TRANSACTION", basisRef: deal.id });
  return submitReview(reviewer, { token: inv.token, overall: overall as never, body: `Words that are my own about this one (${uid()}) and nobody else's.`, now: new Date(Date.now() + 2 * 864e5) });
}

test("a month is ranked from recorded facts, reproducibly, unaffected by payment, with disputes and a freeze", async () => {
  const admin = await newPlatformAdmin();
  const before = await readAwardConfig();
  try {
    await assert.rejects(saveAwardConfig(admin.id, { wSales: 50 as never, wPosts: 50 as never, wRating: 50 as never, minSales: 1 as never, minPosts: 1 as never, minReviews: 1 as never, windowDays: 7 as never, completedDays: 90 as never }), /add up to 100/);
    await saveAwardConfig(admin.id, { wSales: 40 as never, wPosts: 30 as never, wRating: 30 as never, minSales: 1 as never, minPosts: 1 as never, minReviews: 1 as never, windowDays: 7 as never, completedDays: 90 as never });

    // A is strong: two sales, two posts, good reviews. B has one sale and one post. C has no sale at all.
    const A = await agentCo("awA"), B = await agentCo("awB"), C = await agentCo("awC");
    const a1 = await completedSale(A), a2 = await completedSale(A), b1 = await completedSale(B);
    await publishListing(admin, A); await publishListing(admin, A); await publishListing(admin, B); await publishListing(admin, C);
    const r1 = await seeker("r1"), r2 = await seeker("r2"), r3 = await seeker("r3");
    await review(A, a1.deal, r1, 5);
    await review(A, a2.deal, r2, 5);
    await completedSale(A);
    await review(B, b1.deal, r3, 4);

    await assert.rejects(computeMonth(admin.id, THIS), /has not finished/);
    await assert.rejects(computeMonth(A.userId, THIS, AFTER), /Only the platform administrator/);
    const run = await computeMonth(admin.id, THIS, AFTER);
    const ov = await adminAwardOverview(admin.id);
    const mine = ov.runs.find((r) => r.id === run.id)!;
    assert.equal(mine.status, "DRAFT");
    assert.equal((await currentRun(THIS)), null, "a draft is not public");

    const entries = await withPlatformAdmin(admin.id, (tx) => tx.awardEntry.findMany({ where: { runId: run.id, userId: { in: [A.userId, B.userId, C.userId] } } }));
    const eA = entries.find((e) => e.userId === A.userId)!, eB = entries.find((e) => e.userId === B.userId)!, eC = entries.find((e) => e.userId === C.userId);
    assert.equal(eA.sales, 3);
    assert.equal(eA.posts, 2);
    assert.equal(eA.reviews, 2);
    assert.ok(eA.eligible && eB.eligible);
    assert.ok(eA.score > eB.score && eA.rank! < eB.rank!, "more sales, posts and better reviews rank higher");
    assert.ok(!eC || (!eC.eligible && /sale/.test(eC.reason)), "no verified sale, no ranking");

    // The stored facts alone reproduce every line.
    const v = await verifyRun(admin.id, run.id);
    assert.deepEqual(v, { matches: true, checked: v.checked, diffs: [] });

    // Paying for Gold changes nothing about the ranking.
    const gold = await withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-gold" } }));
    await assignSubscription(admin.id, { planId: gold.id, periodEnd: relativeDate(60), companyId: B.companyId });
    const again = await computeMonth(admin.id, THIS, AFTER);
    assert.equal(again.inputsHash, run.inputsHash, "the recorded inputs are identical");
    const eB2 = await withPlatformAdmin(admin.id, (tx) => tx.awardEntry.findFirstOrThrow({ where: { runId: again.id, userId: B.userId } }));
    assert.equal(eB2.score, eB.score);
    assert.equal(eB2.rank, eB.rank);
    assert.equal((await withPlatformAdmin(admin.id, (tx) => tx.awardRun.findUniqueOrThrow({ where: { id: run.id } }))).status, "SUPERSEDED");

    // Publish, and the public sees it with the month named.
    await assert.rejects(publishRun(admin.id, again.id, new Date()), /has not finished/);
    await publishRun(admin.id, again.id, AFTER);
    await assert.rejects(publishRun(admin.id, again.id, AFTER), /Only a new calculation/);
    const lb = (await leaderboard(THIS))!;
    assert.equal(lb.run.id, again.id);
    assert.ok(lb.total >= 2);
    const top = lb.rows.find((r) => r.rank === 1)!;
    const aw = (await awardsFor([top.userId])).get(top.userId)!;
    assert.equal(aw[0].plaque, "GOLD");
    assert.equal(aw[0].month, THIS);

    // The correction period: only someone in the ranking, once, while it is open.
    const stranger = await seeker("nobody");
    await assert.rejects(openAwardDispute(stranger, again.id, "I think my number is wrong here"), /not in this ranking/);
    await assert.rejects(openAwardDispute(B.userId, again.id, "short"), /at least 10/);
    await openAwardDispute(B.userId, again.id, "One of my completed sales is missing from the count.", AFTER);
    await assert.rejects(openAwardDispute(B.userId, again.id, "Trying to dispute a second time again", AFTER), /already disputed/);
    await assert.rejects(freezeRun(admin.id, again.id, AFTER), /not over yet/);
    await assert.rejects(freezeRun(admin.id, again.id, MUCH_LATER), /open disputes/);
    const d = (await adminAwardOverview(admin.id)).disputes.find((x) => x.userId === B.userId)!;
    await decideAwardDispute(admin.id, d.id, "reject", "The sale was completed in the previous month.");
    await assert.rejects(decideAwardDispute(admin.id, d.id, "uphold", "twice over"), /already been decided/);
    await assert.rejects(openAwardDispute(A.userId, again.id, "Too late to say anything now really", MUCH_LATER), /correction period/);

    await freezeRun(admin.id, again.id, MUCH_LATER);
    await assert.rejects(computeMonth(admin.id, THIS, MUCH_LATER), /is frozen/);
    assert.equal((await currentRun(THIS))!.status, "FROZEN");
    assert.equal((await verifyRun(admin.id, again.id)).matches, true, "a frozen ranking still reproduces");
  } finally {
    await saveAwardConfig(admin.id, { wSales: before.weights.sales as never, wPosts: before.weights.posts as never, wRating: before.weights.rating as never, minSales: before.minSales as never, minPosts: before.minPosts as never, minReviews: before.minReviews as never, windowDays: before.windowDays as never, completedDays: before.completedDays as never });
  }
  assert.deepEqual(await readAwardConfig(), before);
});

test("a completed deal is shown only with authorisation and platform approval, with no price or names, and it never goes stale", async () => {
  const admin = await newPlatformAdmin();
  const boss = await newCompany("done");
  const agent = await addMember(boss, "AGENT", "done-agent");
  const city = `Town${uid()}`;
  const sale = await completedSale(boss);
  const stmt = { statement: "Owner and buyer agreed by email on 3 October.", confirmed: true };

  await assert.rejects(requestDisplay(agent, sale.deal.id, stmt), /manager must authorise/);
  await assert.rejects(requestDisplay(withRole(boss, "OFFICER"), sale.deal.id, stmt));
  await assert.rejects(requestDisplay(boss, sale.deal.id, { ...stmt, confirmed: false }), /Tick the box/);
  await assert.rejects(requestDisplay(boss, sale.deal.id, { statement: "ok", confirmed: true }), /at least 10/);
  await assert.rejects(requestDisplay(boss, sale.deal.id, stmt), /Add a city/);
  await withTenant(boss.companyId, boss.userId, (tx) => tx.asset.update({ where: { id: sale.asset.id }, data: { city, state: "Lagos" } }));
  const open = await createDealOpen(boss);
  await assert.rejects(requestDisplay(boss, open.id, stmt), /Only a completed deal/);

  await requestDisplay(boss, sale.deal.id, stmt);
  await assert.rejects(requestDisplay(boss, sale.deal.id, stmt), /already been put forward/);
  assert.equal((await recentlyCompleted({ city })).total, 0, "not shown until the platform approves");
  const q = (await displayQueue(admin.id)).find((x) => x.dealId === sale.deal.id)!;
  assert.equal(q.deal?.status, "COMPLETED");
  await assert.rejects(reviewDisplay(admin.id, q.id, "reject", ""), /Say why/);
  await assert.rejects(reviewDisplay(boss.userId, q.id, "approve", ""), /Only the platform administrator/);
  await reviewDisplay(admin.id, q.id, "approve", "");
  await assert.rejects(reviewDisplay(admin.id, q.id, "approve", ""), /already been decided/);

  const shown = await recentlyCompleted({ city });
  assert.equal(shown.total, 1);
  assert.equal(shown.rows[0].status, "Sold");
  assert.equal(shown.rows[0].category, "Flat");
  const blob = JSON.stringify(shown, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  for (const secret of ["4800000000", "48000000", sale.deal.id, sale.client.name, sale.deal.ref, sale.asset.name, boss.companyId]) assert.ok(!blob.includes(secret), `the public view never carries ${secret}`);
  assert.equal((await recentlyCompleted({ city, kind: "RENTED" })).total, 0, "filters by kind");
  assert.equal((await recentlyCompleted({ city: "nowhere-at-all" })).total, 0, "filters by place");
  assert.ok((await homeSections()).SOLD.length >= 1);

  // Old completions age off, and a deal that stops being completed comes off at once.
  assert.equal((await recentlyCompleted({ city, now: new Date(Date.now() + 120 * 864e5) })).total, 0, "stale deals are not shown");
  await withTenant(boss.companyId, boss.userId, (tx) => tx.deal.update({ where: { id: sale.deal.id }, data: { status: "DISPUTED", disputeReason: "Buyer contests the handover", disputedById: boss.membershipId, disputedAt: new Date() } }));
  assert.equal((await recentlyCompleted({ city })).total, 0, "a disputed deal is not shown");
  await withTenant(boss.companyId, boss.userId, (tx) => tx.deal.update({ where: { id: sale.deal.id }, data: { status: "COMPLETED", disputeReason: "", disputedById: null, disputedAt: null } }));
  assert.equal((await recentlyCompleted({ city })).total, 1);

  await assert.rejects(withdrawDisplay(agent, sale.deal.id), /manager must withdraw/);
  await withdrawDisplay(boss, sale.deal.id);
  assert.equal((await recentlyCompleted({ city })).total, 0, "withdrawn means gone");
  const desk = await companyDesk(boss);
  assert.equal(desk.find((d) => d.id === sale.deal.id)!.display!.status, "WITHDRAWN");

  // A rejected request can be made again.
  await requestDisplay(boss, sale.deal.id, stmt);
  const q2 = (await displayQueue(admin.id)).find((x) => x.dealId === sale.deal.id)!;
  await reviewDisplay(admin.id, q2.id, "reject", "Please say who authorised it");
  await requestDisplay(boss, sale.deal.id, { statement: "Both parties agreed in a signed note.", confirmed: true });
  assert.ok((await displayQueue(admin.id)).some((x) => x.dealId === sale.deal.id));
});

async function createDealOpen(co: Ctx) {
  const asset = await createAsset(co, { name: `Open ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  const client = await createClient(co, { name: `Open Client ${uid()}`, phone: "08030000001" } as never);
  return createDeal(co, { clientId: client.id, assetId: asset.id, type: "SALE", asking: "10,000,000" });
}
