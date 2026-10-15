/**
 * Phase 9 acceptance.
 *  1. Two companies can collaborate on an authorised deal without either gaining unrestricted access to the other's CRM.
 *  2. A seeker can invite an agent, and collaboration is available only when the applicable subscription rules permit it.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { addClientActivity, createClient, createLead } from "../../src/lib/services/crm";
import { createDeal, getDeal } from "../../src/lib/services/deal";
import { registerSeeker, saveAgentProfile, saveCompanyProfile, follow } from "../../src/lib/services/community";
import { assignSubscription, renewSubscription } from "../../src/lib/services/subscriptions";
import {
  addComment, addTask, asCompany, asPerson, createInvitation, getWorkspace, listCollaborations, respondInvitation, revokeItem, revokeParticipant, shareDeal, shareNote,
} from "../../src/lib/services/collab";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const plan = (code: string) => withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code } }));
const subscribe = async (admin: { id: string }, code: string, to: { companyId?: string; email?: string }) => assignSubscription(admin.id, { planId: (await plan(code)).id, periodEnd: relativeDate(60), ...to });

test("two companies collaborate on an authorised deal, and neither gains unrestricted access to the other's CRM", async () => {
  const admin = await newPlatformAdmin();
  const A = await newCompany("accA");
  const B = await newCompany("accB");
  for (const [co, label] of [[A, "A"], [B, "B"]] as const) {
    await saveCompanyProfile(co, { kind: "COMPANY", displayName: `Acceptance ${label} ${uid()}`, tagline: "Homes", listed: true });
    await subscribe(admin, "company-professional", { companyId: co.companyId });
  }
  const aAgent = await addMember(A, "AGENT", "a-owner");
  const aOther = await addMember(A, "AGENT", "a-other");
  const bAgent = await addMember(B, "AGENT", "b-agent");

  // Company A has a deal with a client, a lead, notes and a second deal that has nothing to do with the collaboration.
  const asset = await createAsset(A, { name: "Banana Island duplex", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER", address: "7 Hidden Crescent", city: "Lagos", state: "Lagos" } as never);
  const other = await createAsset(A, { name: "Unrelated block", assetClass: "RESIDENTIAL", category: "Block", companyRelationship: "OWNER" } as never);
  const client = await createClient(aAgent, { name: "Confidential Buyer Eze", phone: "08034445566", email: "eze@example.test" } as never);
  const lead = await createLead(aAgent, client.id, { title: "Wants a duplex", ownerId: aAgent.membershipId } as never);
  await addClientActivity(aAgent, client.id, { kind: "CALL", subject: "Budget", body: "Can stretch to 300m" } as never);
  const deal = await createDeal(aAgent, { clientId: client.id, leadId: lead.id, assetId: asset.id, type: "SALE", asking: "250,000,000" } as never);
  const secondClient = await createClient(aAgent, { name: "Another Client", phone: "08031112233" } as never);
  const second = await createDeal(aAgent, { clientId: secondClient.id, assetId: other.id, type: "SALE", asking: "90,000,000" } as never);

  // A invites B; B accepts and chooses its own person.
  const c = await createInvitation(asCompany(A), { kind: "COMPANY_COMPANY", purpose: "CO_BROKERAGE", title: "Co-broke the duplex", scope: "Find a buyer together", terms: "Fee split to be agreed in writing", companyId: B.companyId }, true);
  await respondInvitation(asCompany(B), c.id, "accept", "", [bAgent.userId]);

  // Only people in the workspace can put anything in it, and only the deal's owner (or a manager) can put a deal forward.
  await assert.rejects(shareDeal(asCompany(aAgent), c.id, { dealId: deal.id, stage: true }), /./, "an agent who is not in the workspace cannot share");
  await addParticipantFor(A, c.id, aOther);
  await addParticipantFor(A, c.id, aAgent);
  await assert.rejects(shareDeal(asCompany(aOther), c.id, { dealId: deal.id, stage: true }), /owner or a manager|not found/i, "an agent who does not own the deal cannot share it");
  const shared = await shareDeal(asCompany(aAgent), c.id, { dealId: deal.id, stage: true, asking: true, note: "Serious seller" });

  // B sees the summary and nothing else of A's.
  const view = await getWorkspace(asCompany(bAgent), c.id);
  const seen = JSON.stringify(view.items);
  assert.match(seen, /250,000,000/);
  for (const secret of ["Eze", "08034445566", "eze@example", "Hidden Crescent", "300m", "Another Client", "90,000,000", "Unrelated block", client.id, lead.id, deal.id, second.id, asset.id, other.id]) {
    assert.ok(!seen.includes(secret), `B must not see: ${secret}`);
  }
  assert.equal(view.items.length, 1);

  // B has no route into A's CRM: not through the services, and not through the database.
  assert.equal(await getDeal(B, deal.id), null);
  assert.equal(await getDeal(bAgent, deal.id), null);
  for (const table of ["deal", "client", "lead", "asset", "clientActivity", "dealEvent"] as const) {
    const count = await withTenant(B.companyId, bAgent.userId, (tx) => (tx[table] as unknown as { count: (a: object) => Promise<number> }).count({ where: { companyId: A.companyId } }));
    assert.equal(count, 0, `B reads none of A's ${table} rows`);
  }
  // The workspace itself is the only thing the two share, and it contains only what was put in it.
  assert.equal(await withTenant(B.companyId, bAgent.userId, (tx) => tx.collabItem.count()), 1);
  // B's own work in the workspace is B's to put in, and A sees it the same way.
  await addTask(asCompany(bAgent), c.id, { title: "Introduce a buyer", assigneeId: bAgent.userId });
  await addComment(asCompany(bAgent), c.id, "I have two interested buyers");
  assert.equal((await getWorkspace(asCompany(aAgent), c.id)).comments.length, 1);

  // A takes the deal back out: B can no longer read it. B's person leaves: B can no longer read anything.
  await revokeItem(asCompany(aAgent), shared.id, "Seller withdrew the instruction");
  assert.ok(!JSON.stringify((await getWorkspace(asCompany(bAgent), c.id)).items).includes("250,000,000"));
  await shareNote(asCompany(aAgent), c.id, { title: "Update", body: "Instruction reinstated" });
  const mine = (await getWorkspace(asCompany(B), c.id)).participants.find((p) => p.userId === bAgent.userId)!;
  await revokeParticipant(asCompany(B), mine.id, "Reassigned");
  await assert.rejects(getWorkspace(asCompany(bAgent), c.id), /not found/i);
  assert.deepEqual((await listCollaborations(asCompany(bAgent))).active, []);
  // And A's CRM was never changed by any of it.
  assert.equal((await getDeal(aAgent, deal.id))!.deal.stage, "ENQUIRY");
});

async function addParticipantFor(co: Awaited<ReturnType<typeof newCompany>>, id: string, who: Awaited<ReturnType<typeof addMember>>) {
  const { addParticipant } = await import("../../src/lib/services/collab");
  await addParticipant(asCompany(co), id, who.userId, {});
}

test("a seeker can invite an agent, and collaboration works only while the subscription rules permit it", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("accSeek");
  const agent = await addMember(co, "AGENT", "listed");
  await saveAgentProfile(agent, { displayName: `Accept Agent ${uid()}`, headline: "Lekki", listed: true, acceptsMessages: true });
  const email = `acc-seek-${uid()}@example.test`;
  const s = await registerSeeker({ name: "Accept Seeker", email, password: "integration-test-pw" });
  const me = asPerson(s.userId);

  // Following is free and works with no plan at all, and it gives no collaboration.
  await follow(s.userId, "AGENT", agent.userId);
  const draft = await createInvitation(me, { kind: "SEEKER_AGENT", purpose: "SEARCH_ASSISTANCE", title: "Find me a flat", agentUserId: agent.userId });
  const { sendInvitation } = await import("../../src/lib/services/collab");
  await assert.rejects(sendInvitation(me, draft.id), /not available on this plan/i);

  await subscribe(admin, "premium-seeker", { email });
  await sendInvitation(me, draft.id);
  await respondInvitation(asCompany(agent), draft.id, "accept");
  await shareNote(me, draft.id, { title: "My brief", body: "Two bedrooms, Lekki, up to 60m" });
  await addComment(asCompany(agent), draft.id, "Understood. I will send options.");

  // The plan runs out: full use for the grace period, then view-only, then closed; renewal restores it. The agent's own plan never mattered.
  const setEnd = (days: number) => withPlatformAdmin(admin.id, (tx) => tx.subscription.updateMany({ where: { ownerUserId: s.userId }, data: { periodEnd: new Date(Date.now() + days * 864e5), startedAt: new Date(Date.now() - 600 * 864e5) } }));
  await setEnd(-2);
  await addComment(me, draft.id, "Still in grace");
  await setEnd(-10);
  const readOnly = await getWorkspace(asCompany(agent), draft.id);
  assert.equal(readOnly.plan.access, "READ_ONLY");
  assert.equal(readOnly.contentHidden, false);
  await assert.rejects(addComment(asCompany(agent), draft.id, "Can I?"), /./);
  await assert.rejects(addComment(me, draft.id, "Can I?"), /./);
  await setEnd(-60);
  assert.equal((await getWorkspace(asCompany(agent), draft.id)).contentHidden, true);
  const sub = await withPlatformAdmin(admin.id, (tx) => tx.subscription.findFirstOrThrow({ where: { ownerUserId: s.userId } }));
  await renewSubscription(admin.id, sub.id, relativeDate(30), "Renewed");
  await addComment(asCompany(agent), draft.id, "Back to work");
  assert.equal((await getWorkspace(me, draft.id)).comments.length, 3);
});
