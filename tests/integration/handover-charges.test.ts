/**
 * The money value of items lost or damaged at move-out: suggested from the register, set by staff with a note when it differs,
 * deducted from the deposit once (up to what is held), and frozen afterwards.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import { recordDepositReceived } from "../../src/lib/services/ledger";
import { acknowledgeSchedule, addScheduleLine, createHandoverSchedule, createItem, getHandoverInventory, removeScheduleLine } from "../../src/lib/services/inventory";
import { deductHandoverCharges, handoverCharges, saveHandoverCharges } from "../../src/lib/services/handover-charges";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

test("lost and damaged items get a value, and the total comes out of the deposit once", async () => {
  const admin = await newCompany("charges");
  const officer = await addMember(admin, "OFFICER", "off");
  const asset = await createAsset(admin, { name: "Charges block", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  const fridge = await createItem(admin, { name: "Fridge", kind: "MOVABLE", quantity: "1", assetId: asset.id, condition: "GOOD", unitCost: "200,000" } as never);
  const chairs = await createItem(admin, { name: "Dining chairs", kind: "MOVABLE", quantity: "4", assetId: asset.id, unitCost: "15,000" } as never);
  const lease = await createLease(admin, asset.id, { occupantName: "Tenant Charged", startDate: relativeDate(-400), endDate: relativeDate(-1), rent: "900,000", frequency: "YEARLY", deposit: "100,000" } as never);
  await recordDepositReceived(admin, lease.id, { amount: "100,000", receivedOn: relativeDate(-400), evidence: "TRF-1234" });

  const inn = await createHandoverSchedule(officer, lease.id, "MOVE_IN");
  await addScheduleLine(officer, inn.id, { room: "Kitchen", itemId: fridge.id, quantity: "1", condition: "GOOD" } as never);
  await addScheduleLine(officer, inn.id, { room: "Dining", itemId: chairs.id, quantity: "4", condition: "GOOD" } as never);
  await addScheduleLine(officer, inn.id, { room: "Bedroom", description: "Curtains", quantity: "2", condition: "GOOD" });
  await acknowledgeSchedule(officer, inn.id, { acknowledgedBy: "Tenant Charged", acknowledgedOn: relativeDate(-399) });
  assert.equal(await handoverCharges(admin, lease.id), null, "nothing to value before move-out");

  const out = await createHandoverSchedule(officer, lease.id, "MOVE_OUT");
  const d = (await getHandoverInventory(admin, lease.id))!;
  const line = (s: string) => d.moveOut!.lines.find((l) => l.description === s)!;
  await removeScheduleLine(officer, out.id, line("Fridge").id);
  await removeScheduleLine(officer, out.id, line("Dining chairs").id);
  await removeScheduleLine(officer, out.id, line("Curtains").id);
  await addScheduleLine(officer, out.id, { room: "Kitchen", itemId: fridge.id, quantity: "1", condition: "POOR" } as never); // two steps worse
  await addScheduleLine(officer, out.id, { room: "Dining", itemId: chairs.id, quantity: "3", condition: "GOOD" } as never); // one short
  // The curtains are missing and are not on the register: no suggestion.

  let c = (await handoverCharges(admin, lease.id))!;
  const row = (s: string) => c.rows.find((r) => r.description === s)!;
  assert.equal(c.rows.length, 3);
  assert.equal(row("Fridge").suggestedKobo, 10_000_000n, "half of 200,000 for two steps down");
  assert.equal(row("Dining chairs").suggestedKobo, 1_500_000n);
  assert.equal(row("Curtains").suggestedKobo, null);
  assert.equal(c.unset, 3);
  await assert.rejects(deductHandoverCharges(admin, lease.id), /must be acknowledged/);

  // Values: the suggestion as is; a different value needs a note.
  await assert.rejects(saveHandoverCharges(officer, lease.id, { [row("Fridge").key]: { amount: "80,000" } }), /Add a note for Fridge/);
  await assert.rejects(saveHandoverCharges(officer, lease.id, { [row("Fridge").key]: { amount: "lots" } }), /as an amount/);
  await saveHandoverCharges(officer, lease.id, {
    [row("Fridge").key]: { amount: "100,000" },
    [row("Dining chairs").key]: { amount: "15,000" },
    [row("Curtains").key]: { amount: "20,000", note: "Replacement quote from the tailor" },
  });
  c = (await handoverCharges(admin, lease.id))!;
  assert.equal(c.totalKobo, 13_500_000n);
  assert.equal(c.fromDeposit, 10_000_000n);
  assert.equal(c.owed, 3_500_000n, "more than the deposit is still owed");

  await acknowledgeSchedule(officer, out.id, { acknowledgedBy: "Tenant Charged", acknowledgedOn: relativeDate(0) });
  await assert.rejects(deductHandoverCharges(officer, lease.id), /permission/i);
  const r = await deductHandoverCharges(admin, lease.id);
  assert.equal(r.fromDeposit, 10_000_000n);
  assert.equal(r.owed, 3_500_000n);
  const entries = await withTenant(admin.companyId, admin.userId, (tx) => tx.depositEntry.findMany({ where: { leaseId: lease.id }, orderBy: { createdAt: "asc" } }));
  assert.deepEqual(entries.map((e) => e.kind), ["RECEIVED", "DEDUCTION"]);
  assert.equal(entries[1].amountKobo, 10_000_000n);
  assert.match(entries[1].reason, /Fridge \(Kitchen\)/);

  // Once only, and frozen in the application and in the database.
  await assert.rejects(deductHandoverCharges(admin, lease.id), /already been deducted/);
  await assert.rejects(saveHandoverCharges(officer, lease.id, { [row("Curtains").key]: { amount: "1" } }), /can no longer be changed/);
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.handoverCharge.deleteMany({ where: { leaseId: lease.id } })), /cannot be changed/);
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.handoverSchedule.update({ where: { id: out.id }, data: { chargesDeductedAt: null } })), /cannot be changed/);
  c = (await handoverCharges(admin, lease.id))!;
  assert.ok(c.deductedAt);
  assert.equal(c.deducted!.amountKobo, 10_000_000n);
});
