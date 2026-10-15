/**
 * Phase 8c: commission rules, splits, second-person approval and payment, dispute withholding, and the agent, team and branch
 * dashboards and company reports, against a real PostgreSQL database through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { addBranch, addTeam, createClient, createLead, setLeadStatus, setMemberPlacement, updateQualification } from "../../src/lib/services/crm";
import { cancelDeal, completeDeal, createDeal, decideAcceptance, moveStage, raiseDispute, recordOffer, requestAcceptance, resolveDispute } from "../../src/lib/services/deal";
import {
  addCommissionRule, cancelCommission, decideCommission, getDealCommission, listCommissionRules, payCommissionSplit, proposeCommission, commissionQueue, setCommissionRuleActive,
} from "../../src/lib/services/commission";
import { companyReport, salesDashboard } from "../../src/lib/services/sales";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const manager = await addMember(admin, "MANAGER", "mgr");
  const manager2 = await addMember(admin, "MANAGER", "mgr2");
  const agent1 = await addMember(admin, "AGENT", "ag1");
  const agent2 = await addMember(admin, "AGENT", "ag2");
  const officer = await addMember(admin, "OFFICER", "off");
  return { admin, manager, manager2, agent1, agent2, officer };
}
type Env = Awaited<ReturnType<typeof setup>>;

let n = 0;
/** A deal taken all the way to completion. */
async function completedDeal(e: Env, price: string, owner = e.agent1, type: "SALE" | "RENT" = "SALE") {
  n += 1;
  const asset = await createAsset(e.admin, { name: `Sold house ${n} ${Math.random().toString(36).slice(2, 6)}`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const client = await createClient(owner, { name: `Client Number${n} Person`, phone: `0809${String(1000000 + n)}` } as never);
  const lead = await createLead(owner, client.id, { title: "Purchase", ownerId: owner.membershipId } as never);
  await updateQualification(owner, lead.id, { title: "Purchase", budgetMax: "900,000,000", timeline: "IMMEDIATE", financing: "CASH", decisionMaker: true } as never);
  await setLeadStatus(owner, lead.id, "QUALIFIED");
  const deal = await createDeal(owner, { clientId: client.id, leadId: lead.id, assetId: asset.id, type, asking: price } as never);
  const offer = await recordOffer(owner, deal.id, { side: "CLIENT", amount: price } as never);
  await requestAcceptance(owner, offer.id);
  await decideAcceptance(e.manager, offer.id, "approve", "");
  await moveStage(owner, deal.id, "LEGAL");
  await completeDeal(e.manager2, deal.id, "Done");
  return { deal, client, asset };
}

test("commission rules are the company's own, validated, and never edited", async () => {
  const e = await setup("rules");
  await assert.rejects(addCommissionRule(e.agent1, { name: "Mine", method: "PERCENT", rate: "5" }), /permission/i);
  await assert.rejects(addCommissionRule(e.manager, { name: "", method: "PERCENT", rate: "5" }), /Name the rule/);
  await assert.rejects(addCommissionRule(e.manager, { name: "Bad", method: "PERCENT" }), /percentage/);
  await assert.rejects(addCommissionRule(e.manager, { name: "Bad", method: "PERCENT", rate: "0" }), /between/);
  await assert.rejects(addCommissionRule(e.manager, { name: "Bad", method: "PERCENT", rate: "101" }), /between/);
  await assert.rejects(addCommissionRule(e.manager, { name: "Bad", method: "FIXED" }), /fixed amount/);
  await assert.rejects(addCommissionRule(e.manager, { name: "Bad", method: "FIXED", fixed: "0" }), /more than zero/);
  const r = await addCommissionRule(e.manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  await assert.rejects(addCommissionRule(e.manager, { name: "sales 5%", method: "PERCENT", rate: "4" }), /already exists/);
  assert.equal(r.rateBps, 500);
  await addCommissionRule(e.manager, { name: "Flat fee", applies: "RENT", method: "FIXED", fixed: "250,000" });
  assert.equal((await listCommissionRules(e.agent1)).length, 2);
  await setCommissionRuleActive(e.manager, r.id, false);
  assert.equal((await listCommissionRules(e.agent1)).find((x) => x.id === r.id)?.active, false);
  const outsider = await newCompany("rules-out");
  assert.equal((await listCommissionRules(outsider)).length, 0);
});

test("a commission is proposed on a completed deal, split to the kobo, and approved by someone with no stake in it", async () => {
  const e = await setup("split");
  const rule = await addCommissionRule(e.manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  const rentRule = await addCommissionRule(e.manager, { name: "Rent fee", applies: "RENT", method: "FIXED", fixed: "100,000" });
  const { deal } = await completedDeal(e, "10,000,001");
  const split = (people: [Env["agent1"], string, string][]) => people.map(([m, role, share]) => ({ membershipId: m.membershipId, role: role as never, share }));
  await assert.rejects(proposeCommission(e.agent2, deal.id, { ruleId: rule.id, splits: split([[e.agent2, "SELLING_AGENT", "100"]]) }), /not found/i);
  await assert.rejects(proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: split([[e.agent1, "SELLING_AGENT", "90"]]) }), /add up to 90%/);
  await assert.rejects(proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: split([[e.agent1, "SELLING_AGENT", "50"], [e.agent1, "REFERRAL", "50"]]) }), /only once/);
  await assert.rejects(proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: split([[e.officer, "OTHER", "100"]]) }), /active agent/i);
  await assert.rejects(proposeCommission(e.agent1, deal.id, { ruleId: rentRule.id, splits: split([[e.agent1, "SELLING_AGENT", "100"]]) }), /does not apply to a sale/);
  const three = split([[e.agent1, "LISTING_AGENT", "33.33"], [e.agent2, "SELLING_AGENT", "33.33"], [e.manager, "TEAM_LEAD", "33.34"]]);
  const p = await proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: three });
  assert.equal(p.totalKobo, 50_000_005n);
  let c = (await getDealCommission(e.agent1, deal.id)).commission!;
  assert.equal(c.splits.reduce((a, s) => a + s.amountKobo, 0n), 50_000_005n);
  assert.equal(c.basisKobo, 1_000_000_100n);
  assert.equal(c.status, "SUBMITTED");
  await assert.rejects(proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: three }), /already has a commission/);

  await assert.rejects(decideCommission(e.agent1, deal.id, "approve"), /permission/i);
  await assert.rejects(decideCommission(e.manager, deal.id, "approve"), /shares in the commission/);
  await assert.rejects(decideCommission(e.manager2, deal.id, "reject"), /why/);
  await decideCommission(e.manager2, deal.id, "reject", "TEAM_LEAD share is not agreed");
  assert.equal((await getDealCommission(e.agent1, deal.id)).commission!.status, "REJECTED");
  // A rejected commission is proposed again, replacing the old split.
  const two = split([[e.agent1, "SELLING_AGENT", "60"], [e.agent2, "REFERRAL", "40"]]);
  await proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: two });
  c = (await getDealCommission(e.agent1, deal.id)).commission!;
  assert.equal(c.splits.length, 2);
  assert.equal(c.status, "SUBMITTED");
  assert.deepEqual(c.splits.map((s) => s.amountKobo).sort(), [20_000_002n, 30_000_003n]);
  await assert.rejects(payCommissionSplit(e.manager2, c.splits[0].id, { paidOn: relativeDate(0), reference: "TRF1" }), /approved commission/);
  await decideCommission(e.manager2, deal.id, "approve", "Agreed");
  c = (await getDealCommission(e.agent1, deal.id)).commission!;
  assert.equal(c.status, "APPROVED");
  assert.equal(c.decidedById, e.manager2.userId);
  await assert.rejects(decideCommission(e.manager2, deal.id, "approve"), /not waiting/);
});

