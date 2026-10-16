import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, mapRows, checkAssetRow, checkLeaseRow, normaliseDate, assetKey, leaseKey, templateCsv, matchChoice, MAX_IMPORT_ROWS } from "../../src/lib/import-rules";

test("CSV reading handles quotes, commas, line breaks, BOM and blank lines", () => {
  const t = parseCsv('﻿Name,Note\r\n"Block B, Adeola","said ""hi""\nsecond line"\r\n\r\nPlain,x\n');
  assert.deepEqual(t, [["Name", "Note"], ["Block B, Adeola", 'said "hi"\nsecond line'], ["Plain", "x"]]);
  assert.deepEqual(parseCsv("a,b,\n,,\n"), [["a", "b", ""]]);
  assert.throws(() => parseCsv('a,"unclosed'), /never closed/);
  assert.deepEqual(parseCsv(""), []);
});

test("headings match however they are written, and missing or repeated ones are reported", () => {
  const m = mapRows("ASSETS", parseCsv("NAME,asset_class,Category,Held As,Mystery\nX House,house,Duplex,owner,zzz\n"));
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.unknownHeadings, ["Mystery"]);
  assert.equal(m.rows[0].rowNo, 2);
  assert.equal(m.rows[0].cells.assetClass, "house");
  assert.deepEqual(mapRows("ASSETS", parseCsv("Name\nA\n")).missing, ["Class", "Category", "Held as"]);
  assert.throws(() => mapRows("ASSETS", parseCsv("Name,Property name,Class,Category,Held as\n")), /Two columns/);
  assert.throws(() => mapRows("ASSETS", []), /empty/);
  const big = "Name,Class,Category,Held as\n" + "a,b,c,d\n".repeat(MAX_IMPORT_ROWS + 1);
  assert.throws(() => mapRows("ASSETS", parseCsv(big)), /at most/);
});

test("dates: unambiguous forms are accepted, impossible and month-first ones refused", () => {
  assert.equal(normaliseDate("2026-1-5"), "2026-01-05");
  assert.equal(normaliseDate("31/01/2026"), "2026-01-31");
  assert.equal(normaliseDate("29/02/2024"), "2024-02-29");
  assert.equal(normaliseDate("29/02/2025"), null);
  assert.equal(normaliseDate("01/31/2026"), null, "month first is never guessed");
  assert.equal(normaliseDate("2026-13-01"), null);
  assert.equal(normaliseDate("soon"), null);
  assert.equal(normaliseDate(""), null);
});

test("choices accept spelling variants", () => {
  assert.equal(matchChoice("Under renovation", ["UNDER_RENOVATION"]), "UNDER_RENOVATION");
  assert.equal(matchChoice(" half-yearly ", ["HALF_YEARLY"], { HALF_YEARLY: "HALF_YEARLY" }), "HALF_YEARLY");
  assert.equal(matchChoice("nonsense", ["OWNER"]), null);
  assert.equal(matchChoice("", ["OWNER"]), null);
});

test("an asset row is checked and cleaned", () => {
  const ok = checkAssetRow({ name: " Block B ", assetClass: "Plant and machinery", category: "Generator", companyRelationship: "Listing agent", acquisition: "₦45,000,000.50", acquiredOn: "01/03/2019" });
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(ok.input.name, "Block B"); assert.equal(ok.input.assetClass, "PLANT_MACHINERY"); assert.equal(ok.input.companyRelationship, "LISTING_AGENT"); assert.equal(ok.input.acquisitionCost, "45000000.50"); assert.equal(ok.input.acquiredOn, "2019-03-01"); assert.equal(ok.input.status, "ACTIVE"); }
  const bad = checkAssetRow({ name: "", assetClass: "Castle", category: "", companyRelationship: "", status: "Haunted", acquisition: "lots", acquiredOn: "someday" });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.equal(bad.errors.length, 7);
});

const lease = (o: Record<string, string> = {}) => ({ assetRef: "ast-1", occupantName: "Ngozi Eze", startDate: "2026-01-01", endDate: "2026-12-31", rent: "1,200,000", frequency: "Quarterly", amountPaid: "2,400,000", ...o });

test("a lease row is checked, and Paid so far cannot exceed all the rent", () => {
  const ok = checkLeaseRow(lease());
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(ok.input.assetRef, "AST-1"); assert.equal(ok.input.frequency, "QUARTERLY"); assert.equal(ok.input.paidKobo, 240_000_000n); assert.equal(ok.input.totalDueKobo, 480_000_000n); assert.equal(ok.input.rent, "1200000"); }
  const over = checkLeaseRow(lease({ amountPaid: "4,800,000.01" }));
  assert.ok(!over.ok); if (!over.ok) assert.match(over.errors.join(), /more than all the rent/);
  assert.ok(checkLeaseRow(lease({ amountPaid: "4,800,000" })).ok, "paid in full is allowed");
  for (const [o, re] of [
    [{ assetRef: "" }, /asset reference or the asset name/], [{ occupantName: "" }, /Tenant is missing/], [{ endDate: "2025-12-31" }, /after the start/],
    [{ rent: "0" }, /more than zero/], [{ rent: "" }, /Rent is missing/], [{ frequency: "Weekly" }, /How often/], [{ frequency: "Custom" }, /Custom needs/],
    [{ intervalMonths: "2" }, /only for Custom/], [{ startDate: "" }, /Start date is missing/], [{ graceDays: "x" }, /whole number/], [{ deposit: "abc" }, /Deposit/],
  ] as [Record<string, string>, RegExp][]) {
    const r = checkLeaseRow(lease(o)); assert.ok(!r.ok, JSON.stringify(o)); if (!r.ok) assert.match(r.errors.join(" | "), re);
  }
  const custom = checkLeaseRow(lease({ frequency: "Custom", intervalMonths: "4", amountPaid: "" }));
  assert.ok(custom.ok);
});

test("duplicate keys ignore case, punctuation and spacing", () => {
  assert.equal(assetKey({ name: "Block B, Adeola Court", address: "12  Admiralty Way", city: "LAGOS" }), assetKey({ name: "block b adeola court", address: "12 admiralty way.", city: "Lagos" }));
  assert.notEqual(assetKey({ name: "Block A" }), assetKey({ name: "Block B" }));
  const k = { assetId: "a1", unit: "Flat 2", startDate: "2026-01-01", occupantName: "Ngozi Eze" };
  assert.equal(leaseKey(k), leaseKey({ ...k, unit: "flat-2", occupantName: "NGOZI  EZE" }));
  assert.notEqual(leaseKey(k), leaseKey({ ...k, startDate: "2026-02-01" }));
});

test("the template reads back through our own reader and passes our own checks", () => {
  for (const kind of ["ASSETS", "LEASES"] as const) {
    const m = mapRows(kind, parseCsv(templateCsv(kind)));
    assert.deepEqual(m.missing, []); assert.deepEqual(m.unknownHeadings, []); assert.equal(m.rows.length, 1);
    const r = kind === "ASSETS" ? checkAssetRow(m.rows[0].cells) : checkLeaseRow(m.rows[0].cells);
    assert.ok(r.ok, r.ok ? "" : r.errors.join("; "));
  }
});
