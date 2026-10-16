/**
 * Phase 16d (runs last, because it loads a large portfolio): performance at a realistic size. One company with 12,000 assets, 12,000 listings (70% published), 2,500 leases and
 * 30,000 rent charges is loaded straight into the database, then the pages that matter are timed. The limits are generous so a slow
 * shared build machine does not cause false alarms; they exist to catch a query that has started to read the whole table, or a page
 * that has started to send everything. Every timing is printed as "PERF name=... ms=..." for the test report.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma, withPublic, withTenant } from "../../src/lib/db";
import { assetOptions, assetPage } from "../../src/lib/services/assets";
import { searchListings } from "../../src/lib/services/listings";
import { companyAnalytics } from "../../src/lib/services/analytics";
import { dashboard } from "../../src/lib/services/dashboard";
import { rentReport } from "../../src/lib/services/reports";
import { portfolioMapPoints, publicMapPoints } from "../../src/lib/services/maps";
import { readStoredFile } from "../../src/lib/storage";
import { parseDateOnly } from "../../src/lib/dates";
import { newCompany } from "./helpers";

after(() => prisma.$disconnect());

const ASSETS = 12_000, LEASES = 2_500;
const CITIES = "ARRAY['Lekki','Ikeja','Yaba','Abuja','Port Harcourt','Ibadan','Kano','Enugu']";
const STATES = "ARRAY['Lagos','Lagos','Lagos','FCT','Rivers','Oyo','Kano','Enugu']";

async function seed(companyId: string, userId: string) {
  await withTenant(companyId, userId, async (tx) => {
    await tx.$executeRawUnsafe(`INSERT INTO assets (id, company_id, ref, name, asset_class, category, city, state, lat, lng, status, company_relationship, created_by_id, created_at, updated_at)
      SELECT 'pf-a-' || g, $1, 'PF-' || g, 'Perf asset ' || g, 'RESIDENTIAL'::"AssetClass", 'Flat', (${CITIES})[1 + g % 8], (${STATES})[1 + g % 8],
        6.4 + (g % 100) / 100.0, 3.3 + (g % 70) / 100.0, (ARRAY['ACTIVE','VACANT','OCCUPIED','UNDER_RENOVATION'])[1 + g % 4]::"AssetStatus", 'OWNER', $2, now() - (g || ' seconds')::interval, now()
      FROM generate_series(1, ${ASSETS}) g`, companyId, userId);
    await tx.$executeRawUnsafe(`INSERT INTO listings (id, company_id, asset_id, public_ref, title, purpose, price_kobo, bedrooms, bathrooms, city, state, status, published_at, created_at, updated_at)
      SELECT 'pf-l-' || g, $1, 'pf-a-' || g, 'PFL-' || g,
        (ARRAY['Bright','Modern','Spacious','Cosy'])[1 + g % 4] || ' ' || (1 + g % 5) || ' bedroom flat in ' || (${CITIES})[1 + g % 8],
        (CASE WHEN g % 3 = 0 THEN 'SALE' ELSE 'RENT' END)::"ListingPurpose", ((1000000 + (g % 900) * 100000)::bigint) * 100, 1 + g % 5, 1 + g % 4,
        (${CITIES})[1 + g % 8], (${STATES})[1 + g % 8], (CASE WHEN g % 10 < 7 THEN 'PUBLISHED' ELSE 'DRAFT' END)::"ListingStatus", now() - (g || ' minutes')::interval, now(), now()
      FROM generate_series(1, ${ASSETS}) g`, companyId);
    await tx.$executeRawUnsafe(`INSERT INTO leases (id, company_id, asset_id, ref, occupant_name, start_date, end_date, rent_kobo, frequency, deposit_kobo, status, created_by_id, created_at)
      SELECT 'pf-le-' || g, $1, 'pf-a-' || g, 'PF-L-' || g, 'Tenant ' || g, date '2025-01-01', date '2026-12-31', 15000000, 'MONTHLY'::"RentFrequency", 0, 'ACTIVE'::"LeaseStatus", $2, now()
      FROM generate_series(1, ${LEASES}) g`, companyId, userId);
    await tx.$executeRawUnsafe(`INSERT INTO rent_charges (id, company_id, lease_id, due_date, amount_kobo, adjusted_kobo, paid_kobo)
      SELECT 'pf-c-' || g || '-' || m, $1, 'pf-le-' || g, (date '2025-01-01' + (m || ' months')::interval)::date, 15000000, 0, CASE WHEN (g + m) % 5 = 0 THEN 0 ELSE 15000000 END
      FROM generate_series(1, ${LEASES}) g, generate_series(0, 11) m`, companyId);
    // Thirty photographs of about 1 MB each, stored as the product stores them.
    await tx.$executeRawUnsafe(`INSERT INTO stored_files (key, company_id, bytes, created_at)
      SELECT 'pf-photo-' || g || '.jpg', $1, convert_to(repeat(md5(g::text), 32768), 'UTF8'), now() FROM generate_series(1, 30) g`, companyId);
  });
}

async function timed<T>(name: string, limitMs: number, fn: () => Promise<T>, runs = 3): Promise<T> {
  let best = Infinity, last!: T;
  const all: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); last = await fn(); const ms = performance.now() - t; all.push(ms); best = Math.min(best, ms); }
  console.log(`PERF name=${name} best_ms=${best.toFixed(1)} runs_ms=${all.map((x) => x.toFixed(0)).join("/")} limit_ms=${limitMs}`);
  assert.ok(best <= limitMs, `${name} took ${best.toFixed(0)} ms at best (limit ${limitMs} ms)`);
  return last;
}

let co: Awaited<ReturnType<typeof newCompany>>;
test("load a realistic portfolio", async () => {
  co = await newCompany("perf");
  const t = performance.now();
  await seed(co.companyId, co.userId);
  console.log(`PERF name=seed ms=${(performance.now() - t).toFixed(0)} assets=${ASSETS} leases=${LEASES} charges=${LEASES * 12}`);
  // Give the planner honest statistics, as autovacuum would in production. Skipped quietly if the owner connection is not available.
  const owner = process.env.MIGRATION_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL }) : null;
  try { if (owner) for (const t of ["assets", "listings", "leases", "rent_charges", "stored_files"]) await owner.$executeRawUnsafe(`ANALYZE ${t}`); } catch { /* best effort */ } finally { await owner?.$disconnect(); }
});

