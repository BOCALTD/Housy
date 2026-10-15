/**
 * Phase 7b: construction and renovation projects against a real PostgreSQL database through the runtime role.
 * Planning, budget approval by a second person, commitments held to the approved budget (including two
 * approvals at once), invoices held to contract sums, variations, forecasts, cost reporting and isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import {
  achieveMilestone, activateProject, addMilestone, addWorkPackage, cancelProject, createProject, decideBudget, decideCommitment, decideInvoice, decideVariation,
  getProject, holdProject, listProjects, markInvoicePaid, recordForecast, recordInvoice, removeMilestone, removeWorkPackage, requestCommitment, requestVariation,
  resumeProject, setProgress, submitBudget, updateProject, updateWorkPackage,
} from "../../src/lib/services/project";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const n = (naira: number) => BigInt(naira) * 100n;

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const viewer = await addMember(admin, "VIEWER", "view");
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  return { admin, officer, manager, viewer, asset };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function planned(env: Env, extra: Record<string, unknown> = {}) {
  const p = await createProject(env.admin, {
    assetId: env.asset.id, title: "Shopfront renovation", kind: "RENOVATION", plannedStart: relativeDate(-10), plannedEnd: relativeDate(80),
    managerId: env.manager.membershipId, contingency: "1,000,000", ...extra,
  } as never);
  const a = (await addWorkPackage(env.officer, p.id, { title: "Roof", plannedStart: relativeDate(-10), plannedEnd: relativeDate(30), budget: "6,000,000" } as never)).workPackage;
  const b = (await addWorkPackage(env.officer, p.id, { title: "Shopfront", plannedStart: relativeDate(0), plannedEnd: relativeDate(60), budget: "4,000,000" } as never)).workPackage;
  return { p, a, b };
}

/** An active project with an approved budget of 11,000,000 (10,000,000 of packages plus 1,000,000 contingency). */
async function active(env: Env) {
  const x = await planned(env);
  await submitBudget(env.officer, x.p.id);
  await decideBudget(env.manager, x.p.id, "approve", "Agreed");
  await activateProject(env.admin, x.p.id);
  return x;
}

const commit = async (env: Env, projectId: string, amount: string, workPackageId?: string, supplierName = "Builder Ltd") => {
  const c = await requestCommitment(env.officer, projectId, { supplierName, description: "Works", amount, workPackageId } as never);
  await decideCommitment(env.manager, c.id, "approve", "");
  return c;
};

test("only managers create projects, numbers run in sequence, and the details are checked", async () => {
  const env = await setup("p-new");
  const base = { assetId: env.asset.id, title: "Roof", kind: "REPAIR_PROGRAMME", plannedStart: relativeDate(0), plannedEnd: relativeDate(30) };
  await assert.rejects(createProject(env.officer, base as never), /permission/i);
  await assert.rejects(createProject(env.admin, { ...base, assetId: "nope" } as never), /Asset not found/);
  await assert.rejects(createProject(env.admin, { ...base, title: "R" } as never), /title/i);
  await assert.rejects(createProject(env.admin, { ...base, plannedEnd: relativeDate(-5) } as never), /end date/i);
  await assert.rejects(createProject(env.admin, { ...base, managerId: "nobody" } as never), /active member/i);
  const a = await createProject(env.admin, base as never);
  const b = await createProject(env.admin, base as never);
  const year = new Date().getUTCFullYear();
  assert.equal(a.ref, `PRJ-${year}-0001`);
  assert.equal(b.ref, `PRJ-${year}-0002`);
  assert.equal(a.status, "PLANNING");
  assert.equal(a.budgetStatus, "DRAFT");
  const read = await getProject(env.viewer, a.id);
  assert.equal(read!.project.id, a.id);
  assert.equal((await listProjects(env.viewer)).rows.length, 2);
  await assert.rejects(updateProject(env.viewer, a.id, { title: "x", plannedStart: relativeDate(0), plannedEnd: relativeDate(1) } as never), /permission/i);
});

