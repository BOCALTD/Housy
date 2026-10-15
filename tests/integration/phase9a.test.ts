/**
 * Phase 9a: seeker accounts, subscription plans and entitlements, following kept apart from paid collaboration, public profiles,
 * the directory, notifications and the platform limits, against a real PostgreSQL database through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { directory, follow, myFollowing, myProfiles, registerSeeker, saveAgentProfile, saveCompanyProfile, unfollow } from "../../src/lib/services/community";
import {
  assignSubscription, cancelSubscription, companySubscription, entitlementIn, listPlans, listSubscriptions, mySubscription, renewSubscription, savePlan, setPlanEntitlements,
} from "../../src/lib/services/subscriptions";
import { markRead, myNotifications, notify, unreadCount } from "../../src/lib/services/notifications";
import { readSettings, saveSettings } from "../../src/lib/services/platform-settings";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
async function seeker(label = "seek") {
  return registerSeeker({ name: `${label} Person`, email: `${label}-${uid()}@example.test`, password: "integration-test-pw" });
}
async function planByCode(code: string) {
  // Plans are readable by a signed-in person, so read them as one.
  return withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code } }));
}
/** Move a subscription's end date, as the clock would. */
async function setEnd(adminId: string, subId: string, daysFromNow: number) {
  await withPlatformAdmin(adminId, (tx) => tx.subscription.update({ where: { id: subId }, data: { periodEnd: new Date(Date.now() + daysFromNow * 864e5), startedAt: new Date(Date.now() - 400 * 864e5) } }));
}

test("a seeker registers without a company, and the same email cannot register twice", async () => {
  const email = `dup-${uid()}@example.test`;
  const a = await registerSeeker({ name: "Dup Seeker", email, password: "integration-test-pw" });
  assert.equal((await prisma.membership.count({ where: { userId: a.userId } })), 0);
  await assert.rejects(registerSeeker({ name: "Again", email, password: "integration-test-pw" }), /already exists/);
  await assert.rejects(registerSeeker({ name: "X", email: `s-${uid()}@example.test`, password: "integration-test-pw" }), /full name/);
  await assert.rejects(registerSeeker({ name: "Short Pw", email: `s-${uid()}@example.test`, password: "short" }), /10 characters/);
  await assert.rejects(registerSeeker({ name: "Bad Mail", email: "not-an-email", password: "integration-test-pw" }), /valid email/);
});

test("plans are the platform administrator's: created, priced, given features, and never by anyone else", async () => {
  const admin = await newPlatformAdmin();
  const company = await newCompany("plans");
  await assert.rejects(listPlans(company.userId), /platform administrator/);
  await assert.rejects(savePlan(company.userId, null, { code: "mine", name: "Mine", audience: "SEEKER", billingPeriod: "MONTHLY" }), /platform administrator/);
  const starting = await listPlans(admin.id);
  assert.ok(starting.length >= 6);
  assert.equal(starting.find((p) => p.code === "premium-seeker")!.priceKobo, null, "starting prices are left unset, not invented");
  const code = `gold-${uid()}`;
  await assert.rejects(savePlan(admin.id, null, { code: "A", name: "Gold", audience: "SEEKER", billingPeriod: "MONTHLY" }), /plan code/);
  await assert.rejects(savePlan(admin.id, null, { code, name: "G", audience: "SEEKER", billingPeriod: "MONTHLY" }), /Name the plan/);
  const plan = await savePlan(admin.id, null, { code, name: "Gold Seeker", audience: "SEEKER", price: "5,000", billingPeriod: "MONTHLY", trialDays: 14, graceDays: 3, readOnlyDays: 10, active: true });
  assert.equal(plan.priceKobo, 500_000n);
  await assert.rejects(savePlan(admin.id, null, { code, name: "Again", audience: "SEEKER", billingPeriod: "MONTHLY" }), /already exists/);
  await setPlanEntitlements(admin.id, plan.id, [{ key: "COLLAB_SEEKER_AGENT", enabled: true, limit: "5" }, { key: "CONTACT_DETAILS", enabled: true }]);
  await assert.rejects(setPlanEntitlements(admin.id, plan.id, [{ key: "TELEPORT", enabled: true }]), /Unknown feature/);
  await assert.rejects(setPlanEntitlements(admin.id, plan.id, [{ key: "COLLAB_SEEKER_AGENT", enabled: true, limit: "-2" }]), /whole number/);
  let again = (await listPlans(admin.id)).find((p) => p.id === plan.id)!;
  assert.deepEqual(again.entitlements.map((e) => [e.key, e.limit]).sort(), [["COLLAB_SEEKER_AGENT", 5], ["CONTACT_DETAILS", null]]);
  await setPlanEntitlements(admin.id, plan.id, [{ key: "CONTACT_DETAILS", enabled: false }]);
  again = (await listPlans(admin.id)).find((p) => p.id === plan.id)!;
  assert.equal(again.entitlements.length, 1);
  await savePlan(admin.id, plan.id, { name: "Gold Seeker Plus", audience: "SEEKER", price: "", billingPeriod: "YEARLY", graceDays: 5, readOnlyDays: 10, active: true });
  assert.equal((await listPlans(admin.id)).find((p) => p.id === plan.id)!.priceKobo, null);
});

