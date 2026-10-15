/**
 * Phase 5c: service charges against a real PostgreSQL database through the runtime role.
 * Exact allocation, part payments, duplicate references, reversal, expense approval, the fund and isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import {
  assessPeriod, createServicePeriod, decideExpense, getServicePeriod, recordCollection, requestExpense, reverseCollection,
} from "../../src/lib/services/service-charges";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

async function plaza(label: string, areas: (string | undefined)[], method: "EQUAL" | "FLOOR_AREA" | "FIXED", budget = "1,000,000.01") {
  const admin = await newCompany(label);
  const asset = await createAsset(admin, { name: `${label} plaza`, assetClass: "COMMERCIAL", category: "Office block", companyRelationship: "OWNER" });
  const leases = [];
  for (let i = 0; i < areas.length; i++) {
    leases.push(await createLease(admin, asset.id, {
      occupantName: `Tenant ${i + 1}`, unit: `Suite ${i + 1}`, startDate: relativeDate(-100), endDate: relativeDate(265),
      rent: "1,000,000", frequency: "YEARLY", floorAreaSqm: areas[i],
    }));
  }
  const period = await createServicePeriod(admin, asset.id, { name: "2026", startDate: relativeDate(-30), endDate: relativeDate(335), budget, method });
  return { admin, asset, leases, period };
}

const assessmentsOf = async (admin: Awaited<ReturnType<typeof newCompany>>, periodId: string) =>
  withTenant(admin.companyId, admin.userId, (tx) => tx.serviceAssessment.findMany({ where: { periodId }, orderBy: { amountKobo: "asc" } }));

test("the budget is shared exactly by floor area, once", async () => {
  const { admin, period } = await plaza("area", ["30", "70", "17"], "FLOOR_AREA");
  const shares = await assessPeriod(admin, period.id, { dueDate: relativeDate(30) });
  assert.equal(shares.length, 3);
  assert.equal(shares.reduce((s, x) => s + x.amountKobo, 0n), 100_000_001n);
  await assert.rejects(assessPeriod(admin, period.id, { dueDate: relativeDate(30) }), /already been assessed/);
  const data = (await getServicePeriod(admin, period.id))!;
  assert.equal(data.period.status, "ASSESSED");
  assert.equal(data.assessed, 100_000_001n);
  assert.equal(data.balance, 0n);
});

test("floor-area sharing needs every area, and fixed shares must add up", async () => {
  const missing = await plaza("noarea", ["30", undefined], "FLOOR_AREA");
  await assert.rejects(assessPeriod(missing.admin, missing.period.id, { dueDate: relativeDate(30) }), /floor area/);
  const fixed = await plaza("fixed", ["10", "10"], "FIXED", "1,000,000");
  const [l1, l2] = fixed.leases;
  await assert.rejects(assessPeriod(fixed.admin, fixed.period.id, { dueDate: relativeDate(30), fixed: { [l1.id]: "600,000", [l2.id]: "300,000" } }), /exactly the budget/);
  await assert.rejects(assessPeriod(fixed.admin, fixed.period.id, { dueDate: relativeDate(30), fixed: { [l1.id]: "600,000" } }), /every lease/);
  // A failed attempt leaves the period open.
  assert.equal((await getServicePeriod(fixed.admin, fixed.period.id))!.period.status, "OPEN");
  await assessPeriod(fixed.admin, fixed.period.id, { dueDate: relativeDate(30), fixed: { [l1.id]: "600,000", [l2.id]: "400,000" } });
  assert.deepEqual((await assessmentsOf(fixed.admin, fixed.period.id)).map((a) => a.amountKobo), [40_000_000n, 60_000_000n]);
});

test("part payments, overpayment, duplicate references and reversal", async () => {
  const { admin, period } = await plaza("collect", ["50", "50"], "EQUAL", "1,000,000");
  await assessPeriod(admin, period.id, { dueDate: relativeDate(30) });
  const [a, b] = await assessmentsOf(admin, period.id);
  assert.equal(a.amountKobo, 50_000_000n);

  const first = await recordCollection(admin, a.id, { amount: "200,000", paidOn: relativeDate(-1), evidence: "SVC-100" });
  await assert.rejects(recordCollection(admin, b.id, { amount: "1", paidOn: relativeDate(-1), evidence: "svc 100" }), /already recorded/);
  await assert.rejects(recordCollection(admin, a.id, { amount: "300,000.01", paidOn: relativeDate(-1), evidence: "SVC-101" }), /more than the amount outstanding/);
  await assert.rejects(recordCollection(admin, a.id, { amount: "0", paidOn: relativeDate(-1), evidence: "SVC-102" }), /more than zero/);
  await assert.rejects(recordCollection(admin, a.id, { amount: "10", paidOn: relativeDate(1), evidence: "SVC-103" }), /future/);
  await recordCollection(admin, a.id, { amount: "300,000", paidOn: relativeDate(-1), evidence: "SVC-104" });
  await assert.rejects(recordCollection(admin, a.id, { amount: "1", paidOn: relativeDate(-1), evidence: "SVC-105" }), /already fully paid/);
  assert.equal((await getServicePeriod(admin, period.id))!.collected, 50_000_000n);

  const manager = await addMember(admin, "MANAGER", "mgr");
  await assert.rejects(reverseCollection(await addMember(admin, "OFFICER", "off"), first.id, "Entered by mistake"), /permission/i);
  await reverseCollection(manager, first.id, "Entered by mistake");
  await assert.rejects(reverseCollection(manager, first.id, "Again please"), /already been reversed/);
  const after = (await getServicePeriod(admin, period.id))!;
  assert.equal(after.collected, 30_000_000n);
  assert.equal(after.outstanding, 70_000_000n);
  // The reversed reference may be used again.
  await recordCollection(admin, a.id, { amount: "200,000", paidOn: relativeDate(-1), evidence: "SVC-100" });
  assert.equal((await getServicePeriod(admin, period.id))!.collected, 50_000_000n);
});

test("expenses need a second approver and cannot spend more than the fund holds", async () => {
  const { admin, period } = await plaza("expense", ["50", "50"], "EQUAL", "1,000,000");
  await assessPeriod(admin, period.id, { dueDate: relativeDate(30) });
  const [a] = await assessmentsOf(admin, period.id);
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");

  const exp = await requestExpense(manager, period.id, { description: "Generator diesel", amount: "100,000", incurredOn: relativeDate(-1), evidence: "INV-1" });
  await assert.rejects(decideExpense(manager, exp.id, "approve", ""), /someone other than the person who requested/);
  await assert.rejects(decideExpense(officer, exp.id, "approve", ""), /permission/i);
  // Nothing has been collected, so the fund cannot pay.
  await assert.rejects(decideExpense(admin, exp.id, "approve", ""), /does not hold enough/);

  await recordCollection(admin, a.id, { amount: "150,000", paidOn: relativeDate(-1), evidence: "SVC-200" });
  await decideExpense(admin, exp.id, "approve", "Approved");
  await assert.rejects(decideExpense(admin, exp.id, "approve", ""), /already been decided/);
  let data = (await getServicePeriod(admin, period.id))!;
  assert.equal(data.balance, 5_000_000n);
  assert.equal(data.approvedExpenses, 10_000_000n);

  const big = await requestExpense(officer, period.id, { description: "Lift repair", amount: "60,000", incurredOn: relativeDate(-1), evidence: "INV-2" });
  await assert.rejects(decideExpense(admin, big.id, "approve", ""), /does not hold enough/);
  await decideExpense(officer, big.id, "reject", "Withdrawn");
  await requestExpense(officer, period.id, { description: "Cleaning", amount: "50,000", incurredOn: relativeDate(-1), evidence: "INV-3" });
  data = (await getServicePeriod(admin, period.id))!;
  assert.equal(data.pendingExpenses, 5_000_000n);
  assert.equal(data.afterPending, 0n);
  await assert.rejects(requestExpense(officer, period.id, { description: "Future", amount: "10", incurredOn: relativeDate(2), evidence: "INV-4" }), /future/);
});

test("simultaneous payments never overpay an assessment", async () => {
  const { admin, period } = await plaza("race", ["50"], "EQUAL", "100,000");
  await assessPeriod(admin, period.id, { dueDate: relativeDate(30) });
  const [a] = await assessmentsOf(admin, period.id);
  const results = await Promise.allSettled(
    [1, 2, 3, 4].map((i) => recordCollection(admin, a.id, { amount: "60,000", paidOn: relativeDate(-1), evidence: `RACE-${i}` })),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await getServicePeriod(admin, period.id))!.collected, 6_000_000n);
});

test("service charge records are private to the company", async () => {
  const a = await plaza("svcisoa", ["50"], "EQUAL", "100,000");
  const b = await newCompany("svcisob");
  assert.equal(await getServicePeriod(b, a.period.id), null);
  await assert.rejects(assessPeriod(b, a.period.id, { dueDate: relativeDate(30) }), /not found/i);
  await assert.rejects(createServicePeriod(b, a.asset.id, { name: "x y", startDate: relativeDate(0), endDate: relativeDate(30), budget: "10", method: "EQUAL" }), /not found/i);
  await assessPeriod(a.admin, a.period.id, { dueDate: relativeDate(30) });
  const [assessment] = await assessmentsOf(a.admin, a.period.id);
  await assert.rejects(recordCollection(b, assessment.id, { amount: "1", paidOn: relativeDate(-1), evidence: "NOPE-1" }), /not found/i);
  await assert.rejects(requestExpense(b, a.period.id, { description: "Spend", amount: "5", incurredOn: relativeDate(-1), evidence: "INV-9" }), /not found/i);
});
