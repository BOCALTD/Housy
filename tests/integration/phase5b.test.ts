/**
 * Phase 5b: lease lifecycle against a real PostgreSQL database through the runtime role.
 * Renewals (second-person approval, no double renewal), notices, handover, closure and isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease, getLease, recordLeasePayment } from "../../src/lib/services/leases";
import { closeLease, decideRenewal, proposeRenewal, recordHandover, recordNotice } from "../../src/lib/services/lifecycle";
import { addMember, newCompany, relativeDate, withRole } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string, lease: Partial<Parameters<typeof createLease>[2]> = {}) {
  const admin = await newCompany(label);
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "MANAGER" });
  const created = await createLease(admin, asset.id, {
    occupantName: "Corner Pharmacy Ltd", startDate: relativeDate(-200), endDate: relativeDate(165), rent: "400,000", frequency: "QUARTERLY",
    deposit: "300,000", noticeDays: "90", ...lease,
  });
  return { admin, asset, lease: created };
}

const handover = (kind: "MOVE_IN" | "MOVE_OUT", on: string) => ({
  kind, handoverOn: on, keysCount: "2", meterReadings: "E 100", conditionNotes: "Clean and in good order", acknowledgedBy: "Tenant rep",
});

test("a renewal needs a different person to approve, then creates the next lease once", async () => {
  const { admin, lease } = await setup("renew");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const proposal = await proposeRenewal(manager, lease.id, { startDate: relativeDate(165), endDate: relativeDate(530), rent: "450,000", note: "Review" });
  await assert.rejects(proposeRenewal(admin, lease.id, { startDate: relativeDate(165), endDate: relativeDate(530), rent: "450,000" }), /already waiting/);
  await assert.rejects(decideRenewal(manager, proposal.id, "approve", ""), /someone other than the person who proposed/);
  const officer = await addMember(admin, "OFFICER", "off");
  await assert.rejects(decideRenewal(officer, proposal.id, "approve", ""), /not allowed|permission/i);

  const created = await decideRenewal(admin, proposal.id, "approve", "Agreed");
  assert.ok(created);
  const next = (await getLease(admin, created.id))!;
  assert.equal(next.lease.rentKobo, 45_000_000n);
  assert.equal(next.lease.renewedFrom?.id, lease.id);
  assert.equal(next.lease.occupantName, "Corner Pharmacy Ltd");
  assert.ok(next.lease.charges.length >= 4);
  const old = (await getLease(admin, lease.id))!;
  assert.equal(old.lease.renewedTo?.id, created.id);
  assert.equal(old.lease.renewals[0].status, "APPROVED");

  await assert.rejects(decideRenewal(admin, proposal.id, "approve", ""), /already been decided/);
  await assert.rejects(proposeRenewal(admin, lease.id, { startDate: relativeDate(165), endDate: relativeDate(530), rent: "450,000" }), /already been renewed/);
});

test("renewal periods are checked and a proposer can withdraw", async () => {
  const { admin, lease } = await setup("renewcheck");
  await assert.rejects(proposeRenewal(admin, lease.id, { startDate: relativeDate(100), endDate: relativeDate(400), rent: "1" }), /before the current lease ends/);
  await assert.rejects(proposeRenewal(admin, lease.id, { startDate: relativeDate(165), endDate: relativeDate(165), rent: "1" }), /end after it starts/);
  const p = await proposeRenewal(admin, lease.id, { startDate: relativeDate(165), endDate: relativeDate(530), rent: "1,000" });
  assert.equal(await decideRenewal(admin, p.id, "reject", "Withdrawn"), null);
  const again = await proposeRenewal(admin, lease.id, { startDate: relativeDate(165), endDate: relativeDate(530), rent: "1,000" });
  assert.ok(again.id !== p.id);
});

test("notices flag short notice and cannot be dated backwards or into the future", async () => {
  const { admin, lease } = await setup("notice");
  const short = await recordNotice(admin, lease.id, { givenBy: "TENANT", givenOn: relativeDate(-1), effectiveOn: relativeDate(30), reason: "Notice to vacate" });
  assert.equal(short.adequacy.short, true);
  assert.equal(short.adequacy.days, 31);
  const ok = await recordNotice(admin, lease.id, { givenBy: "LANDLORD", givenOn: relativeDate(-1), effectiveOn: relativeDate(100), reason: "Non-renewal" });
  assert.equal(ok.adequacy.short, false);
  await assert.rejects(recordNotice(admin, lease.id, { givenBy: "TENANT", givenOn: relativeDate(-1), effectiveOn: relativeDate(-5), reason: "Backwards" }), /before it was given/);
  await assert.rejects(recordNotice(admin, lease.id, { givenBy: "TENANT", givenOn: relativeDate(3), effectiveOn: relativeDate(100), reason: "Future" }), /future/);
});

test("handover is recorded once per kind and move-out cannot precede move-in", async () => {
  const { admin, lease } = await setup("handover");
  await recordHandover(admin, lease.id, handover("MOVE_IN", relativeDate(-190)));
  await assert.rejects(recordHandover(admin, lease.id, handover("MOVE_IN", relativeDate(-189))), /already been recorded/);
  await assert.rejects(recordHandover(admin, lease.id, handover("MOVE_OUT", relativeDate(-195))), /before the move-in/);
  await assert.rejects(recordHandover(admin, lease.id, handover("MOVE_OUT", relativeDate(5))), /future/);
  await assert.rejects(recordHandover(admin, lease.id, { ...handover("MOVE_OUT", relativeDate(-1)), acknowledgedBy: "" }), /Enter the name/);
  const viewer = await addMember(admin, "VIEWER", "view");
  await assert.rejects(recordHandover(viewer, lease.id, handover("MOVE_OUT", relativeDate(-1))), /not allowed|permission/i);
  // Handover records cannot be edited by the runtime role.
  const h = (await getLease(admin, lease.id))!.lease.handovers[0];
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.leaseHandover.update({ where: { id: h.id }, data: { keysCount: 9 } })));
});

test("closing needs the move-out, removes untouched future rent, and keeps arrears and payments", async () => {
  const { admin, asset, lease } = await setup("close");
  const all = (await getLease(admin, lease.id))!.lease.charges;
  const past = all.filter((c) => c.dueDate <= new Date(Date.now()));
  const future = all.filter((c) => c.dueDate > new Date(Date.now() + 864e5));
  assert.ok(past.length >= 1 && future.length >= 1);

  await assert.rejects(closeLease(admin, lease.id, { outcome: "TERMINATED", closedOn: relativeDate(0), reason: "Tenant left" }), /move-out handover/);
  await recordHandover(admin, lease.id, handover("MOVE_OUT", relativeDate(0)));
  await assert.rejects(closeLease(admin, lease.id, { outcome: "ENDED", closedOn: relativeDate(0), reason: "" }), /not reached its end date/);
  await assert.rejects(closeLease(admin, lease.id, { outcome: "TERMINATED", closedOn: relativeDate(0), reason: "" }), /reason/);
  await assert.rejects(closeLease(admin, lease.id, { outcome: "TERMINATED", closedOn: relativeDate(2), reason: "Tenant left" }), /future/);
  const manager = await addMember(admin, "MANAGER", "m2");
  await assert.rejects(closeLease(withRole(manager, "OFFICER"), lease.id, { outcome: "TERMINATED", closedOn: relativeDate(0), reason: "Tenant left" }), /not allowed|permission/i);

  // A payment already made stays on the lease after it is closed.
  await recordLeasePayment(admin, lease.id, { amount: "100,000", paidOn: relativeDate(-1), evidence: "CLOSE-0001" });
  const result = await closeLease(admin, lease.id, { outcome: "TERMINATED", closedOn: relativeDate(0), reason: "Tenant left early" });
  assert.equal(result.removedCharges > 0, true);
  const after = (await getLease(admin, lease.id))!;
  assert.equal(after.lease.status, "TERMINATED");
  assert.equal(after.lease.closeReason, "Tenant left early");
  assert.ok(after.lease.charges.every((c) => c.dueDate <= new Date(Date.now() + 864e5) || c.paidKobo > 0n));
  assert.ok(after.lease.charges.length < all.length);
  assert.equal(after.lease.charges.reduce((s, c) => s + c.paidKobo, 0n), 10_000_000n);
  assert.equal(result.arrearsKobo > 0n, true);
  const assetNow = await withTenant(admin.companyId, admin.userId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: asset.id } }));
  assert.equal(assetNow.status, "VACANT");
  await assert.rejects(closeLease(admin, lease.id, { outcome: "TERMINATED", closedOn: relativeDate(0), reason: "Again" }), /already closed/);
  // Arrears can still be collected after closure.
  await recordLeasePayment(admin, lease.id, { amount: "50,000", paidOn: relativeDate(0), evidence: "CLOSE-0002" });
  // And the tenancy counts as ended for deposit settlement.
  assert.equal(after.lease.closedOn !== null, true);
});

test("a lease past its end date can be closed as ended, and nothing future is removed", async () => {
  const { admin, lease } = await setup("ended", { startDate: relativeDate(-400), endDate: relativeDate(-35) });
  const charges = (await getLease(admin, lease.id))!.lease.charges;
  assert.ok(charges.every((c) => c.dueDate <= new Date(Date.now())));
  await recordHandover(admin, lease.id, handover("MOVE_OUT", relativeDate(-35)));
  const r = await closeLease(admin, lease.id, { outcome: "ENDED", closedOn: relativeDate(-35), reason: "" });
  assert.equal(r.removedCharges, 0);
  assert.equal((await getLease(admin, lease.id))!.lease.status, "ENDED");
});

test("lifecycle records are private to the company", async () => {
  const a = await setup("isoa");
  const b = await newCompany("isob");
  await assert.rejects(proposeRenewal(b, a.lease.id, { startDate: relativeDate(165), endDate: relativeDate(530), rent: "1,000" }), /not found/i);
  await assert.rejects(recordNotice(b, a.lease.id, { givenBy: "TENANT", givenOn: relativeDate(-1), effectiveOn: relativeDate(10), reason: "x y z" }), /not found/i);
  await assert.rejects(recordHandover(b, a.lease.id, handover("MOVE_IN", relativeDate(-1))), /not found/i);
  await assert.rejects(closeLease(b, a.lease.id, { outcome: "TERMINATED", closedOn: relativeDate(0), reason: "Nope nope" }), /not found/i);
  const p = await proposeRenewal(a.admin, a.lease.id, { startDate: relativeDate(165), endDate: relativeDate(530), rent: "1,000" });
  await assert.rejects(decideRenewal(b, p.id, "reject", ""), /not found/i);
});
