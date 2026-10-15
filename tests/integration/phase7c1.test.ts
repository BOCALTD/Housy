/**
 * Phase 7c-1: project delivery against a real PostgreSQL database through the runtime role.
 * Parties, procurement and deliveries into stock, stock used on a project, the risk register,
 * site inspections, progress reports and quality checks that block completion.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createItem, useOnProject } from "../../src/lib/services/inventory";
import {
  activateProject, addWorkPackage, createProject, decideBudget, decideCommitment, requestCommitment, setProgress, submitBudget,
} from "../../src/lib/services/project";
import {
  addProcurement, addQualityCheck, addRisk, appointParty, cancelProcurement, deliveryAlerts, endParty, getProjectDelivery, orderProcurement, recordDelivery,
  recordProgressUpdate, recordQualityResult, recordSiteInspection, updateRisk, waiveQualityCheck,
} from "../../src/lib/services/project-delivery";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const viewer = await addMember(admin, "VIEWER", "view");
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  const p = await createProject(admin, { assetId: asset.id, title: "Shopfront", kind: "RENOVATION", plannedStart: relativeDate(-10), plannedEnd: relativeDate(80), managerId: manager.membershipId } as never);
  const wp = (await addWorkPackage(officer, p.id, { title: "Frame", plannedStart: relativeDate(-10), plannedEnd: relativeDate(30), budget: "5,000,000", responsibleId: officer.membershipId } as never)).workPackage;
  await submitBudget(officer, p.id);
  await decideBudget(manager, p.id, "approve", "Agreed");
  await activateProject(admin, p.id);
  const c = await requestCommitment(officer, p.id, { supplierName: "Builder Ltd", description: "Works", amount: "3,000,000", workPackageId: wp.id } as never);
  await decideCommitment(manager, c.id, "approve", "");
  const stock = await createItem(admin, { name: "Cement bags", kind: "CONSUMABLE", quantity: "10", unit: "bags", unitCost: "9,500" } as never);
  return { admin, officer, manager, viewer, asset, p, wp, c, stock };
}

test("parties can be appointed once per role and ended; viewers cannot change anything", async () => {
  const e = await setup("d-party");
  const party = await appointParty(e.officer, e.p.id, { role: "CONTRACTOR", name: "Roofers Ltd", scope: "Roof" });
  await assert.rejects(appointParty(e.officer, e.p.id, { role: "CONTRACTOR", name: "Roofers Ltd" }), /already appointed/);
  await assert.rejects(appointParty(e.officer, e.p.id, { role: "CONSULTANT", name: "x" }), /name/i);
  await assert.rejects(appointParty(e.viewer, e.p.id, { role: "CONSULTANT", name: "Engineer Co" }), /permission/i);
  await endParty(e.officer, party.id);
  await assert.rejects(endParty(e.officer, party.id), /already ended/);
  const d = await getProjectDelivery(e.viewer, e.p.id);
  assert.equal(d?.parties.length, 1);
});

test("procurement runs required, ordered, delivered; deliveries book into stock; the quantity cannot be exceeded", async () => {
  const e = await setup("d-proc");
  const item = await addProcurement(e.officer, e.p.id, { description: "Cement", quantity: "20", unit: "bags", requiredBy: relativeDate(-2), workPackageId: e.wp.id });
  await assert.rejects(recordDelivery(e.officer, item.id, { quantity: "5" }), /ordered/i);
  await assert.rejects(orderProcurement(e.manager, item.id, { supplierName: "Supplier Ltd", commitmentId: "nope" }), /commitment/i);
  await orderProcurement(e.manager, item.id, { supplierName: "Supplier Ltd", commitmentId: e.c.id });
  await assert.rejects(orderProcurement(e.manager, item.id, { supplierName: "Supplier Ltd" }), /already/);
  await assert.rejects(recordDelivery(e.officer, item.id, { quantity: "25" }), /./);
  await recordDelivery(e.officer, item.id, { quantity: "8", inventoryItemId: e.stock.id });
  let d = await getProjectDelivery(e.officer, e.p.id);
  assert.equal(d?.procurement[0].deliveredQty, 8);
  assert.equal(d?.procurement[0].state, "LATE");
  assert.equal(d?.consumables.find((c) => c.id === e.stock.id)?.quantity, 18);
  await assert.rejects(cancelProcurement(e.officer, item.id), /delivered/);
  await recordDelivery(e.officer, item.id, { quantity: "12" });
  d = await getProjectDelivery(e.officer, e.p.id);
  assert.equal(d?.procurement[0].status, "DELIVERED");
  assert.equal(d?.procurement[0].state, "DONE");
});

test("stock is issued to an active project, never below zero, and recorded", async () => {
  const e = await setup("d-stock");
  await useOnProject(e.officer, e.stock.id, e.p.id, { quantity: "4", workPackageId: e.wp.id });
  await assert.rejects(useOnProject(e.officer, e.stock.id, e.p.id, { quantity: "7" }), /./);
  await assert.rejects(useOnProject(e.viewer, e.stock.id, e.p.id, { quantity: "1" }), /permission/i);
  const d = await getProjectDelivery(e.officer, e.p.id);
  assert.equal(d?.stockUses.length, 1);
  assert.equal(d?.consumables.find((c) => c.id === e.stock.id)?.quantity, 6);
});

test("risks are scored, a high risk needs an owner and a plan, and review dates raise alerts", async () => {
  const e = await setup("d-risk");
  await assert.rejects(addRisk(e.officer, e.p.id, { title: "Flooding", likelihood: "5", impact: "4" }), /owner and a plan/);
  const high = await addRisk(e.officer, e.p.id, { title: "Flooding", likelihood: "5", impact: "4", ownerId: e.manager.membershipId, mitigation: "Drain the site daily" });
  const low = await addRisk(e.officer, e.p.id, { title: "Late glass", likelihood: "2", impact: "2", reviewOn: relativeDate(-1) });
  assert.equal(high.ref, "RSK-1");
  assert.equal(low.ref, "RSK-2");
  const alerts = await withTenant(e.admin.companyId, e.admin.userId, (tx) => deliveryAlerts(tx, e.admin.companyId, e.p.id));
  assert.equal(alerts.highRisks, 1);
  assert.equal(alerts.overdueRiskReviews, 1);
  await assert.rejects(updateRisk(e.officer, high.id, { title: "Flooding", likelihood: "5", impact: "4", ownerId: "", mitigation: "", status: "OPEN" }), /owner and a plan/);
  await updateRisk(e.officer, low.id, { title: "Late glass", likelihood: "2", impact: "2", status: "CLOSED", closeNote: "Glass arrived" });
  const d = await getProjectDelivery(e.officer, e.p.id);
  assert.equal(d?.risks.find((r) => r.id === low.id)?.status, "CLOSED");
});

test("site inspections and progress reports are recorded once; a poor outcome needs actions; dates cannot be future", async () => {
  const e = await setup("d-site");
  await assert.rejects(recordSiteInspection(e.officer, e.p.id, { inspectedOn: relativeDate(0), summary: "Frame is out of level", outcome: "ACTIONS_REQUIRED" }), /what must be done/);
  await assert.rejects(recordSiteInspection(e.officer, e.p.id, { inspectedOn: relativeDate(3), summary: "Frame is fine", outcome: "SATISFACTORY" }), /future/);
  const s = await recordSiteInspection(e.officer, e.p.id, { inspectedOn: relativeDate(0), summary: "Frame is out of level", actions: "Re-fix the frame", outcome: "ACTIONS_REQUIRED", workPackageId: e.wp.id });
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE site_inspections SET summary = 'x' WHERE id = '${s.id}'`), /./);
  await setProgress(e.officer, e.wp.id, "IN_PROGRESS", "40");
  const u = await recordProgressUpdate(e.officer, e.p.id, { summary: "Frame going up" });
  assert.equal(u.percentComplete, 40);
  await assert.rejects(recordProgressUpdate(e.viewer, e.p.id, { summary: "Frame going up" }), /permission/i);
});

test("a work package cannot be done while a quality check is open, and the responsible person cannot pass their own work", async () => {
  const e = await setup("d-qual");
  const chk = await addQualityCheck(e.officer, e.wp.id, { title: "Frame is level", standard: "Spec 4" });
  await setProgress(e.officer, e.wp.id, "IN_PROGRESS", "90");
  await assert.rejects(setProgress(e.officer, e.wp.id, "DONE", "100"), /quality check/);
  await assert.rejects(recordQualityResult(e.officer, chk.id, "PASSED", ""), /Someone other/);
  await assert.rejects(recordQualityResult(e.manager, chk.id, "FAILED", ""), /what failed/);
  await recordQualityResult(e.manager, chk.id, "FAILED", "Out of level by 20mm");
  await assert.rejects(setProgress(e.officer, e.wp.id, "DONE", "100"), /quality check/);
  assert.equal((await withTenant(e.admin.companyId, e.admin.userId, (tx) => deliveryAlerts(tx, e.admin.companyId, e.p.id))).failedChecks, 1);
  await recordQualityResult(e.manager, chk.id, "PASSED", "Re-fixed and rechecked");
  await assert.rejects(recordQualityResult(e.manager, chk.id, "FAILED", "again"), /already settled/);
  await setProgress(e.officer, e.wp.id, "DONE", "100");
});

test("waiving a check needs approval rights, a reason and someone other than the responsible person", async () => {
  const e = await setup("d-waive");
  const chk = await addQualityCheck(e.officer, e.wp.id, { title: "Paint finish" });
  await assert.rejects(waiveQualityCheck(e.officer, chk.id, "Not needed here"), /permission/i);
  await assert.rejects(waiveQualityCheck(e.manager, chk.id, "no"), /reason/i);
  await waiveQualityCheck(e.manager, chk.id, "Client accepted the finish");
  await setProgress(e.officer, e.wp.id, "DONE", "100");
});

test("delivery data is isolated between companies", async () => {
  const a = await setup("d-iso-a");
  const b = await setup("d-iso-b");
  await addRisk(a.officer, a.p.id, { title: "Flooding", likelihood: "2", impact: "2" });
  assert.equal(await getProjectDelivery(b.admin, a.p.id), null);
  await assert.rejects(addRisk(b.officer, a.p.id, { title: "Other firm risk", likelihood: "2", impact: "2" }), /not found/i);
});
