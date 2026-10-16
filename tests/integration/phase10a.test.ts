/**
 * Phase 10a: referral links, attribution and qualification, the reward engine (policies, budgets, approval, safety period, payouts with a
 * second-person check, reversal, reconciliation), disputes and restrictions, against a real PostgreSQL database through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant, withUser, type Tx } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { assignSubscription, cancelSubscription } from "../../src/lib/services/subscriptions";
import {
  captureReferral, countClick, createCampaign, getOrCreateCode, myReferrals, recordCustomEvent, referralEvent, reviewAttribution,
} from "../../src/lib/services/referrals";
import {
  approveReward, cancelReward, clearReward, createPayout, disputeReward, failPayout, liftRewardRestriction, myRewards, readRewardSettings,
  budgets, reconcile, rejectReward, releaseDue, resolveRewardDispute, restrictRewards, saveRewardSettings, savePolicy, setBudget, verifyPayout,
} from "../../src/lib/services/rewards";
import { monthKey } from "../../src/lib/reward-rules";
import { registerCompany } from "../../src/lib/services/companies";
import { newCompany, newPlatformAdmin, relativeDate, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

/** Reads of tables only an administrator may see, as the platform administrator. */
type Delegates = "referralAttribution" | "rewardLedgerEntry" | "rewardPolicy";
function asAdmin<K extends Delegates>(k: K): Tx[K] {
  return new Proxy({}, { get: (_t, method: string) => (args: unknown) => withPlatformAdmin("test-reader", (tx) => (tx[k] as unknown as Record<string, (a: unknown) => Promise<unknown>>)[method](args)) }) as Tx[K];
}
const adm = { referralAttribution: asAdmin("referralAttribution"), rewardLedgerEntry: asAdmin("rewardLedgerEntry"), rewardPolicy: asAdmin("rewardPolicy") };
const uid = () => Math.random().toString(36).slice(2, 8);
const naira = (n: number) => String(n);

/** Retire every other campaign so this test's campaign is the only one a sign-up can match. */
async function onlyCampaign(adminId: string, event: "REFERRAL_REGISTERED" | "REFERRAL_LISTING_PUBLISHED" | "REFERRAL_SUBSCRIBED" | "REFERRAL_CUSTOM", audience: "SEEKER" | "COMPANY", extra: Record<string, string> = {}, hold = "0", amount = 6000) {
  await withPlatformAdmin(adminId, (tx) => tx.referralCampaign.updateMany({ data: { active: false } }));
  const c = await createCampaign(adminId, { name: `Campaign ${uid()}`, audience, event, startsOn: relativeDate(-1), attributionDays: "30", qualifyWithinDays: "60", ...extra } as never);
  await savePolicy(adminId, { programme: "REFERRAL", event, campaignId: c.id, name: "Test reward", amount: naira(amount), holdDays: hold, terms: "Test terms" } as never);
  return c;
}
async function budget(adminId: string, limit = 1_000_000) {
  await setBudget(adminId, "REFERRAL", monthKey(new Date()), naira(limit));
}
async function referrer(label = "ref") {
  const r = await registerSeeker({ name: `${label} Referrer`, email: `${label}-${uid()}@example.test`, password: PASSWORD });
  // An account made seconds ago is itself a signal, so the ordinary referrer is a few days old.
  await prisma.user.update({ where: { id: r.userId }, data: { createdAt: new Date(Date.now() - 5 * 864e5) } });
  return r.userId;
}
async function referSeeker(referrerId: string, at = Date.now(), name?: string, email?: string) {
  const code = (await getOrCreateCode(referrerId)).code;
  const n = name ?? `Friend ${uid()} Person`;
  const e = email ?? `friend-${uid()}@example.test`;
  const u = await registerSeeker({ name: n, email: e, password: PASSWORD });
  const ref = await captureReferral({ id: u.userId, name: n, email: e }, "SEEKER", { code, at });
  return { userId: u.userId, ref };
}
const rewardsOf = (userId: string) => withUser(userId, (tx) => tx.reward.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }));
const last = <T,>(xs: T[]): T => xs[xs.length - 1];
const admins = async () => [await newPlatformAdmin(), await newPlatformAdmin()] as const;