test("work packages are numbered, checked, and their budgets lock when the budget is submitted", async () => {
  const env = await setup("p-wp");
  const { p, a, b } = await planned(env);
  assert.equal(a.code, "WP-1");
  assert.equal(b.code, "WP-2");
  await assert.rejects(addWorkPackage(env.viewer, p.id, { title: "x", plannedStart: relativeDate(0), plannedEnd: relativeDate(1) } as never), /permission/i);
  await assert.rejects(addWorkPackage(env.officer, p.id, { title: "Bad dates", plannedStart: relativeDate(5), plannedEnd: relativeDate(1) } as never), /end date/i);
  await assert.rejects(addWorkPackage(env.officer, p.id, { title: "Ghost", plannedStart: relativeDate(0), plannedEnd: relativeDate(1), responsibleId: "nobody" } as never), /active member/i);
  const outside = await addWorkPackage(env.officer, p.id, { title: "Outside plan", plannedStart: relativeDate(-60), plannedEnd: relativeDate(1), budget: "1" } as never);
  assert.equal(outside.warnings.length, 1);
  await removeWorkPackage(env.officer, outside.workPackage.id);
  await updateWorkPackage(env.officer, b.id, { title: "Shopfront", plannedStart: relativeDate(0), plannedEnd: relativeDate(60), budget: "5,000,000" } as never);

  await assert.rejects(activateProject(env.admin, p.id), /budget must be approved/i);
  await assert.rejects(setProgress(env.officer, a.id, "IN_PROGRESS", "10"), /must be active/i);
  await submitBudget(env.officer, p.id);
  await assert.rejects(submitBudget(env.officer, p.id), /already been submitted/i);
  await assert.rejects(updateWorkPackage(env.officer, b.id, { title: "Shopfront", plannedStart: relativeDate(0), plannedEnd: relativeDate(60), budget: "9,000,000" } as never), /budget is already submitted/i);
  await assert.rejects(addWorkPackage(env.officer, p.id, { title: "Late", plannedStart: relativeDate(0), plannedEnd: relativeDate(1), budget: "100" } as never), /budget is already submitted/i);
  await assert.rejects(removeWorkPackage(env.officer, b.id), /no longer be removed/i);
  await assert.rejects(updateProject(env.admin, p.id, { title: "Shopfront", plannedStart: relativeDate(-10), plannedEnd: relativeDate(80), contingency: "9,000,000" } as never), /contingency/i);
  // A title change is still fine once the budget is submitted.
  await updateWorkPackage(env.officer, b.id, { title: "Shopfront and signage", plannedStart: relativeDate(0), plannedEnd: relativeDate(60), budget: "5,000,000" } as never);
});

test("the budget is approved by a second person, and the project starts only after that", async () => {
  const env = await setup("p-bud");
  const empty = await createProject(env.admin, { assetId: env.asset.id, title: "Empty", kind: "FIT_OUT", plannedStart: relativeDate(0), plannedEnd: relativeDate(10) } as never);
  await assert.rejects(submitBudget(env.officer, empty.id), /at least one work package/i);
  const { p } = await planned(env);
  await assert.rejects(decideBudget(env.manager, p.id, "approve", ""), /not waiting/i);
  await submitBudget(env.admin, p.id);
  await assert.rejects(decideBudget(env.officer, p.id, "approve", ""), /permission/i);
  await assert.rejects(decideBudget(env.admin, p.id, "approve", ""), /different person/i);
  await assert.rejects(decideBudget(env.manager, p.id, "reject", ""), /what needs to change/i);
  await decideBudget(env.manager, p.id, "reject", "Roof figure is too low.");
  let v = await getProject(env.admin, p.id);
  assert.equal(v!.project.budgetStatus, "DRAFT");
  assert.equal(v!.project.budgetNote, "Roof figure is too low.");
  await updateWorkPackage(env.officer, v!.packages[0].id, { title: "Roof", plannedStart: relativeDate(-10), plannedEnd: relativeDate(30), budget: "7,000,000" } as never);
  await submitBudget(env.officer, p.id);
  await decideBudget(env.manager, p.id, "approve", "Agreed");
  v = await getProject(env.admin, p.id);
  assert.equal(v!.project.budgetStatus, "APPROVED");
  assert.equal(v!.project.approvedBudgetKobo, n(12_000_000)); // 7m + 4m + 1m contingency
  assert.equal(v!.project.budgetDecidedById, env.manager.userId);
  await assert.rejects(activateProject(env.officer, p.id), /permission/i);
  await activateProject(env.admin, p.id);
  v = await getProject(env.admin, p.id);
  assert.equal(v!.project.status, "ACTIVE");
  await assert.rejects(activateProject(env.admin, p.id), /in planning/i);
  const noManager = await planned(env, { managerId: undefined });
  await submitBudget(env.officer, noManager.p.id);
  await decideBudget(env.manager, noManager.p.id, "approve", "");
  await assert.rejects(activateProject(env.admin, noManager.p.id), /project manager/i);
});