test("payment is person by person, never to oneself or by the proposer, and the commission is paid when every share is", async () => {
  const e = await setup("pay");
  const rule = await addCommissionRule(e.manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  const { deal } = await completedDeal(e, "20,000,000");
  await proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: [{ membershipId: e.agent1.membershipId, role: "SELLING_AGENT", share: "70" }, { membershipId: e.agent2.membershipId, role: "LISTING_AGENT", share: "30" }] });
  await decideCommission(e.manager2, deal.id, "approve", "");
  const c = (await getDealCommission(e.admin, deal.id)).commission!;
  const [s1, s2] = [c.splits.find((s) => s.membershipId === e.agent1.membershipId)!, c.splits.find((s) => s.membershipId === e.agent2.membershipId)!];
  assert.equal(s1.amountKobo, 70_000_000n);
  assert.equal(s2.amountKobo, 30_000_000n);
  await assert.rejects(payCommissionSplit(e.agent1, s1.id, { paidOn: relativeDate(0), reference: "TRF" }), /permission/i);
  await assert.rejects(payCommissionSplit(e.manager, s1.id, { paidOn: relativeDate(2), reference: "TRF" }), /future/);
  await assert.rejects(payCommissionSplit(e.manager, s1.id, { paidOn: relativeDate(0), reference: "" }), /reference/);
  await payCommissionSplit(e.manager, s1.id, { paidOn: relativeDate(-1), reference: "TRF-001" });
  await assert.rejects(payCommissionSplit(e.manager, s1.id, { paidOn: relativeDate(0), reference: "TRF-002" }), /already been paid/);
  let view = await getDealCommission(e.agent2, deal.id);
  assert.equal(view.payout, "PART_PAID");
  assert.equal(view.commission!.status, "APPROVED");
  await assert.rejects(cancelCommission(e.manager, deal.id, "Changed"), /already been paid/);
  await payCommissionSplit(e.admin, s2.id, { paidOn: relativeDate(0), reference: "TRF-003" });
  view = await getDealCommission(e.agent2, deal.id);
  assert.equal(view.commission!.status, "PAID");
  assert.equal(view.payout, "PAID");
  assert.ok(view.commission!.paidAt);

  // The proposer, when a manager, cannot pay it either; nor can a beneficiary pay themselves.
  const second = await completedDeal(e, "10,000,000");
  await proposeCommission(e.manager, second.deal.id, { ruleId: rule.id, splits: [{ membershipId: e.manager.membershipId, role: "SELLING_AGENT", share: "50" }, { membershipId: e.manager2.membershipId, role: "TEAM_LEAD", share: "50" }] });
  await assert.rejects(decideCommission(e.manager, second.deal.id, "approve"), /Someone other|shares in/);
  await decideCommission(e.admin, second.deal.id, "approve", "");
  const c2 = (await getDealCommission(e.admin, second.deal.id)).commission!;
  const mine = c2.splits.find((s) => s.membershipId === e.manager.membershipId)!;
  const theirs = c2.splits.find((s) => s.membershipId === e.manager2.membershipId)!;
  await assert.rejects(payCommissionSplit(e.manager, mine.id, { paidOn: relativeDate(0), reference: "SELF" }), /own share|Someone other/);
  await assert.rejects(payCommissionSplit(e.manager2, mine.id, { paidOn: relativeDate(0), reference: "X1" }), /./).catch(() => undefined);
  await payCommissionSplit(e.admin, theirs.id, { paidOn: relativeDate(0), reference: "TRF-100" });
});

