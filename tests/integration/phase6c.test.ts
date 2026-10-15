/**
 * Phase 6c: inventory against a real PostgreSQL database through the runtime role.
 * Register, stock movements (including concurrent issues), reviewed adjustments, physical counts,
 * stock used on work orders, acknowledged handover schedules and company isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import {
  acknowledgeSchedule, addScheduleLine, addSchedulePhoto, cancelCount, createHandoverSchedule, createItem, decideAdjustment, decideCount, findItemByCode,
  getCount, getHandoverInventory, getItem, inventorySummary, listInventory, recordMovement, removeScheduleLine, requestAdjustment, saveCountLines,
  startCount, submitCount, updateItem, useOnWorkOrder,
} from "../../src/lib/services/inventory";
import { approveWorkOrder, assignWorkOrder, removeMaterial, reportWorkOrder, setProgress, triageWorkOrder, getWorkOrder } from "../../src/lib/services/maintenance";
import { addMember, newCompany, relativeDate } from "./helpers";

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

const consumable = (ctx: Awaited<ReturnType<typeof newCompany>>, extra: Record<string, unknown> = {}) =>
  createItem(ctx, { name: "Cement", kind: "CONSUMABLE", quantity: "10", unit: "bags", unitCost: "9,500", reorderLevel: "4", location: "Store", ...extra } as never);

const movements = (ctx: Awaited<ReturnType<typeof newCompany>>, itemId: string) =>
  withTenant(ctx.companyId, ctx.userId, (tx) => tx.inventoryMovement.findMany({ where: { itemId }, orderBy: { createdAt: "asc" } }));

test("items get numbers and codes, opening stock is a receipt, and only managers change the register", async () => {
  const { admin, officer, manager, asset } = await setup("reg");
  await assert.rejects(createItem(officer, { name: "Chair", kind: "MOVABLE" } as never), /permission/i);
  await assert.rejects(createItem(admin, { name: "C", kind: "MOVABLE" } as never), /name/i);
  const a = await createItem(admin, { name: "Generator", kind: "FIXED_ASSET", assetId: asset.id, quantity: "1", serialNumber: "SN-123", location: "Generator house" } as never);
  const b = await consumable(admin, { code: "CEM-01" });
  assert.equal(a.itemNo, "INV-0001");
  assert.equal(a.code, "INV-0001");
  assert.equal(b.itemNo, "INV-0002");
  assert.equal(b.code, "CEM-01");
  const first = await movements(admin, a.id);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, "RECEIPT");
  assert.equal(first[0].balanceAfter, 1);

  await assert.rejects(consumable(admin, { code: "CEM-01" }), /already used/);
  await assert.rejects(consumable(admin, { code: "INV-0001" }), /already used/);
  await assert.rejects(createItem(admin, { name: "Ghost", kind: "MOVABLE", assetId: "no-such-asset" } as never), /Asset not found/);

  assert.equal((await findItemByCode(officer, "cem-01"))!.id, b.id);
  assert.equal((await findItemByCode(officer, "SN-123"))!.id, a.id);
  assert.equal((await findItemByCode(officer, "inv-0001"))!.id, a.id);
  assert.equal(await findItemByCode(officer, "nothing"), null);

  await assert.rejects(updateItem(officer, b.id, { name: "Cement", condition: "GOOD", code: "CEM-01" } as never), /permission/i);
  await updateItem(manager, b.id, { name: "Cement 50kg", condition: "FAIR", code: "CEM-01", location: "Main store" } as never);
  assert.equal((await getItem(admin, b.id))!.item.name, "Cement 50kg");
  // The balance is not editable through the register.
  assert.equal((await getItem(admin, b.id))!.item.quantity, 10);
  const list = await listInventory(admin, { q: "cement" });
  assert.equal(list.items.length, 1);
  assert.equal((await listInventory(admin, { assetId: asset.id })).items.length, 1);
});

test("movements change the balance, record who did them and never take stock below zero", async () => {
  const { admin, officer, asset } = await setup("mov");
  const item = await consumable(admin, { assetId: asset.id });
  await assert.rejects(recordMovement(officer, item.id, { kind: "ISSUE", quantity: "11" }), /Only 10 in stock/);
  await assert.rejects(recordMovement(officer, item.id, { kind: "ISSUE", quantity: "0" }), /one or more/);
  await assert.rejects(recordMovement(officer, item.id, { kind: "ADJUSTMENT" as never, quantity: "1" }), /./);
  await recordMovement(officer, item.id, { kind: "ISSUE", quantity: "4", reference: "REQ-1" });
  await recordMovement(officer, item.id, { kind: "RETURN", quantity: "1" });
  await recordMovement(officer, item.id, { kind: "CONSUMPTION", quantity: "2" });
  await recordMovement(officer, item.id, { kind: "RECEIPT", quantity: "5", reference: "DN-77" });
  await assert.rejects(recordMovement(officer, item.id, { kind: "TRANSFER" }), /moving to/);
  await recordMovement(officer, item.id, { kind: "TRANSFER", toLocation: "Site office", custodianId: officer.membershipId });
  const after = (await getItem(admin, item.id))!;
  assert.equal(after.item.quantity, 10 - 4 + 1 - 2 + 5);
  assert.equal(after.item.location, "Site office");
  assert.equal(after.item.custodianId, officer.membershipId);

  const rows = await movements(admin, item.id);
  assert.deepEqual(rows.map((r) => r.kind), ["RECEIPT", "ISSUE", "RETURN", "CONSUMPTION", "RECEIPT", "TRANSFER"]);
  assert.equal(rows.reduce((s, r) => s + r.delta, 0), after.item.quantity);
  assert.equal(rows[rows.length - 1].balanceAfter, after.item.quantity);
  assert.equal(rows[1].performedById, officer.userId);
  assert.equal(rows[5].fromLocation, "Store");
  assert.equal(rows[5].toLocation, "Site office");

  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.inventoryMovement.deleteMany({ where: { itemId: item.id } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.inventoryMovement.updateMany({ where: { itemId: item.id }, data: { delta: 99 } })));
  const viewer = { ...officer, role: "VIEWER" as const };
  await assert.rejects(recordMovement(viewer, item.id, { kind: "ISSUE", quantity: "1" }), /permission/i);
});

test("two people issuing the last stock at the same moment cannot both succeed", async () => {
  const { admin, officer, manager } = await setup("race");
  const item = await consumable(admin, { quantity: "5" });
  const results = await Promise.allSettled([
    recordMovement(officer, item.id, { kind: "ISSUE", quantity: "3" }),
    recordMovement(manager, item.id, { kind: "ISSUE", quantity: "3" }),
    recordMovement(admin, item.id, { kind: "ISSUE", quantity: "3" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await getItem(admin, item.id))!.item.quantity, 2);
  const rows = await movements(admin, item.id);
  assert.equal(rows.reduce((s, r) => s + r.delta, 0), 2);
});

test("a loss, damage, disposal or correction changes the books only after someone else approves it", async () => {
  const { admin, officer, manager } = await setup("adj");
  const item = await consumable(admin, { quantity: "6" });
  await assert.rejects(requestAdjustment(officer, item.id, { kind: "LOSS", quantity: "1", reason: "x" }), /reason/);
  await assert.rejects(requestAdjustment(officer, item.id, { kind: "LOSS", quantity: "7", reason: "Stolen from site" }), /Only 6/);
  const loss = await requestAdjustment(officer, item.id, { kind: "LOSS", quantity: "2", reason: "Two bags stolen from site" });
  assert.equal(loss.delta, -2);
  assert.equal((await getItem(admin, item.id))!.item.quantity, 6);
  await assert.rejects(decideAdjustment(officer, loss.id, "approve", ""), /permission/i);
  const mgrRequest = await requestAdjustment(manager, item.id, { kind: "DAMAGE", quantity: "1", reason: "Wet bag, unusable" });
  await assert.rejects(decideAdjustment(manager, mgrRequest.id, "approve", ""), /someone other than/);
  await assert.rejects(decideAdjustment(admin, mgrRequest.id, "reject", ""), /why/);
  await decideAdjustment(admin, mgrRequest.id, "reject", "Photograph it first");
  await decideAdjustment(manager, loss.id, "approve", "Police report seen");
  assert.equal((await getItem(admin, item.id))!.item.quantity, 4);
  await assert.rejects(decideAdjustment(admin, loss.id, "approve", ""), /already been decided/);

  const rows = await movements(admin, item.id);
  const last = rows[rows.length - 1];
  assert.equal(last.kind, "LOSS");
  assert.equal(last.performedById, officer.userId);
  assert.equal(last.approvedById, manager.userId);
  assert.equal(last.balanceAfter, 4);

  // An adjustment that was fair when asked for is refused if the stock has since gone.
  const big = await requestAdjustment(officer, item.id, { kind: "DAMAGE", quantity: "4", reason: "Flood in the store" });
  await recordMovement(officer, item.id, { kind: "ISSUE", quantity: "2" });
  await assert.rejects(decideAdjustment(admin, big.id, "approve", ""), /Only 2/);

  // A correction upwards.
  const up = await requestAdjustment(officer, item.id, { kind: "ADJUSTMENT", quantity: "3", direction: "UP", reason: "Found three bags behind the shelf" });
  await decideAdjustment(admin, up.id, "approve", "");
  assert.equal((await getItem(admin, item.id))!.item.quantity, 5);
  assert.equal((await inventorySummary(admin)).pendingAdjustments, 1);
});

test("disposing of all of an item retires it", async () => {
  const { admin, officer, manager } = await setup("disp");
  const item = await createItem(admin, { name: "Old freezer", kind: "MOVABLE", quantity: "1" } as never);
  const req = await requestAdjustment(officer, item.id, { kind: "DISPOSAL", quantity: "1", reason: "Beyond repair, sold as scrap" });
  await decideAdjustment(manager, req.id, "approve", "");
  const after = (await getItem(admin, item.id))!.item;
  assert.equal(after.status, "DISPOSED");
  assert.equal(after.quantity, 0);
  await assert.rejects(recordMovement(officer, item.id, { kind: "RECEIPT", quantity: "1" }), /disposed/);
  await assert.rejects(requestAdjustment(officer, item.id, { kind: "ADJUSTMENT", quantity: "1", direction: "UP", reason: "Mistake in the count" }), /disposed/);
  await assert.rejects(updateItem(admin, item.id, { name: "Old freezer", condition: "POOR" } as never), /disposed/);
});

test("a physical count needs every line counted and a different approver, then adjusts balances", async () => {
  const { admin, officer, manager, asset } = await setup("count");
  const cement = await consumable(admin, { assetId: asset.id });
  const sand = await consumable(admin, { name: "Sand", assetId: asset.id, quantity: "20", unit: "tonnes" });
  const other = await createItem(admin, { name: "Elsewhere", kind: "MOVABLE", quantity: "1" } as never);
  await assert.rejects(startCount(officer, { title: "Store count" }), /permission/i);
  await assert.rejects(startCount(admin, { title: "ab" }), /Name the count/);
  const count = await startCount(admin, { title: "Store count", assetId: asset.id });
  const view = (await getCount(admin, count.id))!;
  assert.equal(view.count.lines.length, 2);
  assert.ok(!view.count.lines.some((l) => l.itemId === other.id));

  // Stock moves after the count starts; the variance is measured against the balance at approval.
  await recordMovement(manager, cement.id, { kind: "ISSUE", quantity: "1" });

  await assert.rejects(submitCount(officer, count.id), /not been counted/);
  const lineOf = (id: string) => view.count.lines.find((l) => l.itemId === id)!.id;
  await assert.rejects(saveCountLines(officer, count.id, { [lineOf(cement.id)]: { counted: "abc" } }), /whole numbers/);
  await saveCountLines(officer, count.id, { [lineOf(cement.id)]: { counted: "7", note: "Two torn" }, [lineOf(sand.id)]: { counted: "20" } });
  await assert.rejects(saveCountLines(admin, "no-such", {}), /not found/i);
  await submitCount(officer, count.id);
  await assert.rejects(saveCountLines(officer, count.id, { [lineOf(sand.id)]: { counted: "19" } }), /no longer open/);
  await assert.rejects(decideCount(officer, count.id, "approve", ""), /permission/i);
  await assert.rejects(decideCount(manager, count.id, "return", ""), /recounted/);
  await decideCount(manager, count.id, "return", "Recount the cement");
  assert.equal((await getCount(admin, count.id))!.count.status, "OPEN");
  await submitCount(officer, count.id);

  const adjusted = await decideCount(manager, count.id, "approve", "Agreed");
  assert.equal(adjusted, 1);
  assert.equal((await getItem(admin, cement.id))!.item.quantity, 7);
  assert.equal((await getItem(admin, sand.id))!.item.quantity, 20);
  assert.ok((await getItem(admin, sand.id))!.item.lastVerifiedOn);
  const adj = (await movements(admin, cement.id)).filter((m) => m.kind === "ADJUSTMENT");
  assert.equal(adj.length, 1);
  assert.equal(adj[0].delta, -2);
  assert.equal(adj[0].countId, count.id);
  assert.equal(adj[0].approvedById, manager.userId);
  assert.equal(adj[0].performedById, officer.userId);
  assert.match(adj[0].note, /expected 10, counted 7/);
  assert.equal((await getCount(admin, count.id))!.count.status, "APPROVED");
  await assert.rejects(decideCount(admin, count.id, "approve", ""), /submitted/);
  await assert.rejects(cancelCount(admin, count.id, "Mistake made"), /no longer be cancelled/);
});

test("the person who counted cannot approve the count, and a count can be cancelled", async () => {
  const { admin, officer, manager } = await setup("sod");
  await createItem(admin, { name: "Chairs", kind: "MOVABLE", quantity: "4" } as never);
  const count = await startCount(admin, { title: "Chairs count" });
  const lines = (await getCount(admin, count.id))!.count.lines;
  await saveCountLines(manager, count.id, { [lines[0].id]: { counted: "4" } });
  await submitCount(officer, count.id);
  await assert.rejects(decideCount(manager, count.id, "approve", ""), /did not count or submit/);
  await decideCount(admin, count.id, "approve", "");
  const second = await startCount(admin, { title: "Second count" });
  await assert.rejects(cancelCount(officer, second.id, "Not needed"), /permission/i);
  await assert.rejects(cancelCount(admin, second.id, "x"), /reason/i);
  await cancelCount(admin, second.id, "Started by mistake");
  assert.equal((await getCount(admin, second.id))!.count.status, "CANCELLED");
  await assert.rejects(startCount(admin, { title: "Empty", assetId: "none" }), /Asset not found/);
});

async function workOrderInProgress(admin: Awaited<ReturnType<typeof newCompany>>, officer: Awaited<ReturnType<typeof newCompany>>, manager: Awaited<ReturnType<typeof newCompany>>, assetId: string) {
  const wo = await reportWorkOrder(officer, assetId, { title: "Repair the wall" } as never);
  await triageWorkOrder(admin, wo.id, { priority: "NORMAL", riskLevel: "LOW" } as never);
  await approveWorkOrder(manager, wo.id, { approvedCost: "100,000" });
  await assignWorkOrder(admin, wo.id, { assigneeId: officer.membershipId });
  await setProgress(officer, wo.id, "IN_PROGRESS", "");
  return wo;
}

test("stock used on a work order is taken out once and recorded as the work order's material", async () => {
  const { admin, officer, manager, asset } = await setup("wo");
  const stranger = await addMember(admin, "OFFICER", "stranger");
  const cement = await consumable(admin, { assetId: asset.id, quantity: "8" });
  const chair = await createItem(admin, { name: "Chair", kind: "MOVABLE", quantity: "2" } as never);
  const wo = await workOrderInProgress(admin, officer, manager, asset.id);

  await assert.rejects(useOnWorkOrder(stranger, cement.id, wo.id, { quantity: "1" }), /Only the assigned/);
  await assert.rejects(useOnWorkOrder(officer, chair.id, wo.id, { quantity: "1" }), /consumable/);
  await assert.rejects(useOnWorkOrder(officer, cement.id, wo.id, { quantity: "9" }), /Only 8/);
  await assert.rejects(useOnWorkOrder(officer, cement.id, wo.id, { quantity: "0" }), /one or more/);
  await assert.rejects(useOnWorkOrder(officer, cement.id, "no-such", { quantity: "1" }), /not found/i);
  const mat = await useOnWorkOrder(officer, cement.id, wo.id, { quantity: "3" });
  assert.equal(mat.inventoryItemId, cement.id);
  assert.equal(mat.unitCostKobo, 950000n);
  assert.equal((await getItem(admin, cement.id))!.item.quantity, 5);
  const mv = (await movements(admin, cement.id)).pop()!;
  assert.equal(mv.kind, "CONSUMPTION");
  assert.equal(mv.workOrderId, wo.id);
  const full = (await getWorkOrder(admin, wo.id))!;
  assert.equal(full.materialsTotal, 3n * 950000n);
  assert.ok(full.wo.events.some((e) => e.kind === "MATERIAL_ADDED" && /from stock/.test(e.note)));
  // Stock issued to a work order cannot be deleted from it; a return is recorded in inventory.
  await assert.rejects(removeMaterial(officer, wo.id, mat.id), /issued from stock/);
  await recordMovement(officer, cement.id, { kind: "RETURN", quantity: "1", reference: wo.ref });
  assert.equal((await getItem(admin, cement.id))!.item.quantity, 6);
});

test("handover schedules are built room by room, acknowledged, then frozen", async () => {
  const { admin, officer, manager, asset } = await setup("hand");
  const viewer = { ...officer, role: "VIEWER" as const };
  const lease = await createLease(admin, asset.id, {
    occupantName: "Tenant One", startDate: relativeDate(-60), endDate: relativeDate(300), rent: "500,000", frequency: "YEARLY",
  } as never);
  await assert.rejects(createHandoverSchedule(viewer, lease.id, "MOVE_IN"), /permission/i);
  await assert.rejects(createHandoverSchedule(officer, "no-lease", "MOVE_IN"), /Lease not found/);
  const inn = await createHandoverSchedule(officer, lease.id, "MOVE_IN");
  await assert.rejects(createHandoverSchedule(manager, lease.id, "MOVE_IN"), /already/);
  await assert.rejects(acknowledgeSchedule(officer, inn.id, { acknowledgedBy: "Tenant One", acknowledgedOn: relativeDate(0) }), /at least one item/);
  const sofa = await addScheduleLine(officer, inn.id, { room: "Lounge", description: "Sofa", quantity: "1", condition: "GOOD" }, { ...photo, caption: "Sofa" });
  await addScheduleLine(officer, inn.id, { room: "Lounge", description: "Curtains", quantity: "2", condition: "GOOD" });
  await addScheduleLine(officer, inn.id, { room: "Kitchen", description: "Chairs", quantity: "4", condition: "FAIR", notes: "One wobbly" });
  const extra = await addScheduleLine(officer, inn.id, { room: "Kitchen", description: "Bin", quantity: "1", condition: "GOOD" });
  await assert.rejects(addScheduleLine(officer, inn.id, { room: "K", description: "Bin", quantity: "1" }), /room/i);
  await assert.rejects(addScheduleLine(officer, inn.id, { room: "Kitchen", description: "Bin", quantity: "x" }), /whole number/);
  await removeScheduleLine(officer, inn.id, extra.id);
  await assert.rejects(removeScheduleLine(officer, inn.id, sofa.id), /photograph/);
  await addSchedulePhoto(officer, inn.id, sofa.id, { caption: "Back view" }, photo);
  await assert.rejects(addSchedulePhoto(officer, inn.id, sofa.id, {}, { name: "x.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) }), /./);
  await assert.rejects(acknowledgeSchedule(officer, inn.id, { acknowledgedBy: "T", acknowledgedOn: relativeDate(0) }), /name/i);
  await assert.rejects(acknowledgeSchedule(officer, inn.id, { acknowledgedBy: "Tenant One", acknowledgedOn: relativeDate(2) }), /future/);
  await acknowledgeSchedule(officer, inn.id, { acknowledgedBy: "Tenant One", acknowledgedOn: relativeDate(0) });

  await assert.rejects(addScheduleLine(officer, inn.id, { room: "Lounge", description: "Lamp", quantity: "1" }), /acknowledged/);
  await assert.rejects(removeScheduleLine(officer, inn.id, sofa.id), /acknowledged/);
  await assert.rejects(acknowledgeSchedule(officer, inn.id, { acknowledgedBy: "Someone Else", acknowledgedOn: relativeDate(0) }), /acknowledged/);
  // Even a direct database write through the application role is refused.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.handoverScheduleLine.update({ where: { id: sofa.id }, data: { quantity: 5 } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.handoverScheduleLine.delete({ where: { id: sofa.id } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.handoverSchedule.update({ where: { id: inn.id }, data: { acknowledgedBy: "Changed" } })));

  const out = await createHandoverSchedule(officer, lease.id, "MOVE_OUT");
  await addScheduleLine(officer, out.id, { room: "lounge", description: "sofa", quantity: "1", condition: "POOR" });
  await addScheduleLine(officer, out.id, { room: "Kitchen", description: "Chairs", quantity: "3", condition: "FAIR" });
  await addScheduleLine(officer, out.id, { room: "Lounge", description: "Curtains", quantity: "2", condition: "GOOD" });
  const d = (await getHandoverInventory(admin, lease.id))!;
  assert.equal(d.moveIn!.status, "ACKNOWLEDGED");
  assert.equal(d.moveOut!.status, "DRAFT");
  assert.equal(d.photos.length, 2);
  const kinds = Object.fromEntries(d.comparison!.map((c) => [`${c.room.toLowerCase()}/${c.description.toLowerCase()}`, c.kind]));
  assert.deepEqual(kinds, { "lounge/sofa": "WORSE", "lounge/curtains": "SAME", "kitchen/chairs": "FEWER" });
});

test("inventory is isolated between companies", async () => {
  const a = await setup("isoa");
  const b = await setup("isob");
  const item = await consumable(a.admin, { code: "SHARED-1" });
  assert.equal(await getItem(b.admin, item.id), null);
  assert.equal(await findItemByCode(b.admin, "SHARED-1"), null);
  assert.equal((await listInventory(b.admin)).items.length, 0);
  await assert.rejects(recordMovement(b.officer, item.id, { kind: "RECEIPT", quantity: "1" }), /not found/i);
  await assert.rejects(requestAdjustment(b.officer, item.id, { kind: "LOSS", quantity: "1", reason: "Cross-company" }), /not found/i);
  // The same code can be used in another company.
  const same = await consumable(b.admin, { code: "SHARED-1" });
  assert.notEqual(same.id, item.id);
  assert.equal((await getHandoverInventory(b.admin, "whatever")), null);
  assert.equal((await inventorySummary(b.admin)).items, 1);
  assert.equal((await inventorySummary(a.admin)).items, 1);
});