test("commitments need a second person and cannot exceed the approved budget, even when approved at the same moment", async () => {
  const env = await setup("p-cmt");
  const { p, a } = await active(env);
  await assert.rejects(requestCommitment(env.viewer, p.id, { supplierName: "X", description: "Works", amount: "1,000" } as never), /permission/i);
  await assert.rejects(requestCommitment(env.officer, p.id, { supplierName: "", description: "Works", amount: "1,000" } as never), /supplier/i);
  await assert.rejects(requestCommitment(env.officer, p.id, { supplierName: "X", description: "Works", amount: "12,000,000" } as never), /more than the approved budget/i);
  await assert.rejects(requestCommitment(env.officer, p.id, { supplierName: "X", description: "Works", amount: "0" } as never), /more than zero/i);
  await assert.rejects(requestCommitment(env.officer, p.id, { supplierName: "X", description: "Works", amount: "1,000", workPackageId: "nope" } as never), /Work package not found/i);
  const c = await requestCommitment(env.officer, p.id, { supplierName: "Roofers Ltd", description: "Roof", amount: "5,000,000", workPackageId: a.id } as never);
  assert.match(c.ref, /^CMT-\d{4}-0001$/);
  await assert.rejects(decideCommitment(env.officer, c.id, "approve", ""), /permission/i);
  const own = await requestCommitment(env.manager, p.id, { supplierName: "Self", description: "Own request", amount: "1,000" } as never);
  await assert.rejects(decideCommitment(env.manager, own.id, "approve", ""), /different person/i);
  await assert.rejects(decideCommitment(env.manager, c.id, "reject", ""), /why it is being rejected/i);
  await decideCommitment(env.manager, c.id, "approve", "Quote accepted");
  await assert.rejects(decideCommitment(env.admin, c.id, "approve", ""), /already been decided/i);
  await decideCommitment(env.admin, own.id, "reject", "Not needed");

  // 5m is committed of 11m. Two more requests of 4m each pass the check on their own, but only one can be approved.
  const x = await requestCommitment(env.officer, p.id, { supplierName: "X", description: "Works", amount: "4,000,000" } as never);
  const y = await requestCommitment(env.officer, p.id, { supplierName: "Y", description: "Works", amount: "4,000,000" } as never);
  const results = await Promise.allSettled([decideCommitment(env.manager, x.id, "approve", ""), decideCommitment(env.admin, y.id, "approve", "")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason), /more than the approved budget/i);
  const v = await getProject(env.admin, p.id);
  assert.equal(v!.cost.committedKobo, n(9_000_000));
});