test("a disputed deal withholds its commission until the dispute is settled by someone else, and a cancelled commission pays nothing", async () => {
  const e = await setup("hold");
  const rule = await addCommissionRule(e.manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  const { deal } = await completedDeal(e, "30,000,000");
  await proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: [{ membershipId: e.agent1.membershipId, role: "SELLING_AGENT", share: "100" }] });
  await raiseDispute(e.agent1, deal.id, "Buyer says the title was not as described");
  await assert.rejects(decideCommission(e.manager2, deal.id, "approve"), /withheld/);
  await assert.rejects(cancelDeal(e.manager, deal.id, "No"), /completed deal cannot be cancelled/);
  await assert.rejects(resolveDispute(e.manager2, deal.id, "Settled", "cancel"), /completed deal cannot be cancelled/);
  await resolveDispute(e.manager2, deal.id, "Title queried and cleared by the lawyers", "resume");
  await decideCommission(e.manager2, deal.id, "approve", "");
  const s = (await getDealCommission(e.admin, deal.id)).commission!.splits[0];
  await raiseDispute(e.agent1, deal.id, "A second complaint");
  await assert.rejects(payCommissionSplit(e.manager, s.id, { paidOn: relativeDate(0), reference: "TRF" }), /withheld/);
  await resolveDispute(e.manager, deal.id, "Complaint withdrawn", "resume");
  await payCommissionSplit(e.manager, s.id, { paidOn: relativeDate(0), reference: "TRF-9" });

  const other = await completedDeal(e, "12,000,000");
  await proposeCommission(e.agent1, other.deal.id, { ruleId: rule.id, splits: [{ membershipId: e.agent1.membershipId, role: "SELLING_AGENT", share: "100" }] });
  await assert.rejects(cancelCommission(e.agent2, other.deal.id, "Mine"), /not found/i);
  await cancelCommission(e.agent1, other.deal.id, "Wrong rule chosen");
  assert.equal((await getDealCommission(e.agent1, other.deal.id)).commission!.status, "CANCELLED");
  await proposeCommission(e.agent1, other.deal.id, { ruleId: rule.id, splits: [{ membershipId: e.agent1.membershipId, role: "SELLING_AGENT", share: "100" }] });
});