test("a referral link counts visits, and a sign-up through it opens one reward that waits for a person to approve", async () => {
  const [a] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER");
  const rid = await referrer();
  const code = await getOrCreateCode(rid);
  assert.match(code.code, /^[A-Z2-9]{8}$/);
  assert.equal((await getOrCreateCode(rid)).code, code.code, "one code per person");
  assert.equal(await countClick(code.code), true);
  assert.equal(await countClick("NOSUCHCD"), false);
  assert.equal(await countClick("bad"), false);
  const f = await referSeeker(rid);
  assert.ok(f.ref, "attributed");
  const rs = await rewardsOf(rid);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].status, "ELIGIBLE");
  assert.equal(rs[0].amountKobo, 600000n);
  assert.equal(rs[0].policyVersion, 1);
  const dash = await myReferrals(rid);
  assert.equal(dash.clicks, 1);
  assert.equal(dash.total, 1);
  assert.equal(dash.counts.QUALIFIED, 1);
  assert.match(dash.items[0].who, /^F\*\*\* P\.$/, "the referred person is shown only as initials");
  assert.equal(dash.conversion, 100);
});

test("the same person cannot be attributed twice, and a source earns each event only once", async () => {
  const [a] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER");
  const r1 = await referrer(), r2 = await referrer();
  const f = await referSeeker(r1);
  const code2 = (await getOrCreateCode(r2)).code;
  const again = await captureReferral({ id: f.userId, name: "Whoever Else", email: "x@example.test" }, "SEEKER", { code: code2, at: Date.now() });
  assert.equal(again, null, "a second attribution is refused");
  await referralEvent("REFERRAL_REGISTERED", { userId: f.userId }, { type: "attribution", id: (await adm.referralAttribution.findFirstOrThrow({ where: { referredUserId: f.userId } })).id, label: "again" });
  assert.equal((await rewardsOf(r1)).length, 1, "a repeated event does not pay twice");
  assert.equal((await rewardsOf(r2)).length, 0);
});

test("a link older than the attribution window, an unknown code, an ended campaign and a self-referral all earn nothing", async () => {
  const [a] = await admins();
  const c = await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER");
  const rid = await referrer();
  assert.equal((await referSeeker(rid, Date.now() - 31 * 864e5)).ref, null, "link followed 31 days ago");
  assert.equal((await referSeeker(rid, Date.now() + 3600_000)).ref, null, "a time in the future");
  const u = await registerSeeker({ name: "Fake Code", email: `fc-${uid()}@example.test`, password: PASSWORD });
  assert.equal(await captureReferral({ id: u.userId, name: "Fake Code", email: "fc@example.test" }, "SEEKER", { code: "ABCDEFGH", at: Date.now() }), null);
  assert.equal(await captureReferral({ id: rid, name: "Self", email: "self@example.test" }, "SEEKER", { code: (await getOrCreateCode(rid)).code, at: Date.now() }), null, "you cannot refer yourself");
  assert.equal((await rewardsOf(rid)).length, 0);
  await withPlatformAdmin(a.id, (tx) => tx.referralCampaign.update({ where: { id: c.id }, data: { active: false } }));
  assert.equal((await referSeeker(rid)).ref, null, "campaign ended");
  assert.equal((await rewardsOf(rid)).length, 0);
});

