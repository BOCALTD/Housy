/**
 * Phase 17f: company suspension, editable reference data, purpose-stated admin access, and personal data export and deletion.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPublic, withTenant, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { saveAgentProfile, saveCompanyProfile, registerSeeker } from "../../src/lib/services/community";
import { createApiKey, authenticateApiKey } from "../../src/lib/services/api-keys";
import { accessLogForCompany, companyRecordsForAdmin, companySuspension, openCompanyRecords, restoreCompany, suspendCompany } from "../../src/lib/services/governance";
import { activeOf, clearRefCache, labelsOf, refData, saveReference } from "../../src/lib/services/reference";
import { deleteMyAccount, deletionBlocker, exportMyData } from "../../src/lib/services/privacy";
import { saveSearch } from "../../src/lib/services/alerts";
import { PASSWORD, newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());

async function published(a: Awaited<ReturnType<typeof newCompany>>, admin: string, name: string, extra: Record<string, unknown> = {}) {
  const asset = await createAsset(a, { name, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await saveListingDraft(a, asset.id, { title: `${name} for sale`, purpose: "SALE", price: "10,000,000", city: "Ikeja", state: "Lagos", ...extra } as never);
  await setListingStatus(a, asset.id, "PENDING_REVIEW");
  const l = await withTenant(a.companyId, a.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin, l.id, "approve", "ok");
  return { asset, l };
}

test("suspending a company hides it from the public and stops its keys; restoring brings everything back", async () => {
  const a = await newCompany("gov-a");
  const admin = await newPlatformAdmin();
  const { l } = await published(a, admin.id, "Suspend house");
  await saveCompanyProfile(a, { kind: "COMPANY", displayName: "Gov A Ltd", tagline: "", about: "", listed: true });
  await saveAgentProfile(a, { displayName: "Gov Agent", headline: "", bio: "", listed: true, acceptsMessages: true });
  const { key } = await createApiKey(a, { name: "Integration", scopes: ["assets:read"], days: 30 });
  assert.ok(await authenticateApiKey(key));

  await assert.rejects(suspendCompany(admin.id, a.companyId, { reason: "x" }), /reason/);
  await suspendCompany(admin.id, a.companyId, { reason: "Several fraud reports under investigation" });
  assert.equal((await companySuspension(a.companyId))!.reason, "Several fraud reports under investigation");
  assert.equal(await withPublic((tx) => tx.listing.count({ where: { id: l.id } })), 0, "listing hidden from the public");
  assert.equal(await withPublic((tx) => tx.companyProfile.count({ where: { companyId: a.companyId } })), 0);
  assert.equal(await withPublic((tx) => tx.agentProfile.count({ where: { companyId: a.companyId } })), 0);
  assert.equal(await authenticateApiKey(key), null, "keys stop working");
  // The company's own records are untouched.
  assert.equal((await withTenant(a.companyId, a.userId, (tx) => tx.listing.findFirstOrThrow({ where: { id: l.id } }))).status, "PUBLISHED");
  const notes = await withUser(a.userId, (tx) => tx.notification.count({ where: { userId: a.userId, kind: "security.company_suspended" } }));
  assert.equal(notes, 1);

  await restoreCompany(admin.id, a.companyId, "Investigation closed, no fraud found");
  assert.equal(await companySuspension(a.companyId), null);
  assert.equal(await withPublic((tx) => tx.listing.count({ where: { id: l.id } })), 1);
  assert.ok(await authenticateApiKey(key));
});

test("reference data: rename and hide types, add amenities and documents that listings can then use", async () => {
  const a = await newCompany("ref-a");
  const admin = await newPlatformAdmin();
  const code = `SOLAR_${Date.now().toString(36).toUpperCase().slice(-5)}`;
  await assert.rejects(saveReference(admin.id, { kind: "PROPERTY_TYPE", code: "CASTLE", label: "Castle" }), /software change/);
  await saveReference(admin.id, { kind: "AMENITY", code, label: "Solar street lights" });
  await saveReference(admin.id, { kind: "TITLE_DOCUMENT", code: "GH_LAND_TITLE", label: "Land Title Certificate (Ghana)", country: "GH" });
  await saveReference(admin.id, { kind: "PROPERTY_TYPE", code: "MAISONETTE", label: "Maisonette (duplex flat)", active: false });
  clearRefCache();
  const ref = await refData();
  assert.equal(labelsOf(ref, "AMENITY")[code], "Solar street lights");
  assert.ok(!activeOf(ref, "PROPERTY_TYPE").some((x) => x.code === "MAISONETTE"), "hidden from forms");
  assert.equal(labelsOf(ref, "PROPERTY_TYPE").MAISONETTE, "Maisonette (duplex flat)", "still labelled for old listings");
  assert.ok(!activeOf(ref, "TITLE_DOCUMENT", "NG").some((x) => x.code === "GH_LAND_TITLE"), "a Ghana-only document is not offered in Nigeria");
  assert.ok(activeOf(ref, "TITLE_DOCUMENT", "GH").some((x) => x.code === "GH_LAND_TITLE"));
  const { l } = await published(a, admin.id, "Ref house", { amenities: [code, "POOL", "NOT_REAL"] });
  assert.equal(l.amenities, [code, "POOL"].sort().join(","), "added amenity accepted, unknown dropped");
});

test("admins see a company's records only for a stated purpose, and the company sees that they did", async () => {
  const a = await newCompany("grant-a");
  const admin = await newPlatformAdmin();
  await createAsset(a, { name: "Grant house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await assert.rejects(companyRecordsForAdmin(admin.id, a.companyId), /stated purpose/);
  await assert.rejects(openCompanyRecords(admin.id, a.companyId, { purpose: "SUPPORT_REQUEST", note: "short" }), /why/);
  await openCompanyRecords(admin.id, a.companyId, { purpose: "SUPPORT_REQUEST", caseRef: "SUP-1", note: "The company asked us to check a missing asset." });
  const r = await companyRecordsForAdmin(admin.id, a.companyId);
  assert.equal(r.assets.length, 1);
  const log = await accessLogForCompany(a);
  assert.equal(log.length, 1);
  assert.equal(log[0].purpose, "SUPPORT_REQUEST");
  const other = await newPlatformAdmin();
  await assert.rejects(companyRecordsForAdmin(other.id, a.companyId), /stated purpose/, "each administrator states their own purpose");
});

test("people can download their data and delete their account; the last top administrator cannot", async () => {
  const a = await newCompany("priv-a");
  assert.match((await deletionBlocker(a.userId))!, /only top administrator/);
  const seeker = await registerSeeker({ name: "Privacy Person", email: `priv-${Date.now()}@example.test`, password: PASSWORD });
  await saveSearch(seeker.userId, { name: "Lekki flats", purpose: "RENT", city: "Lekki", q: "", maxPrice: "", minBeds: "" } as never);
  const data = await exportMyData(seeker.userId) as Record<string, unknown>;
  assert.equal((data.account as { name: string }).name, "Privacy Person");
  assert.equal((data.saved_searches as unknown[]).length, 1);
  await assert.rejects(deleteMyAccount(seeker.userId, PASSWORD, "nope"), /Type DELETE/);
  await assert.rejects(deleteMyAccount(seeker.userId, "wrong-password", "DELETE"), /password/);
  await deleteMyAccount(seeker.userId, PASSWORD, "DELETE");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: seeker.userId } });
  assert.equal(u.name, "Deleted user");
  assert.match(u.email, /@deleted\.invalid$/);
  assert.equal(await prisma.session.count({ where: { userId: seeker.userId } }), 0);
  assert.equal(await withUser(seeker.userId, (tx) => tx.savedSearch.count({ where: { userId: seeker.userId } })), 0);
});