test("a subscription moves through grace, read-only and suspended on the plan's dates, and renewal restores it", async () => {
  const admin = await newPlatformAdmin();
  const s = await seeker("sub");
  const premium = await planByCode("premium-seeker");
  const free = await planByCode("free-seeker");
  await assert.rejects(assignSubscription(admin.id, { planId: premium.id, periodEnd: relativeDate(-3), email: "nobody@example.test" }), /future/);
  await assert.rejects(assignSubscription(admin.id, { planId: premium.id, periodEnd: relativeDate(30), email: "nobody@example.test" }), /No account/);
  const company = await newCompany("audience");
  await assert.rejects(assignSubscription(admin.id, { planId: premium.id, periodEnd: relativeDate(30), companyId: company.companyId }), /for individuals/);
  const email = (await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).email;
  await assert.rejects(assignSubscription(admin.id, { planId: (await planByCode("enterprise")).id, periodEnd: relativeDate(30), email }), /for companies/);

  const none = await withUser(s.userId, (tx) => entitlementIn(tx, { kind: "USER", userId: s.userId }, "COLLAB_SEEKER_AGENT"));
  assert.equal(none.access, "NONE");
  assert.equal(none.state, "NONE");

  const sub = await assignSubscription(admin.id, { planId: premium.id, periodEnd: relativeDate(30), email, note: "First month" });
  const check = (key: "COLLAB_SEEKER_AGENT" | "BULK_MESSAGING" = "COLLAB_SEEKER_AGENT") => withUser(s.userId, (tx) => entitlementIn(tx, { kind: "USER", userId: s.userId }, key));
  let e = await check();
  assert.deepEqual([e.access, e.state, e.limit, e.planName], ["FULL", "ACTIVE", 3, "Premium Seeker"]);
  e = await check("BULK_MESSAGING");
  assert.equal(e.access, "NONE");
  assert.match(e.explanation, /does not include/);

  await setEnd(admin.id, sub.id, -3);
  e = await check();
  assert.deepEqual([e.access, e.state], ["FULL", "GRACE"]);
  assert.match(e.explanation, /grace period/);
  await setEnd(admin.id, sub.id, -10);
  e = await check();
  assert.deepEqual([e.access, e.state], ["READ_ONLY", "READ_ONLY"]);
  await setEnd(admin.id, sub.id, -60);
  e = await check();
  assert.deepEqual([e.access, e.state], ["NONE", "SUSPENDED"]);
  assert.match(e.explanation, /records are kept/i);

  await assert.rejects(renewSubscription(admin.id, sub.id, relativeDate(-1)), /future/);
  await renewSubscription(admin.id, sub.id, relativeDate(60), "Paid by transfer");
  e = await check();
  assert.deepEqual([e.access, e.state], ["FULL", "ACTIVE"]);
  await assert.rejects(renewSubscription(admin.id, sub.id, relativeDate(10)), /later than/);

  // Cancelling keeps what was paid for, then stops with no grace.
  await cancelSubscription(admin.id, sub.id, "Asked to stop");
  await assert.rejects(cancelSubscription(admin.id, sub.id), /already cancelled/);
  assert.equal((await check()).state, "ACTIVE");
  await setEnd(admin.id, sub.id, -1);
  assert.equal((await check()).state, "NONE");
  const mine = await mySubscription(s.userId);
  assert.equal(mine.state, "NONE");
  assert.deepEqual(mine.sub!.events.map((x) => x.kind), ["CANCELLED", "RENEWED", "ASSIGNED"]);

  // A change of plan is recorded, and a person holds only one plan.
  await assignSubscription(admin.id, { planId: free.id, periodEnd: relativeDate(90), email });
  const after = await mySubscription(s.userId);
  assert.equal(after.sub!.plan.code, "free-seeker");
  assert.equal(after.state, "ACTIVE");
  assert.equal(after.sub!.events[0].kind, "PLAN_CHANGED");
  assert.equal((await listSubscriptions(admin.id)).filter((x) => x.ownerUserId === s.userId).length, 1);
});

