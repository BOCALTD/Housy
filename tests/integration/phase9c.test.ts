/**
 * Phase 9c: secure messaging. Who may start a conversation, who can read it, contact-detail screening by plan, rate limits,
 * blocking, reports and moderation, property cards and inspection requests, and conversations tied to a collaboration.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withUser } from "../../src/lib/db";
import { createAsset, getAsset } from "../../src/lib/services/assets";
import { registerSeeker, saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import { myNotifications } from "../../src/lib/services/notifications";
import { readSettings, saveSettings } from "../../src/lib/services/platform-settings";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { asCompany, asPerson, createInvitation, respondInvitation, revokeParticipant, getWorkspace, suspendCollaboration } from "../../src/lib/services/collab";
import {
  blockUser, getConversation, liftMessagingPause, listConversations, moderationQueue, pauseMessaging, reportMessage, requestInspection, resolveReport, respondInspection, searchMessages,
  sendMessage, sendPropertyCard, startConversation, unblockUser, unreadConversationCount,
} from "../../src/lib/services/messaging";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const DEFAULTS = { inviteExpiryDays: 14, messagesPerMinute: 20, newConversationsPerDay: 10, contactPolicy: "MASK" as const, reportMuteThreshold: 3 };
async function withSettings<T>(admin: { id: string }, patch: Partial<typeof DEFAULTS>, fn: () => Promise<T>): Promise<T> {
  await saveSettings(admin.id, { ...DEFAULTS, ...patch });
  try { return await fn(); } finally { await saveSettings(admin.id, DEFAULTS); }
}
const plan = (code: string) => withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code } }));
async function subscribe(admin: { id: string }, code: string, to: { companyId?: string; email?: string }) {
  return assignSubscription(admin.id, { planId: (await plan(code)).id, periodEnd: relativeDate(60), ...to });
}
async function seeker(admin?: { id: string }, code?: string) {
  const email = `msg-${uid()}@example.test`;
  const s = await registerSeeker({ name: "Msg Seeker", email, password: "integration-test-pw" });
  if (admin && code) await subscribe(admin, code, { email });
  return { ...s, email, actor: asPerson(s.userId) };
}
async function agentIn(co: Awaited<ReturnType<typeof newCompany>>, o: { accepts?: boolean; listed?: boolean } = {}) {
  const m = await addMember(co, "AGENT", "msgagent");
  await saveAgentProfile(m, { displayName: `Agent ${uid()}`, headline: "Homes", listed: o.listed ?? true, acceptsMessages: o.accepts ?? true });
  return m;
}
const bodyOf = (t: Awaited<ReturnType<typeof getConversation>>) => t.messages.map((m) => m.body).join(" | ");

test("only agents who take messages can be messaged first; a conversation is private, reused, read and notified once", async () => {
  const co = await newCompany("msgco");
  const open = await agentIn(co);
  const quiet = await agentIn(co, { accepts: false });
  const hidden = await agentIn(co, { listed: false });
  const s = await seeker();
  const stranger = await seeker();

  await assert.rejects(startConversation(s.actor, { toUserId: quiet.userId, body: "Hello" }), /not taking messages/);
  await assert.rejects(startConversation(s.actor, { toUserId: hidden.userId, body: "Hello" }), /not taking messages/);
  await assert.rejects(startConversation(s.actor, { toUserId: s.userId, body: "Hello" }), /yourself/);
  await assert.rejects(startConversation(s.actor, { toUserId: "no-such-user", body: "Hello" }), /cannot message/);
  await assert.rejects(startConversation(asCompany(open), { toUserId: s.userId, body: "Cold message to a seeker" }), /not taking messages/, "nobody can cold-message a seeker");
  await assert.rejects(startConversation(s.actor, { toUserId: open.userId, body: "   " }), /./);

  const c = await startConversation(s.actor, { toUserId: open.userId, subject: "A flat in Lekki", body: "Is the two-bedroom flat still available?" });
  const again = await startConversation(s.actor, { toUserId: open.userId, body: "Hello again" });
  assert.equal(again.id, c.id, "the same two people share one conversation");
  await sendMessage(s.actor, c.id, "Third message");
  assert.equal((await myNotifications(open.userId)).filter((n) => n.kind === "message.new").length, 1, "told once, not once per message");
  assert.equal(await unreadConversationCount(asCompany(open)), 1);
  const seen = await getConversation(asCompany(open), c.id);
  assert.equal(seen.messages.length, 3);
  assert.equal(await unreadConversationCount(asCompany(open)), 0);
  assert.equal(await unreadConversationCount(s.actor), 0, "your own messages are not new to you");

  await sendMessage(asCompany(open), c.id, "Yes, it is");
  assert.equal(await unreadConversationCount(s.actor), 1);
  const mine = await getConversation(s.actor, c.id);
  assert.ok(mine.seenUpTo, "the sender can see when the other person has read");
  assert.equal((await listConversations(s.actor)).items[0].others[0], mine.others[0].name);

  // Nobody else can read it, search it, or post into it.
  await assert.rejects(getConversation(stranger.actor, c.id), /not found/i);
  await assert.rejects(sendMessage(stranger.actor, c.id, "Let me in"), /not found/i);
  assert.deepEqual(await searchMessages(stranger.actor, "flat"), []);
  assert.equal((await searchMessages(s.actor, "two-bedroom")).length, 1);
  assert.equal((await searchMessages(asCompany(open), "two-bedroom")).length, 1);
  assert.equal(await withUser(stranger.userId, (tx) => tx.message.count()), 0);
  assert.equal((await listConversations(stranger.actor)).items.length, 0);
  await assert.rejects(sendMessage(s.actor, c.id, "x".repeat(4001)), /4,000/);
});

test("phone numbers and email addresses are hidden unless the sender's plan includes them, or the platform blocks them outright", async () => {
  const admin = await newPlatformAdmin();
  const free = await newCompany("freeco");
  const paid = await newCompany("paidco");
  await subscribe(admin, "company-professional", { companyId: paid.companyId });
  const target = await agentIn(free);
  const paidAgent = await agentIn(paid);
  const s = await seeker();
  const text = "Call me on 08031234567 or write to buyer@example.com";

  const c = await startConversation(s.actor, { toUserId: target.userId, body: text });
  const theirs = await getConversation(asCompany(target), c.id);
  assert.equal(theirs.messages[0].masked, true);
  assert.ok(!/0803123|buyer@example/.test(bodyOf(theirs)), "the recipient never receives the number or address");
  assert.match(bodyOf(theirs), /\[phone hidden\]/);
  assert.match(bodyOf(theirs), /\[email hidden\]/);
  assert.ok(!/0803123|buyer@example/.test(bodyOf(await getConversation(s.actor, c.id))), "it is not stored in the clear");

  // A plan with contact details lets the sender share them: a seeker's own plan, or the company's plan for its staff.
  await subscribe(admin, "premium-seeker", { email: s.email });
  await sendMessage(s.actor, c.id, "You can reach me on 08031234567");
  const after = await getConversation(asCompany(target), c.id);
  assert.match(after.messages.at(-1)!.body, /08031234567/);
  assert.equal(after.messages.at(-1)!.masked, false);
  const c2 = await startConversation(asCompany(paidAgent), { toUserId: (await seeker()).userId, body: "x" }).catch(() => null);
  assert.equal(c2, null, "a company's plan does not let it cold-message a seeker");
  const s2 = await seeker();
  const c3 = await startConversation(s2.actor, { toUserId: paidAgent.userId, body: "Hello" });
  await sendMessage(asCompany(paidAgent), c3.id, "Phone me on 08035550100");
  assert.match((await getConversation(s2.actor, c3.id)).messages.at(-1)!.body, /08035550100/);
  assert.equal((await getConversation(s2.actor, c3.id)).messages.at(-1)!.masked, false);

  // The platform can go further and refuse the message.
  await withSettings(admin, { contactPolicy: "BLOCK" }, async () => {
    const s3 = await seeker();
    await assert.rejects(startConversation(s3.actor, { toUserId: target.userId, body: "Ring 08031112222" }), /cannot be sent on your plan/);
    await startConversation(s3.actor, { toUserId: target.userId, body: "No numbers here" });
  });
});

test("the platform's rate limits stop floods of messages and of new conversations", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("limits");
  const a1 = await agentIn(co), a2 = await agentIn(co), a3 = await agentIn(co);
  const s = await seeker();
  await withSettings(admin, { messagesPerMinute: 3, newConversationsPerDay: 2 }, async () => {
    const c = await startConversation(s.actor, { toUserId: a1.userId, body: "one" });
    await sendMessage(s.actor, c.id, "two");
    await sendMessage(s.actor, c.id, "three");
    await assert.rejects(sendMessage(s.actor, c.id, "four"), /too quickly/);
    await sendMessage(asCompany(a1), c.id, "A reply is the other person's own allowance");
  });
  await withSettings(admin, { messagesPerMinute: 50, newConversationsPerDay: 2 }, async () => {
    await startConversation(s.actor, { toUserId: a2.userId, body: "second conversation" });
    await assert.rejects(startConversation(s.actor, { toUserId: a3.userId, body: "third conversation" }), /2 new conversations a day/);
    await sendMessage(s.actor, (await startConversation(s.actor, { toUserId: a2.userId, body: "Same conversation again" })).id, "More talk in the same one");
  });
  assert.deepEqual(await readSettings(), DEFAULTS, "the limits are put back");
});

test("blocking, reporting and moderation: blocks are silent, reports reach the platform, repeated reports flag a sender, and a pause stops them", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("mod");
  const agents = [await agentIn(co), await agentIn(co), await agentIn(co)];
  const s = await seeker();
  const c = await startConversation(s.actor, { toUserId: agents[0].userId, body: "Pay me outside the platform" });
  const first = (await getConversation(asCompany(agents[0]), c.id)).messages[0];

  await assert.rejects(blockUser(s.actor, s.userId), /yourself/);
  await blockUser(asCompany(agents[0]), s.userId);
  await assert.rejects(sendMessage(s.actor, c.id, "Why no reply"), /cannot message/);
  await assert.rejects(sendMessage(asCompany(agents[0]), c.id, "I blocked you"), /cannot message/);
  await assert.rejects(startConversation(s.actor, { toUserId: agents[0].userId, body: "Hello" }), /cannot message/);
  assert.equal((await getConversation(asCompany(agents[0]), c.id)).iBlocked, true);
  assert.equal((await getConversation(s.actor, c.id)).cannotReply, true, "the blocked person is not told why");
  assert.equal(await withUser(s.userId, (tx) => tx.userBlock.count()), 0, "the blocked person cannot read the block");
  await unblockUser(asCompany(agents[0]), s.userId);
  await sendMessage(s.actor, c.id, "Hello again");

  await assert.rejects(reportMessage(s.actor, first.id, "mine"), /own message/);
  await assert.rejects(reportMessage(asPerson((await seeker()).userId), first.id, "Not in my conversation"), /not found/i);
  await reportMessage(asCompany(agents[0]), first.id, "Asked me to pay outside the platform");
  await assert.rejects(reportMessage(asCompany(agents[0]), first.id, "Again"), /already reported/);
  await assert.rejects(moderationQueue((await seeker()).userId), /platform administrator/);
  let q = await moderationQueue(admin.id);
  const mine = q.reports.filter((r) => r.senderId === s.userId);
  assert.equal(mine.length, 1);
  assert.match(mine[0].body, /outside the platform/, "the administrator reads the reported message");
  assert.equal(q.flagged.some((f) => f.id === s.userId), false, "one report does not flag anyone");

  for (const a of agents.slice(1)) {
    const cc = await startConversation(s.actor, { toUserId: a.userId, body: "Send the money to my account" });
    await reportMessage(asCompany(a), (await getConversation(asCompany(a), cc.id)).messages[0].id, "Scam attempt");
  }
  q = await moderationQueue(admin.id);
  assert.equal(q.flagged.find((f) => f.id === s.userId)?.reporters, 3, "three different people reported the same sender");

  await assert.rejects(resolveReport(admin.id, mine[0].id, "action", "x"), /./);
  await resolveReport(admin.id, mine[0].id, "action", "Confirmed: asked for payment off the platform", true);
  await assert.rejects(resolveReport(admin.id, mine[0].id, "dismiss", "Again please"), /already handled/);
  await assert.rejects(sendMessage(s.actor, c.id, "Still here?"), /paused/);
  await assert.rejects(startConversation(s.actor, { toUserId: agents[2].userId, body: "New one" }), /paused/);
  assert.ok((await myNotifications(s.userId)).some((n) => n.kind === "message.paused"));
  assert.ok((await myNotifications(agents[0].userId)).some((n) => n.kind === "message.report"), "the reporter hears the outcome");
  await liftMessagingPause(admin.id, s.userId);
  await assert.rejects(liftMessagingPause(admin.id, s.userId), /Nothing to lift/);
  await sendMessage(s.actor, c.id, "Restored");
  await pauseMessaging(admin.id, s.userId, "Second look");
  await assert.rejects(sendMessage(s.actor, c.id, "Blocked again"), /Second look/);
  await liftMessagingPause(admin.id, s.userId);
});

test("a listing can be shared as a card and an inspection arranged, answered once by the other person", async () => {
  const admin = await newPlatformAdmin();
  const company = await newCompany("cards");
  const agent = await agentIn(company);
  const asset = await createAsset(company, { name: "Card plot", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER", address: "Private Address Close" } as never);
  await saveListingDraft(company, asset.id, { title: "Plot in Epe", purpose: "SALE", price: "12,000,000", city: "Epe", state: "Lagos" });
  await setListingStatus(company, asset.id, "PENDING_REVIEW");
  const listing = (await getAsset(company, asset.id))!.asset.listing!;
  await reviewListing(admin.id, listing.id, "approve", "");
  const draftAsset = await createAsset(company, { name: "Draft plot", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER" } as never);
  await saveListingDraft(company, draftAsset.id, { title: "Not yet public", purpose: "SALE", price: "1,000,000", city: "Epe", state: "Lagos" });
  const draftRef = (await getAsset(company, draftAsset.id))!.asset.listing!.publicRef;

  const s = await seeker();
  const c = await startConversation(s.actor, { toUserId: agent.userId, body: "Do you have land in Epe?" });
  await sendPropertyCard(asCompany(agent), c.id, listing.publicRef, "This one may suit you");
  await assert.rejects(sendPropertyCard(asCompany(agent), c.id, draftRef), /not published/);
  const thread = await getConversation(s.actor, c.id);
  const card = thread.messages.find((m) => m.kind === "PROPERTY")!;
  const d = card.details as Record<string, string>;
  assert.equal(d.publicRef, listing.publicRef);
  assert.equal(d.priceKobo, "1200000000");
  assert.ok(!JSON.stringify(card).includes("Private Address"), "only public details travel in a card");

  await assert.rejects(requestInspection(s.actor, c.id, { listingRef: listing.publicRef, date: relativeDate(-2), time: "10:00" }), /passed/);
  await assert.rejects(requestInspection(s.actor, c.id, { date: relativeDate(3), time: "25:99" }), /./);
  const req = await requestInspection(s.actor, c.id, { listingRef: listing.publicRef, date: relativeDate(3), time: "10:30", note: "Saturday morning?" });
  await assert.rejects(respondInspection(s.actor, req.id, "accept"), /other person/);
  await respondInspection(asCompany(agent), req.id, "accept", "See you there");
  await assert.rejects(respondInspection(asCompany(agent), req.id, "decline"), /already answered/);
  assert.equal((await getConversation(s.actor, c.id)).answered.get(req.id), "ACCEPTED");
  assert.ok((await myNotifications(s.userId)).some((n) => n.kind === "message.new"));
});

test("people in a live collaboration can message each other, and the conversation ends with their access", async () => {
  const admin = await newPlatformAdmin();
  const prof = (co: Awaited<ReturnType<typeof newCompany>>, label: string) => saveCompanyProfile(co, { kind: "COMPANY", displayName: `${label} ${uid()}`, tagline: "Homes", listed: true });
  const A = await newCompany("msgA"), B = await newCompany("msgB");
  await prof(A, "A"); await prof(B, "B");
  await subscribe(admin, "company-professional", { companyId: A.companyId });
  await subscribe(admin, "company-professional", { companyId: B.companyId });
  const bystander = await addMember(A, "AGENT", "bystander");
  const c = await createInvitation(asCompany(A), { kind: "COMPANY_COMPANY", purpose: "CO_BROKERAGE", title: "Joint listing", companyId: B.companyId }, true);
  await assert.rejects(startConversation(asCompany(A), { toUserId: B.userId, collaborationId: c.id, body: "Before acceptance" }), /both have access/);
  await respondInvitation(asCompany(B), c.id, "accept");

  const t = await startConversation(asCompany(A), { toUserId: B.userId, collaborationId: c.id, body: "Shall we agree viewing times?" });
  await sendMessage(asCompany(B), t.id, "Weekdays after 4pm");
  await assert.rejects(startConversation(asCompany(bystander), { toUserId: B.userId, collaborationId: c.id, body: "Let me in" }), /both have access/);
  await assert.rejects(startConversation(asCompany(A), { toUserId: B.userId, body: "Outside the workspace" }), /not taking messages/, "without a collaboration, the usual rules apply");

  await suspendCollaboration(asCompany(A), c.id, "On hold");
  await assert.rejects(sendMessage(asCompany(A), t.id, "While suspended"), /no longer open/);
  const w = await getWorkspace(asCompany(A), c.id);
  assert.equal(w.collab.status, "SUSPENDED");
  const { resumeCollaboration } = await import("../../src/lib/services/collab");
  await resumeCollaboration(asCompany(A), c.id);
  await sendMessage(asCompany(A), t.id, "Back on");
  const row = (await getWorkspace(asCompany(B), c.id)).participants.find((p) => p.userId === B.userId)!;
  await revokeParticipant(asCompany(B), row.id, "Leaving this deal");
  await assert.rejects(sendMessage(asCompany(A), t.id, "Anyone there?"), /no longer open/);
  await assert.rejects(sendMessage(asCompany(B), t.id, "Can I still talk?"), /no longer open/);
  // What was said stays readable to the people who said it.
  assert.equal((await getConversation(asCompany(A), t.id)).messages.length, 3);
});