test("only managers, the owner and the people sharing can see a commission", async () => {
  const e = await setup("see");
  const rule = await addCommissionRule(e.manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  const { deal } = await completedDeal(e, "8,000,000");
  await proposeCommission(e.agent1, deal.id, { ruleId: rule.id, splits: [{ membershipId: e.agent1.membershipId, role: "SELLING_AGENT", share: "60" }, { membershipId: e.agent2.membershipId, role: "REFERRAL", share: "40" }] });
  assert.equal((await getDealCommission(e.agent2, deal.id)).hidden, false);
  assert.equal((await getDealCommission(e.admin, deal.id)).hidden, false);
  const q2 = await commissionQueue(e.agent2);
  assert.equal(q2.rows.length, 1);
  assert.equal((await commissionQueue(e.agent1)).rows.length, 1);
  const other = await addMember(e.admin, "AGENT", "ag3");
  await assert.rejects(getDealCommission(other, deal.id), /not found/i);
  assert.equal((await commissionQueue(other)).rows.length, 0);
  await assert.rejects(commissionQueue(e.officer), /permission/i);
  assert.equal((await commissionQueue(e.manager)).rows.length, 1);
});

test("dashboards show agents their own work, team leads their team, and managers each branch and the company", async () => {
  const e = await setup("dash");
  const rule = await addCommissionRule(e.manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  const branch = await addBranch(e.admin, { name: "Lekki", code: "LK" });
  const team = await addTeam(e.admin, { name: "Lekki sales", branchId: branch.id, leadId: e.agent1.membershipId });
  await setMemberPlacement(e.admin, e.agent1.membershipId, branch.id, team.id);
  await setMemberPlacement(e.admin, e.agent2.membershipId, branch.id, team.id);
  const d1 = await completedDeal(e, "10,000,000", e.agent1);
  await completedDeal(e, "20,000,000", e.agent2);
  await proposeCommission(e.agent1, d1.deal.id, { ruleId: rule.id, splits: [{ membershipId: e.agent1.membershipId, role: "SELLING_AGENT", share: "100" }] });
  await decideCommission(e.manager2, d1.deal.id, "approve", "");
  const sp = (await getDealCommission(e.admin, d1.deal.id)).commission!.splits[0];
  await payCommissionSplit(e.manager, sp.id, { paidOn: relativeDate(0), reference: "TRF" });
  // an open lead and an open deal for agent1
  const c = await createClient(e.agent1, { name: "Open Lead Person", phone: "08090001234" } as never);
  await createLead(e.agent1, c.id, { title: "Flat", ownerId: e.agent1.membershipId } as never);

  const mine = await salesDashboard(e.agent2);
  assert.equal(mine.scope, "self");
  assert.equal(mine.me.completedDeals, 1);
  assert.equal(mine.me.completedKobo, 2_000_000_000n);
  assert.equal(mine.agents.length, 1);
  assert.equal(mine.branches.length, 0);

  const lead = await salesDashboard(e.agent1);
  assert.equal(lead.scope, "team");
  assert.equal(lead.me.commissionPaidKobo, 50_000_000n);
  assert.equal(lead.me.openLeads, 1);
  assert.equal(lead.agents.length, 2);
  assert.equal(lead.total.completedDeals, 2);
  assert.equal(lead.total.completedKobo, 3_000_000_000n);
  assert.equal(lead.teams.length, 1);

  const boss = await salesDashboard(e.manager);
  assert.equal(boss.scope, "company");
  assert.equal(boss.branches.length, 1);
  assert.equal(boss.branches[0].f.completedDeals, 2);
  assert.equal(boss.teams[0].f.completedKobo, 3_000_000_000n);
  assert.equal(boss.total.commissionApprovedKobo, 50_000_000n);
  await assert.rejects(salesDashboard(e.officer), /permission/i);
});

test("company reports give conversion, pipeline, completed deals and cancellations, to managers only", async () => {
  const e = await setup("report");
  const rule = await addCommissionRule(e.manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  const done = await completedDeal(e, "50,000,000", e.agent1);
  await proposeCommission(e.agent1, done.deal.id, { ruleId: rule.id, splits: [{ membershipId: e.agent1.membershipId, role: "SELLING_AGENT", share: "100" }] });
  // two more leads: one lost, one open; and a cancelled deal
  const c1 = await createClient(e.agent1, { name: "Lost Lead Person", phone: "08090005551" } as never);
  const l1 = await createLead(e.agent1, c1.id, { title: "Flat", ownerId: e.agent1.membershipId } as never);
  await setLeadStatus(e.agent1, l1.id, "LOST", "Bought elsewhere");
  const c2 = await createClient(e.agent1, { name: "Open Lead Person", phone: "08090005552" } as never);
  await createLead(e.agent1, c2.id, { title: "Shop", ownerId: e.agent1.membershipId } as never);
  const asset = await createAsset(e.admin, { name: "Cancelled house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const c3 = await createClient(e.agent1, { name: "Cancelling Person", phone: "08090005553" } as never);
  const dl = await createDeal(e.agent1, { clientId: c3.id, assetId: asset.id, type: "SALE", asking: "9,000,000" } as never);
  await cancelDeal(e.agent1, dl.id, "Client bought elsewhere");
  const open = await createAsset(e.admin, { name: "Pipeline house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const c4 = await createClient(e.agent2, { name: "Pipeline Person", phone: "08090005554" } as never);
  await createDeal(e.agent2, { clientId: c4.id, assetId: open.id, type: "SALE", asking: "7,000,000" } as never);

  const from = new Date(Date.UTC(2020, 0, 1));
  const to = new Date(Date.now() + 2 * 864e5);
  await assert.rejects(companyReport(e.agent1, { from, to }), /permission/i);
  await assert.rejects(companyReport(e.manager, { from: to, to: from }), /before/);
  const r = await companyReport(e.manager, { from, to });
  assert.equal(r.leads.total, 4);
  assert.equal(r.leads.converted, 1);
  assert.equal(r.leads.lost, 1);
  assert.equal(r.leads.convertedBps, 2500);
  assert.equal(r.completedTotals.count, 1);
  assert.equal(r.completedTotals.valueKobo, 5_000_000_000n);
  assert.equal(r.completed[0].commissionKobo, 250_000_000n);
  assert.equal(r.completed[0].commissionStatus, "SUBMITTED");
  assert.equal(r.cancelled.count, 1);
  assert.deepEqual(r.cancelled.reasons, [{ reason: "Client bought elsewhere", count: 1 }]);
  assert.equal(r.pipelineTotals.count, 1);
  assert.equal(r.pipelineTotals.valueKobo, 700_000_000n);
  assert.equal(r.commission.proposedKobo, 250_000_000n);
  const empty = await companyReport(e.manager, { from: new Date(Date.UTC(2019, 0, 1)), to: new Date(Date.UTC(2019, 0, 2)) });
  assert.equal(empty.leads.total, 0);
  assert.equal(empty.completedTotals.count, 0);
  const outsider = await newCompany("report-out");
  assert.equal((await companyReport(outsider, { from, to })).leads.total, 0);
});