test("invoices are held to the contract sum, need a second person, and are paid only once approved", async () => {
  const env = await setup("p-inv");
  const { p, a } = await active(env);
  const c = await commit(env, p.id, "5,000,000", a.id);
  const pending = await requestCommitment(env.officer, p.id, { supplierName: "Later", description: "Works", amount: "1,000" } as never);
  await assert.rejects(recordInvoice(env.officer, pending.id, { invoiceNo: "I-0", invoiceDate: relativeDate(-1), amount: "100" } as never), /approved commitment/i);
  await assert.rejects(recordInvoice(env.viewer, c.id, { invoiceNo: "I-1", invoiceDate: relativeDate(-1), amount: "100" } as never), /permission/i);
  await assert.rejects(recordInvoice(env.officer, c.id, { invoiceNo: "I-1", invoiceDate: relativeDate(3), amount: "100" } as never), /future/i);
  await assert.rejects(recordInvoice(env.officer, c.id, { invoiceNo: "I-1", invoiceDate: relativeDate(-1), amount: "0" } as never), /more than zero/i);
  const i1 = await recordInvoice(env.officer, c.id, { invoiceNo: "I-1", invoiceDate: relativeDate(-1), amount: "3,000,000" } as never);
  await assert.rejects(recordInvoice(env.officer, c.id, { invoiceNo: "I-1", invoiceDate: relativeDate(-1), amount: "100" } as never), /already recorded/i);
  await assert.rejects(recordInvoice(env.officer, c.id, { invoiceNo: "I-2", invoiceDate: relativeDate(-1), amount: "2,500,000" } as never), /contract sum/i);
  const i2 = await recordInvoice(env.officer, c.id, { invoiceNo: "I-2", invoiceDate: relativeDate(-1), amount: "2,000,000" } as never);

  await assert.rejects(decideInvoice(env.officer, i1.id, "approve", ""), /permission/i);
  const own = await recordInvoice(env.admin, c.id, { invoiceNo: "I-3", invoiceDate: relativeDate(-1), amount: "1" } as never).catch((e: Error) => e);
  assert.match(String(own), /contract sum/i); // the commitment is fully invoiced, so nothing more fits
  await decideInvoice(env.admin, i1.id, "approve", "Work seen");
  await assert.rejects(markInvoicePaid(env.officer, i1.id), /permission/i);
  await assert.rejects(markInvoicePaid(env.manager, i2.id), /approved invoice/i);
  await assert.rejects(markInvoicePaid(env.manager, i1.id, relativeDate(2)), /future/i);
  await markInvoicePaid(env.manager, i1.id, relativeDate(0));
  await assert.rejects(decideInvoice(env.manager, i1.id, "reject", "late"), /already been decided/i);
  await assert.rejects(decideInvoice(env.manager, i2.id, "reject", ""), /why it is being rejected/i);
  await decideInvoice(env.manager, i2.id, "reject", "Duplicate of another bill");
  // A rejected invoice no longer counts against the contract sum.
  await recordInvoice(env.officer, c.id, { invoiceNo: "I-4", invoiceDate: relativeDate(-1), amount: "2,000,000" } as never);

  const v = await getProject(env.admin, p.id);
  const paid = v!.invoices.find((i) => i.id === i1.id)!;
  assert.equal(paid.status, "PAID");
  assert.equal(paid.paidById, env.manager.userId);
  assert.equal(paid.decidedById, env.admin.userId);
  assert.equal(v!.cost.invoicedKobo, n(3_000_000)); // only approved or paid invoices are cost
  assert.equal(v!.cost.paidKobo, n(3_000_000));

  // Self-approval: an invoice recorded by the administrator cannot be approved by them.
  const c2 = await commit(env, p.id, "1,000,000", a.id, "Second");
  const mine = await recordInvoice(env.admin, c2.id, { invoiceNo: "A-1", invoiceDate: relativeDate(-1), amount: "500,000" } as never);
  await assert.rejects(decideInvoice(env.admin, mine.id, "approve", ""), /different person/i);
});

