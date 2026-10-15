/**
 * Phase 7a: valuation against a real PostgreSQL database through the runtime role.
 * Instructions, worksheets that calculate from evidence, readiness rules, second-person approval (with AI
 * assistance declared), evidence locking, frozen approved reports, revisions and company isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import {
  addComparable, addEntry, addValuationDocument, assignValuation, cancelInstruction, createInstruction, decideReport, getValuation, getValuationDocument,
  issueValuation, latestValuationForAsset, listValuations, removeComparable, removeEntry, removeWorksheet, reviseReport, saveReportDraft, saveWorksheet,
  submitReport, updateInstruction, verifyComparable,
} from "../../src/lib/services/valuation";
import { addMember, newCompany, PDF_BYTES, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const viewer = await addMember(admin, "VIEWER", "view");
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  return { admin, officer, manager, viewer, asset };
}

type Env = Awaited<ReturnType<typeof setup>>;

const instruct = (env: Env, extra: Record<string, unknown> = {}) =>
  createInstruction(env.admin, {
    assetId: env.asset.id, clientName: "Lender Plc", purpose: "MORTGAGE_SECURITY", basis: "MARKET_VALUE", premise: "STANDARD",
    assetDescription: "Two-storey commercial building", valuationDate: relativeDate(-5), professionalName: "A. Valuer", professionalBody: "Body", registrationNo: "R-1",
    ...extra,
  } as never);

const compA = { address: "14 Market Road", evidenceDate: relativeDate(-60), price: "50,000,000", area: "200", adjustment: "10", adjustmentNote: "Inferior position", weight: "100", source: "Agent letter" };
const compB = { address: "3 Station Street", evidenceDate: relativeDate(-40), price: "60,000,000", area: "250", adjustment: "0", weight: "100", source: "Deed" };

/** An instruction with everything needed for a report, except the report itself. */
async function prepared(env: Env, extra: Record<string, unknown> = {}) {
  const inst = await instruct(env, extra);
  await addEntry(env.officer, inst.id, "LIMITATION", "Areas were measured on site only.");
  await addComparable(env.officer, inst.id, compA as never);
  await addComparable(env.officer, inst.id, compB as never);
  await saveWorksheet(env.officer, inst.id, "SALES_COMPARISON", { subjectArea: "180" });
  return inst;
}

const draft = (concluded = "46,000,000", extra: Record<string, unknown> = {}) => ({ summary: "A commercial building.", conclusion: "Market value as stated.", concludedValue: concluded, ...extra });

test("only managers instruct, numbers run in sequence, and the details are checked", async () => {
  const env = await setup("v-inst");
  await assert.rejects(createInstruction(env.officer, { assetId: env.asset.id, clientName: "X Ltd", purpose: "SALE" } as never), /permission/i);
  await assert.rejects(instruct(env, { assetId: "nope" }), /Asset not found/);
  await assert.rejects(instruct(env, { clientName: "X" }), /client/i);
  await assert.rejects(instruct(env, { instructionDate: relativeDate(0), dueDate: relativeDate(-3) }), /due date/i);
  const a = await instruct(env);
  const b = await instruct(env, { premise: "GOING_CONCERN" });
  const year = new Date().getUTCFullYear();
  assert.match(a.ref, new RegExp(`^VAL-${year}-0001$`));
  assert.match(b.ref, new RegExp(`^VAL-${year}-0002$`));
  assert.equal(a.status, "INSTRUCTED");
  await assert.rejects(assignValuation(env.officer, a.id, env.officer.membershipId), /permission/i);
  await assignValuation(env.admin, a.id, env.officer.membershipId);
  await assert.rejects(assignValuation(env.admin, a.id, "not-a-member"), /active member/i);
  await updateInstruction(env.officer, a.id, { purposeNote: "Loan security", basis: "MARKET_VALUE", premise: "GOING_CONCERN", assetDescription: "Updated" } as never);
  const read = await getValuation(env.viewer, a.id);
  assert.equal(read!.inst.premise, "GOING_CONCERN");
  await assert.rejects(updateInstruction(env.viewer, a.id, { premise: "STANDARD" } as never), /permission/i);
  const list = await listValuations(env.viewer);
  assert.equal(list.rows.length, 2);
  await cancelInstruction(env.admin, b.id, "Client withdrew");
  assert.equal((await getValuation(env.admin, b.id))!.inst.status, "CANCELLED");
  await assert.rejects(addEntry(env.officer, b.id, "ASSUMPTION", "Cannot add to a cancelled valuation"), /locked/i);
});

