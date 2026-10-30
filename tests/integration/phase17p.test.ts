/**
 * Phase 17p: market insights, benchmarks and the rent forecast. A city figure appears only with enough listings from enough
 * companies; time on the market comes from when a listing was taken off; a company sees its own listings against the market
 * and its own rent forecast, built only from its records.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { createLease } from "../../src/lib/services/leases";
import { citySlug, companyBenchmarks, companyForecast, forgetMarketOverview, marketCity, marketOverview } from "../../src/lib/services/market";
import { addMember, newCompany, newPlatformAdmin } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());
const iso = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

test("city figures need enough listings from enough companies, and time on the market follows the off-market date", async () => {
  const city = `Benchville ${randomUUID().slice(0, 6)}`;
  const admin = await newPlatformAdmin();
  const a = await newCompany("mkta"), b = await newCompany("mktb");
  async function home(co: Ctx, price: string, beds = "3") {
    const asset = await createAsset(co, { name: `Home ${randomUUID().slice(0, 5)}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER", city, state: "Lagos" } as never);
    await saveListingDraft(co, asset.id, { title: `${beds}-bedroom flat ${randomUUID().slice(0, 4)}`, purpose: "SALE", price, bedrooms: beds, city, state: "Lagos", propertyType: "FLAT", buildingSqm: "150" } as never);
    const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
    await setListingStatus(co, asset.id, "PENDING_REVIEW");
    await reviewListing(admin.id, l.id, "approve", "ok");
    return { asset, listing: l };
  }

  const mine: Awaited<ReturnType<typeof home>>[] = [];
  for (const p of ["60,000,000", "70,000,000", "80,000,000", "90,000,000", "100,000,000"]) mine.push(await home(a, p));
  forgetMarketOverview();
  let o = await marketOverview();
  assert.equal(o.cities.find((c) => c.city === city), undefined, "one company's listings never make a city figure on their own");

  await home(b, "75,000,000"); await home(b, "300,000,000");
  forgetMarketOverview();
  o = await marketOverview();
  const c = o.cities.find((x) => x.city === city)!;
  assert.ok(c, "two companies with seven listings make a figure");
  assert.equal(c.sale!.n, 7);
  assert.equal(c.sale!.median, 80_000_000);
  assert.equal(c.salePerSqm!.median, 80_000_000 / 150);
  assert.equal(c.byBedrooms.find((x) => x.band === "3")!.sale!.median, 80_000_000);
  assert.equal(c.rent, null, "no rent listings, no rent figure");
  assert.ok(!JSON.stringify(c).includes(a.companyId) && !JSON.stringify(c).includes(b.companyId), "no company is named in the figures");

  const page = await marketCity(citySlug(city));
  assert.equal(page?.city, city);
  assert.equal(page!.trendSale.at(-1)!.median, 80_000_000, "this month's listings show in the trend");

  // Off the market: the date is kept for time-on-market figures, and cleared when the listing goes back for review.
  await setListingStatus(a, mine[0].asset.id, "UNAVAILABLE");
  let row = await withTenant(a.companyId, a.userId, (tx) => tx.listing.findUniqueOrThrow({ where: { id: mine[0].listing.id } }));
  assert.ok(row.offMarketAt && row.status === "UNAVAILABLE");
  await setListingStatus(a, mine[0].asset.id, "PENDING_REVIEW");
  row = await withTenant(a.companyId, a.userId, (tx) => tx.listing.findUniqueOrThrow({ where: { id: mine[0].listing.id } }));
  assert.equal(row.offMarketAt, null);

  // The company's own listings against the market.
  forgetMarketOverview();
  const bench = await companyBenchmarks(a);
  assert.ok(bench);
  const ours = bench!.listings.filter((l) => l.city === city);
  assert.equal(ours.length, 4, "only published homes are compared");
  // Six published homes now (the one sent back for review is out): 70, 75, 80, 90, 100 and 300 million; median 85 million.
  const top = ours.find((l) => l.value === 100_000_000)!;
  assert.equal(top.market.n, 6);
  assert.equal(top.market.median, 85_000_000);
  assert.equal(top.where, "above", "above the middle half (76.25m to 97.5m)");
  assert.equal(top.vsMedianPct, 18);
  assert.ok(!JSON.stringify(bench).includes(b.companyId), "other companies are never named");
});

test("the rent forecast is built from the company's own schedules and leaves the likely line out without a record", async () => {
  const co = await newCompany("fcst");
  const asset = await createAsset(co, { name: "Forecast Court", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER", city: "Lagos", state: "Lagos" } as never);
  await createLease(co, asset.id, { occupantName: "Tenant One", startDate: iso(-45), endDate: iso(300), rent: "100,000", frequency: "MONTHLY" });
  const f = (await companyForecast(co))!;
  const charges = await withTenant(co.companyId, co.userId, (tx) => tx.rentCharge.findMany({ where: { companyId: co.companyId } }));
  const total = charges.reduce((s, c) => s + c.amountKobo, 0n);
  const due = f.months.reduce((s, m) => s + m.dueKobo, 0n);
  assert.equal(f.arrearsKobo, 2n * 10_000_000n, "the two charges already due are arrears");
  assert.equal(due + f.arrearsKobo, total, "every unpaid charge is either overdue or in a forecast month");
  assert.equal(f.rate, null, "with fewer than six past charges there is no collection rate to apply");
  assert.equal(f.atRisk.leases, 1, "the lease ends within the year with no renewal");
  assert.equal(f.atRisk.yearlyKobo, 12n * 10_000_000n);

  const viewer = await addMember(co, "VIEWER", "fcv");
  assert.equal(await companyForecast(viewer), null, "a role without payments sees no forecast");
});