test("variations change a contract sum or the budget with approval, and extend the programme", async () => {
  const env = await setup("p-var");
  const { p, a } = await active(env);
  const c1 = await commit(env, p.id, "5,000,000", a.id);
  await commit(env, p.id, "5,500,000", undefined, "Glazing Ltd");
  const i = await recordInvoice(env.officer, c1.id, { invoiceNo: "I-1", invoiceDate: relativeDate(-1), amount: "3,000,000" } as never);
  await decideInvoice(env.manager, i.id, "approve", "");

  await assert.rejects(requestVariation(env.viewer, p.id, { target: "BUDGET", title: "More", reason: "Because", amount: "100" } as never), /permission/i);
  await assert.rejects(requestVariation(env.officer, p.id, { target: "COMMITMENT", title: "Extra", reason: "Because it is needed", amount: "100" } as never), /Choose the commitment/i);
  await assert.rejects(requestVariation(env.officer, p.id, { target: "BUDGET", commitmentId: c1.id, title: "Extra", reason: "Because it is needed", amount: "100" } as never), /does not name a commitment/i);
  await assert.rejects(requestVariation(env.officer, p.id, { target: "BUDGET", title: "Extra", reason: "Because it is needed", amount: "0" } as never), /above or below zero/i);
  await assert.rejects(requestVariation(env.officer, p.id, { target: "BUDGET", title: "Extra", reason: "why", amount: "100" } as never), /Explain why/i);

  // Committed is 10.5m of 11m. A 1m increase on the contract would go past the budget.
  const up = await requestVariation(env.officer, p.id, { target: "COMMITMENT", commitmentId: c1.id, title: "Rotten timber", reason: "Found when the roof was opened", amount: "1,000,000", timeImpactDays: "7" } as never);
  assert.match(up.ref, /^VAR-\d{4}-0001$/);
  await assert.rejects(decideVariation(env.officer, up.id, "approve", ""), /permission/i);
  await assert.rejects(decideVariation(env.manager, up.id, "approve", ""), /more than the approved budget/i);
  const raise = await requestVariation(env.officer, p.id, { target: "BUDGET", workPackageId: a.id, title: "Increase budget", reason: "Client approved extra roof works", amount: "2,000,000" } as never);
  const ownVar = await requestVariation(env.manager, p.id, { target: "BUDGET", title: "Own", reason: "Self requested change", amount: "1,000" } as never);
  await assert.rejects(decideVariation(env.manager, ownVar.id, "approve", ""), /different person/i);
  const before = (await getProject(env.admin, p.id))!;
  await decideVariation(env.manager, raise.id, "approve", "Funds available");
  let v = (await getProject(env.admin, p.id))!;
  assert.equal(v.project.approvedBudgetKobo, n(13_000_000));
  assert.equal(v.packages.find((w) => w.id === a.id)!.budgetKobo, n(8_000_000));
  assert.equal(v.project.plannedEnd.getTime(), before.project.plannedEnd.getTime());
  await decideVariation(env.manager, up.id, "approve", "Agreed");
  v = (await getProject(env.admin, p.id))!;
  assert.equal(v.contractSums[c1.id], n(6_000_000));
  assert.equal(v.cost.committedKobo, n(11_500_000));
  assert.equal(v.project.plannedEnd.getTime(), before.project.plannedEnd.getTime() + 7 * 864e5);
  await assert.rejects(decideVariation(env.manager, up.id, "reject", "x"), /already been decided/i);

  // Reductions cannot go below what is invoiced or committed.
  const tooFar = await requestVariation(env.officer, p.id, { target: "COMMITMENT", commitmentId: c1.id, title: "Cut", reason: "Scope removed from contract", amount: "-3,500,000" } as never);
  await assert.rejects(decideVariation(env.manager, tooFar.id, "approve", ""), /below what has already been invoiced/i);
  const fine = await requestVariation(env.officer, p.id, { target: "COMMITMENT", commitmentId: c1.id, title: "Cut", reason: "Scope removed from contract", amount: "(3,000,000)" } as never);
  await decideVariation(env.manager, fine.id, "approve", "");
  v = (await getProject(env.admin, p.id))!;
  assert.equal(v.contractSums[c1.id], n(3_000_000));
  const cutBudget = await requestVariation(env.officer, p.id, { target: "BUDGET", title: "Cut budget", reason: "Reduce the budget sharply", amount: "-9,000,000" } as never);
  await assert.rejects(decideVariation(env.manager, cutBudget.id, "approve", ""), /below what is already committed/i);
  await decideVariation(env.manager, cutBudget.id, "reject", "Not now");
});

