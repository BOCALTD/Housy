/**
 * Floor areas to the hundredth of a square metre, and service charges shared pro rata: a tenancy covering only part of the
 * budget period carries a share weighted by the days it covers. The shares still add up to the budget exactly.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import { assessPeriod, createServicePeriod } from "../../src/lib/services/service-charges";
import { saveListingDraft } from "../../src/lib/services/listings";
import { newCompany } from "./helpers";

after(() => prisma.$disconnect());

test("a part-period tenancy pays pro rata; floor areas keep their decimals", async () => {
  const admin = await newCompany("prorata");
  const asset = await createAsset(admin, { name: "Pro rata plaza", assetClass: "COMMERCIAL", category: "Office block", companyRelationship: "OWNER" });
  // A 366-day period (2028 is a leap year). A is there all period (100.5 m²); B only from 1 July (100.5 m²); C all period (50.25 m²).
  const a = await createLease(admin, asset.id, { occupantName: "Tenant A", unit: "1", startDate: "2027-06-01", endDate: "2029-06-01", rent: "1,000,000", frequency: "YEARLY", floorAreaSqm: "100.5" });
  const b = await createLease(admin, asset.id, { occupantName: "Tenant B", unit: "2", startDate: "2028-07-01", endDate: "2030-06-30", rent: "1,000,000", frequency: "YEARLY", floorAreaSqm: "100.50 m²" });
  const c = await createLease(admin, asset.id, { occupantName: "Tenant C", unit: "3", startDate: "2027-01-01", endDate: "2029-12-31", rent: "1,000,000", frequency: "YEARLY", floorAreaSqm: "50.25" });
  await assert.rejects(createLease(admin, asset.id, { occupantName: "Tenant D", startDate: "2028-01-01", endDate: "2028-12-31", rent: "1", frequency: "YEARLY", floorAreaSqm: "12.345" }), /floor area in square metres/);
  const stored = await withTenant(admin.companyId, admin.userId, (tx) => tx.lease.findMany({ where: { id: { in: [a.id, b.id, c.id] } }, select: { id: true, floorAreaSqm100: true } }));
  assert.deepEqual(new Map(stored.map((l) => [l.id, l.floorAreaSqm100])), new Map([[a.id, 10_050], [b.id, 10_050], [c.id, 5_025]]));

  const period = await createServicePeriod(admin, asset.id, { name: "2028", startDate: "2028-01-01", endDate: "2028-12-31", budget: "3,000,000", method: "FLOOR_AREA" });
  const shares = await assessPeriod(admin, period.id, { dueDate: "2028-02-01" });
  const by = new Map(shares.map((s) => [s.id, s.amountKobo]));
  assert.equal(shares.reduce((t, s) => t + s.amountKobo, 0n), 300_000_000n, "exactly the budget");
  // Weights: A 10050×366, B 10050×184 (1 July to 31 December), C 5025×366.
  const wA = 10050n * 366n, wB = 10050n * 184n, wC = 5025n * 366n, W = wA + wB + wC;
  assert.ok(by.get(a.id)! - (300_000_000n * wA) / W <= 1n);
  assert.ok(by.get(b.id)! - (300_000_000n * wB) / W <= 1n);
  assert.ok(by.get(b.id)! < by.get(a.id)!, "B, there for half the year, pays about half of A");
  const rows = await withTenant(admin.companyId, admin.userId, (tx) => tx.serviceAssessment.findMany({ where: { periodId: period.id } }));
  const bRow = rows.find((r) => r.leaseId === b.id)!;
  assert.deepEqual([bRow.daysOccupied, bRow.periodDays], [184, 366]);
  assert.deepEqual([rows.find((r) => r.leaseId === a.id)!.daysOccupied, rows.find((r) => r.leaseId === a.id)!.periodDays], [366, 366]);

  // Equal shares are pro rata too.
  const p2 = await createServicePeriod(admin, asset.id, { name: "2028 cleaning", startDate: "2028-01-01", endDate: "2028-12-31", budget: "916", method: "EQUAL" });
  const eq = new Map((await assessPeriod(admin, p2.id, { dueDate: "2028-02-01" })).map((s) => [s.id, s.amountKobo]));
  assert.equal([...eq.values()].reduce((t, v) => t + v, 0n), 91_600n);
  assert.equal(eq.get(a.id), eq.get(c.id));
  assert.ok(eq.get(b.id)! < eq.get(a.id)!);
});

test("listing sizes keep two decimal places", async () => {
  const co = await newCompany("areas-listing");
  const asset = await createAsset(co, { name: "Decimal house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await saveListingDraft(co, asset.id, { title: "Decimal house", purpose: "SALE", price: "50,000,000", city: "Yaba", state: "Lagos", buildingSqm: "450.25", landSqm: "1,200.5" } as never);
  const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  assert.deepEqual([l.buildingSqm100, l.landSqm100], [45_025, 120_050]);
  await assert.rejects(saveListingDraft(co, asset.id, { title: "Decimal house", purpose: "SALE", price: "50,000,000", city: "Yaba", state: "Lagos", buildingSqm: "abc" } as never), /building size in square metres/);
});