test("the same mailbox, the same name, a burst and a brand-new referrer are held for a person to look at, never decided automatically", async () => {
  const [a, b] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER");
  await budget(a.id);
  const rid = await referrer("self");
  const me = await prisma.user.findUniqueOrThrow({ where: { id: rid } });
  const [local, domain] = me.email.split("@");
  const sneaky = await referSeeker(rid, Date.now(), "Totally Different", `${local}+two@${domain}`);
  const att = await adm.referralAttribution.findFirstOrThrow({ where: { referredUserId: sneaky.userId } });
  assert.match(att.signals, /SAME_EMAIL_ROOT/);
  assert.equal(att.reviewState, "FLAGGED");
  let rs = await rewardsOf(rid);
  assert.equal(rs[0].status, "UNDER_REVIEW", "held, not rejected");
  await assert.rejects(approveReward(b.id, rs[0].id), /eligible/i, "cannot be approved while held");
  await reviewAttribution(b.id, att.id, "clear", "Checked: a family member with their own mailbox");
  rs = await rewardsOf(rid);
  assert.equal(rs[0].status, "ELIGIBLE");
  await approveReward(b.id, rs[0].id);

  // The same name: flagged, and a person confirms abuse.
  const rid2 = await referrer("name");
  const second = await referSeeker(rid2, Date.now(), "name Referrer", `other-${uid()}@example.test`);
  const att2 = await adm.referralAttribution.findFirstOrThrow({ where: { referredUserId: second.userId } });
  assert.match(att2.signals, /SAME_NAME/);
  await reviewAttribution(b.id, att2.id, "reject", "The same person made both accounts");
  const r2 = (await rewardsOf(rid2))[0];
  assert.equal(r2.status, "REJECTED");
  assert.match(r2.reason, /same person/);
  await assert.rejects(reviewAttribution(b.id, att2.id, "clear", "changed my mind"), /not waiting/);

  // A burst.
  await saveRewardSettings(a.id, { payoutThreshold: "5000", referralBurstPerDay: "2", vacancyReportsPerDay: "5", vacancyRejectFlag: "3", duplicateRadiusM: "50", duplicateWindowDays: "365" });
  const rid3 = await referrer("burst");
  await referSeeker(rid3); await referSeeker(rid3);
  const third = await referSeeker(rid3);
  assert.match((await adm.referralAttribution.findFirstOrThrow({ where: { referredUserId: third.userId } })).signals, /BURST/);
  await saveRewardSettings(a.id, { payoutThreshold: "5000", referralBurstPerDay: "10", vacancyReportsPerDay: "5", vacancyRejectFlag: "3", duplicateRadiusM: "50", duplicateWindowDays: "365" });
  assert.equal((await readRewardSettings()).referralBurstPerDay, 10);

  // A referrer whose account is minutes old.
  const fresh = await registerSeeker({ name: "Brand New", email: `bn-${uid()}@example.test`, password: PASSWORD });
  const fr = await referSeeker(fresh.userId);
  assert.match((await adm.referralAttribution.findFirstOrThrow({ where: { referredUserId: fr.userId } })).signals, /NEW_REFERRER/);
});

