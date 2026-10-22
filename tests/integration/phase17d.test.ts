/**
 * Phase 17d: listing details, categories and search filters.
 * Details are saved and validated; a sale is always a total price; amenities and other filters narrow results; categories pick the
 * right listings; drafts never appear; "verified companies only" uses the trust level.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { categoryCounts, reviewListing, saveListingDraft, searchListingsPage, setListingStatus } from "../../src/lib/services/listings";
import { decideKyc, submitCompanyKyc, verifiedCompanyIds } from "../../src/lib/services/kyc";
import { categoryBySlug, CATEGORIES, parseFilters } from "../../src/lib/listing-rules";
import { PDF_BYTES, newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const tag = `T${Date.now().toString(36).toUpperCase()}`;
const filters = (s: string) => { const p = new URLSearchParams(s); return parseFilters((k) => p.get(k) ?? undefined, (k) => p.getAll(k)); };

test("listing details: saved, validated, filtered and categorised", async () => {
  const a = await newCompany("ld-a");
  const admin = await newPlatformAdmin();
  const publish = async (name: string, listing: Record<string, unknown>, live = true) => {
    const asset = await createAsset(a, { name, assetClass: "RESIDENTIAL", category: "Home", companyRelationship: "OWNER" } as never);
    await saveListingDraft(a, asset.id, { city: `City${tag}`, state: "Lagos", ...listing } as never);
    const l = await withTenant(a.companyId, a.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
    if (live) { await setListingStatus(a, asset.id, "PENDING_REVIEW"); await reviewListing(admin.id, l.id, "approve", "ok"); }
    return { asset, l };
  };

  // Validation.
  await assert.rejects(publish("Bad video", { title: "Bad video link", purpose: "SALE", price: "1,000,000", videoUrl: "https://evil.example/x" }, false), /YouTube or Vimeo/);
  await assert.rejects(publish("Sale lease length", { title: "Sale with lease length", purpose: "SALE", price: "1,000,000", minLeaseMonths: "12" }, false), /only applies to rent or lease/);

  const duplex = await publish("Duplex", { title: `Duplex ${tag}`, purpose: "SALE", pricePeriod: "NIGHT", price: "150,000,000", bedrooms: "4", propertyType: "DUPLEX", buildingSqm: "400",
    amenities: ["POOL", "SECURITY", "NOT_A_THING"], titleDocument: "C_OF_O", furnishing: "UNFURNISHED", negotiable: "yes" });
  assert.equal(duplex.l.pricePeriod, "TOTAL", "a sale is always a total price");
  assert.equal(duplex.l.amenities, "POOL,SECURITY", "unknown amenities are dropped");
  assert.equal(duplex.l.negotiable, true);
  const shortlet = await publish("Short let", { title: `Short let ${tag}`, purpose: "RENT", pricePeriod: "NIGHT", price: "60,000", bedrooms: "1", propertyType: "FLAT", furnishing: "FURNISHED", amenities: ["GYM"] });
  assert.equal(shortlet.l.pricePeriod, "NIGHT");
  const flat = await publish("Flat", { title: `Flat ${tag}`, purpose: "RENT", price: "3,000,000", bedrooms: "2", propertyType: "FLAT", amenities: ["POOL"], availableFrom: "2030-01-01" });
  assert.equal(flat.l.pricePeriod, "YEAR", "rent defaults to a yearly price");
  const land = await publish("Land", { title: `Land ${tag}`, purpose: "SALE", price: "20,000,000", propertyType: "LAND", landSqm: "900" });
  await publish("Draft", { title: `Draft ${tag}`, purpose: "SALE", price: "1", propertyType: "LAND" }, false);

  const ids = async (f: string, slug?: string, companyIds?: string[]) => (await searchListingsPage(filters(`city=City${tag}&${f}`), slug ? categoryBySlug(slug)!.rule : {}, companyIds)).rows.map((r) => r.id).sort();
  assert.deepEqual(await ids(""), [duplex.l.id, shortlet.l.id, flat.l.id, land.l.id].sort(), "drafts never appear");
  assert.deepEqual(await ids("amenity=POOL"), [duplex.l.id, flat.l.id].sort());
  assert.deepEqual(await ids("amenity=POOL&amenity=SECURITY"), [duplex.l.id]);
  assert.deepEqual(await ids("type=FLAT"), [shortlet.l.id, flat.l.id].sort());
  assert.deepEqual(await ids("minSize=800"), [land.l.id]);
  assert.deepEqual(await ids("titleDoc=C_OF_O"), [duplex.l.id]);
  assert.deepEqual(await ids("availableBy=2026-12-31"), [duplex.l.id, shortlet.l.id, land.l.id].sort(), "not available until 2030");
  assert.deepEqual(await ids("negotiable=1"), [duplex.l.id]);
  assert.deepEqual(await ids("", "short-let"), [shortlet.l.id]);
  assert.deepEqual(await ids("", "rent"), [flat.l.id], "short lets are not in the rent page");
  assert.deepEqual(await ids("", "land"), [land.l.id]);
  assert.deepEqual(await ids("", "buy"), [duplex.l.id]);
  const sorted = (await searchListingsPage(filters(`city=City${tag}&sort=price_desc`))).rows.map((r) => r.id);
  assert.equal(sorted[0], duplex.l.id);

  // "Verified companies only" uses the trust level.
  assert.ok(!(await verifiedCompanyIds()).includes(a.companyId));
  const cac = await submitCompanyKyc(a, "CAC_REGISTRATION", { legalName: "A Ltd", rcNumber: "RC 123456" }, { type: "application/pdf", bytes: PDF_BYTES, name: "c.pdf" });
  const dir = await submitCompanyKyc(a, "DIRECTOR_ID", { directorName: "Ada Obi", idType: "NIN", idNumber: "12345678901" }, { type: "application/pdf", bytes: PDF_BYTES, name: "i.pdf" });
  for (const id of [cac, dir]) await decideKyc(admin.id, id, { decision: "verify", note: "", evidence: "Checked against the original" });
  const verified = await verifiedCompanyIds();
  assert.ok(verified.includes(a.companyId));
  assert.equal((await ids("", undefined, verified)).length, 4);

  const counts = await categoryCounts(CATEGORIES);
  assert.ok(counts["short-let"] >= 1);
});
