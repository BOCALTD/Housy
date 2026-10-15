/**
 * Phase 6b: maintenance and work orders against a real PostgreSQL database through the runtime role.
 * Full flow, emergency path, role permissions, second-person approval and verification, completion
 * evidence, cost control, materials, preventive schedules (idempotent and concurrent) and isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import {
  addFinding, decideInspection, createTemplate, getInspection, listInspections, saveInspectionRecord, scheduleInspection, submitInspection,
} from "../../src/lib/services/inspections";
import {
  addMaterial, addWorkOrderPhoto, approveWorkOrder, assetMaintenance, assignWorkOrder, cancelWorkOrder, closeWorkOrder, completeWorkOrder,
  contractorSummary, createContractor, createSchedule, generateDueWorkOrders, getWorkOrder, listMaintenance, removeMaterial, reopenWorkOrder,
  reportWorkOrder, setContractorActive, setProgress, setScheduleActive, triageWorkOrder,
} from "../../src/lib/services/maintenance";
import { addMember, newCompany, relativeDate, withRole } from "./helpers";

after(() => prisma.$disconnect());

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64"));
const photo = { name: "p.png", type: "image/png", bytes: PNG };

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  return { admin, officer, manager, asset };
}

const report = (ctx: Awaited<ReturnType<typeof newCompany>>, assetId: string, extra: Record<string, unknown> = {}) =>
  reportWorkOrder(ctx, assetId, { title: "Leaking tap", description: "Kitchen", ...extra } as never);

test("a work order runs from report to verified closure and keeps its history", async () => {
  const { admin, officer, manager, asset } = await setup("flow");
  const contractor = await createContractor(admin, { name: "Pipes Ltd", trade: "Plumbing" } as never);
  const wo = await report(officer, asset.id, { estimatedCost: "20,000" });
  assert.match(wo.ref, /^WO-\d{4}-0001$/);
  assert.equal(wo.status, "REPORTED");

  await assert.rejects(approveWorkOrder(manager, wo.id, { approvedCost: "20,000" }), /Triage/);
  await assert.rejects(assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId }), /Approve/);
  await triageWorkOrder(manager, wo.id, { priority: "NORMAL", riskLevel: "LOW", estimatedCost: "20,000" } as never);
  await assert.rejects(approveWorkOrder(officer, wo.id, { approvedCost: "20,000" }), /permission/i);
  await approveWorkOrder(manager, wo.id, { approvedCost: "25,000" });
  await assignWorkOrder(manager, wo.id, { assigneeId: officer.membershipId, contractorId: contractor.id });
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  await addMaterial(officer, wo.id, { description: "Tap washer", quantity: "4", unit: "pcs", unitCost: "1,500" });
  await addWorkOrderPhoto(officer, wo.id, { phase: "BEFORE", caption: "Leak" }, photo);

  await assert.rejects(completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Fixed the tap" }), /after photograph/);
  await addWorkOrderPhoto(officer, wo.id, { phase: "AFTER", caption: "Fixed" }, photo);
  await assert.rejects(completeWorkOrder(officer, wo.id, { completedOn: relativeDate(1), notes: "Fixed the tap" }), /future/);
  await assert.rejects(completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "ok" }), /Describe/);
  await completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Replaced washers", actualCost: "6,000", downtimeFrom: relativeDate(-2), downtimeTo: relativeDate(0) });

  await assert.rejects(closeWorkOrder(officer, wo.id, ""), /permission/i);
  const closer = await addMember(admin, "MANAGER", "mgr2");
  await closeWorkOrder(closer, wo.id, "Checked");
  const full = (await getWorkOrder(admin, wo.id))!;
  assert.equal(full.wo.status, "CLOSED");
  assert.equal(full.photos.length, 2);
  assert.deepEqual(full.wo.events.map((e) => e.kind), ["REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "MATERIAL_ADDED", "COMPLETED", "CLOSED"]);

  const history = await assetMaintenance(admin, asset.id);
  assert.equal(history.rows.length, 1);
  assert.equal(history.downtimeDays, 3);
  const summary = (await contractorSummary(admin)).find((c) => c.id === contractor.id)!;
  assert.equal(summary.spendKobo, 600000n);
  assert.equal(summary.openCount, 0);

  // The history cannot be rewritten by the application role.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.workOrderEvent.deleteMany({ where: { workOrderId: wo.id } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.workOrderEvent.updateMany({ where: { workOrderId: wo.id }, data: { note: "x" } })));
});

test("the person who reported the work cannot approve it, and the person who did it cannot verify it", async () => {
  const { admin, officer, manager, asset } = await setup("sod");
  const wo = await report(manager, asset.id);
  await triageWorkOrder(admin, wo.id, { priority: "NORMAL", riskLevel: "LOW" } as never);
  await assert.rejects(approveWorkOrder(manager, wo.id, { approvedCost: "10,000" }), /someone other than/);
  await approveWorkOrder(admin, wo.id, { approvedCost: "10,000" });
  await assignWorkOrder(admin, wo.id, { assigneeId: manager.membershipId });
  await setProgress(manager, wo.id, "IN_PROGRESS", "");
  await completeWorkOrder(manager, wo.id, { completedOn: relativeDate(0), notes: "All done", evidenceRef: "JOB-001", actualCost: "9,000" });
  await assert.rejects(closeWorkOrder(manager, wo.id, ""), /someone other than/);
  // An administrator who is neither the assignee nor the completer can verify.
  await closeWorkOrder(admin, wo.id, "");
  // An officer assigned to work cannot verify even if given the role elsewhere.
  const wo2 = await report(admin, asset.id);
  await triageWorkOrder(admin, wo2.id, { priority: "NORMAL", riskLevel: "LOW" } as never);
  await approveWorkOrder(manager, wo2.id, { approvedCost: "5,000" });
  await assignWorkOrder(admin, wo2.id, { assigneeId: officer.membershipId });
  await setProgress(officer, wo2.id, "IN_PROGRESS", "");
  await completeWorkOrder(officer, wo2.id, { completedOn: relativeDate(0), notes: "Done and tested", evidenceRef: "JOB-002" });
  await assert.rejects(closeWorkOrder(withRole(officer, "MANAGER"), wo2.id, ""), /someone other than/);
});

test("an emergency can be assigned and worked before approval but not closed without it", async () => {
  const { admin, officer, manager, asset } = await setup("emerg");
  const wo = await report(officer, asset.id, { title: "Burst main pipe", priority: "EMERGENCY", riskLevel: "CRITICAL", safetyRisk: true });
  // Ordinary work would need approval first; the emergency does not.
  await assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId });
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  await completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Main isolated and repaired", evidenceRef: "EMG-1", actualCost: "40,000" });
  await assert.rejects(closeWorkOrder(manager, wo.id, ""), /cost must be approved/);
  await assert.rejects(approveWorkOrder(officer, wo.id, { approvedCost: "40,000" }), /permission/i);
  await approveWorkOrder(manager, wo.id, { approvedCost: "40,000", note: "Emergency spend" });
  await closeWorkOrder(manager, wo.id, "");
  assert.equal((await getWorkOrder(admin, wo.id))!.wo.status, "CLOSED");

  // A non-emergency report cannot skip the steps.
  const plain = await report(officer, asset.id);
  await assert.rejects(assignWorkOrder(admin, plain.id, { assigneeId: officer.membershipId }), /Approve/);
});

test("closure is blocked when the actual cost is above the approved cost until a higher amount is approved", async () => {
  const { admin, officer, manager, asset } = await setup("cost");
  const wo = await report(officer, asset.id);
  await triageWorkOrder(admin, wo.id, { priority: "HIGH", riskLevel: "MEDIUM" } as never);
  await approveWorkOrder(manager, wo.id, { approvedCost: "10,000" });
  await assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId });
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  await completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Repaired fully", evidenceRef: "INV-77", actualCost: "15,000" });
  await assert.rejects(closeWorkOrder(manager, wo.id, ""), /more than the approved/);
  await approveWorkOrder(manager, wo.id, { approvedCost: "15,000" });
  await closeWorkOrder(manager, wo.id, "");
});

test("work can wait for parts, be sent back after verification, and be cancelled with a reason", async () => {
  const { admin, officer, manager, asset } = await setup("states");
  const wo = await report(officer, asset.id);
  await assert.rejects(setProgress(officer, wo.id, "IN_PROGRESS", ""), /Only the assigned|Assign|cannot go/);
  await triageWorkOrder(admin, wo.id, { priority: "NORMAL", riskLevel: "LOW" } as never);
  await approveWorkOrder(manager, wo.id, { approvedCost: "8,000" });
  await assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId });
  const stranger = await addMember(admin, "OFFICER", "stranger");
  await assert.rejects(setProgress(stranger, wo.id, "IN_PROGRESS", ""), /Only the assigned/);
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  await assert.rejects(setProgress(officer, wo.id, "AWAITING_PARTS", ""), /Say what is needed/);
  await setProgress(officer, wo.id, "AWAITING_PARTS", "Waiting for a washer");
  await setProgress(officer, wo.id, "IN_PROGRESS", "Part arrived");
  await completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Part fitted", evidenceRef: "REF-1" });
  await assert.rejects(reopenWorkOrder(manager, wo.id, "no"), /still wrong/);
  await reopenWorkOrder(manager, wo.id, "Still dripping at the joint");
  assert.equal((await getWorkOrder(admin, wo.id))!.wo.status, "IN_PROGRESS");
  await assert.rejects(cancelWorkOrder(officer, wo.id, "Not needed any more"), /permission/i);
  await assert.rejects(cancelWorkOrder(admin, wo.id, "no"), /reason/i);
  await cancelWorkOrder(admin, wo.id, "Tenant fixed it themselves");
  await assert.rejects(setProgress(officer, wo.id, "IN_PROGRESS", ""), /cancelled/);
});

test("materials are totalled, only the worker can change them, and they freeze on completion", async () => {
  const { admin, officer, manager, asset } = await setup("mats");
  const other = await addMember(admin, "OFFICER", "other");
  const wo = await report(officer, asset.id);
  await triageWorkOrder(admin, wo.id, { priority: "NORMAL", riskLevel: "LOW" } as never);
  await approveWorkOrder(manager, wo.id, { approvedCost: "50,000" });
  await assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId });
  await assert.rejects(addMaterial(other, wo.id, { description: "Cement", quantity: "2", unit: "bags", unitCost: "9,000" }), /Only the assigned/);
  await assert.rejects(addMaterial(officer, wo.id, { description: "Cement", quantity: "0", unit: "bags", unitCost: "9,000" }), /more than zero/);
  const m1 = await addMaterial(officer, wo.id, { description: "Cement", quantity: "2", unit: "bags", unitCost: "9,000" });
  await addMaterial(manager, wo.id, { description: "Sand", quantity: "1", unit: "load", unitCost: "12,000.50" });
  assert.equal((await getWorkOrder(admin, wo.id))!.materialsTotal, 3000050n);
  await removeMaterial(officer, wo.id, m1.id);
  assert.equal((await getWorkOrder(admin, wo.id))!.materialsTotal, 1200050n);
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  await completeWorkOrder(officer, wo.id, { completedOn: relativeDate(0), notes: "Wall patched", evidenceRef: "JC-9" });
  await assert.rejects(addMaterial(officer, wo.id, { description: "More", quantity: "1", unit: "", unitCost: "100" }), /once the work is completed/);
});

test("a finding is turned into one work order and the link is kept", async () => {
  const { admin, officer, manager, asset } = await setup("finding");
  await createTemplate(admin, { name: "Quick", assetClass: "COMMERCIAL", checklist: "Roof | Sound" });
  const templateId = (await listInspections(admin)).templates[0].id;
  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(0), inspectorId: officer.membershipId });
  const rows = (await getInspection(admin, ins.id))!.inspection.responses;
  await saveInspectionRecord(officer, ins.id, {
    conductedOn: relativeDate(0), conditionRating: "FAIR", summary: "Leak found", recommendedActions: "", responses: Object.fromEntries(rows.map((r) => [r.id, { result: "FAIL", note: "Leaking" }])),
  } as never);
  const finding = await addFinding(officer, ins.id, { title: "Roof leak", severity: "HIGH", location: "Store", estimatedCost: "100,000", recommendedAction: "Reseal" } as never);
  await submitInspection(officer, ins.id);
  await decideInspection(manager, ins.id, "approve", "");

  const wo = await reportWorkOrder(officer, asset.id, { title: "Roof leak", priority: "HIGH", riskLevel: "HIGH", findingId: finding.id } as never);
  assert.equal(wo.source, "INSPECTION");
  const linked = await withTenant(admin.companyId, admin.userId, (tx) => tx.inspectionFinding.findUniqueOrThrow({ where: { id: finding.id } }));
  assert.equal(linked.workOrderId, wo.id);
  assert.equal((await getWorkOrder(admin, wo.id))!.wo.finding!.id, finding.id);
  await assert.rejects(reportWorkOrder(officer, asset.id, { title: "Roof leak again", findingId: finding.id } as never), /already been raised/);

  const other = await createAsset(admin, { name: "Another building", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  await assert.rejects(reportWorkOrder(officer, other.id, { title: "Wrong asset", findingId: finding.id } as never), /not found for this asset/);
});

test("recurring work orders are created once, ahead of the due date, and not duplicated by concurrent runs", async () => {
  const { admin, officer, manager, asset } = await setup("sched");
  await assert.rejects(createSchedule(officer, asset.id, { title: "Service generator", intervalMonths: "3", nextDueOn: relativeDate(5) } as never), /permission/i);
  await assert.rejects(createSchedule(admin, asset.id, { title: "Service generator", intervalMonths: "0", nextDueOn: relativeDate(5) } as never), /interval/i);
  const far = await createSchedule(admin, asset.id, { title: "Annual fire check", intervalMonths: "12", nextDueOn: relativeDate(90), leadDays: "14" } as never);
  const soon = await createSchedule(admin, asset.id, { title: "Generator service", intervalMonths: "3", nextDueOn: relativeDate(5), leadDays: "14", assigneeId: officer.membershipId, estimatedCost: "45,000" } as never);
  const results = await Promise.all([generateDueWorkOrders(admin), generateDueWorkOrders(manager), generateDueWorkOrders(admin)]);
  assert.equal(results.reduce((a, b) => a + b, 0), 1);
  assert.equal(await generateDueWorkOrders(admin), 0);
  const orders = await withTenant(admin.companyId, admin.userId, (tx) => tx.workOrder.findMany({ where: { scheduleId: soon.id } }));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].source, "PREVENTIVE");
  assert.equal(orders[0].assigneeId, officer.membershipId);
  const after = await withTenant(admin.companyId, admin.userId, (tx) => tx.preventiveSchedule.findUniqueOrThrow({ where: { id: soon.id } }));
  assert.ok(after.nextDueOn.getTime() > new Date(relativeDate(60)).getTime());
  const untouched = await withTenant(admin.companyId, admin.userId, (tx) => tx.workOrder.count({ where: { scheduleId: far.id } }));
  assert.equal(untouched, 0);

  await setScheduleActive(admin, soon.id, false);
  await withTenant(admin.companyId, admin.userId, (tx) => tx.preventiveSchedule.update({ where: { id: soon.id }, data: { nextDueOn: new Date(relativeDate(-1)) } }));
  assert.equal(await generateDueWorkOrders(admin), 0);
  await assert.rejects(setScheduleActive(officer, soon.id, true), /permission/i);
});

test("contractors are unique per company, can be switched off, and cannot be assigned while off", async () => {
  const { admin, officer, manager, asset } = await setup("contr");
  await assert.rejects(createContractor(officer, { name: "Pipes Ltd" } as never), /permission/i);
  const c = await createContractor(admin, { name: "Pipes Ltd", trade: "Plumbing" } as never);
  await assert.rejects(createContractor(manager, { name: "Pipes Ltd" } as never), /already exists/);
  await setContractorActive(admin, c.id, false);
  const wo = await report(officer, asset.id);
  await triageWorkOrder(admin, wo.id, { priority: "NORMAL", riskLevel: "LOW" } as never);
  await approveWorkOrder(manager, wo.id, { approvedCost: "1,000" });
  await assert.rejects(assignWorkOrder(admin, wo.id, { contractorId: c.id }), /switched off/);
  await assert.rejects(assignWorkOrder(admin, wo.id, {}), /Choose an officer/);
});

test("maintenance data is isolated between companies", async () => {
  const a = await setup("isoa");
  const b = await setup("isob");
  const wo = await report(a.officer, a.asset.id);
  assert.equal(await getWorkOrder(b.admin, wo.id), null);
  assert.equal((await listMaintenance(b.admin)).open.length, 0);
  await assert.rejects(reportWorkOrder(b.officer, a.asset.id, { title: "Cross-company" } as never), /not found/i);
  await assert.rejects(triageWorkOrder(b.admin, wo.id, { priority: "NORMAL", riskLevel: "LOW" } as never), /not found/i);
  const leak = await withTenant(b.admin.companyId, b.admin.userId, (tx) => tx.workOrder.findMany({ where: { id: wo.id } }));
  assert.equal(leak.length, 0);
  assert.equal((await listMaintenance(a.admin)).open.length, 1);
});
