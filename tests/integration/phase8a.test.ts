/**
 * Phase 8a: clients, duplicates, lead sources and assignment, qualification, follow-ups, requirements and matching,
 * and who may see what, against a real PostgreSQL database through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createEnquiry, reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import {
  addBranch, addClientActivity, addRequirement, addTeam, archiveClient, assignLead, completeFollowUp, createClient, createLead, createLeadFromEnquiry, crmOverview, dismissDuplicate,
  getClient, listClients, listLeads, matchesFor, mergeClients, myFollowUps, pendingEnquiries, reassignClient, setLeadStatus, setMatchStatus, setMemberPlacement, setTeamLead,
  updateClient, updateQualification,
} from "../../src/lib/services/crm";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const manager = await addMember(admin, "MANAGER", "mgr");
  const agent1 = await addMember(admin, "AGENT", "ag1");
  const agent2 = await addMember(admin, "AGENT", "ag2");
  const officer = await addMember(admin, "OFFICER", "off");
  return { admin, manager, agent1, agent2, officer };
}

const person = (name: string, extra: Record<string, unknown> = {}) => ({ name, email: "", phone: "", ...extra }) as never;

test("duplicates are caught by email, phone and name, can be dismissed, and never leak other agents' clients", async () => {
  const e = await setup("dup");
  const a = await createClient(e.agent1, person("Ngozi Adeyemi", { email: "Ngozi.A@Example.test", phone: "0803 111 2222", city: "Lagos" }));
  await assert.rejects(createClient(e.agent1, person("Someone Else", { email: " ngozi.a@example.test " })), /already on record.*same email/s);
  await assert.rejects(createClient(e.agent1, person("Ngozi Adeyemi", { phone: "+234 803 111 2222" })), /same phone/);
  // Another agent is told a duplicate exists, but not whose or what it is.
  const err = await createClient(e.agent2, person("Another Name", { phone: "08031112222" })).catch((x: Error) => x.message);
  assert.match(String(err), /held by someone else/);
  assert.doesNotMatch(String(err), /Ngozi/);
  // Agreed different person: allowed.
  const b = await createClient(e.agent1, person("Ngozi Adeyemi", { city: "Lagos", notDuplicate: true }));
  assert.notEqual(a.id, b.id);
  await assert.rejects(createClient(e.agent1, person("Single")), /full name/);
  await assert.rejects(createClient(e.officer, person("Not Allowed")), /permission/i);
  // Dismissed pairs stop being flagged.
  const before = (await getClient(e.agent1, a.id))!.duplicates.map((d) => d.id);
  assert.ok(before.includes(b.id));
  await dismissDuplicate(e.agent1, a.id, b.id);
  assert.ok(!(await getClient(e.agent1, a.id))!.duplicates.some((d) => d.id === b.id));
});

test("an agent sees only their own clients, a team lead sees the team, confidential clients stay private", async () => {
  const e = await setup("scope");
  const own = await createClient(e.agent1, person("Folake Bankole", { phone: "08051110001" }));
  const other = await createClient(e.agent2, person("Tunde Bakare", { phone: "08051110002" }));
  const secret = await createClient(e.agent2, person("Kemi Ogunleye", { phone: "08051110003", confidential: true }));
  assert.deepEqual((await listClients(e.agent1)).rows.map((r) => r.id), [own.id]);
  assert.equal(await getClient(e.agent1, other.id), null);
  await assert.rejects(updateClient(e.agent1, other.id, person("Tunde Bakare", { phone: "08051110002" })), /not found/i);
  assert.equal((await listClients(e.manager)).rows.length, 3);
  assert.equal((await listClients(e.admin)).rows.length, 3);
  assert.equal(await getClient(e.officer, own.id).catch(() => "denied"), "denied");

  // Team lead sees team members' clients but not a confidential one.
  const team = await addTeam(e.admin, { name: "Lekki sales", leadId: e.agent1.membershipId });
  await setMemberPlacement(e.admin, e.agent2.membershipId, null, team.id);
  const ids = (await listClients(e.agent1)).rows.map((r) => r.id).sort();
  assert.deepEqual(ids, [own.id, other.id].sort());
  assert.equal(await getClient(e.agent1, secret.id), null);
  assert.ok(await getClient(e.manager, secret.id));
  // Other companies see nothing.
  const outsider = await newCompany("scope-out");
  assert.equal((await listClients(outsider)).rows.length, 0);
  await assert.rejects(addTeam(e.agent1, { name: "Nope" }), /permission/i);
  await assert.rejects(addBranch(e.manager, { name: "Main", code: "MN" }), /permission/i);
  await setTeamLead(e.admin, team.id, null);
  assert.equal((await listClients(e.agent1)).rows.length, 1);
});

test("leads are qualified with evidence, move only along allowed steps, and lost leads need a reason", async () => {
  const e = await setup("lead");
  const c = await createClient(e.agent1, person("Ibrahim Musa", { phone: "08061110001" }));
  const lead = await createLead(e.agent1, c.id, { title: "Flat in Yaba" } as never);
  assert.equal(lead.status, "NEW");
  assert.equal(lead.ownerId, e.agent1.membershipId);
  await assert.rejects(setLeadStatus(e.agent1, lead.id, "QUALIFIED"), /budget/i);
  await assert.rejects(setLeadStatus(e.agent1, lead.id, "CONVERTED"), /transaction/i);
  await updateQualification(e.agent1, lead.id, { title: "Flat in Yaba", budgetMax: "30,000,000" } as never);
  await assert.rejects(setLeadStatus(e.agent1, lead.id, "QUALIFIED"), /when the client wants to move/);
  await updateQualification(e.agent1, lead.id, { title: "Flat in Yaba", budgetMax: "30,000,000", timeline: "IMMEDIATE", financing: "CASH", decisionMaker: true } as never);
  await setLeadStatus(e.agent1, lead.id, "QUALIFIED");
  const q = (await listLeads(e.agent1)).leads[0];
  assert.equal(q.status, "QUALIFIED");
  assert.equal(q.score, 100);
  assert.ok(q.qualifiedAt && q.qualifiedById === e.agent1.userId);
  await assert.rejects(setLeadStatus(e.agent2, lead.id, "LOST", "x"), /not found/i);
  await assert.rejects(setLeadStatus(e.agent1, lead.id, "LOST", ""), /why/i);
  await setLeadStatus(e.agent1, lead.id, "LOST", "Bought elsewhere");
  await assert.rejects(setLeadStatus(e.agent1, lead.id, "QUALIFIED"), /allowed|cannot|move/i);
  await setLeadStatus(e.agent1, lead.id, "CONTACTED");
  const row = (await listLeads(e.agent1)).leads[0];
  assert.equal(row.lostReason, "");
  assert.equal(row.qualifiedAt, null);
});

test("new leads go to the agent with the fewest open leads, and only managers can reassign, with a reason", async () => {
  const e = await setup("assign");
  const mk = async (n: string, owner?: string) => {
    const c = await createClient(e.manager, person(`Client ${n} Surname`, { phone: `0807000${n.padStart(4, "0")}` }));
    return createLead(e.manager, c.id, { title: `Interest ${n}`, ownerId: owner } as never);
  };
  const l1 = await mk("1"); const l2 = await mk("2"); const l3 = await mk("3");
  const owners = [l1, l2, l3].map((l) => l.ownerId);
  assert.equal(owners[0], e.agent1.membershipId);
  assert.equal(owners[1], e.agent2.membershipId);
  assert.equal(owners[2], e.agent1.membershipId);
  assert.notEqual(l1.assignedAt, null);
  const c = await createClient(e.agent1, person("Own Lead Person", { phone: "08070009999" }));
  await assert.rejects(createLead(e.agent1, c.id, { title: "Mine", ownerId: e.agent2.membershipId } as never), /manager/i);
  await assert.rejects(assignLead(e.agent1, l1.id, e.agent2.membershipId, "Busy"), /permission/i);
  await assert.rejects(assignLead(e.manager, l1.id, e.agent2.membershipId, ""), /reason/i);
  await assert.rejects(assignLead(e.manager, l1.id, e.officer.membershipId, "Test"), /active agent/i);
  await assignLead(e.manager, l1.id, e.agent2.membershipId, "Agent 1 is on leave");
  assert.equal((await listLeads(e.agent2)).leads.filter((l) => l.id === l1.id).length, 1);
  assert.equal((await listLeads(e.agent1)).leads.filter((l) => l.id === l1.id).length, 0);
  // Reassigning a client moves the open leads with it and leaves a note.
  await reassignClient(e.manager, l3.clientId, e.agent2.membershipId, "Territory change");
  const d = await getClient(e.agent2, l3.clientId);
  assert.equal(d?.leads[0].ownerId, e.agent2.membershipId);
  assert.ok(d?.activities.some((a) => a.subject === "Client reassigned" && a.body === "Territory change"));
  const ov = await crmOverview(e.agent2);
  assert.ok(ov.newLeads >= 2);
});

test("an enquiry becomes one lead, reusing a client who already exists", async () => {
  const e = await setup("enq");
  const platform = await newPlatformAdmin();
  const asset = await createAsset(e.admin, { name: "Enquiry house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  await saveListingDraft(e.admin, asset.id, { title: "Enquiry house in Ikeja", purpose: "SALE", price: "50,000,000", bedrooms: "3", city: "Ikeja", state: "Lagos" } as never);
  await setListingStatus(e.admin, asset.id, "PENDING_REVIEW");
  const l = await withTenant(e.admin.companyId, e.admin.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(platform.id, l.id, "approve", "ok");
  await createEnquiry(l.publicRef, { name: "Seyi Coker", contact: "seyi@example.test", message: "Is it still available?" } as never, "k1");
  await createEnquiry(l.publicRef, { name: "Seyi Coker", contact: "seyi@example.test", message: "Also, can I view Saturday?" } as never, "k2");
  const pending = await pendingEnquiries(e.agent1);
  assert.equal(pending.length, 2);
  await assert.rejects(createLeadFromEnquiry(e.officer, pending[0].id), /permission/i);
  const first = await createLeadFromEnquiry(e.agent1, pending[0].id);
  assert.equal(first.lead.listingId, l.id);
  await assert.rejects(createLeadFromEnquiry(e.agent1, pending[0].id), /already been made/);
  const second = await createLeadFromEnquiry(e.agent1, pending[1].id);
  assert.equal(second.client.id, first.client.id);
  assert.equal((await pendingEnquiries(e.agent1)).length, 0);
  // Another agent cannot take over a client someone else holds.
  await createEnquiry(l.publicRef, { name: "Seyi Coker", contact: "SEYI@example.test", message: "Hello again" } as never, "k3");
  const third = (await pendingEnquiries(e.agent2))[0];
  await assert.rejects(createLeadFromEnquiry(e.agent2, third.id), /held by someone else/);
  assert.ok(first.client.marketingConsent === false);
});

test("follow-ups must be dated in the future, appear for the assignee, and complete once", async () => {
  const e = await setup("fu");
  const c = await createClient(e.agent1, person("Bola Tinubu-Smith", { phone: "08090001111" }));
  await assert.rejects(addClientActivity(e.agent1, c.id, { kind: "FOLLOW_UP", subject: "Call back" }), /due/i);
  await assert.rejects(addClientActivity(e.agent1, c.id, { kind: "FOLLOW_UP", subject: "Call back", dueOn: relativeDate(-1) }), /past/i);
  await assert.rejects(addClientActivity(e.agent1, c.id, { kind: "FOLLOW_UP", subject: "Call back", dueOn: relativeDate(1), assigneeId: e.agent2.membershipId }), /owner or a manager/);
  const f = await addClientActivity(e.agent1, c.id, { kind: "FOLLOW_UP", subject: "Call back", dueOn: relativeDate(2) });
  assert.equal((await myFollowUps(e.agent1, 7)).length, 1);
  assert.equal((await myFollowUps(e.agent1, 1)).length, 0);
  assert.equal((await myFollowUps(e.agent2, 7)).length, 0);
  await assert.rejects(completeFollowUp(e.agent2, f.id, "done"), /not found/i);
  await completeFollowUp(e.agent1, f.id, "Spoke, wants a viewing");
  await assert.rejects(completeFollowUp(e.agent1, f.id, "again"), /already done/);
  assert.equal((await myFollowUps(e.agent1, 7)).length, 0);
  // A call on a new lead moves it to contacted.
  const lead = await createLead(e.agent1, c.id, { title: "Shop space" } as never);
  await addClientActivity(e.agent1, c.id, { kind: "CALL", subject: "Intro", leadId: lead.id });
  assert.equal((await listLeads(e.agent1)).leads[0].status, "CONTACTED");
});

test("requirements match published listings by purpose, budget, place and size, and the workflow status is kept", async () => {
  const e = await setup("match");
  const platform = await newPlatformAdmin();
  const mk = async (name: string, price: string, beds: string, city: string, purpose = "SALE") => {
    const asset = await createAsset(e.admin, { name, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
    await saveListingDraft(e.admin, asset.id, { title: `${name} listing`, purpose, price, bedrooms: beds, city, state: "Lagos" } as never);
    await setListingStatus(e.admin, asset.id, "PENDING_REVIEW");
    const l = await withTenant(e.admin.companyId, e.admin.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
    await reviewListing(platform.id, l.id, "approve", "ok");
    return l;
  };
  const fits = await mk("Lekki Four", "90,000,000", "4", "Lekki");
  await mk("Lekki Too Dear", "400,000,000", "4", "Lekki");
  await mk("Lekki Small", "60,000,000", "1", "Lekki");
  await mk("Lekki Rental", "5,000,000", "4", "Lekki", "RENT");
  const draftOnly = await createAsset(e.admin, { name: "Unpublished", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  await saveListingDraft(e.admin, draftOnly.id, { title: "Unpublished listing", purpose: "SALE", price: "50,000,000", bedrooms: "4", city: "Lekki", state: "Lagos" } as never);
  const c = await createClient(e.agent1, person("Match Client", { phone: "08090002222" }));
  await assert.rejects(addRequirement(e.agent1, c.id, { purpose: "SALE", city: "Lekki", state: "Lagos", budgetMax: "0" } as never), /more than zero/);
  await assert.rejects(addRequirement(e.agent1, c.id, { purpose: "SALE", budgetMax: "100,000,000" } as never), /city or state/);
  await assert.rejects(addRequirement(e.agent1, c.id, { purpose: "SALE", city: "Lekki", budgetMin: "200,000,000", budgetMax: "100,000,000" } as never), /lowest/);
  const r = await addRequirement(e.agent1, c.id, { purpose: "SALE", city: "Lekki", state: "Lagos", bedroomsMin: "3", budgetMax: "100,000,000" } as never);
  const m = await matchesFor(e.agent1, r.id);
  assert.deepEqual(m.map((x) => x.listing.id), [fits.id]);
  assert.ok(m[0].score >= 70);
  await assert.rejects(matchesFor(e.agent2, r.id), /not found/i);
  await setMatchStatus(e.agent1, r.id, fits.id, "SENT", "Sent by WhatsApp");
  assert.equal((await matchesFor(e.agent1, r.id))[0].match?.status, "SENT");
  await assert.rejects(setMatchStatus(e.agent2, r.id, fits.id, "INTERESTED"), /not found/i);
});

test("clients merge into one record, archived clients cannot take new work, and nothing leaks across companies", async () => {
  const e = await setup("merge");
  const keep = await createClient(e.agent1, person("Hauwa Sani", { phone: "08090003333" }));
  const dupe = await createClient(e.agent1, person("Hauwa Sani", { email: "hauwa@example.test", notDuplicate: true }));
  await createLead(e.agent1, dupe.id, { title: "Duplex" } as never);
  await assert.rejects(mergeClients(e.agent1, keep.id, dupe.id), /permission/i);
  await assert.rejects(mergeClients(e.manager, keep.id, keep.id), /different/);
  await mergeClients(e.manager, keep.id, dupe.id);
  const d = (await getClient(e.agent1, keep.id))!;
  assert.equal(d.leads.length, 1);
  assert.equal(d.client.email, "hauwa@example.test");
  assert.ok(d.activities.some((a) => a.subject.startsWith("Merged ")));
  const gone = await withTenant(e.admin.companyId, e.admin.userId, (tx) => tx.client.findFirstOrThrow({ where: { id: dupe.id } }));
  assert.equal(gone.mergedIntoId, keep.id);
  assert.ok(gone.archivedAt);
  await assert.rejects(archiveClient(e.agent1, keep.id), /open leads/);
  await assert.rejects(createLead(e.agent1, dupe.id, { title: "More" } as never), /archived/);
  await assert.rejects(archiveClient(e.agent1, dupe.id, true), /merged/);
  const other = await newCompany("merge-out");
  assert.equal(await getClient(other, keep.id), null);
  await assert.rejects(mergeClients(other, keep.id, dupe.id), /not found|permission/i);
});