test("forecasts and cost reporting: committed, invoiced, paid, forecast at completion and variance", async () => {
  const env = await setup("p-cost");
  const { p, a, b } = await active(env);
  const c1 = await commit(env, p.id, "5,000,000", a.id);
  await commit(env, p.id, "3,000,000", b.id, "Glazing");
  const i1 = await recordInvoice(env.officer, c1.id, { invoiceNo: "I-1", invoiceDate: relativeDate(-1), amount: "2,000,000" } as never);
  const i2 = await recordInvoice(env.officer, c1.id, { invoiceNo: "I-2", invoiceDate: relativeDate(-1), amount: "1,000,000" } as never);
  await recordInvoice(env.officer, c1.id, { invoiceNo: "I-3", invoiceDate: relativeDate(-1), amount: "500,000" } as never); // still waiting: not counted
  await decideInvoice(env.manager, i1.id, "approve", "");
  await markInvoicePaid(env.manager, i1.id);
  await decideInvoice(env.manager, i2.id, "approve", "");
  await assert.rejects(recordForecast(env.viewer, b.id, "1", ""), /permission/i);
  await assert.rejects(recordForecast(env.officer, b.id, "abc", ""), /naira/i);
  await recordForecast(env.officer, b.id, "2,500,000", "Quote received");

  let v = (await getProject(env.admin, p.id))!;
  assert.equal(v.cost.budgetKobo, n(11_000_000));
  assert.equal(v.cost.committedKobo, n(8_000_000));
  assert.equal(v.cost.invoicedKobo, n(3_000_000));
  assert.equal(v.cost.paidKobo, n(2_000_000));
  assert.equal(v.cost.forecastKobo, n(7_500_000)); // A: larger of 5m committed and 3m invoiced; B: 0 invoiced plus 2.5m to complete
  assert.equal(v.cost.varianceKobo, n(3_500_000));
  assert.equal(v.cost.uncommittedKobo, n(3_000_000));
  assert.equal(v.cost.contingencyLeftKobo, n(1_000_000));
  assert.equal(v.cost.overBudget, false);

  await recordForecast(env.officer, b.id, "6,000,000", "Glazing prices rose");
  v = (await getProject(env.admin, p.id))!;
  assert.equal(v.cost.forecastKobo, n(11_000_000));
  assert.equal(v.cost.varianceKobo, 0n);
  assert.equal(v.cost.overrunKobo, n(2_000_000)); // B forecasts 6m against its 4m
  assert.equal(v.cost.contingencyLeftKobo, n(-1_000_000));
  assert.equal(v.forecasts.length, 2);

  await recordForecast(env.officer, b.id, "7,000,000", "");
  v = (await getProject(env.admin, p.id))!;
  assert.equal(v.cost.overBudget, true);
  const row = (await listProjects(env.admin)).rows.find((r) => r.project.id === p.id)!;
  assert.equal(row.cost!.overBudget, true);
});

test("progress, milestones and project status follow their rules", async () => {
  const env = await setup("p-prog");
  const { p, a, b } = await active(env);
  await assert.rejects(setProgress(env.viewer, a.id, "IN_PROGRESS", "10"), /permission/i);
  await assert.rejects(setProgress(env.officer, a.id, "IN_PROGRESS", "150"), /0 to 100/i);
  await assert.rejects(setProgress(env.officer, a.id, "BLOCKED", "10"), /what is blocking/i);
  await setProgress(env.officer, a.id, "NOT_STARTED", "30");
  let v = (await getProject(env.admin, p.id))!;
  assert.equal(v.packages.find((w) => w.id === a.id)!.status, "IN_PROGRESS");
  assert.ok(v.packages.find((w) => w.id === a.id)!.actualStart);
  await setProgress(env.officer, a.id, "IN_PROGRESS", "100");
  v = (await getProject(env.admin, p.id))!;
  const done = v.packages.find((w) => w.id === a.id)!;
  assert.equal(done.status, "DONE");
  assert.ok(done.actualEnd);
  assert.equal(v.progress, 60); // 6m of 10m at 100%
  await setProgress(env.officer, b.id, "BLOCKED", "20", "Waiting for planning permission");
  assert.equal((await getProject(env.admin, p.id))!.states[b.id], "BLOCKED");

  await assert.rejects(addMilestone(env.officer, p.id, { title: "x", dueOn: relativeDate(5) }), /Name the milestone/i);
  await assert.rejects(addMilestone(env.officer, p.id, { title: "Ghost", dueOn: relativeDate(5), workPackageId: "nope" }), /Work package not found/i);
  const late = await addMilestone(env.officer, p.id, { title: "Roof watertight", dueOn: relativeDate(-3), workPackageId: a.id });
  const future = await addMilestone(env.officer, p.id, { title: "Handover", dueOn: relativeDate(50) });
  assert.equal((await getProject(env.admin, p.id))!.lateMilestones, 1);
  await assert.rejects(achieveMilestone(env.viewer, late.id), /permission/i);
  await assert.rejects(achieveMilestone(env.officer, late.id, relativeDate(2)), /future/i);
  await achieveMilestone(env.officer, late.id);
  await assert.rejects(achieveMilestone(env.officer, late.id), /already/i);
  await assert.rejects(removeMilestone(env.officer, late.id), /cannot be removed/i);
  await removeMilestone(env.officer, future.id);
  assert.equal((await getProject(env.admin, p.id))!.lateMilestones, 0);

  await assert.rejects(holdProject(env.officer, p.id, "Weather"), /permission/i);
  await assert.rejects(holdProject(env.admin, p.id, "x"), /why/i);
  await holdProject(env.admin, p.id, "Rainy season");
  await assert.rejects(setProgress(env.officer, b.id, "IN_PROGRESS", "30"), /must be active/i);
  await assert.rejects(requestCommitment(env.officer, p.id, { supplierName: "X", description: "Works", amount: "1,000" } as never), /must be active/i);
  await resumeProject(env.admin, p.id);
  await assert.rejects(resumeProject(env.admin, p.id), /on hold/i);
});