test("a company's plan is read by that company alone, and a person's plan by that person alone", async () => {
  const admin = await newPlatformAdmin();
  const a = await newCompany("planA");
  const b = await newCompany("planB");
  const other = await seeker("other");
  const pro = await planByCode("company-professional");
  await assignSubscription(admin.id, { planId: pro.id, periodEnd: relativeDate(30), companyId: a.companyId });
  const mineA = await companySubscription(a.companyId, a.userId);
  assert.equal(mineA.state, "ACTIVE");
  assert.deepEqual(mineA.features.map((f) => f.key).sort(), ["COLLAB_COMPANY", "CONTACT_DETAILS"]);
  assert.equal((await companySubscription(b.companyId, b.userId)).sub, null);
  assert.equal((await mySubscription(other.userId)).sub, null);
  // Nobody but the platform administrator can write a subscription.
  await assert.rejects(withUser(other.userId, (tx) => tx.subscription.create({ data: { ownerKind: "USER", ownerUserId: other.userId, planId: pro.id, periodEnd: new Date(Date.now() + 864e5), createdById: other.userId } })), /row-level security|violates/i);
});

test("following is free and separate from paid collaboration; profiles are listed only by choice", async () => {
  const company = await newCompany("follow");
  const agent = await addMember(company, "AGENT", "agt");
  const officer = await addMember(company, "OFFICER", "off");
  const s = await seeker("fan");
  await assert.rejects(saveAgentProfile(officer, { displayName: "Officer", listed: true }), /permission/i);
  await assert.rejects(saveAgentProfile(agent, { displayName: "A", listed: true }), /name to show/i);
  await saveAgentProfile(agent, { displayName: "Agent Quiet", headline: "Not listed", listed: false });
  await assert.rejects(follow(s.userId, "AGENT", agent.userId), /not available/);
  await assert.rejects(saveCompanyProfile(agent, { kind: "COMPANY", displayName: "Co", listed: true }), /permission/i);
  await saveAgentProfile(agent, { displayName: "Agent Loud", headline: "Lekki specialist", bio: "Ten years.", listed: true, acceptsMessages: true });
  await saveCompanyProfile(company, { kind: "DEVELOPER", displayName: "Loud Developments", tagline: "Estates", listed: true });

  await follow(s.userId, "AGENT", agent.userId);
  await follow(s.userId, "AGENT", agent.userId);
  await follow(s.userId, "DEVELOPER", company.companyId);
  await assert.rejects(follow(s.userId, "COMPANY", company.companyId), /not available/, "a developer is followed as a developer");
  await assert.rejects(follow(agent.userId, "AGENT", agent.userId), /yourself/);
  const list = await myFollowing(s.userId);
  assert.deepEqual(list.map((f) => f.kind).sort(), ["AGENT", "DEVELOPER"]);
  assert.equal((await myProfiles(agent)).agent!.followerCount, 1);
  assert.equal((await myProfiles(company)).company!.followerCount, 1);

  // Following gives no paid feature and no access.
  const ent = await withUser(s.userId, (tx) => entitlementIn(tx, { kind: "USER", userId: s.userId }, "COLLAB_SEEKER_AGENT"));
  assert.equal(ent.access, "NONE");
  assert.equal(await prisma.membership.count({ where: { userId: s.userId } }), 0);

  await unfollow(s.userId, "AGENT", agent.userId);
  assert.equal((await myProfiles(agent)).agent!.followerCount, 0);
  assert.equal((await myFollowing(s.userId)).length, 1);

  // Unlisting hides the profile from the directory and from the follower's list.
  await saveAgentProfile(agent, { displayName: "Agent Loud", listed: false });
  await follow(s.userId, "AGENT", agent.userId).catch(() => undefined);
  assert.ok(!(await directory({ kind: "agents", q: "Loud" })).rows.some((r) => r.name === "Agent Loud"));
});