test("comparable evidence is validated, and the sales worksheet calculates from it and follows every change", async () => {
  const env = await setup("v-cmp");
  const inst = await instruct(env);
  await assert.rejects(addComparable(env.viewer, inst.id, compA as never), /permission/i);
  await assert.rejects(addComparable(env.officer, inst.id, { ...compA, source: "" } as never), /source/i);
  await assert.rejects(addComparable(env.officer, inst.id, { ...compA, adjustmentNote: "" } as never), /why the adjustment/i);
  await assert.rejects(addComparable(env.officer, inst.id, { ...compA, adjustment: "60" } as never), /between -50% and 50%/);
  await assert.rejects(addComparable(env.officer, inst.id, { ...compA, evidenceDate: relativeDate(5) } as never), /future/i);
  await assert.rejects(addComparable(env.officer, inst.id, { ...compA, price: "0" } as never), /price/i);
  await assert.rejects(addComparable(env.officer, inst.id, { ...compA, area: "0" } as never), /area/i);

  await addComparable(env.officer, inst.id, compA as never);
  const ws0 = await saveWorksheet(env.officer, inst.id, "SALES_COMPARISON", { subjectArea: "180" }, "Primary method");
  assert.equal(ws0.method, "SALES_COMPARISON");
  let v = await getValuation(env.officer, inst.id);
  assert.equal(v!.inst.status, "IN_PROGRESS");
  // One comparable at 275,000 per m2 on 180 m2.
  assert.equal(v!.worksheets[0].resultKobo, 4_950_000_000n);
  assert.ok((v!.worksheets[0].warnings as unknown as string[]).some((w) => w.includes("fewer than 3")));

  const b = await addComparable(env.officer, inst.id, compB as never);
  v = await getValuation(env.officer, inst.id);
  assert.equal(v!.worksheets[0].resultKobo, 4_635_000_000n); // average of 275,000 and 240,000 is 257,500 per m2

  await verifyComparable(env.manager, b.id);
  v = await getValuation(env.officer, inst.id);
  assert.equal(v!.comparables.find((c) => c.id === b.id)!.verifiedById, env.manager.userId);

  await removeComparable(env.officer, b.id);
  v = await getValuation(env.officer, inst.id);
  assert.equal(v!.worksheets[0].resultKobo, 4_950_000_000n);
  const only = v!.comparables[0];
  await removeComparable(env.officer, only.id);
  v = await getValuation(env.officer, inst.id);
  assert.equal(v!.worksheets[0].resultKobo, null);
  assert.ok((v!.worksheets[0].warnings as unknown as string[]).some((w) => /at least one comparable/i.test(w)));
});

