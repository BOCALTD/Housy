/**
 * Phase 16d: bringing in existing records. A preview marks what would be created, skipped or rejected; confirming creates only
 * the good lines; the totals of the file are reconciled against the database; the ledger stays consistent; and one company
 * can never see or confirm another's import.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { getLease } from "../../src/lib/services/leases";
import { verifyLedger } from "../../src/lib/services/ledger";
import { commitImport, discardImport, importReportCsv, importRowsPage, previewImport, reconcileImport } from "../../src/lib/services/imports";
import { addMember, newCompany } from "./helpers";

after(() => prisma.$disconnect());

const ASSET_FILE = [
  "Name,Class,Category,Held as,Address,City,Acquisition cost",
  "Adeola Court,Residential,Apartment block,Owner,12 Admiralty Way,Lagos,\"45,000,000\"",
  "adeola court,residential,Apartment block,owner,12 Admiralty Way.,LAGOS,",      // same place, different spelling
  "Castle Hill,Castle,Fort,Owner,,,",                                              // bad class
  "Ikoyi Shops,Commercial,Shop row,Manager,3 Awolowo Road,Lagos,1000.50",
].join("\r\n");

test("assets: preview marks duplicates and mistakes, confirming creates only the good lines, and the totals reconcile", async () => {
  const admin = await newCompany("imp");
  const manager = await addMember(admin, "MANAGER", "mgr");
  await assert.rejects(previewImport(manager, "ASSETS", "a.csv", ASSET_FILE), /permission/);

  const { id, ref } = await previewImport(admin, "ASSETS", "assets.csv", ASSET_FILE);
  assert.equal(ref, "IMP-0001");
  const view = (await importRowsPage(admin, id))!;
  assert.deepEqual(view.rows.map((r) => [r.rowNo, r.status]), [[2, "READY"], [3, "DUPLICATE"], [4, "ERROR"], [5, "READY"]]);
  assert.match(view.rows[1].message, /row 2/);
  assert.match(view.rows[2].message, /Class "Castle"/);
  assert.equal(await prisma.asset.count({ where: { companyId: admin.companyId } }), 0, "nothing is created by a preview");

  const done = await commitImport(admin, id);
  assert.deepEqual(done, { imported: 2, failed: 0 });
  const assets = await prisma.asset.findMany({ where: { companyId: admin.companyId }, orderBy: { ref: "asc" } });
  assert.deepEqual(assets.map((a) => [a.ref, a.name, a.assetClass, a.companyRelationship]), [["AST-00001", "Adeola Court", "RESIDENTIAL", "OWNER"], ["AST-00002", "Ikoyi Shops", "COMMERCIAL", "MANAGER"]]);
  assert.equal(assets[0].acquisitionCostKobo, 4_500_000_000n);
  assert.equal(assets[1].acquisitionCostKobo, 100_050n);

  const rec = (await reconcileImport(admin, id))!;
  assert.ok(rec.balanced, JSON.stringify(rec.checks));
  assert.deepEqual(rec.counts, { READY: 0, DUPLICATE: 1, ERROR: 1, IMPORTED: 2, FAILED: 0 });
  await assert.rejects(commitImport(admin, id), /already been confirmed/);
  await assert.rejects(discardImport(admin, id), /not been confirmed/);

  const again = await previewImport(admin, "ASSETS", "assets.csv", ASSET_FILE);
  const second = (await importRowsPage(admin, again.id))!;
  assert.deepEqual(second.rows.map((r) => r.status), ["DUPLICATE", "DUPLICATE", "ERROR", "DUPLICATE"], "a second upload creates nothing new");
  assert.match(second.rows[0].message, /AST-00001/);
  await discardImport(admin, again.id);
  await assert.rejects(commitImport(admin, again.id), /discarded/);

  const csv = (await importReportCsv(admin, id))!.csv;
  assert.match(csv, /^Line in file,Result,Name,Reason/);
  assert.equal(csv.trim().split("\r\n").length, 5);
});

test("leases: asset lookup, opening balances, duplicates, clashes and reconciliation", async () => {
  const admin = await newCompany("impl");
  await commitImport(admin, (await previewImport(admin, "ASSETS", "a.csv", ASSET_FILE)).id);
  const head = "Asset reference,Asset name,Tenant,Unit,Start date,End date,Rent per period,How often,Deposit,Paid so far";
  const file = [
    head,
    "AST-00001,,Ngozi Eze,Flat 1,2026-01-01,2026-12-31,\"1,200,000\",Quarterly,600000,\"2,400,000\"",   // two of four quarters paid
    ",Adeola Court,Tunde Bello,Flat 2,01/01/2026,31/12/2026,500000,Monthly,,",                          // found by name, dates day-first
    "AST-00099,,Nobody,,2026-01-01,2026-12-31,100000,Monthly,,",                                         // no such asset
    "AST-00001,,Over Payer,Flat 3,2026-01-01,2026-12-31,100000,Quarterly,,\"500,000\"",                  // paid more than all the rent
    "AST-00001,,ngozi eze,flat-1,2026-01-01,2026-06-30,100000,Monthly,,",                                // same lease again
    "AST-00001,,Clash Tenant,Flat 1,2026-06-01,2027-05-31,100000,Monthly,,",                            // overlaps Flat 1
  ].join("\n");
  const { id } = await previewImport(admin, "LEASES", "leases.csv", file);
  const view = (await importRowsPage(admin, id))!;
  assert.deepEqual(view.rows.map((r) => r.status), ["READY", "READY", "ERROR", "ERROR", "DUPLICATE", "READY"]);
  assert.match(view.rows[2].message, /AST-00099/);
  assert.match(view.rows[3].message, /more than all the rent/);

  const done = await commitImport(admin, id);
  assert.deepEqual(done, { imported: 2, failed: 1 });
  const after = (await importRowsPage(admin, id, { status: "FAILED" }))!;
  assert.equal(after.rows.length, 1);
  assert.match(after.rows[0].message, /already has an active lease/);

  const rec = (await reconcileImport(admin, id))!;
  assert.ok(rec.balanced, JSON.stringify(rec.checks));
  const byLabel = Object.fromEntries(rec.checks.map((c) => [c.label, c]));
  assert.equal(byLabel["Total rent scheduled, naira"].actual, "10800000.00", "4.8M for Ngozi plus 12 x 500,000 for Tunde");
  assert.equal(byLabel["Total already paid, on opening receipts, naira"].actual, "2400000.00");
  assert.equal(byLabel["Total still owed, naira"].actual, "8400000.00");

  const leases = await prisma.lease.findMany({ where: { companyId: admin.companyId }, orderBy: { ref: "asc" } });
  assert.equal(leases.length, 2);
  const ngozi = (await getLease(admin, leases[0].id))!.lease;
  assert.deepEqual(ngozi.charges.map((c) => c.paidKobo), [120_000_000n, 120_000_000n, 0n, 0n], "the oldest rent is cleared first");
  assert.equal(ngozi.receipts.length, 1);
  assert.match(ngozi.receipts[0].evidence, /^IMPORT IMP-0002 row 2$/);
  assert.deepEqual(await verifyLedger(admin), []);
});

test("another company cannot see, confirm or reconcile an import, and the tables are closed to it", async () => {
  const a = await newCompany("impa");
  const b = await newCompany("impb");
  const { id } = await previewImport(a, "ASSETS", "a.csv", ASSET_FILE);
  assert.equal(await importRowsPage(b, id), null);
  assert.equal(await reconcileImport(b, id), null);
  assert.equal(await importReportCsv(b, id), null);
  await assert.rejects(commitImport(b, id), /not found/);
  await assert.rejects(discardImport(b, id), /not been confirmed/);
  const seen = await withTenant(b.companyId, b.userId, async (tx) => [await tx.importBatch.count(), await tx.importRow.count()]);
  assert.deepEqual(seen, [0, 0]);
  assert.equal((await importRowsPage(a, id))!.rows.length, 4, "the owner still sees it");
});

test("bad files are refused with a plain reason", async () => {
  const admin = await newCompany("impbad");
  await assert.rejects(previewImport(admin, "ASSETS", "x.csv", ""), /empty/);
  await assert.rejects(previewImport(admin, "ASSETS", "x.csv", "Name,Class\nA,B\n"), /missing these columns: Category, Held as/);
  await assert.rejects(previewImport(admin, "ASSETS", "x.csv", "Name,Class,Category,Held as\n"), /no rows/);
  await assert.rejects(previewImport(admin, "ASSETS", "x.csv", 'Name,Class,Category,Held as\n"A,B,C,D\n'), /never closed/);
  await assert.rejects(previewImport(admin, "ASSETS", "x.csv", "x".repeat(2 * 1024 * 1024 + 1)), /larger than 2 MB/);
  const formula = await previewImport(admin, "ASSETS", "x.csv", "Name,Class,Category,Held as\n=HYPERLINK(\"http://evil\"),Land,Plot,Owner\n");
  const csv = (await importReportCsv(admin, formula.id))!.csv;
  assert.match(csv, /,"'=HYPERLINK/, "a spreadsheet never runs text from the file as a formula");
});
