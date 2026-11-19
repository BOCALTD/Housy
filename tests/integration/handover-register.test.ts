/**
 * Inventory: a stock count freezes its items (in the application and in the database), and move-in/move-out lines can be
 * register items, matched by item at move-out and sent to the register once.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import {
  acknowledgeSchedule, addScheduleLine, applyHandoverToRegister, cancelCount, createHandoverSchedule, createItem, decideAdjustment, decideCount,
  getCount, getHandoverInventory, getItem, recordMovement, removeScheduleLine, requestAdjustment, saveCountLines, startCount, submitCount,
} from "../../src/lib/services/inventory";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const asset = await createAsset(admin, { name: `${label} block`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  return { admin, officer, manager, asset };
}

test("a stock count freezes its items until it is approved or cancelled", async () => {
  const { admin, officer, manager, asset } = await setup("freeze");
  const paint = await createItem(admin, { name: "Paint", kind: "CONSUMABLE", quantity: "12", unit: "tins", assetId: asset.id } as never);
  const free = await createItem(admin, { name: "Ladder", kind: "MOVABLE", quantity: "1" } as never);
  const adj = await requestAdjustment(officer, paint.id, { kind: "DAMAGE", quantity: "1", reason: "Tin dented in the store" } as never);

  const count = await startCount(admin, { title: "Block store", assetId: asset.id });
  assert.equal((await getItem(admin, paint.id))!.frozenBy?.ref, count.ref);
  assert.equal((await getItem(admin, free.id))!.frozenBy, null);

  // The application refuses, and says why.
  await assert.rejects(recordMovement(officer, paint.id, { kind: "ISSUE", quantity: "1" }), new RegExp(`Paint is being counted in ${count.ref}`));
  await assert.rejects(decideAdjustment(manager, adj.id, "approve", ""), /being counted/);
  await assert.rejects(startCount(manager, { title: "Second count", assetId: asset.id }), /already being counted/);
  // Items outside the count still move.
  await recordMovement(officer, free.id, { kind: "TRANSFER", quantity: "1", toLocation: "Roof" } as never);

  // The database refuses too, even if the application check were skipped.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.inventoryMovement.create({
    data: { companyId: admin.companyId, itemId: paint.id, kind: "ISSUE", delta: -1, balanceAfter: 11, performedById: admin.userId },
  })), /being counted/);

  // Waiting for approval is still frozen.
  const line = (await getCount(admin, count.id))!.count.lines[0];
  await saveCountLines(officer, count.id, { [line.id]: { counted: "11" } });
  await submitCount(officer, count.id);
  await assert.rejects(recordMovement(officer, paint.id, { kind: "ISSUE", quantity: "1" }), /being counted/);

  // Approval writes the count's own correction, then stock moves again.
  assert.equal(await decideCount(manager, count.id, "approve", ""), 1);
  assert.equal((await getItem(admin, paint.id))!.item.quantity, 11);
  assert.equal((await getItem(admin, paint.id))!.frozenBy, null);
  await recordMovement(officer, paint.id, { kind: "ISSUE", quantity: "2" });
  await decideAdjustment(manager, adj.id, "approve", "");
  assert.equal((await getItem(admin, paint.id))!.item.quantity, 8);

  // A cancelled count releases its items.
  const again = await startCount(admin, { title: "Recheck", assetId: asset.id });
  await assert.rejects(recordMovement(officer, paint.id, { kind: "ISSUE", quantity: "1" }), /being counted/);
  await cancelCount(admin, again.id, "Started by mistake");
  await recordMovement(officer, paint.id, { kind: "ISSUE", quantity: "1" });
  assert.equal((await getItem(admin, paint.id))!.item.quantity, 7);
});

test("handover lines can be register items: matched by item at move-out, then sent to the register once", async () => {
  const { admin, officer, manager, asset } = await setup("link");
  const other = await createAsset(admin, { name: "Other block", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  const fridge = await createItem(admin, { name: "Fridge", kind: "MOVABLE", quantity: "1", assetId: asset.id, condition: "GOOD" } as never);
  const chairs = await createItem(admin, { name: "Dining chairs", kind: "MOVABLE", quantity: "4", assetId: asset.id } as never);
  const lamp = await createItem(admin, { name: "Lamp", kind: "MOVABLE", quantity: "1", assetId: asset.id } as never);
  const elsewhere = await createItem(admin, { name: "Heater", kind: "MOVABLE", quantity: "1", assetId: other.id } as never);
  const lease = await createLease(admin, asset.id, { occupantName: "Tenant Linked", startDate: relativeDate(-200), endDate: relativeDate(100), rent: "900,000", frequency: "YEARLY" } as never);

  const inn = await createHandoverSchedule(officer, lease.id, "MOVE_IN");
  await assert.rejects(addScheduleLine(officer, inn.id, { room: "Lounge", itemId: elsewhere.id, quantity: "1" } as never), /this property's register/);
  await assert.rejects(addScheduleLine(officer, inn.id, { room: "Lounge", quantity: "1" } as never), /Describe the item/);
  const f = await addScheduleLine(officer, inn.id, { room: "Kitchen", itemId: fridge.id, quantity: "1", condition: "GOOD" } as never);
  assert.equal(f.description, "Fridge");
  await assert.rejects(addScheduleLine(officer, inn.id, { room: "Lounge", itemId: fridge.id, quantity: "1" } as never), /already on this schedule/);
  await addScheduleLine(officer, inn.id, { room: "Dining", description: "Chairs (set)", itemId: chairs.id, quantity: "4", condition: "GOOD" } as never);
  await addScheduleLine(officer, inn.id, { room: "Bedroom", itemId: lamp.id, quantity: "1", condition: "GOOD" } as never);
  await addScheduleLine(officer, inn.id, { room: "Bedroom", description: "Curtains", quantity: "2", condition: "GOOD" });
  await assert.rejects(applyHandoverToRegister(admin, lease.id), /must be acknowledged/);
  await acknowledgeSchedule(officer, inn.id, { acknowledgedBy: "Tenant Linked", acknowledgedOn: relativeDate(-199) });

  // Move-out starts from the move-in lines, links included.
  const out = await createHandoverSchedule(officer, lease.id, "MOVE_OUT");
  let d = (await getHandoverInventory(admin, lease.id))!;
  assert.equal(d.register.length, 3);
  assert.deepEqual(d.moveOut!.lines.map((l) => l.item?.itemNo ?? null), [fridge.itemNo, chairs.itemNo, lamp.itemNo, null]);
  const byDesc = (s: string) => d.moveOut!.lines.find((l) => l.description === s)!;
  // The fridge was moved to the lounge and is now poor; one chair is gone; the lamp is missing.
  await removeScheduleLine(officer, out.id, byDesc("Fridge").id);
  await removeScheduleLine(officer, out.id, byDesc("Chairs (set)").id);
  await removeScheduleLine(officer, out.id, byDesc("Lamp").id);
  await addScheduleLine(officer, out.id, { room: "Lounge", itemId: fridge.id, quantity: "1", condition: "POOR" } as never);
  await addScheduleLine(officer, out.id, { room: "Dining", itemId: chairs.id, quantity: "3", condition: "GOOD" } as never);
  await acknowledgeSchedule(officer, out.id, { acknowledgedBy: "Tenant Linked", acknowledgedOn: relativeDate(0) });

  d = (await getHandoverInventory(admin, lease.id))!;
  const kinds = Object.fromEntries(d.comparison!.map((c) => [c.description, c.kind]));
  // Matched by register item even though the room changed.
  assert.deepEqual(kinds, { Fridge: "WORSE", "Chairs (set)": "FEWER", Lamp: "MISSING", Curtains: "SAME" });

  await assert.rejects(applyHandoverToRegister(officer, lease.id), /permission/i);
  const r = await applyHandoverToRegister(admin, lease.id);
  assert.deepEqual(r, { losses: 2, worse: 1 });
  assert.equal((await getItem(admin, fridge.id))!.item.condition, "POOR");
  const chairAdj = (await getItem(admin, chairs.id))!.adjustments;
  assert.equal(chairAdj.length, 1);
  assert.equal(chairAdj[0].kind, "LOSS");
  assert.equal(chairAdj[0].delta, -1);
  assert.equal(chairAdj[0].status, "PENDING");
  assert.match(chairAdj[0].reason, new RegExp(lease.ref));
  // Nothing leaves the books until someone else approves.
  assert.equal((await getItem(admin, chairs.id))!.item.quantity, 4);
  await assert.rejects(decideAdjustment(admin, chairAdj[0].id, "approve", ""), /someone other/);
  await decideAdjustment(manager, chairAdj[0].id, "approve", "");
  assert.equal((await getItem(admin, chairs.id))!.item.quantity, 3);

  // Once only, and the acknowledged schedule is otherwise still locked.
  await assert.rejects(applyHandoverToRegister(admin, lease.id), /already been updated/);
  assert.ok((await getHandoverInventory(admin, lease.id))!.moveOut!.registerUpdatedAt);
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.handoverSchedule.update({ where: { id: out.id }, data: { acknowledgedBy: "Changed" } })));
  // A register item on a handover cannot be deleted from under it.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.inventoryItem.delete({ where: { id: lamp.id } })));
});
