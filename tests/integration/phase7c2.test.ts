/**
 * Phase 7c-2: completion, defects, warranties, documents and handover against a real PostgreSQL database through
 * the runtime role. Completion needs a second person, the checks run again at approval, defects are verified by
 * someone other than the fixer, handover needs a complete checklist, and completed work links to the asset.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { activateProject, addWorkPackage, createProject, decideBudget, decideCommitment, getProject, requestCommitment, setProgress, submitBudget } from "../../src/lib/services/project";
import {
  addHandoverItem, addProjectDocument, addWarranty, assetProjectHistory, decideCompletion, defectToWorkOrder, fixDefect, getProjectDocument, getProjectHandover, raiseDefect,
  recordHandover, removeWarranty, requestCompletion, tickHandoverItem, verifyDefect, withdrawCompletion,
} from "../../src/lib/services/project-handover";
import { getWorkOrder } from "../../src/lib/services/maintenance";
import { addMember, newCompany, PDF_BYTES, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "off");
  const officer2 = await addMember(admin, "OFFICER", "off2");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const viewer = await addMember(admin, "VIEWER", "view");
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  const p = await createProject(admin, { assetId: asset.id, title: "Gate repair", kind: "REPAIR_PROGRAMME", plannedStart: relativeDate(-20), plannedEnd: relativeDate(20), managerId: manager.membershipId } as never);
  const wp = (await addWorkPackage(officer, p.id, { title: "Gate", plannedStart: relativeDate(-20), plannedEnd: relativeDate(10), budget: "800,000" } as never)).workPackage;
  await submitBudget(officer, p.id);
  await decideBudget(manager, p.id, "approve", "Agreed");
  await activateProject(admin, p.id);
  return { admin, officer, officer2, manager, viewer, asset, p, wp };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function finished(e: Env) {
  await setProgress(e.officer, e.wp.id, "DONE", "100");
  await requestCompletion(e.officer, e.p.id, { note: "Done", defectsMonths: "12" });
  await decideCompletion(e.manager, e.p.id, "approve", "Accepted");
}

test("completion needs finished work, then a request and a decision by a second person", async () => {
  const e = await setup("c-flow");
  await assert.rejects(requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "12" }), /1 work package is not done/);
  await setProgress(e.officer, e.wp.id, "DONE", "100");
  await assert.rejects(requestCompletion(e.viewer, e.p.id, { note: "", defectsMonths: "12" }), /permission/i);
  await assert.rejects(requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "99" }), /0 to 60/);
  await requestCompletion(e.officer, e.p.id, { note: "Done", defectsMonths: "6" });
  await assert.rejects(requestCompletion(e.officer2, e.p.id, { note: "", defectsMonths: "6" }), /already been requested/);
  await assert.rejects(decideCompletion(e.officer, e.p.id, "approve", ""), /permission/i);
  await assert.rejects(decideCompletion(e.manager, e.p.id, "reject", ""), /why/i);
  await decideCompletion(e.manager, e.p.id, "reject", "Snags not listed");
  assert.equal((await getProject(e.admin, e.p.id))?.project.status, "ACTIVE");
  await requestCompletion(e.officer, e.p.id, { note: "Done", defectsMonths: "6" });
  await withdrawCompletion(e.officer, e.p.id);
  await requestCompletion(e.manager, e.p.id, { note: "Done", defectsMonths: "6" });
  await assert.rejects(decideCompletion(e.manager, e.p.id, "approve", ""), /Someone other/);
  await decideCompletion(e.admin, e.p.id, "approve", "Accepted");
  const h = await getProjectHandover(e.admin, e.p.id);
  assert.equal(h?.project.status, "COMPLETED");
  assert.equal(h?.project.completedById, e.admin.userId);
  assert.equal(h?.items.length, 7);
  const end = h?.project.defectsPeriodEnd;
  assert.ok(end && end.getTime() > Date.now());
  await assert.rejects(requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "6" }), /active project/);
});

test("an unverified critical defect, or an undecided request, blocks completion, and approval re-checks", async () => {
  const e = await setup("c-block");
  await setProgress(e.officer, e.wp.id, "DONE", "100");
  const crit = await raiseDefect(e.officer, e.p.id, { title: "Gate falls over", severity: "CRITICAL" });
  await assert.rejects(requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "12" }), /critical defect/);
  await fixDefect(e.officer, crit.id, "Reset the gate posts");
  await assert.rejects(requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "12" }), /critical defect/);
  await verifyDefect(e.manager, crit.id, "verify", "Checked");
  const c = await requestCommitment(e.officer, e.p.id, { supplierName: "Builder Ltd", description: "Extra", amount: "100,000" } as never);
  await assert.rejects(requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "12" }), /waiting for a decision/);
  await decideCommitment(e.manager, c.id, "approve", "");
  await requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "12" });
  // A new critical defect appears before the decision: approval must refuse.
  await raiseDefect(e.officer2, e.p.id, { title: "Lock fails", severity: "CRITICAL" });
  await assert.rejects(decideCompletion(e.manager, e.p.id, "approve", ""), /no longer ready/);
});

test("two approvals at once complete the project only once", async () => {
  const e = await setup("c-race");
  await setProgress(e.officer, e.wp.id, "DONE", "100");
  await requestCompletion(e.officer, e.p.id, { note: "", defectsMonths: "12" });
  const results = await Promise.allSettled([decideCompletion(e.manager, e.p.id, "approve", ""), decideCompletion(e.admin, e.p.id, "approve", "")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const h = await getProjectHandover(e.admin, e.p.id);
  assert.equal(h?.items.length, 7);
});

test("defects: the fixer cannot verify, a failed fix is sent back, and the liability period bounds new defects", async () => {
  const e = await setup("c-def");
  await assert.rejects(raiseDefect(e.viewer, e.p.id, { title: "Crack", severity: "LOW" }), /permission/i);
  await assert.rejects(raiseDefect(e.officer, e.p.id, { title: "Crack", severity: "LOW", dueOn: relativeDate(-2) }), /past/);
  const d1 = await raiseDefect(e.officer, e.p.id, { title: "Crack in the wall", severity: "MEDIUM", workPackageId: e.wp.id });
  assert.equal(d1.ref, "DEF-1");
  await assert.rejects(verifyDefect(e.manager, d1.id, "verify", ""), /marked as fixed/);
  await fixDefect(e.officer, d1.id, "Filled and painted");
  await assert.rejects(fixDefect(e.officer, d1.id, "again"), /already/);
  await assert.rejects(verifyDefect(e.officer, d1.id, "verify", ""), /Someone other/);
  await assert.rejects(verifyDefect(e.manager, d1.id, "reject", ""), /still wrong/);
  await verifyDefect(e.manager, d1.id, "reject", "Crack is back");
  let d = await getProjectHandover(e.admin, e.p.id);
  assert.equal(d?.defects[0].status, "OPEN");
  await fixDefect(e.officer2, d1.id, "Re-plastered");
  await verifyDefect(e.officer, d1.id, "verify", "Good");
  d = await getProjectHandover(e.admin, e.p.id);
  assert.equal(d?.defects[0].state, "CLOSED");
  await finished(e);
  await raiseDefect(e.officer, e.p.id, { title: "Hinge squeaks", severity: "LOW" });
  // End the liability period and refuse new defects.
  await withTenant(e.admin.companyId, e.admin.userId, (tx) => tx.$executeRawUnsafe(`UPDATE projects SET defects_period_end = CURRENT_DATE - 1 WHERE id = '${e.p.id}'`));
  await assert.rejects(raiseDefect(e.officer, e.p.id, { title: "Late defect", severity: "LOW" }), /liability period/);
});

test("a defect becomes one maintenance work order, and a warranty in force shows on it", async () => {
  const e = await setup("c-wo");
  await finished(e);
  const d = await raiseDefect(e.officer, e.p.id, { title: "Gate drags", severity: "HIGH" });
  await assert.rejects(defectToWorkOrder(e.viewer, d.id), /permission/i);
  const results = await Promise.allSettled([defectToWorkOrder(e.officer, d.id), defectToWorkOrder(e.manager, d.id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const after_ = await getProjectHandover(e.admin, e.p.id);
  const woId = after_?.defects[0].workOrderId;
  assert.ok(woId);
  await addWarranty(e.officer, e.p.id, { title: "Gate", provider: "Ironworks Ltd", startsOn: relativeDate(-2), endsOn: relativeDate(300) });
  const wo = await getWorkOrder(e.admin, woId!);
  assert.equal(wo?.wo.riskLevel, "HIGH");
  assert.equal(wo?.warranties.length, 1);
  assert.match(wo!.wo.title, /DEF-1/);
});

test("warranties are checked, linked to the asset, and removed only by a manager", async () => {
  const e = await setup("c-war");
  await assert.rejects(addWarranty(e.officer, e.p.id, { title: "Gate", provider: "Ironworks", startsOn: relativeDate(5), endsOn: relativeDate(1) }), /before it starts/);
  await assert.rejects(addWarranty(e.officer, e.p.id, { title: "Gate", provider: "", startsOn: relativeDate(1), endsOn: relativeDate(5) }), /who gives/);
  await assert.rejects(addWarranty(e.officer, e.p.id, { title: "Gate", provider: "Ironworks", startsOn: relativeDate(0), endsOn: relativeDate(100), documentId: "nope" }), /Document not found/);
  const w = await addWarranty(e.officer, e.p.id, { title: "Gate", provider: "Ironworks", startsOn: relativeDate(0), endsOn: relativeDate(100) });
  assert.equal(w.assetId, e.asset.id);
  const hist = await assetProjectHistory(e.viewer, e.asset.id);
  assert.equal(hist.warranties.length, 1);
  assert.equal(hist.projects.length, 1);
  await assert.rejects(removeWarranty(e.officer, w.id), /permission/i);
  await removeWarranty(e.manager, w.id);
  assert.equal((await assetProjectHistory(e.viewer, e.asset.id)).warranties.length, 0);
});

test("project documents are stored, downloadable by members and isolated between companies", async () => {
  const a = await setup("c-doc-a");
  const b = await setup("c-doc-b");
  await assert.rejects(addProjectDocument(a.officer, a.p.id, "DRAWING", "Plan", { name: "plan.pdf", type: "application/pdf", bytes: new Uint8Array() }), /./);
  await assert.rejects(addProjectDocument(a.viewer, a.p.id, "DRAWING", "Plan", { name: "plan.pdf", type: "application/pdf", bytes: PDF_BYTES }), /permission/i);
  const doc = await addProjectDocument(a.officer, a.p.id, "DRAWING", "Floor plan", { name: "plan.pdf", type: "application/pdf", bytes: PDF_BYTES });
  const got = await getProjectDocument(a.viewer, doc.id);
  assert.equal(got?.doc.title, "Floor plan");
  assert.equal(got?.bytes.byteLength, PDF_BYTES.byteLength);
  assert.equal(await getProjectDocument(b.admin, doc.id), null);
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE project_documents SET title = 'x' WHERE id = '${doc.id}'`), /./);
});

test("handover needs every item ticked, no serious open defects and a recipient; it is recorded once and links the asset", async () => {
  const e = await setup("c-hand");
  await assert.rejects(recordHandover(e.manager, e.p.id, { handedTo: "Owner" }), /completed project/);
  await finished(e);
  const h0 = await getProjectHandover(e.admin, e.p.id);
  await assert.rejects(recordHandover(e.officer, e.p.id, { handedTo: "Owner" }), /permission/i);
  await assert.rejects(recordHandover(e.manager, e.p.id, { handedTo: "Owner" }), /not ticked/);
  await addHandoverItem(e.officer, e.p.id, "Gate keys counted");
  for (const i of (await getProjectHandover(e.admin, e.p.id))!.items) await tickHandoverItem(e.officer, i.id, true, "ok");
  const high = await raiseDefect(e.officer, e.p.id, { title: "Latch broken", severity: "HIGH" });
  await assert.rejects(recordHandover(e.manager, e.p.id, { handedTo: "Owner" }), /high or critical/);
  await fixDefect(e.officer, high.id, "New latch");
  await verifyDefect(e.manager, high.id, "verify", "Works");
  await assert.rejects(recordHandover(e.manager, e.p.id, { handedTo: "" }), /Name the person/);
  await assert.rejects(recordHandover(e.manager, e.p.id, { handedTo: "Owner", handoverOn: relativeDate(3) }), /future/);
  await recordHandover(e.manager, e.p.id, { handedTo: "Owner Ltd", note: "Keys and papers handed over" });
  await assert.rejects(recordHandover(e.manager, e.p.id, { handedTo: "Owner Ltd" }), /already been handed over/);
  await assert.rejects(tickHandoverItem(e.officer, h0!.items[0].id, false, ""), /can no longer change/);
  const hist = await assetProjectHistory(e.viewer, e.asset.id);
  assert.equal(hist.projects[0].status, "COMPLETED");
  assert.ok(hist.projects[0].handoverOn);
  const log = await withTenant(e.admin.companyId, e.admin.userId, (tx) => tx.activityLog.findMany({ where: { companyId: e.admin.companyId, entityType: "asset", entityId: e.asset.id, action: { startsWith: "project." } } }));
  const actions = log.map((l) => l.action);
  assert.ok(actions.includes("project.completed"));
  assert.ok(actions.includes("project.handed_over"));
});

test("completion and handover data is isolated between companies", async () => {
  const a = await setup("c-iso-a");
  const b = await setup("c-iso-b");
  await finished(a);
  assert.equal(await getProjectHandover(b.admin, a.p.id), null);
  await assert.rejects(raiseDefect(b.officer, a.p.id, { title: "Other firm", severity: "LOW" }), /not found/i);
});
