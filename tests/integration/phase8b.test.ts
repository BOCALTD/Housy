/**
 * Phase 8b: deals from lead to completion, viewings with clash detection, offers and counteroffers, second-person approval of
 * acceptance and completion, cancellation, disputes, reassignment and who may see what, against a real PostgreSQL database.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createClient, createLead, getClient, listLeads, setLeadStatus, updateQualification } from "../../src/lib/services/crm";
import {
  cancelDeal, cancelViewing, completeDeal, counterOffer, createDeal, decideAcceptance, getDeal, listDeals, moveStage, raiseDispute, reassignDeal, recordOffer, recordViewingOutcome,
  rejectOffer, reopenNegotiation, requestAcceptance, rescheduleViewing, resolveDispute, scheduleViewing, setHold, withdrawAcceptanceRequest, withdrawOffer,
} from "../../src/lib/services/deal";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const manager = await addMember(admin, "MANAGER", "mgr");
  const agent1 = await addMember(admin, "AGENT", "ag1");
  const agent2 = await addMember(admin, "AGENT", "ag2");
  const officer = await addMember(admin, "OFFICER", "off");
  const asset = await createAsset(admin, { name: `${label} house`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  return { admin, manager, agent1, agent2, officer, asset };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function qualifiedLead(e: Env, who = e.agent1, name = "Femi Adewale", phone = "08031230001") {
  const c = await createClient(who, { name, phone } as never);
  const lead = await createLead(who, c.id, { title: "House purchase", ownerId: who.membershipId } as never);
  await updateQualification(who, lead.id, { title: "House purchase", budgetMax: "200,000,000", timeline: "IMMEDIATE", financing: "CASH", decisionMaker: true } as never);
  await setLeadStatus(who, lead.id, "QUALIFIED");
  return { client: c, lead };
}

async function openDeal(e: Env, who = e.agent1, asking = "100,000,000") {
  const { client, lead } = await qualifiedLead(e, who, `Buyer ${Math.random().toString(36).slice(2, 7)} Person`, `0803${Math.floor(1e7 + Math.random() * 9e7)}`);
  const deal = await createDeal(who, { clientId: client.id, leadId: lead.id, assetId: e.asset.id, type: "SALE", asking } as never);
  return { client, lead, deal };
}

test("a deal opens from a qualified lead, converts it, and is seen only by those who may see it", async () => {
  const e = await setup("open");
  const c = await createClient(e.agent1, { name: "Unready Client", phone: "08031230099" } as never);
  const raw = await createLead(e.agent1, c.id, { title: "Not ready" } as never);
  await assert.rejects(createDeal(e.agent1, { clientId: c.id, leadId: raw.id, assetId: e.asset.id, type: "SALE", asking: "10,000,000" } as never), /Qualify the lead first/);
  await assert.rejects(createDeal(e.officer, { clientId: c.id, assetId: e.asset.id, type: "SALE", asking: "10" } as never), /permission/i);

  const { client, lead } = await qualifiedLead(e);
  await assert.rejects(createDeal(e.agent1, { clientId: client.id, leadId: lead.id, assetId: e.asset.id, asking: "10,000,000" } as never), /sale, a rent or a lease/);
  await assert.rejects(createDeal(e.agent1, { clientId: client.id, leadId: lead.id, assetId: e.asset.id, type: "SALE" } as never), /asking price/);
  await assert.rejects(createDeal(e.agent2, { clientId: client.id, leadId: lead.id, assetId: e.asset.id, type: "SALE", asking: "10" } as never), /not found/i);
  const deal = await createDeal(e.agent1, { clientId: client.id, leadId: lead.id, assetId: e.asset.id, type: "SALE", asking: "100,000,000" } as never);
  assert.match(deal.ref, /^DL-\d{4}-0001$/);
  assert.equal(deal.ownerId, e.agent1.membershipId);
  assert.equal(deal.stage, "ENQUIRY");
  assert.equal((await listLeads(e.agent1)).leads.find((l) => l.id === lead.id)?.status, "CONVERTED");
  await assert.rejects(setLeadStatus(e.agent1, lead.id, "LOST", "changed mind"), /cannot move/);
  await assert.rejects(createDeal(e.agent1, { clientId: client.id, assetId: e.asset.id, type: "SALE", asking: "10,000,000" } as never), /already open/);

  assert.equal((await listDeals(e.agent1)).deals.length, 1);
  assert.equal((await listDeals(e.agent2)).deals.length, 0);
  assert.equal(await getDeal(e.agent2, deal.id), null);
  assert.equal((await listDeals(e.manager)).deals.length, 1);
  assert.equal((await getClient(e.agent1, client.id))?.deals.length, 1);
  const outsider = await newCompany("open-out");
  assert.equal(await getDeal(outsider, deal.id), null);
  assert.equal((await listDeals(outsider)).deals.length, 0);
  const events = (await getDeal(e.agent1, deal.id))!.events;
  assert.equal(events[0].kind, "OPENED");
});

test("stages move in order, going back needs a reason, and agreed and completed have their own steps", async () => {
  const e = await setup("stage");
  const { deal } = await openDeal(e);
  await assert.rejects(moveStage(e.agent1, deal.id, "OFFER"), /one stage/);
  await moveStage(e.agent1, deal.id, "VIEWING");
  await moveStage(e.agent1, deal.id, "OFFER");
  await assert.rejects(moveStage(e.agent1, deal.id, "VIEWING"), /why/);
  await moveStage(e.agent1, deal.id, "VIEWING", "Client wants another look");
  await moveStage(e.agent1, deal.id, "OFFER");
  await moveStage(e.agent1, deal.id, "NEGOTIATION");
  await assert.rejects(moveStage(e.agent1, deal.id, "AGREED"), /accepted and approved/);
  await assert.rejects(moveStage(e.agent1, deal.id, "COMPLETED"), /second person/);
  await assert.rejects(moveStage(e.agent2, deal.id, "OFFER", "x"), /not found/i);
  const g = (await getDeal(e.agent1, deal.id))!;
  assert.deepEqual(g.events.filter((x) => x.kind === "STAGE").map((x) => x.toStage).reverse(), ["VIEWING", "OFFER", "VIEWING", "OFFER", "NEGOTIATION"]);
  // On hold: frozen until resumed.
  await assert.rejects(setHold(e.agent1, deal.id, true, ""), /why/);
  await setHold(e.agent1, deal.id, true, "Client travelling");
  await assert.rejects(moveStage(e.agent1, deal.id, "OFFER", "back"), /on hold/);
  await setHold(e.agent1, deal.id, false, "");
  await assert.rejects(setHold(e.agent1, deal.id, false, ""), /not on hold/);
  await moveStage(e.agent1, deal.id, "OFFER", "Back to offer");
});

test("viewings reject clashes for the agent and the property, can be moved, cancelled, and not recorded before they happen", async () => {
  const e = await setup("view");
  const a = await openDeal(e, e.agent1);
  const day = relativeDate(5);
  await assert.rejects(scheduleViewing(e.agent1, a.deal.id, { date: relativeDate(-1), time: "10:00", minutes: "30" } as never), /past/);
  await assert.rejects(scheduleViewing(e.agent1, a.deal.id, { date: day, time: "10:00", minutes: "5" } as never), /10 minutes/);
  const v1 = await scheduleViewing(e.agent1, a.deal.id, { date: day, time: "10:00", minutes: "60", meetingPoint: "Gate" } as never);
  assert.equal(v1.startsAt.toISOString().slice(11, 16), "09:00");
  assert.equal((await getDeal(e.agent1, a.deal.id))!.deal.stage, "VIEWING");
  await assert.rejects(scheduleViewing(e.agent1, a.deal.id, { date: day, time: "10:30", minutes: "30" } as never), /already has a viewing/);
  // A second client's deal on the same property cannot be viewed at the same time by another agent either.
  const b = await createClient(e.agent2, { name: "Second Buyer", phone: "08031230002" } as never);
  const deal2 = await createDeal(e.agent2, { clientId: b.id, assetId: e.asset.id, type: "SALE", asking: "100,000,000" } as never);
  await assert.rejects(scheduleViewing(e.agent2, deal2.id, { date: day, time: "10:15", minutes: "30" } as never), /property is already booked/);
  const v2 = await scheduleViewing(e.agent2, deal2.id, { date: day, time: "11:00", minutes: "30" } as never);
  await assert.rejects(rescheduleViewing(e.agent2, v2.id, { date: day, time: "10:30", minutes: "45" } as never), /property is already booked/);
  await rescheduleViewing(e.agent2, v2.id, { date: day, time: "12:00", minutes: "30" } as never);
  await assert.rejects(recordViewingOutcome(e.agent1, v1.id, "COMPLETED", "Went well"), /not happened yet/);
  await assert.rejects(cancelViewing(e.agent2, v1.id, "Not mine"), /not found/i);
  await assert.rejects(cancelViewing(e.agent1, v1.id, ""), /why/);
  await cancelViewing(e.agent1, v1.id, "Client unwell");
  await assert.rejects(rescheduleViewing(e.agent1, v1.id, { date: day, time: "13:00", minutes: "30" } as never), /scheduled/);
  // The freed slot can be booked again.
  await scheduleViewing(e.agent2, deal2.id, { date: day, time: "10:00", minutes: "30" } as never);
  const g = (await getDeal(e.agent2, deal2.id))!;
  assert.equal(g.viewings.find((v) => v.id === v2.id)?.rescheduledCount, 1);
});

test("offers and counteroffers keep the negotiation history, and a price is agreed only when a second person approves", async () => {
  const e = await setup("offer");
  const { deal } = await openDeal(e);
  await assert.rejects(recordOffer(e.agent1, deal.id, { side: "CLIENT", amount: "0" } as never), /more than zero/);
  const o1 = await recordOffer(e.agent1, deal.id, { side: "CLIENT", amount: "85,000,000", note: "Opening" } as never);
  assert.equal((await getDeal(e.agent1, deal.id))!.deal.stage, "OFFER");
  await assert.rejects(recordOffer(e.agent1, deal.id, { side: "CLIENT", amount: "86,000,000" } as never), /live offer/);
  const o2 = await counterOffer(e.agent1, o1.id, { amount: "98,000,000" } as never);
  assert.equal(o2.side, "OWNER");
  assert.equal(o2.parentId, o1.id);
  await assert.rejects(counterOffer(e.agent1, o1.id, { amount: "90,000,000" } as never), /open offer/);
  const o3 = await counterOffer(e.agent1, o2.id, { amount: "92,000,000", conditions: "Closing within 30 days" } as never);
  assert.equal((await getDeal(e.agent1, deal.id))!.deal.stage, "NEGOTIATION");
  const g = (await getDeal(e.agent1, deal.id))!;
  assert.deepEqual(g.offers.map((x) => x.status), ["COUNTERED", "COUNTERED", "OPEN"]);

  await assert.rejects(decideAcceptance(e.manager, o3.id, "approve"), /no acceptance waiting/);
  await requestAcceptance(e.agent1, o3.id);
  await assert.rejects(decideAcceptance(e.agent1, o3.id, "approve"), /permission/i);
  await assert.rejects(recordOffer(e.agent1, deal.id, { side: "OWNER", amount: "95,000,000" } as never), /live offer/);
  await assert.rejects(decideAcceptance(e.manager, o3.id, "reject"), /why/);
  await decideAcceptance(e.manager, o3.id, "reject", "Check the survey first");
  assert.equal((await getDeal(e.agent1, deal.id))!.offers[2].status, "OPEN");
  await requestAcceptance(e.agent1, o3.id);
  await withdrawAcceptanceRequest(e.agent1, o3.id);
  await requestAcceptance(e.agent1, o3.id);
  await decideAcceptance(e.manager, o3.id, "approve", "Price confirmed");
  const done = (await getDeal(e.agent1, deal.id))!;
  assert.equal(done.deal.stage, "AGREED");
  assert.equal(done.deal.agreedKobo, 9_200_000_000n);
  assert.equal(done.offers[2].status, "ACCEPTED");
  assert.equal(done.offers[2].decidedById, e.manager.userId);
  await assert.rejects(recordOffer(e.agent1, deal.id, { side: "CLIENT", amount: "90,000,000" } as never), /already agreed/);
  await assert.rejects(rejectOffer(e.agent1, o3.id, "late"), /open offer/);

  // A manager who asks cannot also approve; another manager can.
  const { deal: d2 } = await openDeal({ ...e, asset: await createAsset(e.admin, { name: "Other house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" }) } as Env, e.manager);
  const p = await recordOffer(e.manager, d2.id, { side: "CLIENT", amount: "50,000,000" } as never);
  await requestAcceptance(e.manager, p.id);
  await assert.rejects(decideAcceptance(e.manager, p.id, "approve"), /Someone other/);
  await decideAcceptance(e.admin, p.id, "approve", "Fine");
  assert.equal((await getDeal(e.manager, d2.id))!.deal.stage, "AGREED");
});

test("an expired offer cannot be accepted, rejected and withdrawn offers need no approval, and a second deal cannot agree a sold property", async () => {
  const e = await setup("rival");
  const first = await openDeal(e, e.agent1);
  const second = await openDeal(e, e.agent2);
  await assert.rejects(recordOffer(e.agent1, first.deal.id, { side: "CLIENT", amount: "90,000,000", validUntil: relativeDate(-1) } as never), /past/);
  const lo = await recordOffer(e.agent1, first.deal.id, { side: "CLIENT", amount: "60,000,000" } as never);
  await assert.rejects(rejectOffer(e.agent1, lo.id, ""), /why/);
  await rejectOffer(e.agent1, lo.id, "Far too low");
  const wo = await recordOffer(e.agent1, first.deal.id, { side: "CLIENT", amount: "70,000,000" } as never);
  await withdrawOffer(e.agent1, wo.id, "Client changed mind");
  const ok = await recordOffer(e.agent1, first.deal.id, { side: "CLIENT", amount: "95,000,000" } as never);
  await requestAcceptance(e.agent1, ok.id);
  const other = await recordOffer(e.agent2, second.deal.id, { side: "CLIENT", amount: "96,000,000" } as never);
  await requestAcceptance(e.agent2, other.id);
  await decideAcceptance(e.manager, ok.id, "approve", "Agreed");
  await assert.rejects(decideAcceptance(e.manager, other.id, "approve", "Also"), /already agreed this property/);
  // If the first agreement falls through, the second can proceed.
  await assert.rejects(reopenNegotiation(e.agent1, first.deal.id, "x"), /permission/i);
  await reopenNegotiation(e.manager, first.deal.id, "Buyer's finance failed");
  const re = (await getDeal(e.agent1, first.deal.id))!;
  assert.equal(re.deal.stage, "NEGOTIATION");
  assert.equal(re.deal.agreedKobo, null);
  assert.equal(re.offers.find((o) => o.id === ok.id)?.status, "WITHDRAWN");
  await decideAcceptance(e.manager, other.id, "approve", "Now free");
  assert.equal((await getDeal(e.agent2, second.deal.id))!.deal.stage, "AGREED");
});

test("completion needs the legal stage and a manager who is not the owner; completed deals are final", async () => {
  const e = await setup("done");
  const { deal } = await openDeal(e, e.agent1);
  const o = await recordOffer(e.agent1, deal.id, { side: "CLIENT", amount: "100,000,000" } as never);
  await requestAcceptance(e.agent1, o.id);
  await assert.rejects(completeDeal(e.manager, deal.id), /legal stage/);
  await decideAcceptance(e.manager, o.id, "approve", "");
  await assert.rejects(completeDeal(e.manager, deal.id), /legal stage/);
  await moveStage(e.agent1, deal.id, "LEGAL");
  await assert.rejects(completeDeal(e.agent1, deal.id), /permission/i);
  await completeDeal(e.manager, deal.id, "Keys and title passed");
  const g = (await getDeal(e.agent1, deal.id))!;
  assert.equal(g.deal.status, "COMPLETED");
  assert.equal(g.deal.stage, "COMPLETED");
  assert.equal(g.deal.completedById, e.manager.userId);
  await assert.rejects(cancelDeal(e.manager, deal.id, "Changed"), /completed/);
  await assert.rejects(moveStage(e.agent1, deal.id, "OFFER", "back"), /completed/);
  await assert.rejects(reassignDeal(e.manager, deal.id, e.agent2.membershipId, "Handover"), /closed/);

  // A manager who owns the deal cannot complete it herself.
  const mine = await openDeal({ ...e, asset: await createAsset(e.admin, { name: "Managed house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" }) } as Env, e.manager);
  const mo = await recordOffer(e.manager, mine.deal.id, { side: "CLIENT", amount: "40,000,000" } as never);
  await requestAcceptance(e.manager, mo.id);
  await decideAcceptance(e.admin, mo.id, "approve", "");
  await moveStage(e.manager, mine.deal.id, "LEGAL");
  await assert.rejects(completeDeal(e.manager, mine.deal.id), /other than the deal's owner/);
  await completeDeal(e.admin, mine.deal.id);
});

test("cancelled deals close their viewings and offers, and agreed deals can be cancelled only by a manager", async () => {
  const e = await setup("cancel");
  const { deal } = await openDeal(e, e.agent1);
  await scheduleViewing(e.agent1, deal.id, { date: relativeDate(4), time: "09:00", minutes: "30" } as never);
  const o = await recordOffer(e.agent1, deal.id, { side: "CLIENT", amount: "80,000,000" } as never);
  await assert.rejects(cancelDeal(e.agent1, deal.id, ""), /why/);
  await assert.rejects(cancelDeal(e.agent2, deal.id, "Mine now"), /not found/i);
  await cancelDeal(e.agent1, deal.id, "Client bought elsewhere");
  const g = (await getDeal(e.agent1, deal.id))!;
  assert.equal(g.deal.status, "CANCELLED");
  assert.equal(g.deal.cancelReason, "Client bought elsewhere");
  assert.ok(g.viewings.every((v) => v.status === "CANCELLED"));
  assert.equal(g.offers.find((x) => x.id === o.id)?.status, "WITHDRAWN");
  await assert.rejects(cancelDeal(e.agent1, deal.id, "again"), /already cancelled/);
  await assert.rejects(scheduleViewing(e.agent1, deal.id, { date: relativeDate(6), time: "09:00", minutes: "30" } as never), /cancelled/);
  // The property is free again for a new deal.
  const next = await openDeal(e, e.agent1);
  const ao = await recordOffer(e.agent1, next.deal.id, { side: "CLIENT", amount: "100,000,000" } as never);
  await requestAcceptance(e.agent1, ao.id);
  await decideAcceptance(e.manager, ao.id, "approve", "");
  await assert.rejects(cancelDeal(e.agent1, next.deal.id, "Second thoughts"), /only a manager/);
  await cancelDeal(e.manager, next.deal.id, "Buyer withdrew after agreeing");
});

test("a dispute freezes the deal until someone else settles it, and reassignment keeps history and changes who can see it", async () => {
  const e = await setup("dispute");
  const { deal } = await openDeal(e, e.agent1);
  await assert.rejects(raiseDispute(e.agent1, deal.id, ""), /about/);
  await raiseDispute(e.agent1, deal.id, "Owner disputes the survey figures");
  await assert.rejects(moveStage(e.agent1, deal.id, "VIEWING"), /disputed/);
  await assert.rejects(recordOffer(e.agent1, deal.id, { side: "CLIENT", amount: "1,000,000" } as never), /disputed/);
  await assert.rejects(resolveDispute(e.agent1, deal.id, "Settled", "resume"), /permission/i);
  await assert.rejects(resolveDispute(e.manager, deal.id, "", "resume"), /how the dispute/i);
  await resolveDispute(e.manager, deal.id, "Survey re-measured and agreed", "resume");
  assert.equal((await getDeal(e.agent1, deal.id))!.deal.status, "OPEN");
  // Raised by a manager: the same manager cannot settle it.
  const mine = await openDeal({ ...e, asset: await createAsset(e.admin, { name: "Disputed house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" }) } as Env, e.manager);
  await raiseDispute(e.manager, mine.deal.id, "Title query");
  await assert.rejects(resolveDispute(e.manager, mine.deal.id, "Fine now", "resume"), /Someone other/);
  await resolveDispute(e.admin, mine.deal.id, "Title is clean, but the buyer left", "cancel");
  assert.equal((await getDeal(e.manager, mine.deal.id))!.deal.status, "CANCELLED");

  // Reassignment.
  await assert.rejects(reassignDeal(e.agent1, deal.id, e.agent2.membershipId, "Busy"), /permission/i);
  await assert.rejects(reassignDeal(e.manager, deal.id, e.agent2.membershipId, ""), /reason/i);
  await assert.rejects(reassignDeal(e.manager, deal.id, e.officer.membershipId, "Test"), /active agent/i);
  await assert.rejects(reassignDeal(e.manager, deal.id, e.agent1.membershipId, "Same"), /already owns/);
  await reassignDeal(e.manager, deal.id, e.agent2.membershipId, "Agent 1 is on leave");
  assert.equal(await getDeal(e.agent1, deal.id), null);
  const g = (await getDeal(e.agent2, deal.id))!;
  assert.equal(g.deal.ownerId, e.agent2.membershipId);
  assert.ok(g.events.some((x) => x.kind === "REASSIGNED" && x.reason === "Agent 1 is on leave"));
  await moveStage(e.agent2, deal.id, "VIEWING");
});

test("a confidential client's deal is hidden from a team lead, and an officer cannot reach deals at all", async () => {
  const e = await setup("secret");
  const { addTeam, setMemberPlacement } = await import("../../src/lib/services/crm");
  const team = await addTeam(e.admin, { name: "North team", leadId: e.agent1.membershipId });
  await setMemberPlacement(e.admin, e.agent2.membershipId, null, team.id);
  const c = await createClient(e.agent2, { name: "Private Person", phone: "08031239999", confidential: true } as never);
  const deal = await createDeal(e.agent2, { clientId: c.id, assetId: e.asset.id, type: "RENT", asking: "5,000,000" } as never);
  const open = await openDeal({ ...e, asset: await createAsset(e.admin, { name: "Visible house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" }) } as Env, e.agent2);
  assert.equal(await getDeal(e.agent1, deal.id), null);
  assert.ok(await getDeal(e.agent1, open.deal.id));
  assert.deepEqual((await listDeals(e.agent1)).deals.map((d) => d.id), [open.deal.id]);
  assert.ok(await getDeal(e.manager, deal.id));
  await assert.rejects(listDeals(e.officer), /permission/i);
  await assert.rejects(moveStage(e.agent1, deal.id, "VIEWING"), /not found/i);
  const raw = await withTenant(e.admin.companyId, e.admin.userId, (tx) => tx.dealEvent.count({ where: { dealId: deal.id } }));
  assert.ok(raw >= 1);
});