test("approval needs a budget, stays inside it, and cannot be done by the person who earned the reward", async () => {
  const [a, b] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER", {}, "0", 6000);
  await withPlatformAdmin(a.id, (tx) => tx.rewardBudget.deleteMany({}));
  const rid = await referrer();
  await referSeeker(rid); await referSeeker(rid);
  const [r1, r2] = await rewardsOf(rid);
  await assert.rejects(approveReward(b.id, r1.id), /No budget/);
  // Other tests approve rewards in the same month, so the limits here are set relative to what is already spent.
  const spent = async () => Number((await budgets(a.id)).find((x) => x.programme === "REFERRAL" && x.month === monthKey(new Date()))?.spentKobo ?? 0n) / 100;
  await budget(a.id, 1);
  await budget(a.id, (await spent()) + 10000);
  await approveReward(b.id, r1.id);
  await assert.rejects(approveReward(b.id, r2.id), /budget/, "6,000 + 6,000 is over the 10,000 left");
  await assert.rejects(approveReward(b.id, r1.id), /eligible/i, "approved twice");
  await budget(a.id, (await spent()) + 20000);
  await approveReward(b.id, r2.id);
  await assert.rejects(approveReward(rid, r2.id), /Only the platform administrator/);
  const ledger = await adm.rewardLedgerEntry.findMany({ where: { rewardId: r1.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(ledger.map((l) => l.toStatus), ["ELIGIBLE", "APPROVED"]);
});

test("a reward becomes payable after its safety period, is paid only after a second administrator verifies the payment, and a failed payment loses nothing", async () => {
  const [a, b] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER", {}, "0", 6000);
  await budget(a.id);
  const rid = await referrer();
  await referSeeker(rid);
  const [r] = await rewardsOf(rid);
  await approveReward(a.id, r.id);
  await releaseDue(new Date(Date.now() + 1000));
  assert.equal((await rewardsOf(rid))[0].status, "PAYABLE");
  await assert.rejects(createPayout(a.id, await referrer("none")), /nothing payable/);
  const p = await createPayout(a.id, rid);
  assert.equal(p.amountKobo, 600000n);
  await assert.rejects(createPayout(b.id, rid), /nothing payable|already has a payout/);
  await assert.rejects(verifyPayout(a.id, p.id, "REF-12345"), /different administrator/);
  await assert.rejects(verifyPayout(b.id, p.id, "ab"), /reference/i);
  // The payment fails.
  await failPayout(b.id, p.id, "Bank rejected the account number");
  let again = (await rewardsOf(rid))[0];
  assert.equal(again.status, "PAYABLE");
  assert.equal(again.payoutId, null);
  await assert.rejects(verifyPayout(b.id, p.id, "REF-12345"), /already failed/);
  // A second attempt succeeds.
  const p2 = await createPayout(a.id, rid);
  await verifyPayout(b.id, p2.id, "NIP-20261016-001");
  again = (await rewardsOf(rid))[0];
  assert.equal(again.status, "PAID");
  assert.ok(again.paidAt);
  await assert.rejects(verifyPayout(b.id, p2.id, "NIP-20261016-001"), /already paid/);
  await assert.rejects(cancelReward(a.id, again.id, "too late"), /payout/i);
  const mine = await myRewards(rid);
  assert.equal(mine.by.PAID.kobo, 600000n);
  assert.equal(mine.payouts.length, 2);
  const ledger = (await adm.rewardLedgerEntry.findMany({ where: { rewardId: r.id }, orderBy: { createdAt: "asc" } })).map((l) => l.toStatus);
  assert.deepEqual(ledger, ["ELIGIBLE", "APPROVED", "PAYABLE", "PAYABLE", "PAID"]);
  const rec = await reconcile(a.id);
  assert.equal(rec.findings.filter((f) => f.refs.includes(r.ref)).length, 0, "this reward reconciles");
  // Another person cannot see the reward or the payout.
  const other = await referrer("other");
  assert.equal((await myRewards(other)).items.length, 0);
});

test("a payout below the threshold is refused, and the safety period holds an approved reward back", async () => {
  const [a] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER", {}, "14", 2000);
  await budget(a.id);
  const rid = await referrer();
  await referSeeker(rid);
  const [r] = await rewardsOf(rid);
  await approveReward(a.id, r.id);
  const approved = (await rewardsOf(rid))[0];
  assert.ok(approved.payableAt && approved.payableAt.getTime() > Date.now() + 13 * 864e5, "14 days to wait");
  await releaseDue();
  assert.equal((await rewardsOf(rid))[0].status, "APPROVED", "not yet");
  await releaseDue(new Date(Date.now() + 15 * 864e5));
  assert.equal((await rewardsOf(rid))[0].status, "PAYABLE");
  await assert.rejects(createPayout(a.id, rid), /below the payout threshold/);
});

test("a listing that earns a reward only counts if it is still published when the money would move", async () => {
  const [a, b] = await admins();
  await onlyCampaign(a.id, "REFERRAL_LISTING_PUBLISHED", "COMPANY", {}, "0", 8000);
  await budget(a.id);
  const rid = await referrer();
  const code = (await getOrCreateCode(rid)).code;
  const email = `co-${uid()}@example.test`;
  const reg = await registerCompany({ companyName: `Refd ${uid()}`, name: "Company Owner", email, password: PASSWORD });
  assert.ok(await captureReferral({ id: reg.userId, name: "Company Owner", email, companyId: reg.companyId }, "COMPANY", { code, at: Date.now() }));
  assert.equal((await rewardsOf(rid)).length, 0, "signing up is not the condition for this campaign");
  const ctx = { userId: reg.userId, companyId: reg.companyId, membershipId: (await withTenant(reg.companyId, reg.userId, (tx) => tx.membership.findFirstOrThrow({ where: { userId: reg.userId } }))).id, role: "COMPANY_SUPER_ADMIN" as const };
  const publish = async (name: string) => {
    const asset = await createAsset(ctx, { name, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
    await saveListingDraft(ctx, asset.id, { title: `${name} in Ikeja`, purpose: "SALE", price: "50,000,000", bedrooms: "3", city: "Ikeja", state: "Lagos" } as never);
    await setListingStatus(ctx, asset.id, "PENDING_REVIEW");
    const l = await withPlatformAdmin(a.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
    await reviewListing(a.id, l.id, "approve", "ok");
    return l.id;
  };
  const l1 = await publish("First house");
  let rs = await rewardsOf(rid);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].event, "REFERRAL_LISTING_PUBLISHED");
  assert.equal(rs[0].status, "ELIGIBLE");
  await approveReward(b.id, rs[0].id);
  // The company withdraws the listing before the reward is released.
  await withPlatformAdmin(a.id, (tx) => tx.listing.update({ where: { id: l1 }, data: { status: "UNAVAILABLE" } }));
  const out = await releaseDue(new Date(Date.now() + 1000));
  assert.ok(out.cancelled >= 1);
  rs = await rewardsOf(rid);
  assert.equal(rs[0].status, "CANCELLED");
  assert.match(rs[0].reason, /no longer published/);
  // A second listing from the same company does not pay the referrer again: one referred company earns one reward per campaign.
  await publish("Second house");
  assert.equal((await rewardsOf(rid)).length, 1);
});

test("a paid subscription earns a reward; a trial and a free plan do not; a cancellation reverses what has not been paid", async () => {
  const [a, b] = await admins();
  await onlyCampaign(a.id, "REFERRAL_SUBSCRIBED", "COMPANY", {}, "0", 5000);
  await budget(a.id);
  const plan = await withUser("plan-reader", (tx) => tx.subscriptionPlan.findFirstOrThrow({ where: { audience: "COMPANY", active: true } }));
  await withPlatformAdmin(a.id, (tx) => tx.subscriptionPlan.update({ where: { id: plan.id }, data: { priceKobo: 2500000n } }));
  const rid = await referrer();
  const code = (await getOrCreateCode(rid)).code;
  const email = `sub-${uid()}@example.test`;
  const reg = await registerCompany({ companyName: `Sub ${uid()}`, name: "Sub Owner", email, password: PASSWORD });
  await captureReferral({ id: reg.userId, name: "Sub Owner", email, companyId: reg.companyId }, "COMPANY", { code, at: Date.now() });
  await assignSubscription(a.id, { planId: plan.id, periodEnd: relativeDate(30), trial: true, companyId: reg.companyId });
  assert.equal((await rewardsOf(rid)).length, 0, "a trial does not pay");
  const sub = await assignSubscription(a.id, { planId: plan.id, periodEnd: relativeDate(30), companyId: reg.companyId });
  let rs = await rewardsOf(rid);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].sourceId, sub.id);
  await approveReward(b.id, rs[0].id);
  await cancelSubscription(a.id, sub.id, "Refunded");
  rs = await rewardsOf(rid);
  assert.equal(rs[0].status, "CANCELLED");
  assert.match(rs[0].reason, /subscription was cancelled/);

  // A reward already paid is flagged for a person, never silently taken back.
  const rid2 = await referrer();
  const code2 = (await getOrCreateCode(rid2)).code;
  const email2 = `sub2-${uid()}@example.test`;
  const reg2 = await registerCompany({ companyName: `Sub2 ${uid()}`, name: "Sub Two", email: email2, password: PASSWORD });
  await captureReferral({ id: reg2.userId, name: "Sub Two", email: email2, companyId: reg2.companyId }, "COMPANY", { code: code2, at: Date.now() });
  const sub2 = await assignSubscription(a.id, { planId: plan.id, periodEnd: relativeDate(30), companyId: reg2.companyId });
  const r2 = (await rewardsOf(rid2))[0];
  await approveReward(b.id, r2.id);
  await releaseDue(new Date(Date.now() + 1000));
  await saveRewardSettings(a.id, { payoutThreshold: "0", referralBurstPerDay: "10", vacancyReportsPerDay: "5", vacancyRejectFlag: "3", duplicateRadiusM: "50", duplicateWindowDays: "365" });
  const p = await createPayout(a.id, rid2);
  await verifyPayout(b.id, p.id, "NIP-PAID-0001");
  await cancelSubscription(a.id, sub2.id, "Refunded after payout");
  const paid = (await rewardsOf(rid2))[0];
  assert.equal(paid.status, "PAID", "not clawed back");
  assert.match(paid.flag, /already paid/);
  assert.ok((await reconcile(a.id)).findings.some((f) => f.code === "PAID_THEN_REVERSED" && f.refs.includes(paid.ref)));
  await saveRewardSettings(a.id, { payoutThreshold: "5000", referralBurstPerDay: "10", vacancyReportsPerDay: "5", vacancyRejectFlag: "3", duplicateRadiusM: "50", duplicateWindowDays: "365" });
  await withPlatformAdmin(a.id, (tx) => tx.subscriptionPlan.update({ where: { id: plan.id }, data: { priceKobo: plan.priceKobo } }));
});

test("the qualifying time limit, the per-referrer cap and a custom event are enforced", async () => {
  const [a, b] = await admins();
  const c = await onlyCampaign(a.id, "REFERRAL_CUSTOM", "SEEKER", { maxRewardsPerReferrer: "1", qualifyWithinDays: "5" }, "0", 1000);
  await budget(a.id);
  const rid = await referrer();
  const f1 = await referSeeker(rid), f2 = await referSeeker(rid), f3 = await referSeeker(rid);
  const att = async (u: string) => (await adm.referralAttribution.findFirstOrThrow({ where: { referredUserId: u } })).id;
  await recordCustomEvent(a.id, await att(f1.userId), "Completed the onboarding call");
  await recordCustomEvent(a.id, await att(f2.userId), "Completed the onboarding call");
  const rs = await rewardsOf(rid);
  assert.equal(rs.length, 2);
  assert.equal(rs[0].status, "ELIGIBLE");
  assert.equal(rs[1].status, "NOT_ELIGIBLE");
  assert.match(rs[1].reason, /at most 1/);
  // The third came too late.
  await adm.referralAttribution.update({ where: { id: await att(f3.userId) }, data: { registeredAt: new Date(Date.now() - 6 * 864e5) } });
  await assert.rejects(recordCustomEvent(a.id, await att(f3.userId), "Completed the onboarding call"), /expired/);
  assert.equal((await adm.referralAttribution.findFirstOrThrow({ where: { referredUserId: f3.userId } })).status, "EXPIRED");
  void c; void b;
});

test("a change to a reward never rewrites one already earned, and a reward with no policy is recorded as not eligible with the reason", async () => {
  const [a] = await admins();
  const c = await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER", {}, "0", 3000);
  const rid = await referrer();
  await referSeeker(rid);
  await savePolicy(a.id, { programme: "REFERRAL", event: "REFERRAL_REGISTERED", campaignId: c.id, name: "Bigger", amount: "9000", holdDays: "0" } as never);
  await referSeeker(rid);
  const rs = await rewardsOf(rid);
  assert.deepEqual(rs.map((r) => [r.policyVersion, r.amountKobo]), [[1, 300000n], [2, 900000n]]);
  const versions = await adm.rewardPolicy.findMany({ where: { campaignId: c.id }, orderBy: { version: "asc" } });
  assert.deepEqual(versions.map((v) => v.active), [false, true]);
  // No reward set up for a new campaign.
  await withPlatformAdmin(a.id, (tx) => tx.referralCampaign.updateMany({ data: { active: false } }));
  await createCampaign(a.id, { name: `NoPay ${uid()}`, audience: "SEEKER", event: "REFERRAL_REGISTERED", startsOn: relativeDate(-1), attributionDays: "30", qualifyWithinDays: "60" } as never);
  const rid2 = await referrer();
  await referSeeker(rid2);
  const r2 = (await rewardsOf(rid2))[0];
  assert.equal(r2.status, "NOT_ELIGIBLE");
  assert.match(r2.reason, /No reward is set up/);
});

test("a rejected reward can be disputed once, a different administrator decides, and paused rewards open as not eligible", async () => {
  const [a, b] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER");
  await budget(a.id);
  const rid = await referrer();
  await referSeeker(rid);
  const [r] = await rewardsOf(rid);
  await assert.rejects(disputeReward(rid, r.id, "I should be paid for this one please"), /not approved/i, "only a decision against you can be disputed");
  await assert.rejects(rejectReward(a.id, r.id, "no"), /reason/i);
  await rejectReward(a.id, r.id, "The sign-up used a shared company mailbox");
  const other = await referrer("nosy");
  await assert.rejects(disputeReward(other, r.id, "Not my reward but I will try"), /not found/i);
  await assert.rejects(disputeReward(rid, r.id, "short"), /sentence/);
  const d = await disputeReward(rid, r.id, "The mailbox belongs to a different person");
  assert.equal((await rewardsOf(rid))[0].status, "DISPUTED");
  await assert.rejects(disputeReward(rid, r.id, "Trying a second time over"), /not approved|already/i);
  await resolveRewardDispute(b.id, d.id, "uphold", "Mailbox ownership confirmed");
  assert.equal((await rewardsOf(rid))[0].status, "ELIGIBLE");
  await assert.rejects(resolveRewardDispute(b.id, d.id, "deny", "again please"), /already decided/);
  const done = await withUser(rid, (tx) => tx.rewardDispute.findFirstOrThrow({ where: { id: d.id } }));
  assert.equal(done.status, "UPHELD");

  await restrictRewards(a.id, rid, "Under investigation for repeated sign-ups");
  await referSeeker(rid);
  const latest = last(await rewardsOf(rid));
  assert.equal(latest.status, "NOT_ELIGIBLE");
  assert.match(latest.reason, /paused/);
  assert.equal((await myRewards(rid)).restricted, "Under investigation for repeated sign-ups");
  await liftRewardRestriction(a.id, rid);
  await referSeeker(rid);
  assert.equal(last(await rewardsOf(rid)).status, "ELIGIBLE");
});

test("a person cannot move, approve or write rewards, and the ledger cannot be edited", async () => {
  const [a] = await admins();
  await onlyCampaign(a.id, "REFERRAL_REGISTERED", "SEEKER");
  await budget(a.id);
  const rid = await referrer();
  await referSeeker(rid);
  const [r] = await rewardsOf(rid);
  await assert.rejects(approveReward(rid, r.id), /Only the platform administrator/);
  await assert.rejects(withUser(rid, (tx) => tx.reward.update({ where: { id: r.id }, data: { status: "PAID" } })));
  await assert.rejects(withUser(rid, (tx) => tx.reward.create({ data: { ref: "RW-HACK", userId: rid, programme: "REFERRAL", event: "REFERRAL_CUSTOM", amountKobo: 1n, status: "ELIGIBLE", sourceType: "x", sourceId: uid() } })));
  await assert.rejects(withPlatformAdmin(a.id, (tx) => tx.rewardLedgerEntry.updateMany({ data: { note: "rewritten" } })));
  await assert.rejects(clearReward(a.id, r.id, "not held"), /not under review/);
  const co = await newCompany("rw");
  assert.equal((await withUser(co.userId, (tx) => tx.reward.findMany())).length, 0, "someone else's reward is invisible");
});
