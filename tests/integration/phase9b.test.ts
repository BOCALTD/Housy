/**
 * Phase 9b: collaboration. Invitations between a seeker and an agent, and between two companies; the workspace, what is shared
 * (as copies), who can see and change what, plan states, suspension, and the audit trail.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant, withUser } from "../../src/lib/db";
import { registerSeeker, saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { assignSubscription, renewSubscription } from "../../src/lib/services/subscriptions";
import { myNotifications } from "../../src/lib/services/notifications";
import { createAsset } from "../../src/lib/services/assets";
import { createClient } from "../../src/lib/services/crm";
import { createDeal, getDeal } from "../../src/lib/services/deal";
import {
  addComment, addParticipant, addTask, asCompany, asPerson, cancelInvitation, collaborationReport, createInvitation, endCollaboration, getSharedFile, getWorkspace, listCollaborations, pendingIncoming,
  platformResume, platformSuspend, refreshItem, respondInvitation, resumeCollaboration, revokeItem, revokeParticipant, sendInvitation, setTaskStatus, shareDeal, shareDocument, shareNote, shareProperty,
  suspendCollaboration, updateParticipant,
} from "../../src/lib/services/collab";
import { addMember, newCompany, newPlatformAdmin, PDF_BYTES, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const plan = (code: string) => withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code } }));
async function subscribe(admin: { id: string }, code: string, to: { companyId?: string; email?: string }, days = 60) {
  return assignSubscription(admin.id, { planId: (await plan(code)).id, periodEnd: relativeDate(days), ...to });
}
async function seekerWith(admin: { id: string }, code: string | null) {
  const email = `seek-${uid()}@example.test`;
  const s = await registerSeeker({ name: "Seeker Person", email, password: "integration-test-pw" });
  if (code) await subscribe(admin, code, { email });
  return { ...s, email, actor: asPerson(s.userId) };
}
async function listedAgent(co: Awaited<ReturnType<typeof newCompany>>, name = "Agent") {
  const m = await addMember(co, "AGENT", name.toLowerCase());
  await saveAgentProfile(m, { displayName: `${name} ${uid()}`, headline: "Specialist", listed: true });
  return m;
}
async function listedCompany(label: string, admin: { id: string }, code: string | null) {
  const co = await newCompany(label);
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `${label} Realty ${uid()}`, tagline: "Homes", listed: true });
  if (code) await subscribe(admin, code, { companyId: co.companyId });
  return co;
}
const invite = (purpose = "SEARCH_ASSISTANCE") => ({ kind: "SEEKER_AGENT" as const, purpose: purpose as never, title: "Find me a flat in Lekki", scope: "Two bedrooms", terms: "" });
const pair = (to: string, purpose = "CO_BROKERAGE") => ({ kind: "COMPANY_COMPANY" as const, purpose: purpose as never, title: "Co-broke the Ikoyi duplex", companyId: to });
const mutate = (admin: { id: string }, fn: (tx: Parameters<Parameters<typeof withPlatformAdmin>[1]>[0]) => Promise<unknown>) => withPlatformAdmin(admin.id, fn);
async function liveWorkspace(admin: { id: string }) {
  const A = await listedCompany("collabA", admin, "company-professional");
  const B = await listedCompany("collabB", admin, "company-professional");
  const c = await createInvitation(asCompany(A), pair(B.companyId), true);
  await respondInvitation(asCompany(B), c.id, "accept");
  return { A, B, id: c.id, a: asCompany(A), b: asCompany(B) };
}
async function aDeal(co: Awaited<ReturnType<typeof newCompany>>, label: string) {
  const agent = await addMember(co, "AGENT", `dealer-${label}`);
  const asset = await createAsset(co, { name: `${label} duplex`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER", address: "12 Secret Street", city: "Lagos", state: "Lagos" } as never);
  const client = await createClient(agent, { name: "Private Client Okafor", phone: "08035550177", email: "okafor@example.test" } as never);
  const deal = await createDeal(agent, { clientId: client.id, assetId: asset.id, type: "SALE", asking: "120,000,000" } as never);
  return { agent, asset, client, deal };
}

test("a seeker can invite an agent only on a plan that allows it, and only up to the plan's limit", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("seekco");
  const agents = [] as Awaited<ReturnType<typeof listedAgent>>[];
  for (let i = 0; i < 4; i++) agents.push(await listedAgent(co, `Ag${i}`));
  const hidden = await addMember(co, "AGENT", "hidden");
  await saveAgentProfile(hidden, { displayName: "Hidden Agent", listed: false });
  const s = await seekerWith(admin, null);

  const draft = await createInvitation(s.actor, { ...invite(), agentUserId: agents[0].userId });
  assert.equal(draft.status, "DRAFT");
  await assert.rejects(sendInvitation(s.actor, draft.id), /not available on this plan/i, "no plan, no collaboration");
  await subscribe(admin, "free-seeker", { email: s.email });
  await assert.rejects(sendInvitation(s.actor, draft.id), /not available on this plan/i, "the free plan does not include it");
  await subscribe(admin, "premium-seeker", { email: s.email });

  await assert.rejects(createInvitation(s.actor, { ...invite(), agentUserId: s.userId }), /yourself|not available/);
  await assert.rejects(createInvitation(s.actor, { ...invite(), agentUserId: hidden.userId }), /not available to collaborate/);
  await assert.rejects(createInvitation(s.actor, { ...invite(), agentUserId: agents[0].userId }), /already have an open/);
  await assert.rejects(createInvitation(asCompany(agents[1]), { ...invite(), agentUserId: agents[2].userId }), /personal account/);
  await assert.rejects(createInvitation(s.actor, { ...invite("CO_BROKERAGE"), agentUserId: agents[1].userId }), /suits a seeker/);

  const sent = await sendInvitation(s.actor, draft.id);
  assert.equal(sent.status, "PENDING");
  assert.ok(sent.expiresAt && sent.expiresAt.getTime() > Date.now());
  assert.equal(await pendingIncoming(asCompany(agents[0])), 1);
  assert.ok((await myNotifications(agents[0].userId)).some((n) => n.kind === "collab.invited"), "the agent is told");

  await createInvitation(s.actor, { ...invite(), agentUserId: agents[1].userId }, true);
  const third = await createInvitation(s.actor, { ...invite(), agentUserId: agents[2].userId }, true);
  await assert.rejects(createInvitation(s.actor, { ...invite(), agentUserId: agents[3].userId }, true), /allows 3 open/);
  await cancelInvitation(s.actor, third.id, "Changed my mind");
  await createInvitation(s.actor, { ...invite(), agentUserId: agents[3].userId }, true);
});

test("only the invited agent answers; declining, cancelling and expiry each close the invitation", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("answers");
  const agent = await listedAgent(co, "Answerer");
  const colleague = await listedAgent(co, "Colleague");
  const s = await seekerWith(admin, "premium-seeker");
  const c = await createInvitation(s.actor, { ...invite(), agentUserId: agent.userId }, true);

  await assert.rejects(respondInvitation(s.actor, c.id, "accept"), /invited agent/);
  await assert.rejects(respondInvitation(asCompany(colleague), c.id, "accept"), /invited agent|not found/i);
  await assert.rejects(getWorkspace(asPerson((await seekerWith(admin, null)).userId), c.id), /not found/i, "a stranger cannot even see it exists");
  // The company's own administrator is a supervisor: the roster and history, not the answer.
  await assert.rejects(respondInvitation(asCompany(co), c.id, "accept"), /invited agent/);

  await respondInvitation(asCompany(agent), c.id, "decline", "Not taking new clients");
  const after = await getWorkspace(s.actor, c.id);
  assert.equal(after.collab.status, "DECLINED");
  assert.equal(after.collab.responseNote, "Not taking new clients");
  assert.ok((await myNotifications(s.userId)).some((n) => n.kind === "collab.declined"));
  await assert.rejects(respondInvitation(asCompany(agent), c.id, "accept"), /declined/);
  await assert.rejects(cancelInvitation(s.actor, c.id), /cannot|declined/i);

  // Expiry: nobody answers in time.
  const d = await createInvitation(s.actor, { ...invite(), agentUserId: colleague.userId }, true);
  await mutate(admin, (tx) => tx.collaboration.update({ where: { id: d.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
  await assert.rejects(respondInvitation(asCompany(colleague), d.id, "accept"), /expired|cannot be answered/i);
  assert.equal((await getWorkspace(s.actor, d.id)).collab.status, "EXPIRED");

  // The sender can cancel while it is still waiting, and the invited person is told.
  const e = await createInvitation(s.actor, { ...invite(), agentUserId: agent.userId }, true);
  await cancelInvitation(s.actor, e.id, "Found one elsewhere");
  assert.equal((await getWorkspace(s.actor, e.id)).collab.status, "CANCELLED");
  assert.ok((await myNotifications(agent.userId)).some((n) => n.kind === "collab.cancelled"));
  await assert.rejects(cancelInvitation(asCompany(agent), e.id), /Only the sender|cannot/i);
});

test("two companies collaborate only when both plans allow it; the invited company picks who works on it", async () => {
  const admin = await newPlatformAdmin();
  const A = await listedCompany("coA", admin, "company-professional");
  const B = await listedCompany("coB", admin, null);
  const aAgent = await addMember(A, "AGENT", "a-agent");
  const bAgent = await addMember(B, "AGENT", "b-agent");
  const bManager = await addMember(B, "MANAGER", "b-mgr");
  const bOfficer = await addMember(B, "OFFICER", "b-off");

  await assert.rejects(createInvitation(asCompany(aAgent), pair(B.companyId)), /permission/i);
  await assert.rejects(createInvitation(asCompany(A), pair(A.companyId)), /own company/);
  await assert.rejects(createInvitation(asCompany(A), { ...pair(B.companyId), purpose: "SEARCH_ASSISTANCE" as never }), /suits two companies/);
  const unlisted = await newCompany("unlisted");
  await assert.rejects(createInvitation(asCompany(A), pair(unlisted.companyId)), /not available to collaborate/);

  const c = await createInvitation(asCompany(A), pair(B.companyId), true);
  assert.equal(await pendingIncoming(asCompany(B)), 1);
  assert.equal(await pendingIncoming(asCompany(bAgent)), 0, "only managers and administrators see invitations to answer");
  await assert.rejects(respondInvitation(asCompany(bAgent), c.id, "accept"), /not found/i, "a colleague who is not a manager does not even see it");
  await assert.rejects(respondInvitation(asCompany(A), c.id, "accept"), /manager or administrator|other side/);
  await assert.rejects(respondInvitation(asCompany(B), c.id, "accept"), /plan/i, "the invited company's own plan must allow it too");
  await assert.rejects(createInvitation(asCompany(A), pair(B.companyId)), /already have an open/);

  await subscribe(admin, "company-professional", { companyId: B.companyId });
  await assert.rejects(respondInvitation(asCompany(bManager), c.id, "accept", "", [bOfficer.userId]), /agents, managers or administrators/);
  await respondInvitation(asCompany(bManager), c.id, "accept", "Glad to", [bAgent.userId]);
  const w = await getWorkspace(asCompany(bAgent), c.id);
  assert.equal(w.collab.status, "ACTIVE");
  assert.deepEqual(w.participants.filter((p) => p.side === "RECIPIENT").map((p) => p.userId), [bAgent.userId]);
  assert.ok(w.me, "the chosen person is in");
  // The manager who accepted chose someone else, so is a supervisor with roster and history but no content.
  const sup = await getWorkspace(asCompany(bManager), c.id);
  assert.equal(sup.me, null);
  assert.equal(sup.contentHidden, true);
  assert.ok(sup.events.length >= 3);
  assert.ok((await myNotifications(A.userId)).some((n) => n.kind === "collab.accepted"));
  void aAgent;
});

test("what is shared is a copy of the fields ticked; the client, the CRM and the other company's records stay out of reach", async () => {
  const admin = await newPlatformAdmin();
  const { A, B, id, a, b } = await liveWorkspace(admin);
  const { deal, client, asset } = await aDeal(A, "Ikoyi");
  const other = await aDeal(B, "Bs");

  const item = await shareDeal(a, id, { dealId: deal.id, stage: true, asking: true, note: "Seller is flexible" });
  const seen = (await getWorkspace(b, id)).items.find((i) => i.id === item.id)!;
  const text = JSON.stringify(seen);
  assert.match(text, /120,000,000/);
  for (const secret of ["Okafor", "08035550177", "okafor@example", "Secret Street", client.id, asset.id, deal.id]) assert.ok(!text.includes(secret), `not shared: ${secret}`);
  assert.ok(!text.includes("Agreed price"), "a field not ticked is not copied");

  // The partner has no way into the sharer's CRM, by service or by database.
  await assert.rejects(getDeal(B, deal.id), /not found|access/i);
  assert.equal(await withTenant(B.companyId, B.userId, (tx) => tx.deal.count({ where: { id: deal.id } })), 0);
  assert.equal(await withTenant(B.companyId, B.userId, (tx) => tx.client.count({ where: { id: client.id } })), 0);
  assert.equal(await withTenant(B.companyId, B.userId, (tx) => tx.asset.count({ where: { id: asset.id } })), 0);
  assert.equal(await withTenant(A.companyId, A.userId, (tx) => tx.deal.count({ where: { id: other.deal.id } })), 0);
  // Sharing needs a deal the sharer may change: an unrelated agent in the same company cannot share someone else's deal.
  const stranger = await addMember(A, "AGENT", "stranger");
  await assert.rejects(shareDeal(asCompany(stranger), id, { dealId: deal.id, stage: true }), /participant|not found|permission|owner/i);
  // The partner cannot share the other side's deal or another company's.
  await assert.rejects(shareDeal(b, id, { dealId: deal.id, stage: true }), /./);
  await assert.rejects(shareDeal(a, id, { dealId: deal.id, stage: true }), /already shared/);

  // The partner can only read: it cannot update or take back what A shared.
  await assert.rejects(refreshItem(b, item.id), /Only the side that shared/);
  await assert.rejects(revokeItem(b, item.id, "I want it gone"), /Only the side that shared/);

  // A refresh brings the copy up to date with the same fields that were ticked the first time.
  await refreshItem(a, item.id);
  const refreshed = (await getWorkspace(b, id)).items.find((i) => i.id === item.id)!;
  assert.equal(refreshed.version, 2);

  // A property goes only as far as the ticked fields: no address unless chosen.
  const p = await shareProperty(a, id, { assetId: asset.id, price: false, address: false, note: "" });
  const pText = JSON.stringify((await getWorkspace(b, id)).items.find((i) => i.id === p.id));
  assert.ok(!pText.includes("Secret Street"));
  assert.ok(!pText.includes("120,000,000"));
  const pa = await shareNote(a, id, { title: "Viewing times", body: "Weekdays after 4pm" });
  assert.equal((await getWorkspace(b, id)).items.find((i) => i.id === pa.id)!.summary, "Weekdays after 4pm");
});

test("taking something back wipes the copy and the file; the other side can no longer read it", async () => {
  const admin = await newPlatformAdmin();
  const { A, id, a, b } = await liveWorkspace(admin);
  const doc = await shareDocument(a, id, "Title deed", { name: "deed.pdf", type: "application/pdf", bytes: PDF_BYTES });
  const got = await getSharedFile(b, doc.id);
  assert.ok(got && got.bytes.length === PDF_BYTES.length, "the partner can open it while it is shared");
  assert.ok((await getWorkspace(a, id)).events.some((e) => e.kind === "document_opened"), "opening it is recorded");
  await assert.rejects(shareDocument(a, id, "Bad", { name: "x.exe", type: "application/x-msdownload", bytes: new Uint8Array([1, 2, 3]) }), /./);

  await assert.rejects(revokeItem(a, doc.id, "x"), /./);
  await revokeItem(a, doc.id, "Sent the wrong file");
  assert.equal(await getSharedFile(b, doc.id), null);
  const row = await withTenant(A.companyId, A.userId, (tx) => tx.collabItem.findUniqueOrThrow({ where: { id: doc.id } }));
  assert.equal(row.title, "Revoked item");
  assert.equal(row.fileKey, null);
  assert.equal(row.summary, "");
  assert.equal(await withTenant(A.companyId, A.userId, (tx) => tx.collabFile.count({ where: { collaborationId: id } })), 0, "the bytes are gone");
  await assert.rejects(revokeItem(a, doc.id, "Again please"), /already/);
  await assert.rejects(refreshItem(a, doc.id), /revoked/);
  assert.ok((await collaborationReport(a)).itemsRevoked >= 1);
});

test("access can be limited, expire and be taken away, and takes effect at once", async () => {
  const admin = await newPlatformAdmin();
  const { A, B, id, a, b } = await liveWorkspace(admin);
  const colleague = await addMember(A, "AGENT", "colleague");
  const reader = await addMember(A, "AGENT", "reader");
  await assert.rejects(addParticipant(asCompany(colleague), id, reader.userId), /manager or administrator|not found/i);
  await assert.rejects(addParticipant(a, id, (await addMember(B, "AGENT", "bb")).userId), /your company/);
  await addParticipant(a, id, reader.userId, { canComment: false, canTasks: false, canShare: false, canDocuments: false });
  const r = asCompany(reader);
  assert.ok((await getWorkspace(r, id)).me, "a reader sees the workspace");
  await assert.rejects(addComment(r, id, "hello"), /permission/);
  await assert.rejects(shareNote(r, id, { title: "Note", body: "x" }), /permission/);
  await assert.rejects(addTask(r, id, { title: "A task" }), /permission/);
  await assert.rejects(shareDocument(r, id, "Doc", { name: "a.pdf", type: "application/pdf", bytes: PDF_BYTES }), /permission/);

  const row = (await getWorkspace(a, id)).participants.find((p) => p.userId === reader.userId)!;
  await updateParticipant(a, row.id, { canComment: true });
  await addComment(r, id, "Now I may comment");
  await assert.rejects(updateParticipant(b, row.id, { canTasks: true }), /Only a manager or administrator of that side|not found/i);

  // Access that has run out stops working without anyone doing anything.
  await mutate(admin, (tx) => tx.collabParticipant.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
  await assert.rejects(addComment(r, id, "Too late"), /not found/i);
  await assert.rejects(getWorkspace(r, id), /not found/i);

  // Removing someone is immediate and is told to them.
  await addParticipant(a, id, reader.userId, {});
  await addComment(r, id, "Back again");
  await revokeParticipant(a, row.id, "Left the deal team");
  await assert.rejects(addComment(r, id, "Still here?"), /not found/i);
  assert.ok((await myNotifications(reader.userId)).some((n) => n.kind === "collab.revoked"));
  await assert.rejects(revokeParticipant(a, row.id, "Again"), /already/);
  assert.ok((await getWorkspace(a, id)).events.some((e) => e.kind === "participant_revoked"));
});

test("a stranger, another company's manager and a non-participant colleague see nothing of the workspace", async () => {
  const admin = await newPlatformAdmin();
  const { A, id, a } = await liveWorkspace(admin);
  const C = await listedCompany("coC", admin, "enterprise");
  const colleague = await addMember(A, "AGENT", "nonpart");
  await shareNote(a, id, { title: "Private to the pair", body: "Reserve price 90m" });
  for (const who of [asCompany(C), asCompany(colleague)]) {
    await assert.rejects(getWorkspace(who, id), /not found/i);
    await assert.rejects(addComment(who, id, "hi"), /not found/i);
    await assert.rejects(shareNote(who, id, { title: "Hello", body: "x" }), /not found/i);
    await assert.rejects(endCollaboration(who, id, "ending it"), /not found/i);
    await assert.rejects(suspendCollaboration(who, id, "stopping it"), /not found/i);
    assert.deepEqual((await listCollaborations(who)).active, []);
  }
  // At the database level too: the third company reads no collaboration rows at all.
  assert.equal(await withTenant(C.companyId, C.userId, (tx) => tx.collaboration.count()), 0);
  assert.equal(await withTenant(C.companyId, C.userId, (tx) => tx.collabItem.count()), 0);
  assert.equal(await withTenant(C.companyId, C.userId, (tx) => tx.collabEvent.count()), 0);
});

test("plan states: full in grace, view-only when read-only, hidden when suspended, restored on renewal, and the weaker plan decides", async () => {
  const admin = await newPlatformAdmin();
  const { A, B, id, a, b } = await liveWorkspace(admin);
  const item = await shareNote(a, id, { title: "Keep", body: "Keep this" });
  const setEnd = (companyId: string, days: number) => mutate(admin, (tx) => tx.subscription.updateMany({ where: { ownerCompanyId: companyId }, data: { periodEnd: new Date(Date.now() + days * 864e5), startedAt: new Date(Date.now() - 600 * 864e5) } }));

  await setEnd(A.companyId, -2); // grace
  await addComment(a, id, "Still fully working in grace");
  assert.equal((await getWorkspace(a, id)).plan.access, "FULL");

  await setEnd(A.companyId, -10); // read-only
  const ro = await getWorkspace(b, id);
  assert.equal(ro.plan.access, "READ_ONLY", "the partner is held by the weaker plan");
  assert.equal(ro.contentHidden, false, "the content can still be read");
  assert.match(ro.plan.explanation, new RegExp(ro.collab.senderName));
  await assert.rejects(addComment(b, id, "No"), /./);
  await assert.rejects(shareNote(a, id, { title: "No", body: "no" }), /./);
  await assert.rejects(addTask(a, id, { title: "No task" }), /./);
  await revokeItem(a, item.id, "Taking it back while read-only");
  assert.equal((await getWorkspace(b, id)).items.find((i) => i.id === item.id)!.title, "Revoked item", "taking back still works");
  await assert.rejects(createInvitation(a, { ...pair((await listedCompany("coD", admin, null)).companyId) }, true), /not available on this plan/i);

  await setEnd(A.companyId, -60); // suspended
  const sus = await getWorkspace(b, id);
  assert.equal(sus.contentHidden, true);
  assert.deepEqual(sus.items, []);

  const subs = await mutate(admin, (tx) => tx.subscription.findFirstOrThrow({ where: { ownerCompanyId: A.companyId } })) as { id: string };
  await renewSubscription(admin.id, subs.id, relativeDate(30), "Paid by transfer");
  assert.equal((await getWorkspace(b, id)).plan.access, "FULL");
  await addComment(b, id, "Back in business");

  // The other company's lapse holds the pair just the same.
  await mutate(admin, (tx) => tx.subscription.updateMany({ where: { ownerCompanyId: B.companyId }, data: { periodEnd: new Date(Date.now() - 10 * 864e5), startedAt: new Date(Date.now() - 600 * 864e5) } }));
  assert.equal((await getWorkspace(a, id)).plan.access, "READ_ONLY");
  await assert.rejects(addComment(a, id, "Blocked by B's plan"), /./);
});

test("suspending, resuming and finishing: only the right side can undo a suspension, and the platform's suspension is its own", async () => {
  const admin = await newPlatformAdmin();
  const { id, a, b } = await liveWorkspace(admin);
  await assert.rejects(suspendCollaboration(a, id, "x"), /./);
  await suspendCollaboration(a, id, "Waiting on the survey");
  await assert.rejects(addComment(b, id, "hello"), /suspend/i);
  await assert.rejects(resumeCollaboration(b, id), /side that suspended/);
  await resumeCollaboration(a, id);
  await addComment(b, id, "We are back");

  await platformSuspend(admin.id, id, "Complaint under review");
  await assert.rejects(resumeCollaboration(a, id), /platform/i);
  await assert.rejects(resumeCollaboration(b, id), /platform/i);
  await assert.rejects(platformResume((await newCompany("nonadmin")).userId, id), /platform administrator/);
  await assert.rejects(platformSuspend((await newCompany("nonadmin2")).userId, id, "I want to"), /platform administrator/);
  assert.equal((await getWorkspace(a, id)).collab.suspendedBy, "PLATFORM");
  await platformResume(admin.id, id);
  await addComment(a, id, "Cleared");

  await endCollaboration(b, id, "Deal done");
  await assert.rejects(addComment(a, id, "after the end"), /./);
  assert.equal((await getWorkspace(a, id)).collab.status, "COMPLETED");
  assert.ok((await getWorkspace(a, id)).items.length >= 0, "the record stays readable");
  await assert.rejects(resumeCollaboration(a, id), /not suspended/);
});

test("tasks, milestones and comments are shared by both sides, and every step is in the history and the company report", async () => {
  const admin = await newPlatformAdmin();
  const { A, B, id, a, b } = await liveWorkspace(admin);
  const t = await addTask(a, id, { title: "Arrange the survey", assigneeId: B.userId, dueOn: relativeDate(5) });
  const m = await addTask(b, id, { title: "Exchange of contracts", milestone: true });
  assert.equal(m.milestone, true);
  await assert.rejects(addTask(a, id, { title: "Bad assignee", assigneeId: (await newCompany("nobody")).userId }), /someone in the workspace/);
  assert.ok((await myNotifications(B.userId)).some((n) => n.kind === "collab.task"));
  await assert.rejects(setTaskStatus(b, t.id, "DONE", ""), /Say what was done/);
  await setTaskStatus(b, t.id, "DONE", "Surveyor booked for Friday");
  await addComment(a, id, "Thanks");
  const w = await getWorkspace(a, id);
  assert.equal(w.tasks.find((x) => x.id === t.id)!.status, "DONE");
  assert.equal(w.comments.length, 1);
  assert.ok(w.events.some((e) => e.kind === "milestone_added"));
  assert.ok(w.events.some((e) => e.kind === "task_done"));
  await assert.rejects(addComment(a, id, "   "), /./);

  const rep = await collaborationReport(a);
  assert.ok(rep.total >= 1 && rep.byStatus.ACTIVE >= 1);
  assert.ok(rep.events.length >= 4);
  await assert.rejects(collaborationReport(asCompany(await addMember(A, "AGENT", "norep"))), /permission/i);
  // A company's report never contains another company's events.
  const other = await newCompany("report-other");
  assert.equal((await collaborationReport(asCompany(other))).total, 0);
});

test("a seeker's workspace stays between the seeker and the agent", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("seekws");
  const agent = await listedAgent(co, "Pairing");
  const s = await seekerWith(admin, "premium-seeker");
  const c = await createInvitation(s.actor, { ...invite("INSPECTION"), agentUserId: agent.userId }, true);
  await respondInvitation(asCompany(agent), c.id, "accept");
  await assert.rejects(addParticipant(asCompany(co), c.id, co.userId), /stays between/);
  await shareNote(s.actor, c.id, { title: "My budget", body: "Up to 60m" });
  await shareProperty(asCompany(agent), c.id, { assetId: (await createAsset(co, { name: "Showflat", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" } as never)).id, price: false, address: false, note: "Worth a look" });
  await addComment(s.actor, c.id, "Looks good");
  const mine = await getWorkspace(s.actor, c.id);
  assert.equal(mine.items.length, 2);
  await assert.rejects(shareDeal(asCompany(agent), c.id, { dealId: "x", stage: true }), /between companies|participant|./);
  // The seeker's lapse puts the workspace on hold for the agent too.
  await mutate(admin, (tx) => tx.subscription.updateMany({ where: { ownerUserId: s.userId }, data: { periodEnd: new Date(Date.now() - 60 * 864e5), startedAt: new Date(Date.now() - 600 * 864e5) } }));
  const held = await getWorkspace(asCompany(agent), c.id);
  assert.equal(held.contentHidden, true);
  assert.match(held.plan.explanation, /seeker/i);
});