test("public search and browse stay quick across thousands of listings", async () => {
  const browse = await timed("search browse (no filters)", 800, () => searchListings({}));
  assert.equal(browse.length, 60);
  assert.ok(browse.every((l) => l.status === "PUBLISHED"));
  const rent = await timed("search rent in Lekki under 300m, 2+ beds", 1000, () => searchListings({ purpose: "RENT", city: "lekki", maxPrice: "300,000,000", minBeds: "2" }));
  assert.ok(rent.every((l) => l.purpose === "RENT" && l.bedrooms! >= 2));
  await timed("search by words in the title", 1000, () => searchListings({ q: "spacious 3 bedroom" }));
  await timed("search that matches nothing", 1000, () => searchListings({ q: "zzzz-no-such-home" }));
  await timed("map points for the public", 1500, () => publicMapPoints({ purpose: "RENT" }));
  // Hostile search text is treated as text, not as a pattern or as SQL.
  for (const q of ["%", "_", "'; DROP TABLE listings; --", "\\", "a".repeat(5000)]) await searchListings({ q, city: q });
  assert.equal((await searchListings({})).length, 60, "the table is still there");
});

test("the browse query reads an index rather than sorting every published listing", async () => {
  const plan = await withPublic((tx) => tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN SELECT * FROM listings WHERE status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 60`));
  const text = plan.map((p) => p["QUERY PLAN"]).join("\n");
  console.log(`PERF name=browse-plan ${text.split("\n")[0].trim()}`);
  assert.match(text, /listings_published_at_idx/, text);
  assert.doesNotMatch(text, /Sort/, "no sort over every published listing");
});

test("a company's pages stay quick with thousands of assets and tens of thousands of charges", async () => {
  const d = await timed("company dashboard", 2500, () => dashboard(co));
  assert.equal(d.totalAssets, ASSETS);
  assert.ok(d.overdueCharges > 0);
  const a = await timed("company analytics", 4000, () => companyAnalytics(co));
  assert.ok(a);
  const rep = await timed("rent report for a year", 4000, () => rentReport(co, { from: parseDateOnly("2025-01-01"), to: parseDateOnly("2025-12-31") }));
  assert.equal(rep.rows.length, LEASES);
  const first = await timed("asset register, first page", 1000, () => assetPage(co, {}));
  assert.equal(first.rows.length, 25); assert.equal(first.total, ASSETS);
  const deep = await timed("asset register, a page far down", 1000, () => assetPage(co, { page: 400 }));
  assert.equal(deep.rows.length, 25);
  const ids = new Set([...first.rows, ...deep.rows].map((r) => r.id)); assert.equal(ids.size, 50, "pages do not overlap");
  const found = await timed("asset register, search by name", 1500, () => assetPage(co, { q: "perf asset 777" }));
  assert.ok(found.total >= 1);
  const opts = await timed("asset drop-down", 1000, () => assetOptions(co));
  assert.equal(opts.length, 1000);
  const pts = await timed("portfolio map", 2500, () => portfolioMapPoints(co));
  assert.ok(pts.points.length > 0);
});

test("media-heavy pages: thirty one-megabyte photographs read back in reasonable time, one after another and together", async () => {
  const keys = Array.from({ length: 30 }, (_, i) => `pf-photo-${i + 1}.jpg`);
  const seq = await timed("30 MB of photographs, one by one", 6000, () => withTenant(co.companyId, co.userId, async (tx) => { let n = 0; for (const k of keys) n += (await readStoredFile(tx, co.companyId, k)).byteLength; return n; }), 2);
  assert.equal(seq, 30 * 1_048_576);
  const par = await timed("30 MB of photographs, ten at a time", 6000, async () => {
    let n = 0;
    for (let i = 0; i < keys.length; i += 10) n += (await Promise.all(keys.slice(i, i + 10).map((k) => withTenant(co.companyId, co.userId, (tx) => readStoredFile(tx, co.companyId, k))))).reduce((s, b) => s + b.byteLength, 0);
    return n;
  }, 2);
  assert.equal(par, 30 * 1_048_576);
  // Another company cannot read them, however large the table.
  const other = await newCompany("perf-other");
  await assert.rejects(withTenant(other.companyId, other.userId, (tx) => readStoredFile(tx, other.companyId, keys[0])), /missing/);
  void randomUUID;
});
