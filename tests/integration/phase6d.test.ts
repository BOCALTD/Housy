/**
 * Phase 6d: maintenance dashboard figures and calendar alerts against a real PostgreSQL database.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { complianceCalendar } from "../../src/lib/services/obligations";
import { addFinding, createTemplate, decideInspection, getInspection, listInspections, saveInspectionRecord, scheduleInspection, submitInspection } from "../../src/lib/services/inspections";
import {
  addWorkOrderPhoto, approveWorkOrder, assetMaintenance, assignWorkOrder, closeWorkOrder, completeWorkOrder, createContractor, getWorkOrder, listMaintenance,
  reportWorkOrder, setProgress, triageWorkOrder,
} from "../../src/lib/services/maintenance";
import { createItem, getItem, inventorySummary, useOnWorkOrder } from "../../src/lib/services/inventory";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64"));
const photo = { name: "p.png", type: "image/png", bytes: PNG };

test("urgent work nobody has taken up, late work and due inspections appear on the calendar", async () => {
  const admin = await newCompany("cal");
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const asset = await createAsset(admin, { name: "Calendar building", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });

  const urgent = await reportWorkOrder(officer, asset.id, { title: "Gas smell in kitchen", priority: "EMERGENCY", riskLevel: "CRITICAL", safetyRisk: true } as never);
  const fresh = await reportWorkOrder(officer, asset.id, { title: "Another emergency", priority: "EMERGENCY", riskLevel: "HIGH" } as never);
  const late = await reportWorkOrder(officer, asset.id, { title: "Fix the gate", targetDate: relativeDate(-3) } as never);
  const calm = await reportWorkOrder(officer, asset.id, { title: "Paint the fence", targetDate: relativeDate(20) } as never);
  // Make the first emergency 30 hours old.
  await withTenant(admin.companyId, admin.userId, (tx) =>
    tx.workOrder.update({ where: { id: urgent.id }, data: { createdAt: new Date(Date.now() - 30 * 3_600_000) } }));

  await createTemplate(admin, { name: "Quick", assetClass: "COMMERCIAL", checklist: "Roof | Sound" });
  const templateId = (await listInspections(admin)).templates[0].id;
  const due = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(-2) });

  const cal = await complianceCalendar(officer);
  const byId = (id: string) => cal.items.find((i) => i.id === id);
  const flagged = byId(`${urgent.id}:urgent`);
  assert.ok(flagged, "unattended urgent work is flagged");
  assert.equal(flagged!.kind, "URGENT_WORK");
  assert.ok(flagged!.state === "OVERDUE" || flagged!.state === "ESCALATED");
  assert.equal(byId(`${fresh.id}:urgent`), undefined, "recently reported urgent work is not flagged yet");
  assert.equal(byId(late.id)!.kind, "WORK_ORDER");
  assert.equal(byId(late.id)!.state, "OVERDUE");
  assert.equal(byId(calm.id)!.state === "LATER" || byId(calm.id)!.state === "DUE_SOON", true);
  assert.equal(byId(due.id)!.kind, "INSPECTION");
  assert.equal(byId(due.id)!.state, "OVERDUE");

  const dash = await listMaintenance(officer);
  assert.equal(dash.unattendedUrgent, 1);
  assert.equal(dash.overdue.length, 1);

  // Once the urgent job is assigned it stops being flagged.
  await assignWorkOrder(admin, urgent.id, { assigneeId: officer.membershipId });
  assert.equal((await complianceCalendar(officer)).items.find((i) => i.id === `${urgent.id}:urgent`), undefined);
  assert.equal((await listMaintenance(officer)).unattendedUrgent, 0);
  assert.ok(manager.userId);
});

test("spend this year counts closed work only, and inventory figures are summed", async () => {
  const admin = await newCompany("dash");
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const asset = await createAsset(admin, { name: "Dashboard building", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  const wo = await reportWorkOrder(officer, asset.id, { title: "Replace pump" } as never);
  await triageWorkOrder(admin, wo.id, { priority: "NORMAL", riskLevel: "LOW" } as never);
  await approveWorkOrder(manager, wo.id, { approvedCost: "60,000" });
  await assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId });
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  await completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Pump replaced", evidenceRef: "INV-1", actualCost: "55,000" });
  assert.equal((await listMaintenance(admin)).spentThisYearKobo, 0n);
  await closeWorkOrder(manager, wo.id, "");
  assert.equal((await listMaintenance(admin)).spentThisYearKobo, 5_500_000n);

  await createItem(admin, { name: "Cement", kind: "CONSUMABLE", quantity: "3", unit: "bags", unitCost: "10,000", reorderLevel: "5" } as never);
  await createItem(admin, { name: "Table", kind: "MOVABLE", quantity: "2", unitCost: "50,000" } as never);
  const s = await inventorySummary(admin);
  assert.equal(s.items, 2);
  assert.equal(s.lowStock, 1);
  assert.equal(s.stockValueKobo, 3n * 1_000_000n + 2n * 5_000_000n);
  assert.equal(s.openCounts, 0);
});

test("acceptance: inspect an asset, record a defect, raise a work order, assign a contractor, track materials, verify completion and keep the history", async () => {
  const admin = await newCompany("accept");
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const asset = await createAsset(admin, { name: "Acceptance building", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  const contractor = await createContractor(admin, { name: "Roof Masters", trade: "Roofing" } as never);
  const stock = await createItem(admin, { name: "Roofing sheets", kind: "CONSUMABLE", quantity: "20", unit: "sheets", unitCost: "6,000", assetId: asset.id } as never);

  await createTemplate(admin, { name: "Quick", assetClass: "COMMERCIAL", checklist: "Roof | Sound" });
  const templateId = (await listInspections(admin)).templates[0].id;
  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(0), inspectorId: officer.membershipId });
  const rows = (await getInspection(admin, ins.id))!.inspection.responses;
  await saveInspectionRecord(officer, ins.id, {
    conductedOn: relativeDate(0), conditionRating: "POOR", summary: "Roof is leaking", recommendedActions: "", responses: Object.fromEntries(rows.map((r) => [r.id, { result: "FAIL", note: "Leaks" }])),
  } as never);
  const finding = await addFinding(officer, ins.id, { title: "Roof leak", severity: "HIGH", estimatedCost: "150,000" } as never, { ...photo, phase: "EVIDENCE", caption: "Stain" });
  await submitInspection(officer, ins.id);
  await decideInspection(manager, ins.id, "approve", "");

  const wo = await reportWorkOrder(officer, asset.id, { title: "Roof leak", priority: "HIGH", riskLevel: "HIGH", findingId: finding.id, estimatedCost: "150,000" } as never);
  await triageWorkOrder(admin, wo.id, { priority: "HIGH", riskLevel: "HIGH", estimatedCost: "150,000" } as never);
  await approveWorkOrder(manager, wo.id, { approvedCost: "160,000" });
  await assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId, contractorId: contractor.id });
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  await addWorkOrderPhoto(officer, wo.id, { phase: "BEFORE", caption: "Before" }, photo);
  await useOnWorkOrder(officer, stock.id, wo.id, { quantity: "8" });
  await addWorkOrderPhoto(officer, wo.id, { phase: "AFTER", caption: "After" }, photo);
  await completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Sheets replaced and sealed", actualCost: "150,000", downtimeFrom: relativeDate(-1), downtimeTo: relativeDate(0) });
  await closeWorkOrder(manager, wo.id, "Dry after rain");

  const full = (await getWorkOrder(admin, wo.id))!;
  assert.equal(full.wo.status, "CLOSED");
  assert.equal(full.wo.contractorId, contractor.id);
  assert.equal(full.wo.finding!.id, finding.id);
  assert.equal(full.materialsTotal, 8n * 600000n);
  assert.deepEqual(full.photos.map((p) => p.phase).sort(), ["AFTER", "BEFORE"]);
  assert.deepEqual(full.wo.events.map((e) => e.kind), ["REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "MATERIAL_ADDED", "COMPLETED", "CLOSED"]);
  assert.equal((await getItem(admin, stock.id))!.item.quantity, 12);
  const history = await assetMaintenance(admin, asset.id);
  assert.equal(history.rows.length, 1);
  assert.equal(history.downtimeDays, 2);
  assert.equal((await getInspection(admin, ins.id))!.inspection.status, "APPROVED");
});
