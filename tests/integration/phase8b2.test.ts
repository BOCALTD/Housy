/**
 * Phase 8b-2: the deal file. Documents, payments, linked correspondence, tasks and conversations are tied to a deal, follow the
 * deal's access rules, and merging clients carries them across. Viewings, follow-ups and closing dates reach the calendar.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { registerCorrespondence } from "../../src/lib/services/correspondence";
import { addClientActivity, createClient, createLead, mergeClients, setLeadStatus, updateQualification } from "../../src/lib/services/crm";
import { cancelDeal, createDeal, scheduleViewing } from "../../src/lib/services/deal";
import {
  addDealDocument, addDealTask, getDealDocument, getDealFile, linkCorrespondence, paymentTotals, recordDealPayment, reverseDealPayment, setDealTaskStatus,
} from "../../src/lib/services/deal-file";
import { complianceCalendar } from "../../src/lib/services/obligations";
import { addMember, newCompany, PDF_BYTES, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const manager = await addMember(admin, "MANAGER", "mgr");
  const manager2 = await addMember(admin, "MANAGER", "mgr2");
  const agent1 = await addMember(admin, "AGENT", "ag1");
  const agent2 = await addMember(admin, "AGENT", "ag2");
  const asset = await createAsset(admin, { name: `${label} house`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const client = await createClient(agent1, { name: "File Buyer", phone: "08037770001" } as never);
  const deal = await createDeal(agent1, { clientId: client.id, assetId: asset.id, type: "SALE", asking: "80,000,000", expectedCloseOn: relativeDate(20) } as never);
  return { admin, manager, manager2, agent1, agent2, asset, client, deal };
}
type Env = Awaited<ReturnType<typeof setup>>;
const pdf = { name: "offer.pdf", type: "application/pdf", bytes: PDF_BYTES };

async function letter(e: Env, subject: string, confidential = false) {
  return registerCorrespondence(e.admin, { direction: "INCOMING", subject, senderName: "Buyer's solicitor", recipientName: "Company", dateReceived: relativeDate(-1), confidential } as never);
}

test("deal documents are stored, served only to people who can see the deal, and closed with a cancelled deal", async () => {
  const e = await setup("docs");
  await assert.rejects(addDealDocument(e.agent1, e.deal.id, "OFFER_LETTER", "", pdf), /title/);
  await assert.rejects(addDealDocument(e.agent2, e.deal.id, "OFFER_LETTER", "Offer", pdf), /not found/i);
  await assert.rejects(addDealDocument(e.agent1, e.deal.id, "OFFER_LETTER", "Offer", { name: "x.exe", type: "application/x-msdownload", bytes: new Uint8Array([1, 2, 3]) }), /file/i);
  const doc = await addDealDocument(e.agent1, e.deal.id, "OFFER_LETTER", "Signed offer letter", pdf);
  const got = await getDealDocument(e.agent1, doc.id);
  assert.equal(got?.doc.title, "Signed offer letter");
  assert.deepEqual(Array.from(got!.bytes), Array.from(PDF_BYTES));
  assert.ok(await getDealDocument(e.manager, doc.id));
  assert.equal(await getDealDocument(e.agent2, doc.id), null);
  const outsider = await newCompany("docs-out");
  assert.equal(await getDealDocument(outsider, doc.id), null);
  await cancelDeal(e.agent1, e.deal.id, "Buyer withdrew");
  await assert.rejects(addDealDocument(e.agent1, e.deal.id, "OTHER", "Later", pdf), /cancelled/);
});

test("payments are recorded, reversed only by a second manager, never edited, and totalled correctly", async () => {
  const e = await setup("pay");
  await assert.rejects(recordDealPayment(e.agent1, e.deal.id, { kind: "BOOKING_DEPOSIT", amount: "0", paidOn: relativeDate(-1) }), /more than zero/);
  await assert.rejects(recordDealPayment(e.agent1, e.deal.id, { kind: "BOOKING_DEPOSIT", amount: "1,000,000", paidOn: relativeDate(3) }), /future/);
  await assert.rejects(recordDealPayment(e.agent2, e.deal.id, { kind: "BOOKING_DEPOSIT", amount: "1,000,000", paidOn: relativeDate(-1) }), /not found/i);
  const dep = await recordDealPayment(e.agent1, e.deal.id, { kind: "BOOKING_DEPOSIT", amount: "5,000,000", paidOn: relativeDate(-2), method: "Transfer", reference: "TRF-1" });
  const wrong = await recordDealPayment(e.agent1, e.deal.id, { kind: "PART_PAYMENT", amount: "2,500,000.50", paidOn: relativeDate(-1) });
  await recordDealPayment(e.agent1, e.deal.id, { kind: "REFUND", amount: "500,000", paidOn: relativeDate(-1) });
  let f = (await getDealFile(e.agent1, e.deal.id))!;
  assert.equal(f.totals.received, 750_000_050n);
  assert.equal(f.totals.refunded, 50_000_000n);
  assert.equal(f.totals.net, 700_000_050n);

  await assert.rejects(reverseDealPayment(e.agent1, wrong.id, "Typo"), /permission/i);
  await assert.rejects(reverseDealPayment(e.manager, wrong.id, ""), /why/);
  await reverseDealPayment(e.manager, wrong.id, "Entered against the wrong deal");
  await assert.rejects(reverseDealPayment(e.manager2, wrong.id, "Again"), /already been reversed/);
  f = (await getDealFile(e.agent1, e.deal.id))!;
  const reversal = f.payments.find((p) => p.reversesId === wrong.id)!;
  await assert.rejects(reverseDealPayment(e.manager2, reversal.id, "Undo"), /cannot itself be reversed/);
  assert.equal(f.totals.received, 500_000_000n);
  assert.equal(f.totals.net, 450_000_000n);
  assert.equal(f.payments.length, 4);

  // The manager who recorded a payment cannot reverse it.
  const mine = await recordDealPayment(e.manager, e.deal.id, { kind: "BALANCE", amount: "1,000", paidOn: relativeDate(-1) });
  await assert.rejects(reverseDealPayment(e.manager, mine.id, "Mistake"), /Someone other/);
  await reverseDealPayment(e.manager2, mine.id, "Mistake");

  // The ledger cannot be edited or deleted through the runtime role.
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE deal_payments SET amount_kobo = 1 WHERE id = '${dep.id}'`));
  assert.deepEqual(paymentTotals([]), { received: 0n, refunded: 0n, net: 0n });
});

test("correspondence links to a deal only if the person can see it, once, and can be unlinked", async () => {
  const e = await setup("link");
  const a = await letter(e, "Solicitor's letter on completion");
  const secret = await letter(e, "Confidential valuation dispute", true);
  const other = await createClient(e.agent2, { name: "Other Buyer", phone: "08037770002" } as never);
  const deal2 = await createDeal(e.agent2, { clientId: other.id, assetId: e.asset.id, type: "RENT", asking: "3,000,000" } as never);
  await assert.rejects(linkCorrespondence(e.agent2, e.deal.id, a.id), /not found/i);
  await assert.rejects(linkCorrespondence(e.agent1, e.deal.id, secret.id), /Correspondence not found/);
  await linkCorrespondence(e.agent1, e.deal.id, a.id);
  await assert.rejects(linkCorrespondence(e.agent2, deal2.id, a.id), /already linked to another deal/);
  let f = (await getDealFile(e.agent1, e.deal.id))!;
  assert.deepEqual(f.correspondence.map((c) => c.id), [a.id]);
  assert.ok(!f.linkable.some((c) => c.id === a.id));
  await linkCorrespondence(e.manager, e.deal.id, secret.id);
  f = (await getDealFile(e.manager, e.deal.id))!;
  assert.equal(f.correspondence.length, 2);
  // The agent still cannot see the confidential letter on their own deal.
  f = (await getDealFile(e.agent1, e.deal.id))!;
  assert.deepEqual(f.correspondence.map((c) => c.id), [a.id]);
  await assert.rejects(linkCorrespondence(e.agent2, deal2.id, a.id, true), /not linked|already linked/);
  await linkCorrespondence(e.agent1, e.deal.id, a.id, true);
  assert.equal((await getDealFile(e.agent1, e.deal.id))!.correspondence.length, 0);
  await linkCorrespondence(e.agent2, deal2.id, a.id);
});

test("deal tasks stay off the asset pages, can go only to people who can see the deal, and record an outcome", async () => {
  const e = await setup("task");
  await assert.rejects(addDealTask(e.agent1, e.deal.id, { title: "x" }), /short title/);
  await assert.rejects(addDealTask(e.agent1, e.deal.id, { title: "Ask for the survey", assigneeId: e.agent2.membershipId }), /cannot see this deal/);
  const t = await addDealTask(e.agent1, e.deal.id, { title: "Ask for the survey", dueOn: relativeDate(2), assigneeId: e.manager.membershipId });
  await assert.rejects(setDealTaskStatus(e.agent2, t.id, "DONE", "done"), /not found/i);
  await assert.rejects(setDealTaskStatus(e.agent1, t.id, "DONE", ""), /outcome/);
  await setDealTaskStatus(e.manager, t.id, "DONE", "Survey received");
  const f = (await getDealFile(e.agent1, e.deal.id))!;
  assert.equal(f.tasks[0].status, "DONE");
  const { getAsset } = await import("../../src/lib/services/assets");
  const asset = await getAsset(e.admin, e.asset.id);
  assert.equal(asset?.tasks.length, 0);
});

test("conversations are tied to the deal and its client, and merging clients carries the deals and letters across", async () => {
  const e = await setup("merge");
  const x = await addClientActivity(e.agent1, e.client.id, { kind: "MEETING", subject: "Met at the property", body: "Discussed the price", dealId: e.deal.id });
  await assert.rejects(addClientActivity(e.agent1, e.client.id, { kind: "CALL", subject: "Wrong deal", dealId: "nope" }), /Deal not found for this client/);
  let f = (await getDealFile(e.agent1, e.deal.id))!;
  assert.deepEqual(f.activities.map((a) => a.id), [x.id]);

  const l = await letter(e, "Letter to merge");
  await linkCorrespondence(e.agent1, e.deal.id, l.id);
  const dupe = await createClient(e.agent1, { name: "File Buyer", email: "fb@example.test", notDuplicate: true } as never);
  const lead = await createLead(e.agent1, dupe.id, { title: "Another interest", ownerId: e.agent1.membershipId } as never);
  await updateQualification(e.agent1, lead.id, { title: "Another interest", budgetMax: "10,000,000", timeline: "LATER" } as never);
  await setLeadStatus(e.agent1, lead.id, "QUALIFIED");
  const asset2 = await createAsset(e.admin, { name: "Merge house two", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const deal2 = await createDeal(e.agent1, { clientId: dupe.id, leadId: lead.id, assetId: asset2.id, type: "SALE", asking: "9,000,000" } as never);
  await mergeClients(e.manager, e.client.id, dupe.id);
  f = (await getDealFile(e.agent1, deal2.id))!;
  assert.equal(f.client.id, e.client.id);
  const g = (await getDealFile(e.agent1, e.deal.id))!;
  assert.equal(g.correspondence.length, 1);
  assert.equal(g.client.id, e.client.id);
});

test("viewings, follow-ups and closing dates reach the calendar of the people who may see them", async () => {
  const e = await setup("cal");
  await scheduleViewing(e.agent1, e.deal.id, { date: relativeDate(6), time: "14:30", minutes: "30" } as never);
  await addClientActivity(e.agent1, e.client.id, { kind: "FOLLOW_UP", subject: "Chase the proof of funds", dueOn: relativeDate(3) });
  const mine = (await complianceCalendar(e.agent1)).items;
  assert.ok(mine.some((i) => i.kind === "VIEWING" && i.title.includes("14:30")));
  assert.ok(mine.some((i) => i.kind === "FOLLOW_UP" && i.title.includes("proof of funds")));
  assert.ok(mine.some((i) => i.kind === "DEAL_CLOSE"));
  const theirs = (await complianceCalendar(e.agent2)).items;
  assert.ok(!theirs.some((i) => ["VIEWING", "FOLLOW_UP", "DEAL_CLOSE"].includes(i.kind)));
  const boss = (await complianceCalendar(e.manager)).items;
  assert.ok(boss.some((i) => i.kind === "VIEWING"));
  assert.ok(!boss.some((i) => i.kind === "FOLLOW_UP"), "follow-ups are personal to the person they are assigned to");
});
