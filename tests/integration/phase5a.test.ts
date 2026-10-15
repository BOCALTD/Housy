/**
 * Phase 5a: the rent ledger, run against a real PostgreSQL database through the runtime role.
 * Receipts, duplicate references, allocation, reversal, reconciliation, adjustments, deposits,
 * grace periods, units, custom frequencies, concurrency and company isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease, getLease, getReceipt, recordLeasePayment, recordPayment } from "../../src/lib/services/leases";
import {
  decideAdjustment, reconcileReceipt, recordDepositReceived, requestAdjustment, reverseReceipt, settleDeposit, verifyLedger,
} from "../../src/lib/services/ledger";
import { dashboard } from "../../src/lib/services/dashboard";
import { chargeState } from "../../src/lib/rent";
import { todayInLagos } from "../../src/lib/dates";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function setup(label: string, lease: Partial<Parameters<typeof createLease>[2]> = {}) {
  const admin = await newCompany(label);
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "MANAGER" });
  const created = await createLease(admin, asset.id, {
    occupantName: "Corner Pharmacy Ltd", startDate: "2025-01-01", endDate: "2026-01-01", rent: "400,000", frequency: "QUARTERLY",
    deposit: "300,000", ...lease,
  });
  const full = (await getLease(admin, created.id))!;
  return { admin, asset, lease: created, charges: full.lease.charges };
}

const stateOf = async (ctx: Awaited<ReturnType<typeof newCompany>>, leaseId: string) => {
  const r = (await getLease(ctx, leaseId))!;
  return r.lease.charges.map((c) => ({ id: c.id, paid: c.paidKobo, adjusted: c.adjustedKobo, amount: c.amountKobo }));
};

test("one payment is applied to the oldest charges first, and each reference is recorded once", async () => {
  const { admin, lease, charges } = await setup("alloc");
  const receipt = await recordLeasePayment(admin, lease.id, {
    amount: "500,000", paidOn: "2025-01-05", evidence: "GTB-0001", method: "Bank transfer", payerName: "Corner Pharmacy",
  });
  assert.match(receipt.no, /^RCT-\d{4}-00001$/);
  const after1 = await stateOf(admin, lease.id);
  assert.equal(after1[0].paid, 40_000_000n, "the oldest charge is cleared first");
  assert.equal(after1[1].paid, 10_000_000n, "the rest part-pays the next charge");
  assert.equal(after1[2].paid, 0n);

  // The same reference, in any spelling, cannot be recorded again.
  await assert.rejects(recordLeasePayment(admin, lease.id, { amount: "1,000", paidOn: "2025-01-06", evidence: "gtb 0001" }), /already recorded on receipt RCT-/);
  await assert.rejects(recordPayment(admin, charges[2].id, { amount: "1,000", paidOn: "2025-01-06", evidence: "GTB/0001" }), /already recorded/);

  // Overpayment is refused, for the lease as a whole and for a single charge.
  await assert.rejects(recordLeasePayment(admin, lease.id, { amount: "1,100,000.01", paidOn: "2025-01-06", evidence: "OVER-1" }), /more than the total outstanding/);
  await assert.rejects(recordPayment(admin, charges[2].id, { amount: "400,000.01", paidOn: "2025-01-06", evidence: "OVER-2" }), /more than the amount outstanding/);
  // A payment dated in the future is refused. A payment today is accepted.
  await assert.rejects(recordLeasePayment(admin, lease.id, { amount: "1,000", paidOn: relativeDate(1), evidence: "FUT-1" }), /cannot be in the future/);
  await recordLeasePayment(admin, lease.id, { amount: "1,000", paidOn: relativeDate(0), evidence: "TODAY-1" });

  const t = await getReceipt(admin, receipt.id);
  assert.equal(t!.receipt.allocations.length, 2);

  // The whole remaining balance can be paid in one go, including charges that are not yet paid at all.
  await recordLeasePayment(admin, lease.id, { amount: "1,099,000", paidOn: "2025-10-05", evidence: "FULL-1" });
  assert.ok((await stateOf(admin, lease.id)).every((c) => c.paid === c.amount));
  await assert.rejects(recordLeasePayment(admin, lease.id, { amount: "1", paidOn: "2025-10-06", evidence: "FULL-2" }), /Nothing is outstanding/);
  assert.deepEqual((await verifyLedger(admin)), []);
});

test("reconciliation needs a second person, and a reversal puts the charges back", async () => {
  const { admin, lease, charges } = await setup("recon");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const officer = await addMember(admin, "OFFICER", "off");

  const r1 = await recordLeasePayment(admin, lease.id, { amount: "400,000", paidOn: "2025-01-03", evidence: "BANK-100" });
  await assert.rejects(reconcileReceipt(admin, r1.id, { statementRef: "Stmt Jan line 4" }), /someone other than the person who recorded/);
  await assert.rejects(reconcileReceipt(officer, r1.id, { statementRef: "Stmt Jan line 4" }), /permission/);
  await reconcileReceipt(manager, r1.id, { statementRef: "Stmt Jan line 4" });
  await assert.rejects(reconcileReceipt(manager, r1.id, { statementRef: "again" }), /already reconciled/);
  await assert.rejects(reverseReceipt(admin, r1.id, "recorded in error"), /reconciled to a bank statement/);

  // A second receipt is reversed; the charge is unpaid again and its reference can be used afresh.
  const r2 = await recordPayment(manager, charges[1].id, { amount: "400,000", paidOn: "2025-04-02", evidence: "CASH-77" });
  assert.equal((await stateOf(admin, lease.id))[1].paid, 40_000_000n);
  await assert.rejects(reverseReceipt(officer, r2.id, "wrong amount entered"), /permission/);
  await assert.rejects(reverseReceipt(admin, r2.id, "bad"), /reason/);
  await reverseReceipt(admin, r2.id, "wrong amount entered");
  assert.equal((await stateOf(admin, lease.id))[1].paid, 0n);
  await assert.rejects(reverseReceipt(admin, r2.id, "twice"), /already been reversed/);
  await assert.rejects(reconcileReceipt(manager, r2.id, { statementRef: "Stmt Apr line 9" }), /reversed/);
  const r3 = await recordPayment(manager, charges[1].id, { amount: "400,000", paidOn: "2025-04-02", evidence: "CASH-77" });
  assert.notEqual(r3.id, r2.id);
  assert.equal((await stateOf(admin, lease.id))[1].paid, 40_000_000n);
  assert.deepEqual(await verifyLedger(admin), []);

  // The receipt, its reconciliation and its reversal all stay on file.
  const view = (await getLease(admin, lease.id))!;
  assert.equal(view.lease.receipts.length, 3);
  assert.ok(view.lease.receipts.find((r) => r.id === r1.id)!.reconciliation);
  assert.ok(view.lease.receipts.find((r) => r.id === r2.id)!.reversal);
});

test("adjustments take effect only when a different person approves them", async () => {
  const { admin, lease, charges } = await setup("adjust");
  const officer = await addMember(admin, "OFFICER", "off");
  const viewer = await addMember(admin, "VIEWER", "view");
  await recordPayment(admin, charges[0].id, { amount: "100,000", paidOn: "2025-01-03", evidence: "ADJ-PAY-1" });

  await assert.rejects(requestAdjustment(viewer, charges[3].id, { kind: "LATE_FEE", amount: "20,000", reason: "Clause 7 late fee" }), /permission/);
  const fee = await requestAdjustment(officer, charges[3].id, { kind: "LATE_FEE", amount: "20,000", reason: "Clause 7 late fee" });
  assert.equal(fee.status, "PENDING");
  assert.equal((await stateOf(admin, lease.id))[3].adjusted, 0n, "nothing changes until approval");

  await assert.rejects(decideAdjustment(officer, fee.id, "approve"), /permission/);
  const own = await requestAdjustment(admin, charges[3].id, { kind: "CORRECTION", direction: "INCREASE", amount: "1,000", reason: "Rounding correction" });
  await assert.rejects(decideAdjustment(admin, own.id, "approve"), /someone other than the person who requested/);
  await assert.rejects(decideAdjustment(admin, own.id, "reject"), /reason/);
  await decideAdjustment(admin, own.id, "reject", "Withdrawn");
  await decideAdjustment(admin, fee.id, "approve");
  await assert.rejects(decideAdjustment(admin, fee.id, "approve"), /already been decided/);
  assert.equal((await stateOf(admin, lease.id))[3].adjusted, 2_000_000n);

  // A late fee raises what is owed on that charge.
  const today = todayInLagos();
  const view = (await getLease(admin, lease.id))!;
  const c4 = view.lease.charges[3];
  assert.equal(c4.amountKobo + c4.adjustedKobo, 42_000_000n);
  assert.equal(chargeState(c4, today, 0), "OVERDUE");
  await recordPayment(admin, c4.id, { amount: "420,000", paidOn: "2025-10-05", evidence: "ADJ-PAY-2" });
  assert.equal(chargeState((await getLease(admin, lease.id))!.lease.charges[3], today, 0), "PAID");

  // A waiver cannot go below what has been paid; a full waiver of an unpaid charge is WAIVED.
  await assert.rejects(requestAdjustment(officer, charges[0].id, { kind: "WAIVER", amount: "350,000", reason: "Goodwill waiver" }), /more than the amount still unpaid/);
  const waiver = await requestAdjustment(officer, charges[2].id, { kind: "WAIVER", amount: "400,000", reason: "Landlord agreed to waive" });
  await decideAdjustment(admin, waiver.id, "approve");
  const waived = (await getLease(admin, lease.id))!.lease.charges[2];
  assert.equal(chargeState(waived, today, 0), "WAIVED");
  await assert.rejects(recordPayment(admin, waived.id, { amount: "1", paidOn: "2025-07-02", evidence: "ADJ-PAY-3" }), /fully paid/);
  assert.deepEqual(await verifyLedger(admin), []);
});

test("approving an adjustment re-checks payments made since it was requested", async () => {
  const { admin, charges } = await setup("adjrace");
  const officer = await addMember(admin, "OFFICER", "off");
  const waiver = await requestAdjustment(officer, charges[0].id, { kind: "WAIVER", amount: "300,000", reason: "Agreed reduction" });
  await recordPayment(admin, charges[0].id, { amount: "200,000", paidOn: "2025-01-03", evidence: "RACE-ADJ" });
  await assert.rejects(decideAdjustment(admin, waiver.id, "approve"), /more than the amount still unpaid/);
});

test("the deposit ledger follows the agreed amount, the balance and the end of the tenancy", async () => {
  const { admin, lease } = await setup("deposit");
  const officer = await addMember(admin, "OFFICER", "off");
  await recordDepositReceived(officer, lease.id, { amount: "200,000", receivedOn: "2025-01-02", evidence: "DEP-1" });
  await assert.rejects(recordDepositReceived(officer, lease.id, { amount: "100,000.01", receivedOn: "2025-01-03", evidence: "DEP-2" }), /above the agreed/);
  await recordDepositReceived(officer, lease.id, { amount: "100,000", receivedOn: "2025-01-03", evidence: "DEP-2" });
  await assert.rejects(settleDeposit(officer, lease.id, { kind: "REFUND", amount: "10", reason: "Refund after inspection", evidence: "REF-0" }), /permission/);
  await settleDeposit(admin, lease.id, { kind: "DEDUCTION", amount: "50,000", reason: "Repairs to shopfront" });
  await assert.rejects(settleDeposit(admin, lease.id, { kind: "REFUND", amount: "250,001", reason: "Refund after inspection", evidence: "REF-1" }), /more than the deposit still held/);
  await assert.rejects(settleDeposit(admin, lease.id, { kind: "REFUND", amount: "250,000", reason: "Refund after inspection" }), /payment reference/);
  await settleDeposit(admin, lease.id, { kind: "REFUND", amount: "250,000", reason: "Refund after inspection", evidence: "REF-1" });
  await assert.rejects(settleDeposit(admin, lease.id, { kind: "REFUND", amount: "1", reason: "Refund after inspection", evidence: "REF-2" }), /more than the deposit still held/);
  const entries = (await getLease(admin, lease.id))!.lease.depositEntries;
  assert.deepEqual(entries.map((e) => e.kind).sort(), ["DEDUCTION", "RECEIVED", "RECEIVED", "REFUND"]);

  // While a tenancy is still running, its deposit cannot be settled.
  const live = await setup("depositlive", { startDate: relativeDate(-30), endDate: relativeDate(335), frequency: "YEARLY" });
  await recordDepositReceived(live.admin, live.lease.id, { amount: "300,000", receivedOn: relativeDate(-29), evidence: "LIVE-DEP" });
  await assert.rejects(settleDeposit(live.admin, live.lease.id, { kind: "DEDUCTION", amount: "1", reason: "Early deduction" }), /once the tenancy has ended/);
  // A lease with no agreed deposit takes none.
  const none = await setup("depositnone", { deposit: "0" });
  await assert.rejects(recordDepositReceived(none.admin, none.lease.id, { amount: "1", receivedOn: "2025-01-02", evidence: "NONE-1" }), /No deposit was agreed/);
});

test("grace periods, units and custom payment frequencies", async () => {
  const admin = await newCompany("terms");
  const a1 = await createAsset(admin, { name: "Block A", assetClass: "RESIDENTIAL", category: "Flats", companyRelationship: "OWNER" });
  const a2 = await createAsset(admin, { name: "Block B", assetClass: "RESIDENTIAL", category: "Flats", companyRelationship: "OWNER" });

  // Units: two flats in one building can be let at once; the same flat, or the whole building, cannot.
  const base = { startDate: relativeDate(-5), endDate: relativeDate(360), rent: "100,000", frequency: "YEARLY" as const };
  await createLease(admin, a1.id, { ...base, occupantName: "Tenant 3B", unit: "Flat 3B" });
  await createLease(admin, a1.id, { ...base, occupantName: "Tenant 3C", unit: "Flat 3C" });
  await assert.rejects(createLease(admin, a1.id, { ...base, occupantName: "Clash", unit: "flat 3b" }), /already has an active lease/);
  await assert.rejects(createLease(admin, a1.id, { ...base, occupantName: "Whole building" }), /already has an active lease/);

  // Grace: rent due 5 days ago is overdue with no grace, and not overdue with 10 days' grace.
  const strict = await createLease(admin, a2.id, { ...base, occupantName: "No grace", unit: "Flat 1", graceDays: "0" });
  const before = await dashboard(admin);
  const lenient = await createLease(admin, a2.id, { ...base, occupantName: "Ten days", unit: "Flat 2", graceDays: "10" });
  const withGrace = await dashboard(admin);
  assert.equal(withGrace.overdueCharges, before.overdueCharges, "a lease inside its grace period adds no overdue charge");
  assert.ok(before.overdueCharges >= 1, "a lease with no grace and rent due 5 days ago is overdue");
  assert.equal((await getLease(admin, lenient.id))!.lease.graceDays, 10);
  assert.equal((await getLease(admin, strict.id))!.lease.graceDays, 0);
  await assert.rejects(createLease(admin, a2.id, { ...base, occupantName: "Bad", unit: "Flat 9", graceDays: "91" }), /between 0 and 90/);
  await assert.rejects(createLease(admin, a2.id, { ...base, occupantName: "Bad", unit: "Flat 9", graceDays: "ten" }), /whole number/);

  // Custom frequency: every two months from 1 January gives six charges.
  const custom = await createLease(admin, a2.id, {
    occupantName: "Bi-monthly", unit: "Flat 7", startDate: "2020-01-01", endDate: "2020-12-31", rent: "10,000", frequency: "CUSTOM", intervalMonths: "2",
  });
  const dates = (await getLease(admin, custom.id))!.lease.charges.map((c) => c.dueDate.toISOString().slice(0, 10));
  assert.deepEqual(dates, ["2020-01-01", "2020-03-01", "2020-05-01", "2020-07-01", "2020-09-01", "2020-11-01"]);
  await assert.rejects(createLease(admin, a2.id, { ...base, occupantName: "No interval", unit: "Flat 8", frequency: "CUSTOM" }), /1 to 120 months/);
});

test("money cannot go out of balance, and financial records cannot be edited", async () => {
  const { admin, lease, charges } = await setup("guards");
  const r = await recordPayment(admin, charges[0].id, { amount: "100,000", paidOn: "2025-01-03", evidence: "GUARD-1" });
  // Even code that bypasses the rules is stopped by the database.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) =>
    tx.rentCharge.update({ where: { id: charges[0].id }, data: { paidKobo: 40_000_001n } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) =>
    tx.rentCharge.update({ where: { id: charges[0].id }, data: { paidKobo: -1n } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) =>
    tx.receipt.updateMany({ where: { id: r.id }, data: { amountKobo: 1n } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) =>
    tx.rentPayment.deleteMany({ where: { receiptId: r.id } })));
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) =>
    tx.depositEntry.deleteMany({ where: { leaseId: lease.id } })));
  assert.deepEqual(await verifyLedger(admin), []);
  // The ledger check does notice a balance that disagrees with its receipts.
  await withTenant(admin.companyId, admin.userId, (tx) =>
    tx.rentCharge.update({ where: { id: charges[1].id }, data: { paidKobo: 5_000n } }));
  const problems = await verifyLedger(admin);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, charges[1].id);
});

test("simultaneous payments never overpay or share a reference or number", async () => {
  const { admin, lease, charges } = await setup("race");
  // Two full payments for the same charge at once: exactly one succeeds.
  const both = await Promise.allSettled([
    recordPayment(admin, charges[0].id, { amount: "400,000", paidOn: "2025-01-03", evidence: "RACE-A" }),
    recordPayment(admin, charges[0].id, { amount: "400,000", paidOn: "2025-01-03", evidence: "RACE-B" }),
  ]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await stateOf(admin, lease.id))[0].paid, 40_000_000n);

  // The same reference used on two different charges at once: exactly one succeeds.
  const same = await Promise.allSettled([
    recordPayment(admin, charges[1].id, { amount: "1,000", paidOn: "2025-04-02", evidence: "RACE-SAME" }),
    recordPayment(admin, charges[2].id, { amount: "1,000", paidOn: "2025-07-02", evidence: "race same" }),
  ]);
  assert.equal(same.filter((r) => r.status === "fulfilled").length, 1);

  // Several receipts at once all get different numbers.
  const many = await Promise.all([1, 2, 3, 4].map((n) =>
    recordLeasePayment(admin, lease.id, { amount: "1,000", paidOn: "2025-08-01", evidence: `RACE-N-${n}` })));
  assert.equal(new Set(many.map((m) => m.no)).size, 4);
  assert.deepEqual(await verifyLedger(admin), []);
});

test("another company cannot see or change any part of a lease ledger", async () => {
  const { admin, lease, charges } = await setup("owner");
  const other = await newCompany("intruder");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const receipt = await recordPayment(admin, charges[0].id, { amount: "100,000", paidOn: "2025-01-03", evidence: "ISO-1" });
  const adj = await requestAdjustment(admin, charges[1].id, { kind: "LATE_FEE", amount: "5,000", reason: "Clause 7 late fee" });
  await recordDepositReceived(admin, lease.id, { amount: "100,000", receivedOn: "2025-01-02", evidence: "ISO-DEP" });

  assert.equal(await getLease(other, lease.id), null);
  assert.equal(await getReceipt(other, receipt.id), null);
  await assert.rejects(recordLeasePayment(other, lease.id, { amount: "1", paidOn: "2025-01-03", evidence: "INTRUDE-1" }), /not found/);
  await assert.rejects(recordPayment(other, charges[0].id, { amount: "1", paidOn: "2025-01-03", evidence: "INTRUDE-2" }), /not found/);
  await assert.rejects(reverseReceipt(other, receipt.id, "attempted reversal"), /not found/);
  await assert.rejects(reconcileReceipt(other, receipt.id, { statementRef: "forged statement" }), /not found/);
  await assert.rejects(requestAdjustment(other, charges[0].id, { kind: "WAIVER", amount: "1", reason: "attempted waiver" }), /not found/);
  await assert.rejects(decideAdjustment(other, adj.id, "approve"), /not found/);
  await assert.rejects(recordDepositReceived(other, lease.id, { amount: "1", receivedOn: "2025-01-02", evidence: "INTRUDE-3" }), /not found/);
  await assert.rejects(settleDeposit(other, lease.id, { kind: "REFUND", amount: "1", reason: "attempted refund", evidence: "INTRUDE-4" }), /not found/);
  assert.deepEqual(await verifyLedger(other), []);

  // Even a raw query in the other company's context sees none of it (row-level security).
  const raw = await withTenant(other.companyId, other.userId, async (tx) => ({
    receipts: await tx.receipt.count(), allocations: await tx.rentPayment.count(), adjustments: await tx.rentAdjustment.count(),
    deposits: await tx.depositEntry.count(), counters: await tx.numberCounter.count(),
  }));
  assert.deepEqual(raw, { receipts: 0, allocations: 0, adjustments: 0, deposits: 0, counters: 0 });
  // The owner's data is intact, and a second manager there can still see it.
  assert.equal((await getLease(manager, lease.id))!.lease.receipts.length, 1);
});
