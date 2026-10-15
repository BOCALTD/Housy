/**
 * Phase 7 acceptance: "A professional can prepare an evidence-based valuation worksheet, while a project manager
 * can plan work, track costs and progress, record variations, and complete a documented handover."
 * One company, one asset, both journeys end to end, through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createItem } from "../../src/lib/services/inventory";
import {
  addComparable, addEntry, assignValuation, createInstruction, decideReport, getValuation, saveReportDraft, saveWorksheet, submitReport, verifyComparable,
} from "../../src/lib/services/valuation";
import {
  activateProject, addMilestone, addWorkPackage, achieveMilestone, createProject, decideBudget, decideCommitment, decideInvoice, decideVariation, getProject,
  markInvoicePaid, recordForecast, recordInvoice, requestCommitment, requestVariation, setProgress, submitBudget,
} from "../../src/lib/services/project";
import { addProcurement, addQualityCheck, addRisk, appointParty, getProjectDelivery, orderProcurement, recordDelivery, recordProgressUpdate, recordQualityResult, recordSiteInspection } from "../../src/lib/services/project-delivery";
import {
  addProjectDocument, addWarranty, assetProjectHistory, decideCompletion, fixDefect, getProjectHandover, raiseDefect, recordHandover, requestCompletion, tickHandoverItem, verifyDefect,
} from "../../src/lib/services/project-handover";
import { complianceCalendar } from "../../src/lib/services/obligations";
import { workOverview } from "../../src/lib/services/work-overview";
import { addMember, newCompany, PDF_BYTES, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

test("a professional prepares an evidence-based valuation and a project manager delivers and hands over the works", async () => {
  const admin = await newCompany("acc");
  const professional = await addMember(admin, "OFFICER", "valuer");
  const approver = await addMember(admin, "MANAGER", "approver");
  const pm = await addMember(admin, "OFFICER", "pm");
  const director = await addMember(admin, "MANAGER", "director");
  const asset = await createAsset(admin, { name: "Acceptance Plaza", assetClass: "COMMERCIAL", category: "Office block", companyRelationship: "OWNER" });

  // ---- Valuation ----
  const inst = await createInstruction(admin, {
    assetId: asset.id, clientName: "Lender Plc", purpose: "MORTGAGE_SECURITY", basis: "MARKET_VALUE", premise: "STANDARD",
    assetDescription: "Four-storey office block", valuationDate: relativeDate(-3), professionalName: "A. Valuer", professionalBody: "Body", registrationNo: "R-1",
  } as never);
  await assignValuation(admin, inst.id, professional.membershipId);
  await addEntry(professional, inst.id, "LIMITATION", "Floor areas were measured on site only.");
  await addEntry(professional, inst.id, "ASSUMPTION", "Title is good and marketable.");
  const c1 = await addComparable(professional, inst.id, { address: "14 Market Road", evidenceDate: relativeDate(-60), price: "50,000,000", area: "200", adjustment: "10", adjustmentNote: "Inferior position", weight: "100", source: "Agent letter" } as never);
  await addComparable(professional, inst.id, { address: "3 Station Street", evidenceDate: relativeDate(-40), price: "60,000,000", area: "250", adjustment: "0", weight: "100", source: "Deed" } as never);
  await verifyComparable(approver, c1.id);
  await saveWorksheet(professional, inst.id, "SALES_COMPARISON", { subjectArea: "180" });
  await saveReportDraft(professional, inst.id, { summary: "A four-storey office block.", conclusion: "Market value as stated.", concludedValue: "46,000,000" } as never);
  await submitReport(professional, inst.id);
  await assert.rejects(decideReport(professional, inst.id, "approve", "", false), /permission|different person/i);
  await decideReport(approver, inst.id, "approve", "Evidence checked.", false);
  const val = await getValuation(admin, inst.id);
  assert.equal(val!.inst.status, "APPROVED");
  assert.equal(val!.reports[0].authorId, professional.userId);
  assert.equal(val!.reports[0].decidedById, approver.userId);

  // ---- Project ----
  const p = await createProject(admin, { assetId: asset.id, title: "Lobby refurbishment", kind: "RENOVATION", plannedStart: relativeDate(-20), plannedEnd: relativeDate(60), managerId: pm.membershipId, contingency: "500,000" } as never);
  const wpA = (await addWorkPackage(pm, p.id, { title: "Strip out", plannedStart: relativeDate(-20), plannedEnd: relativeDate(0), budget: "2,000,000", responsibleId: pm.membershipId } as never)).workPackage;
  const wpB = (await addWorkPackage(pm, p.id, { title: "Fit out", plannedStart: relativeDate(0), plannedEnd: relativeDate(50), budget: "6,000,000", responsibleId: pm.membershipId } as never)).workPackage;
  await addMilestone(pm, p.id, { title: "Strip out finished", dueOn: relativeDate(1), workPackageId: wpA.id } as never);
  await assert.rejects(activateProject(admin, p.id), /budget/i);
  await submitBudget(pm, p.id);
  await assert.rejects(decideBudget(pm, p.id, "approve", ""), /permission|different person|someone other/i);
  await decideBudget(director, p.id, "approve", "Agreed.");
  await activateProject(admin, p.id);
  const stock = await createItem(admin, { name: "Cement bags", kind: "CONSUMABLE", quantity: "1", unit: "bags" } as never);

  await appointParty(pm, p.id, { role: "CONTRACTOR", name: "Fitout Builders Ltd", scope: "Fit out" });
  const c = await requestCommitment(pm, p.id, { supplierName: "Fitout Builders Ltd", description: "Fit out works", amount: "5,500,000", workPackageId: wpB.id } as never);
  await assert.rejects(decideCommitment(pm, c.id, "approve", ""), /different person|someone other|permission/i);
  await decideCommitment(director, c.id, "approve", "");
  // A commitment above the approved budget is refused until a variation raises it.
  await assert.rejects(requestCommitment(pm, p.id, { supplierName: "Another Ltd", description: "Too much", amount: "9,000,000" } as never), /more than the approved budget/);
  const v = await requestVariation(pm, p.id, { target: "COMMITMENT", commitmentId: c.id, title: "Extra partitions", reason: "Client asked for two more offices.", amount: "400,000", timeImpactDays: "4" } as never);
  await decideVariation(director, v.id, "approve", "Agreed.");

  const mat = await addProcurement(pm, p.id, { description: "Cement", quantity: "20", unit: "bags", requiredBy: relativeDate(5), workPackageId: wpB.id });
  await orderProcurement(director, mat.id, { supplierName: "Building Supplies", commitmentId: c.id });
  await recordDelivery(pm, mat.id, { quantity: "20", inventoryItemId: stock.id });
  await addRisk(pm, p.id, { title: "Lift outage delays materials", likelihood: "4", impact: "4", ownerId: pm.membershipId, mitigation: "Book the goods lift early", reviewOn: relativeDate(7) });
  await recordSiteInspection(pm, p.id, { inspectedOn: relativeDate(0), summary: "Strip out complete and tidy.", outcome: "SATISFACTORY", workPackageId: wpA.id });

  const inv = await recordInvoice(pm, c.id, { invoiceNo: "FB-001", invoiceDate: relativeDate(-1), amount: "2,000,000" } as never);
  await decideInvoice(director, inv.id, "approve", "Work seen.");
  await markInvoicePaid(director, inv.id);

  const check = await addQualityCheck(pm, wpA.id, { title: "Substrate ready for new floor" });
  await setProgress(pm, wpA.id, "IN_PROGRESS", "90");
  await assert.rejects(setProgress(pm, wpA.id, "DONE", "100"), /quality check/);
  await recordQualityResult(director, check.id, "PASSED", "Level and dry");
  await setProgress(pm, wpA.id, "DONE", "100");
  await recordForecast(pm, wpB.id, "6,200,000", "Quote for remaining joinery");
  await setProgress(pm, wpB.id, "IN_PROGRESS", "60");
  await recordProgressUpdate(pm, p.id, { summary: "Strip out done, fit out 60%.", issues: "Lift outage", nextSteps: "Joinery" });
  const mid = await getProject(admin, p.id);
  assert.ok(mid!.cost!.committedKobo > 0n);
  assert.equal(mid!.cost!.paidKobo >= 0n, true);
  assert.ok(mid!.progress > 0 && mid!.progress < 100);
  assert.equal(mid!.cost!.paidKobo, 200_000_000n);
  await achieveMilestone(pm, (mid!.milestones[0]).id).catch(() => undefined);

  // The project is not ready until the fit out is done; completion needs a second person.
  await assert.rejects(requestCompletion(pm, p.id, { note: "", defectsMonths: "12" }), /work package/);
  await setProgress(pm, wpB.id, "DONE", "100");
  await requestCompletion(pm, p.id, { note: "All works complete.", defectsMonths: "6" });
  await decideCompletion(director, p.id, "approve", "Inspected and accepted.");

  // Defect, warranty, documents, handover.
  const defect = await raiseDefect(pm, p.id, { title: "Door sticks", severity: "HIGH" });
  await fixDefect(pm, defect.id, "Door planed and rehung.");
  await assert.rejects(verifyDefect(pm, defect.id, "verify", ""), /Someone other/);
  await verifyDefect(director, defect.id, "verify", "Opens freely.");
  await addProjectDocument(pm, p.id, "DRAWING", "As-built drawings", { name: "asbuilt.pdf", type: "application/pdf", bytes: PDF_BYTES });
  await addWarranty(pm, p.id, { title: "Joinery and doors", provider: "Fitout Builders Ltd", startsOn: relativeDate(0), endsOn: relativeDate(30) });
  const h = await getProjectHandover(admin, p.id);
  assert.equal(h!.project.status, "COMPLETED");
  for (const i of h!.items) await tickHandoverItem(pm, i.id, true, "");
  await recordHandover(director, p.id, { handedTo: "Acceptance Plaza management", note: "Keys, manuals and warranties handed over." });

  // ---- The asset now carries the whole story ----
  const hist = await assetProjectHistory(admin, asset.id);
  assert.equal(hist.projects[0].status, "COMPLETED");
  assert.ok(hist.projects[0].handoverOn);
  assert.equal(hist.warranties.length, 1);
  assert.equal(hist.valuation?.valueKobo, 4_600_000_000n);
  assert.equal(hist.openDefects, 0);
  const done = await getProjectHandover(admin, p.id);
  assert.equal(done!.documents.length, 1);
  assert.equal(done!.defects[0].state, "CLOSED");
  const delivery = await getProjectDelivery(admin, p.id);
  assert.equal(delivery!.procurement[0].status, "DELIVERED");

  // Alerts: the warranty ends within the calendar window, and the dashboard counts are available.
  const cal = await complianceCalendar(admin);
  assert.ok(cal.items.some((i) => i.kind === "WARRANTY"));
  assert.ok(cal.items.some((i) => i.kind === "DEFECTS_PERIOD"));
  const w = await workOverview(admin);
  assert.equal(w!.projects!.active, 0);
  assert.equal(w!.projects!.openDefects, 0);
});