test("a project cannot be cancelled with requests waiting or invoices unpaid, and a cancelled project is closed", async () => {
  const env = await setup("p-can");
  const { p, a } = await active(env);
  const c = await commit(env, p.id, "2,000,000", a.id);
  const waiting = await requestCommitment(env.officer, p.id, { supplierName: "Z", description: "Works", amount: "1,000" } as never);
  await assert.rejects(cancelProject(env.admin, p.id, "No longer needed"), /waiting/i);
  await decideCommitment(env.manager, waiting.id, "reject", "Not needed");
  const inv = await recordInvoice(env.officer, c.id, { invoiceNo: "I-1", invoiceDate: relativeDate(-1), amount: "1,000,000" } as never);
  await decideInvoice(env.manager, inv.id, "approve", "");
  await assert.rejects(cancelProject(env.admin, p.id, "No longer needed"), /approved invoices/i);
  await markInvoicePaid(env.manager, inv.id);
  await assert.rejects(cancelProject(env.officer, p.id, "No longer needed"), /permission/i);
  await assert.rejects(cancelProject(env.admin, p.id, "x"), /why/i);
  await cancelProject(env.admin, p.id, "Client withdrew funding");
  const v = (await getProject(env.admin, p.id))!;
  assert.equal(v.project.status, "CANCELLED");
  await assert.rejects(addWorkPackage(env.officer, p.id, { title: "More", plannedStart: relativeDate(0), plannedEnd: relativeDate(1) } as never), /closed/i);
  await assert.rejects(updateProject(env.admin, p.id, { title: "Changed", plannedStart: relativeDate(0), plannedEnd: relativeDate(1) } as never), /closed/i);
  await assert.rejects(cancelProject(env.admin, p.id, "Again"), /closed/i);
});

test("projects and their money are isolated between companies", async () => {
  const env = await setup("p-iso");
  const other = await setup("p-iso-b");
  const { p, a } = await active(env);
  const c = await commit(env, p.id, "1,000,000", a.id);
  assert.equal(await getProject(other.admin, p.id), null);
  assert.equal((await listProjects(other.admin)).rows.length, 0);
  await assert.rejects(addWorkPackage(other.admin, p.id, { title: "Intruder", plannedStart: relativeDate(0), plannedEnd: relativeDate(1) } as never), /not found/i);
  await assert.rejects(decideCommitment(other.admin, c.id, "approve", ""), /not found/i);
  await assert.rejects(recordInvoice(other.admin, c.id, { invoiceNo: "X", invoiceDate: relativeDate(-1), amount: "1" } as never), /not found/i);
  await assert.rejects(setProgress(other.admin, a.id, "IN_PROGRESS", "10"), /not found/i);
  await assert.rejects(createProject(other.admin, { assetId: env.asset.id, title: "Steal", kind: "RENOVATION", plannedStart: relativeDate(0), plannedEnd: relativeDate(1) } as never), /Asset not found/i);
});