test("the directory is public, searchable and paged, and shows a signed-in person who they follow", async () => {
  const company = await newCompany("dir");
  const token = uid();
  const agents = [] as Awaited<ReturnType<typeof addMember>>[];
  for (let i = 0; i < 14; i++) {
    const a = await addMember(company, "AGENT", `dir${i}`);
    await saveAgentProfile(a, { displayName: `Dirtest${token} Agent ${String(i).padStart(2, "0")}`, headline: "Sales", listed: true });
    agents.push(a);
  }
  const s = await seeker("dirfan");
  await follow(s.userId, "AGENT", agents[3].userId);
  const first = await directory({ kind: "agents", q: `Dirtest${token}` });
  assert.equal(first.rows.length, 12);
  assert.equal(first.more, true);
  assert.equal(first.rows.every((r) => !r.following), true, "a signed-out visitor follows nobody");
  const second = await directory({ kind: "agents", q: `Dirtest${token}`, page: 2 });
  assert.equal(second.rows.length, 2);
  assert.equal(second.more, false);
  const mine = await directory({ kind: "agents", q: `Dirtest${token}`, viewerId: s.userId });
  const all = [...mine.rows, ...(await directory({ kind: "agents", q: `Dirtest${token}`, page: 2, viewerId: s.userId })).rows];
  assert.equal(all.filter((r) => r.following).length, 1);
  assert.equal(all.find((r) => r.following)!.targetId, agents[3].userId);
  assert.equal((await directory({ kind: "agents", q: `Dirtest${token}`, page: 3 })).rows.length, 0);
  assert.equal((await directory({ kind: "developers", q: `Dirtest${token}` })).rows.length, 0);
});

test("notices belong to their owner, count as unread until ticked, and can be left by someone else", async () => {
  const a = await seeker("notice-a");
  const b = await seeker("notice-b");
  await withUser(b.userId, async (tx) => {
    await notify(tx, a.userId, { kind: "test", title: "First", body: "Hello", link: "/me" });
    await notify(tx, a.userId, { kind: "test", title: "Second" });
  });
  assert.equal(await unreadCount(a.userId), 2);
  assert.equal(await unreadCount(b.userId), 0);
  assert.equal((await myNotifications(b.userId)).length, 0);
  const notes = await myNotifications(a.userId);
  assert.deepEqual(notes.map((n) => n.title).sort(), ["First", "Second"]);
  await markRead(b.userId, notes[0].id);
  assert.equal(await unreadCount(a.userId), 2, "someone else cannot tick them off");
  await markRead(a.userId, notes[0].id);
  assert.equal(await unreadCount(a.userId), 1);
  await markRead(a.userId, null);
  assert.equal(await unreadCount(a.userId), 0);
});

test("platform limits have defaults, are changed only by the administrator, and are checked", async () => {
  const admin = await newPlatformAdmin();
  const company = await newCompany("settings");
  const before = await readSettings();
  assert.ok(before.messagesPerMinute >= 1);
  await assert.rejects(saveSettings(company.userId, { inviteExpiryDays: 5, messagesPerMinute: 5, newConversationsPerDay: 5, contactPolicy: "MASK", reportMuteThreshold: 3 }), /platform administrator/);
  await assert.rejects(saveSettings(admin.id, { inviteExpiryDays: 0, messagesPerMinute: 5, newConversationsPerDay: 5, contactPolicy: "MASK", reportMuteThreshold: 3 }), /at least 1 day/);
  await assert.rejects(saveSettings(admin.id, { inviteExpiryDays: 5, messagesPerMinute: 5, newConversationsPerDay: 5, contactPolicy: "SHOUT" as never, reportMuteThreshold: 3 }));
  await saveSettings(admin.id, { inviteExpiryDays: 21, messagesPerMinute: 12, newConversationsPerDay: 7, contactPolicy: "BLOCK", reportMuteThreshold: 4 });
  const now = await readSettings();
  assert.deepEqual(now, { inviteExpiryDays: 21, messagesPerMinute: 12, newConversationsPerDay: 7, contactPolicy: "BLOCK", reportMuteThreshold: 4 });
  await saveSettings(admin.id, { inviteExpiryDays: 14, messagesPerMinute: 20, newConversationsPerDay: 10, contactPolicy: "MASK", reportMuteThreshold: 3 });
});