test("income and cost worksheets calculate exactly and reject unusable inputs", async () => {
  const env = await setup("v-calc");
  const inst = await instruct(env);
  await saveWorksheet(env.officer, inst.id, "INCOME_CAPITALISATION", { grossRent: "12,000,000", vacancy: "10", operatingCosts: "1,080,000", capRate: "8" });
  await saveWorksheet(env.officer, inst.id, "COST_APPROACH", { landValue: "20,000,000", costPerSqm: "300,000", buildingArea: "150", depreciation: "20" });
  let v = await getValuation(env.officer, inst.id);
  const result = (m: string) => v!.worksheets.find((w) => w.method === m)!.resultKobo;
  assert.equal(result("INCOME_CAPITALISATION"), 12_150_000_000n);
  assert.equal(result("COST_APPROACH"), 5_600_000_000n);
  await assert.rejects(saveWorksheet(env.officer, inst.id, "INCOME_CAPITALISATION", { grossRent: "1,000", vacancy: "0", operatingCosts: "5,000", capRate: "8" }), /not positive/i);
  await assert.rejects(saveWorksheet(env.officer, inst.id, "INCOME_CAPITALISATION", { grossRent: "1,000,000", vacancy: "0", operatingCosts: "0", capRate: "0.5" }), /capitalisation rate/i);
  await assert.rejects(saveWorksheet(env.officer, inst.id, "COST_APPROACH", { landValue: "1", costPerSqm: "1", buildingArea: "1", depreciation: "120" }), /Depreciation/);
  await assert.rejects(saveWorksheet(env.officer, inst.id, "COST_APPROACH", { landValue: "x", costPerSqm: "1", buildingArea: "1", depreciation: "1" }), /naira/i);
  await assert.rejects(saveWorksheet(env.viewer, inst.id, "COST_APPROACH", { landValue: "1", costPerSqm: "1", buildingArea: "1", depreciation: "1" }), /permission/i);
  // A rejected change leaves the saved worksheet as it was.
  v = await getValuation(env.officer, inst.id);
  assert.equal(result("INCOME_CAPITALISATION"), 12_150_000_000n);
  await saveWorksheet(env.officer, inst.id, "INCOME_CAPITALISATION", { grossRent: "12,000,000", vacancy: "10", operatingCosts: "1,080,000", capRate: "10" });
  v = await getValuation(env.officer, inst.id);
  assert.equal(result("INCOME_CAPITALISATION"), 9_720_000_000n);
  await removeWorksheet(env.officer, inst.id, "COST_APPROACH");
  v = await getValuation(env.officer, inst.id);
  assert.equal(v!.worksheets.length, 1);
});

test("a report cannot go for approval until the evidence, premise and professional details are recorded", async () => {
  const env = await setup("v-ready");
  const inst = await instruct(env, { premise: "GONE_CONCERN", assetDescription: "", professionalBody: "" });
  await assert.rejects(submitReport(env.officer, inst.id), /no draft/i);
  await saveReportDraft(env.officer, inst.id, { summary: "", conclusion: "" });
  await assert.rejects(submitReport(env.officer, inst.id), (e: Error) => {
    for (const part of [/valuation worksheet/i, /gone-concern/i, /limitation/i, /summary and the conclusion/i, /concluded value/i, /registration number/i, /Describe the asset/i]) assert.match(e.message, part);
    return true;
  });
  await updateInstruction(env.officer, inst.id, { basis: "MARKET_VALUE", premise: "GONE_CONCERN", assetDescription: "Vacant warehouse", valuationDate: relativeDate(-1), professionalName: "A. Valuer", professionalBody: "Body", registrationNo: "R-1" } as never);
  await addEntry(env.officer, inst.id, "PREMISE", "Valued on the basis that trading has ceased and the asset is sold in a reasonable time.");
  await addEntry(env.officer, inst.id, "LIMITATION", "No access to the roof void.");
  await addComparable(env.officer, inst.id, compA as never);
  await addComparable(env.officer, inst.id, compB as never);
  await saveWorksheet(env.officer, inst.id, "SALES_COMPARISON", { subjectArea: "180" });
  await saveReportDraft(env.officer, inst.id, draft("90,000,000"));
  await assert.rejects(submitReport(env.officer, inst.id), /Explain the difference/);
  await saveReportDraft(env.officer, inst.id, draft("90,000,000", { reconciliationNote: "Reflects the strength of the location." }));
  await submitReport(env.officer, inst.id);
  assert.equal((await getValuation(env.admin, inst.id))!.inst.status, "IN_REVIEW");
});

