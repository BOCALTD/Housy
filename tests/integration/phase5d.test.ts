/**
 * Phase 5d: obligations, reminders, the compliance calendar and rent reports, run against a real
 * PostgreSQL database through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease, getLease, recordLeasePayment } from "../../src/lib/services/leases";
import { reverseReceipt } from "../../src/lib/services/ledger";
import {
  cancelObligation, completeObligation, complianceCalendar, createObligation, listObligations, recordProfessionalReview,
} from "../../src/lib/services/obligations";
import { rentReport } from "../../src/lib/services/reports";
import { getSettings, updateReminderSettings } from "../../src/lib/services/settings";
import { addMonthsClamped, parseDateOnly, todayInLagos } from "../../src/lib/dates";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const base = { kind: "LAND_USE_CHARGE" as const, title: "Land use charge", dueDate: relativeDate(10) };

test("an obligation is completed once, with evidence, and a repeating one rolls forward", async () => {
  const admin = await newCompany("oblig");
  const officer = await addMember(admin, "OFFICER", "off");
  const viewer = await addMember(admin, "VIEWER", "view");
  await assert.rejects(createObligation(officer, base), /permission/i);
  const o = await createObligation(admin, { ...base, dueDate: "2026-01-31", recurrenceMonths: "1", amount: "150,000", nextReviewOn: "2026-01-15" });

  await assert.rejects(completeObligation(viewer, o.id, { completedOn: relativeDate(0), evidence: "REC-1" }), /permission/i);
  await assert.rejects(completeObligation(officer, o.id, { completedOn: relativeDate(0), evidence: "" }), /receipt or filing reference/);
  await assert.rejects(completeObligation(officer, o.id, { completedOn: relativeDate(1), evidence: "REC-1" }), /future/);

  const next = await completeObligation(officer, o.id, { completedOn: relativeDate(0), amountPaid: "150,000", evidence: "REC-1" });
  assert.ok(next);
  assert.equal(next.dueDate.getTime(), parseDateOnly("2026-02-28").getTime());
  await assert.rejects(completeObligation(admin, o.id, { completedOn: relativeDate(0), evidence: "REC-2" }), /no longer open/);

  const { open, closed } = await listObligations(admin);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, next.id);
  assert.equal(open[0].amountKobo, 15_000_000n);
  assert.equal(open[0].nextReviewOn?.getTime(), addMonthsClamped(parseDateOnly("2026-01-15"), 1).getTime());
  assert.equal(closed[0].filing?.evidence, "REC-1");
  // Filings cannot be edited by the runtime role.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.obligationFiling.update({ where: { obligationId: o.id }, data: { evidence: "changed" } })));
});

test("a recurring obligation completed at the same moment rolls forward only once", async () => {
  const admin = await newCompany("obrace");
  const o = await createObligation(admin, { ...base, recurrenceMonths: "12" });
  const results = await Promise.allSettled(
    [1, 2, 3].map((i) => completeObligation(admin, o.id, { completedOn: relativeDate(0), evidence: `RACE-${i}` })),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rolled = await withTenant(admin.companyId, admin.userId, (tx) => tx.obligation.count({ where: { rolledFromId: o.id } }));
  assert.equal(rolled, 1);
});

test("professional review gates completion, and cancelling needs a reason", async () => {
  const admin = await newCompany("review");
  const o = await createObligation(admin, { ...base, kind: "WITHHOLDING_TAX", title: "WHT on rent", requiresProfessionalReview: true });
  await assert.rejects(completeObligation(admin, o.id, { completedOn: relativeDate(0), evidence: "WHT-1" }), /professional review/);
  await assert.rejects(recordProfessionalReview(admin, o.id, { reviewedBy: "A", reviewedOn: relativeDate(0) }), /Enter the name/);
  await assert.rejects(recordProfessionalReview(admin, o.id, { reviewedBy: "Ngozi Adviser", reviewedOn: relativeDate(3) }), /future/);
  await recordProfessionalReview(admin, o.id, { reviewedBy: "Ngozi Adviser", reviewedOn: relativeDate(-1) });
  await completeObligation(admin, o.id, { completedOn: relativeDate(0), evidence: "WHT-1" });

  const c = await createObligation(admin, { ...base, title: "Old permit" });
  await assert.rejects(cancelObligation(admin, c.id, "no"), /reason/);
  await cancelObligation(admin, c.id, "Property sold");
  await assert.rejects(cancelObligation(admin, c.id, "Property sold again"), /no longer open/);
  assert.equal((await listObligations(admin)).open.length, 0);
});

test("the calendar classes deadlines by the company's reminder settings", async () => {
  const admin = await newCompany("calendar");
  const asset = await createAsset(admin, { name: "Cal building", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  await createLease(admin, asset.id, {
    occupantName: "Ending Tenant", startDate: relativeDate(-345), endDate: relativeDate(20), rent: "100,000", frequency: "YEARLY",
  });
  for (const [title, due] of [["Escalated", -10], ["Overdue", -3], ["Boundary", 30], ["Later", 31]] as const) {
    await createObligation(admin, { ...base, title, dueDate: relativeDate(due) });
  }
  const stateOf = async () => {
    const { items } = await complianceCalendar(admin);
    return Object.fromEntries(items.map((i) => [i.title, i.state]));
  };
  let s = await stateOf();
  assert.equal(s["Escalated"], "ESCALATED");
  assert.equal(s["Overdue"], "OVERDUE");
  assert.equal(s["Boundary"], "DUE_SOON");
  assert.equal(s["Later"], "LATER");
  assert.equal(s["Lease ends: Ending Tenant"], "DUE_SOON");

  await assert.rejects(updateReminderSettings(await addMember(admin, "MANAGER", "mgr"), { leadDays: "60", escalationDays: "3" }), /permission/i);
  await assert.rejects(updateReminderSettings(admin, { leadDays: "0", escalationDays: "3" }), /between 1 and 365/);
  await assert.rejects(updateReminderSettings(admin, { leadDays: "30", escalationDays: "91" }), /between 1 and 90/);
  await assert.rejects(updateReminderSettings(admin, { leadDays: "x", escalationDays: "3" }), /whole number/);
  await updateReminderSettings(admin, { leadDays: "60", escalationDays: "3" });
  s = await stateOf();
  assert.equal(s["Later"], "DUE_SOON");
  assert.equal(s["Overdue"], "ESCALATED");
  const { company } = await getSettings(admin);
  assert.equal(company.reminderLeadDays, 60);
  assert.equal(company.escalationDays, 3);

  // Completing an item takes it off the calendar.
  const { open } = await listObligations(admin);
  await completeObligation(admin, open.find((o) => o.title === "Overdue")!.id, { completedOn: relativeDate(0), evidence: "DONE-1" });
  assert.equal((await stateOf())["Overdue"], undefined);
});

test("rent reports reconcile with the ledger, exclude reversed receipts and age arrears", async () => {
  const admin = await newCompany("report");
  const asset = await createAsset(admin, { name: "Report building", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  const lease = await createLease(admin, asset.id, {
    occupantName: "Reported Tenant", startDate: relativeDate(-200), endDate: relativeDate(165), rent: "400,000", frequency: "QUARTERLY",
  });
  const receipt = await recordLeasePayment(admin, lease.id, { amount: "500,000", paidOn: relativeDate(-1), evidence: "RPT-1" });
  const range = { from: parseDateOnly(relativeDate(-365)), to: todayInLagos() };

  let r = await rentReport(admin, range);
  assert.equal(r.rows.length, 1);
  assert.equal(r.totals.billedKobo, 120_000_000n);
  assert.equal(r.totals.collectedKobo, 50_000_000n);
  assert.equal(r.totals.arrearsKobo, 70_000_000n);
  assert.equal(r.totals.activeLeases, 1);
  const age = Object.fromEntries(r.ageing.map((a) => [a.bucket, a.kobo]));
  assert.equal(age["Over 90 days"], 30_000_000n);
  assert.equal(age["1-30 days"], 40_000_000n);

  // The report's arrears match the lease's own ledger.
  const ledger = (await getLease(admin, lease.id))!.lease.charges.filter((c) => c.dueDate <= todayInLagos())
    .reduce((s, c) => s + (c.amountKobo + c.adjustedKobo - c.paidKobo), 0n);
  assert.equal(ledger, r.totals.arrearsKobo);

  // A payment outside the range is not counted, and a reversed receipt is not collected money.
  const narrow = await rentReport(admin, { from: parseDateOnly(relativeDate(-30)), to: parseDateOnly(relativeDate(-2)) });
  assert.equal(narrow.totals.collectedKobo, 0n);
  await reverseReceipt(admin, receipt.id, "Entered against the wrong lease");
  r = await rentReport(admin, range);
  assert.equal(r.totals.collectedKobo, 0n);
  assert.equal(r.totals.arrearsKobo, 120_000_000n);
  await assert.rejects(rentReport(admin, { from: range.to, to: range.from }), /must not be before/);
});

test("obligations and reports are private to the company", async () => {
  const a = await newCompany("obisoa");
  const b = await newCompany("obisob");
  const asset = await createAsset(a, { name: "A building", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  const o = await createObligation(a, { ...base, assetId: asset.id });
  await assert.rejects(createObligation(b, { ...base, assetId: asset.id }), /not found/i);
  await assert.rejects(completeObligation(b, o.id, { completedOn: relativeDate(0), evidence: "NOPE-1" }), /not found/i);
  await assert.rejects(cancelObligation(b, o.id, "Not yours to cancel"), /not found/i);
  assert.equal((await listObligations(b)).open.length, 0);
  assert.equal((await complianceCalendar(b)).items.length, 0);
  assert.equal((await rentReport(b, { from: parseDateOnly(relativeDate(-30)), to: todayInLagos() })).rows.length, 0);
});
