/**
 * Phase 12a: verified reviews and reputation. What makes a review verified, who can write one, manipulation holds, replies, disputes,
 * appeals and moderation, reproducible reputation figures, badges, and the guarantee that paid plans do not move a score.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant, withUser } from "../../src/lib/db";
import { registerSeeker, saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { createClient } from "../../src/lib/services/crm";
import { createDeal } from "../../src/lib/services/deal";
import { sendMessage, startConversation } from "../../src/lib/services/messaging";
import { asPerson } from "../../src/lib/services/collab";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import {
  appealReview, companyReviewDesk, decideCase, disputeReview, ensureReputation, inviteInfo, issueInvite, moderateReview, moderationQueue, myReviews, publicReviews, refreshReputation,
  reportReview, respondToReview, reviewableConversations, revokeInvite, submitReview,
} from "../../src/lib/services/reviews";
import { computeReputation, type ReputationInputs } from "../../src/lib/reputation-rules";
import type { Ctx } from "../../src/lib/services/context";
import { addMember, newCompany, newPlatformAdmin, relativeDate, withRole, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const later = () => new Date(Date.now() + 2 * 864e5);
const seeker = async (label = "rev") => (await registerSeeker({ name: `${label} Person ${uid()}`, email: `${label}-${uid()}@example.test`, password: PASSWORD })).userId;

async function listedAgent(label: string) {
  const co = await newCompany(label);
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `${label} Homes ${uid()}`, tagline: "Homes", listed: true });
  await saveAgentProfile(co, { displayName: `${label} Agent`, headline: "Sales", bio: "", listed: true, acceptsMessages: true });
  return co;
}
async function completedDeal(co: Ctx) {
  const asset = await createAsset(co, { name: `House ${uid()}`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const client = await createClient(co, { name: `Client ${uid()}`, phone: "08030000000" } as never);
  const deal = await createDeal(co, { clientId: client.id, assetId: asset.id, type: "SALE", asking: "50,000,000" });
  return { deal, finish: () => withTenant(co.companyId, co.userId, (tx) => tx.deal.update({ where: { id: deal.id }, data: { stage: "COMPLETED", status: "COMPLETED", agreedKobo: 4_800_000_000n, completedAt: new Date(), completedById: co.membershipId } })) };
}
async function talk(agent: Ctx, person: string) {
  const c = await startConversation(asPerson(person), { toUserId: agent.userId, subject: "A flat", body: "Is it still available?" } as never);
  await sendMessage(asPerson(agent.userId), c.id, "Yes, when would you like to see it?");
  return c.id;
}
const rv = () => ({ overall: 5 as never, communication: 5 as never, accuracy: 4 as never, body: `Straight answers and no pressure at any point (${uid()}).` });

test("an enquiry review needs a real two-sided conversation and a day to pass; one per conversation; never your own company", async () => {
  const agent = await listedAgent("enq");
  const p = await seeker();
  await assert.rejects(submitReview(p, { ...rv() }), /conversation with the agent or a review link/);
  const convId = await talk(agent, p);
  await assert.rejects(submitReview(p, { conversationId: convId, ...rv() }), /24 hours/);
  assert.equal((await reviewableConversations(p)).length, 0);
  assert.equal((await reviewableConversations(p, later())).length, 1);
  await assert.rejects(submitReview(p, { conversationId: convId, ...rv(), overall: "" as never, now: later() }), /overall rating/);
  await assert.rejects(submitReview(p, { conversationId: convId, ...rv(), overall: "9" as never, now: later() }), /1 to 5/);
  const r = await submitReview(p, { conversationId: convId, ...rv(), now: later() });
  assert.equal(r.status, "PUBLISHED");
  assert.equal(r.basis, "ENQUIRY");
  await assert.rejects(submitReview(p, { conversationId: convId, ...rv(), now: later() }), /already reviewed|conversation/);

  const stranger = await seeker("stranger");
  await assert.rejects(submitReview(stranger, { conversationId: convId, ...rv(), now: later() }), /not found|not with an agent/);
  const rep = await ensureReputation("AGENT", agent.userId);
  assert.equal(rep!.reviewCount, 1);
  assert.equal((await ensureReputation("COMPANY", agent.companyId))!.reviewCount, 1);

  // A colleague of the agent cannot review the company they work for.
  const colleague = await addMember(agent, "AGENT", "colleague");
  const c2 = await startConversation(asPerson(colleague.userId), { toUserId: agent.userId, subject: "x", body: "hello there" } as never);
  await sendMessage(asPerson(agent.userId), c2.id, "hello back");
  await assert.rejects(submitReview(colleague.userId, { conversationId: c2.id, ...rv(), now: later() }), /own company/);
});

test("a deal or viewing review link: only after completion, only by the agent or a manager, once, and never by the company's own people", async () => {
  const admin = await newPlatformAdmin();
  const co = await listedAgent("inv");
  const other = await addMember(co, "AGENT", "other-agent");
  const { deal, finish } = await completedDeal(co);
  await assert.rejects(issueInvite(co, { basis: "TRANSACTION", basisRef: deal.id }), /once the deal is completed/);
  await finish();
  await assert.rejects(issueInvite(withRole(co, "OFFICER"), { basis: "TRANSACTION", basisRef: deal.id }), /permission/);
  await assert.rejects(issueInvite(other, { basis: "TRANSACTION", basisRef: deal.id }), /Only the agent who handled this, or a manager/);
  const inv = await issueInvite(co, { basis: "TRANSACTION", basisRef: deal.id });
  assert.match(inv.path, /^\/reviews\/write\?invite=/);
  const info = await inviteInfo(inv.token);
  assert.equal(info.ok, true);
  assert.equal(await inviteInfo("not-a-real-token").then((x) => x.ok), false);

  const buyer = await seeker("buyer");
  await assert.rejects(submitReview(co.userId, { token: inv.token, ...rv() }), /own company/);
  const r = await submitReview(buyer, { token: inv.token, ...rv(), now: later() });
  assert.equal(r.basis, "TRANSACTION");
  assert.equal(r.status, "PUBLISHED");
  await assert.rejects(submitReview(await seeker("late"), { token: inv.token, ...rv(), now: later() }), /already been used/);
  await assert.rejects(issueInvite(co, { basis: "TRANSACTION", basisRef: deal.id }), /already been reviewed/);

  // A link can be cancelled and reissued, expires, and can be about the company instead.
  const d2 = await completedDeal(co); await d2.finish();
  const i2 = await issueInvite(co, { basis: "TRANSACTION", basisRef: d2.deal.id, aboutCompany: true });
  await revokeInvite(co, "TRANSACTION", d2.deal.id);
  await assert.rejects(submitReview(await seeker("b2"), { token: i2.token, ...rv(), now: later() }), /cancelled/);
  const i3 = await issueInvite(co, { basis: "TRANSACTION", basisRef: d2.deal.id, aboutCompany: true });
  await assert.rejects(submitReview(await seeker("b3"), { token: i3.token, ...rv(), now: new Date(Date.now() + 40 * 864e5) }), /expired/);
  const cr = await submitReview(await seeker("b4"), { token: i3.token, ...rv(), now: later() });
  assert.equal(cr.agentUserId, null, "a company review names no agent");
  assert.equal((await publicReviews("AGENT", co.userId)).total, 1);
  assert.equal((await publicReviews("COMPANY", co.companyId)).total, 2);

  // A completed viewing works the same way.
  const d3 = await completedDeal(co);
  const v = await withTenant(co.companyId, co.userId, (tx) => tx.viewing.create({ data: { companyId: co.companyId, dealId: d3.deal.id, assetId: d3.deal.assetId, agentId: co.membershipId, startsAt: new Date(Date.now() - 864e5), endsAt: new Date(Date.now() - 864e5 + 36e5), status: "SCHEDULED", createdById: co.userId } }));
  await assert.rejects(issueInvite(co, { basis: "INSPECTION", basisRef: v.id }), /has taken place/);
  await withTenant(co.companyId, co.userId, (tx) => tx.viewing.update({ where: { id: v.id }, data: { status: "COMPLETED" } }));
  const vi = await issueInvite(co, { basis: "INSPECTION", basisRef: v.id });
  assert.equal((await submitReview(await seeker("viewer"), { token: vi.token, ...rv(), now: later() })).basis, "INSPECTION");
  const desk = await companyReviewDesk(co);
  assert.ok(desk.reviews.length >= 3 && desk.deals.length >= 2);
  assert.ok(admin.id);
});

test("reviews that look manipulated are held, do not count, and a person decides", async () => {
  const admin = await newPlatformAdmin();
  const co = await listedAgent("sus");
  // A brand-new account reviewing straight away.
  const fresh = await seeker("fresh");
  const c1 = await talk(co, fresh);
  const held = await submitReview(fresh, { conversationId: c1, ...rv(), now: new Date(Date.now() + 30 * 60e3) }).catch((e) => e);
  assert.match(String(held.message ?? ""), /24 hours/, "even a quick account must wait a day");
  // The same wording used by two different people on one agent.
  const a = await seeker("dupA"), b = await seeker("dupB");
  const ca = await talk(co, a), cb = await talk(co, b);
  const text = "They were rude, late and the listing was misleading about everything.";
  const first = await submitReview(a, { conversationId: ca, overall: 1 as never, body: text, now: later() });
  const second = await submitReview(b, { conversationId: cb, overall: 1 as never, body: text.toUpperCase(), now: later() });
  assert.equal(first.status, "PUBLISHED");
  assert.equal(second.status, "HELD");
  assert.match(second.signals, /DUPLICATE_TEXT/);
  assert.equal((await publicReviews("AGENT", co.userId)).total, 1, "a held review is not public");
  assert.equal((await myReviews(b))[0].status, "HELD", "but its writer can see it is being checked");
  const q = await moderationQueue(admin.id);
  assert.ok(q.held.some((h) => h.id === second.id));
  await assert.rejects(moderateReview(admin.id, second.id, "hide", "no"), /at least 5/);
  await assert.rejects(moderateReview(a, second.id, "release", ""), /Only the platform administrator/);
  await moderateReview(admin.id, second.id, "release", "Checked, they are different people");
  assert.equal((await publicReviews("AGENT", co.userId)).total, 2);
  assert.ok((await myReviews(b))[0].events.some((e) => e.kind === "RELEASE"));

  // Several reviews landing on one person within two days.
  const burst = await listedAgent("burst");
  const statuses: string[] = [];
  for (let i = 0; i < 5; i++) {
    const p = await seeker(`bst${i}`);
    statuses.push((await submitReview(p, { conversationId: await talk(burst, p), overall: 5 as never, body: `Review number ${i} with its own words ${uid()} about the visit.`, now: later() })).status);
  }
  assert.deepEqual(statuses, ["PUBLISHED", "PUBLISHED", "PUBLISHED", "HELD", "HELD"]);
});

test("reply once, dispute once, report, appeal: the whole moderation path, with reputation following every change", async () => {
  const admin = await newPlatformAdmin();
  const co = await listedAgent("mod");
  const p = await seeker("critic");
  const convId = await talk(co, p);
  const rev = await submitReview(p, { conversationId: convId, overall: 1 as never, body: "Never turned up to the viewing and wasted my whole day.", now: later() });
  const before = (await ensureReputation("AGENT", co.userId))!;
  assert.equal(before.reviewCount, 1);

  await assert.rejects(respondToReview(withRole(co, "OFFICER"), rev.id, "Sorry about that"), /permission/);
  await respondToReview(co, rev.id, "We rescheduled by phone twice and have the call log.");
  await assert.rejects(respondToReview(co, rev.id, "again"), /already replied/);
  assert.equal((await publicReviews("AGENT", co.userId)).rows[0].response.slice(0, 7), "We resc");

  await assert.rejects(disputeReview(co, rev.id, "short"), /at least 10/);
  await disputeReview(co, rev.id, "This client was never booked for a viewing on that day.");
  await assert.rejects(disputeReview(co, rev.id, "Trying a second time for the same review."), /already been disputed/);
  const stranger = await seeker("rep");
  await reportReview(stranger, rev.id, "Looks fake to me");
  await assert.rejects(reportReview(stranger, rev.id, "again please"), /already reported/);
  await assert.rejects(reportReview(p, rev.id, "my own review"), /your own/);

  const q = await moderationQueue(admin.id);
  const c = q.cases.find((x) => x.reviewId === rev.id)!;
  assert.equal(q.reports.filter((x) => x.reviewId === rev.id).length, 1);
  await assert.rejects(decideCase(admin.id, c.id, "uphold", "ok"), /at least 5/);
  await decideCase(admin.id, c.id, "uphold", "No booking exists for that day.");
  assert.equal((await publicReviews("AGENT", co.userId)).total, 0, "an upheld dispute takes the review down");
  assert.equal((await ensureReputation("AGENT", co.userId))!.reviewCount, 0, "and out of the reputation figure");
  await assert.rejects(decideCase(admin.id, c.id, "reject", "twice over"), /already been decided/);

  // The reviewer may appeal once.
  const mine = (await myReviews(p))[0];
  assert.equal(mine.status, "HIDDEN");
  await assert.rejects(appealReview(await seeker("x"), rev.id, "Not my review but I will try"), /not found/);
  await appealReview(p, rev.id, "I have the call log showing the agent never rang me.");
  await assert.rejects(appealReview(p, rev.id, "Another go at it again"), /already appealed/);
  const q2 = await moderationQueue(admin.id);
  const ap = q2.cases.find((x) => x.reviewId === rev.id && x.kind === "APPEAL")!;
  await decideCase(admin.id, ap.id, "uphold", "Call log supports the reviewer.");
  assert.equal((await publicReviews("AGENT", co.userId)).total, 1, "an upheld appeal restores it");
  assert.equal((await ensureReputation("AGENT", co.userId))!.reviewCount, 1);

  // Removing needs a reason, and a removed review can still be appealed once.
  await moderateReview(admin.id, rev.id, "remove", "Breaks the review rules");
  assert.equal((await publicReviews("AGENT", co.userId)).total, 0);
});

test("a reputation figure is reproducible from the facts stored with it, and a paid plan cannot move it", async () => {
  const admin = await newPlatformAdmin();
  const co = await listedAgent("repro");
  const reviewers = [await seeker("r1"), await seeker("r2")];
  for (const [i, p] of reviewers.entries()) await submitReview(p, { conversationId: await talk(co, p), overall: (5 - i) as never, body: `Distinct words about visit number ${i} ${uid()} here.`, now: later() });
  const snap = (await refreshReputation("AGENT", co.userId))!;
  const again = computeReputation(snap.inputs as unknown as ReputationInputs);
  assert.equal(again.score, snap.score, "anyone with the stored facts gets the same figure");
  assert.equal(again.reviewCount, 2);
  assert.deepEqual(again.badges, snap.badges);

  // Nothing changed, so no new snapshot; then a Gold plan, still nothing.
  const same = await refreshReputation("AGENT", co.userId);
  assert.equal(same.id, snap.id);
  const gold = await withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-gold" } }));
  await assignSubscription(admin.id, { planId: gold.id, periodEnd: relativeDate(60), companyId: co.companyId });
  const afterGold = await refreshReputation("AGENT", co.userId);
  assert.equal(afterGold.score, snap.score, "paying for Gold does not change reputation");
  assert.equal(afterGold.id, snap.id);
  assert.equal(JSON.stringify(afterGold.inputs).includes("tier"), false);
  const count = await withPlatformAdmin(admin.id, (tx) => tx.reputationSnapshot.count({ where: { subjectId: co.userId } }));
  assert.ok(count >= 1);
});

test("the public never sees a reviewer's full name or identity", async () => {
  const co = await listedAgent("priv");
  const p = await seeker("Privacy");
  const name = (await prisma.user.findUniqueOrThrow({ where: { id: p } })).name;
  await submitReview(p, { conversationId: await talk(co, p), ...rv(), now: later() });
  const list = await publicReviews("AGENT", co.userId);
  const blob = JSON.stringify(list);
  assert.ok(!blob.includes(name), "no full name");
  assert.ok(!blob.includes(p), "no reviewer id");
  assert.match(list.rows[0].who, /^Privacy \S\.$/);
});