test("a second person approves; the author cannot, and the evidence is locked once submitted", async () => {
  const env = await setup("v-appr");
  const inst = await prepared(env);
  await saveReportDraft(env.officer, inst.id, draft());
  await submitReport(env.officer, inst.id);
  await assert.rejects(addComparable(env.officer, inst.id, { ...compB, address: "Late evidence" } as never), /locked/i);
  await assert.rejects(addEntry(env.officer, inst.id, "ASSUMPTION", "A late assumption added after submission"), /locked/i);
  await assert.rejects(saveWorksheet(env.officer, inst.id, "COST_APPROACH", { landValue: "1", costPerSqm: "1", buildingArea: "1", depreciation: "1" }), /locked/i);
  await assert.rejects(saveReportDraft(env.officer, inst.id, draft("1")), /locked/i);
  await assert.rejects(decideReport(env.officer, inst.id, "approve", "", false), /permission/i);
  await assert.rejects(decideReport(env.viewer, inst.id, "approve", "", false), /permission/i);

  // The report is by the officer, so the manager may decide. Have the administrator prepare another to show the author rule.
  const other = await prepared(env);
  await saveReportDraft(env.admin, other.id, draft());
  await submitReport(env.admin, other.id);
  await assert.rejects(decideReport(env.admin, other.id, "approve", "", false), /different person/i);
  await assert.rejects(decideReport(env.admin, other.id, "reject", "No", false), /different person/i);
  await decideReport(env.manager, other.id, "approve", "Checked", false);

  await assert.rejects(decideReport(env.manager, inst.id, "reject", "", false), /what needs to change/i);
  await decideReport(env.manager, inst.id, "reject", "Add the roof inspection to the limitations.", false);
  let v = await getValuation(env.officer, inst.id);
  assert.equal(v!.inst.status, "IN_PROGRESS");
  assert.equal(v!.reports[0].status, "REJECTED");
  assert.equal(v!.reports[0].decisionNote, "Add the roof inspection to the limitations.");
  await addEntry(env.officer, inst.id, "LIMITATION", "The roof void was not inspected.");
  await saveReportDraft(env.officer, inst.id, draft());
  await submitReport(env.officer, inst.id);
  await decideReport(env.manager, inst.id, "approve", "Now complete.", false);
  v = await getValuation(env.officer, inst.id);
  assert.equal(v!.inst.status, "APPROVED");
  assert.equal(v!.reports.length, 1);
  assert.equal(v!.reports[0].status, "APPROVED");
  assert.equal(v!.reports[0].decidedById, env.manager.userId);
  assert.equal(v!.reports[0].authorId, env.officer.userId);
  const snap = v!.reports[0].snapshot as unknown as { comparables: unknown[]; worksheets: { resultKobo: string }[]; entries: unknown[] };
  assert.equal(snap.comparables.length, 2);
  assert.equal(snap.worksheets[0].resultKobo, "4635000000");
  assert.equal(snap.entries.length, 2);
  await assert.rejects(decideReport(env.manager, inst.id, "approve", "", false), /not waiting/i);
});

test("AI-assisted reports must be declared and are only approved when the approver confirms their own review", async () => {
  const env = await setup("v-ai");
  const inst = await prepared(env);
  await assert.rejects(saveReportDraft(env.officer, inst.id, draft("46,000,000", { aiAssisted: true, aiNote: "" })), /what the AI assistant/i);
  await saveReportDraft(env.officer, inst.id, draft("46,000,000", { aiAssisted: true, aiNote: "Drafted the summary wording" }));
  await submitReport(env.officer, inst.id);
  await assert.rejects(decideReport(env.manager, inst.id, "approve", "", false), /AI assistance/i);
  assert.equal((await getValuation(env.manager, inst.id))!.inst.status, "IN_REVIEW");
  await decideReport(env.manager, inst.id, "approve", "Read in full.", true);
  const v = await getValuation(env.manager, inst.id);
  assert.equal(v!.reports[0].aiAssisted, true);
  assert.equal(v!.reports[0].reviewConfirmed, true);
  assert.equal(v!.reports[0].aiNote, "Drafted the summary wording");
});

test("an approved report is frozen in the database, and a revision supersedes it only when approved", async () => {
  const env = await setup("v-rev");
  const inst = await prepared(env);
  await saveReportDraft(env.officer, inst.id, draft());
  await submitReport(env.officer, inst.id);
  await decideReport(env.manager, inst.id, "approve", "", false);
  const first = (await getValuation(env.admin, inst.id))!.reports[0];

  await assert.rejects(withTenant(env.admin.companyId, env.admin.userId, (tx) => tx.$executeRawUnsafe(`UPDATE valuation_reports SET concluded_value_kobo = 1 WHERE id = $1`, first.id)), /cannot be changed/i);
  await assert.rejects(withTenant(env.admin.companyId, env.admin.userId, (tx) => tx.$executeRawUnsafe(`DELETE FROM valuation_reports WHERE id = $1`, first.id)), /cannot be deleted/i);
  await assert.rejects(withTenant(env.admin.companyId, env.admin.userId, (tx) => tx.valuationReport.update({ where: { id: first.id }, data: { summary: "Edited" } })), /cannot be changed/i);

  const stand = await withTenant(env.admin.companyId, env.admin.userId, (tx) => latestValuationForAsset(tx, env.admin.companyId, env.asset.id));
  assert.equal(stand!.valueKobo, 4_600_000_000n);

  await assert.rejects(reviseReport(env.officer, inst.id, "Client asked"), /permission/i);
  await assert.rejects(issueValuation(env.officer, inst.id), /permission/i);
  await reviseReport(env.admin, inst.id, "Client supplied a new survey");
  let v = await getValuation(env.admin, inst.id);
  assert.equal(v!.inst.status, "IN_PROGRESS");
  assert.equal(v!.reports.length, 2);
  assert.equal(v!.reports[0].version, 2);
  assert.equal(v!.reports[0].status, "DRAFT");
  assert.equal(v!.reports[1].status, "APPROVED"); // the approved version stands until the new one is approved
  assert.equal((await withTenant(env.admin.companyId, env.admin.userId, (tx) => latestValuationForAsset(tx, env.admin.companyId, env.asset.id)))!.valueKobo, 4_600_000_000n);

  await saveReportDraft(env.officer, inst.id, draft("47,000,000"));
  await submitReport(env.officer, inst.id);
  await decideReport(env.manager, inst.id, "approve", "Revised value accepted.", false);
  v = await getValuation(env.admin, inst.id);
  assert.equal(v!.reports.find((r) => r.version === 1)!.status, "SUPERSEDED");
  assert.equal(v!.reports.find((r) => r.version === 2)!.status, "APPROVED");
  assert.equal((await withTenant(env.admin.companyId, env.admin.userId, (tx) => latestValuationForAsset(tx, env.admin.companyId, env.asset.id)))!.valueKobo, 4_700_000_000n);
  await assert.rejects(withTenant(env.admin.companyId, env.admin.userId, (tx) => tx.valuationReport.update({ where: { id: v!.reports.find((r) => r.version === 1)!.id }, data: { summary: "x" } })), /cannot be changed/i);

  await issueValuation(env.admin, inst.id, relativeDate(0));
  v = await getValuation(env.admin, inst.id);
  assert.equal(v!.inst.status, "ISSUED");
  await assert.rejects(issueValuation(env.admin, inst.id), /approved valuation/i);
  await assert.rejects(cancelInstruction(env.admin, inst.id, "Too late"), /not yet with the reviewer/i);
});

test("supporting documents are stored privately and company records are isolated", async () => {
  const env = await setup("v-doc");
  const other = await setup("v-doc-b");
  const inst = await prepared(env);
  await assert.rejects(addValuationDocument(env.viewer, inst.id, "Title deed", { name: "deed.pdf", type: "application/pdf", bytes: PDF_BYTES }), /permission/i);
  await assert.rejects(addValuationDocument(env.officer, inst.id, "Bad", { name: "x.exe", type: "application/x-msdownload", bytes: PDF_BYTES }), /PDF, JPG/i);
  const doc = await addValuationDocument(env.officer, inst.id, "Title deed", { name: "deed.pdf", type: "application/pdf", bytes: PDF_BYTES });
  const got = await getValuationDocument(env.viewer, doc.id);
  assert.equal(got!.doc.title, "Title deed");
  assert.equal(got!.bytes.byteLength, PDF_BYTES.byteLength);
  assert.equal(await getValuationDocument(other.admin, doc.id), null);
  assert.equal(await getValuation(other.admin, inst.id), null);
  assert.equal((await listValuations(other.admin)).rows.length, 0);
  await assert.rejects(updateInstruction(other.admin, inst.id, { premise: "STANDARD", basis: "MARKET_VALUE" } as never), /not found/i);
  await assert.rejects(addEntry(other.admin, inst.id, "ASSUMPTION", "Cross-company write must fail"), /not found/i);
  await assert.rejects(removeEntry(other.admin, "no-such-entry"), /not found/i);
  const v = await getValuation(env.admin, inst.id);
  assert.equal(v!.documents.length, 1);
});
