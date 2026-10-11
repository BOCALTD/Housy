/**
 * End-to-end vertical slice (master prompt Section 51), run against a real PostgreSQL database
 * through the runtime role, so row-level security is active.
 * Requires DATABASE_URL (estate_app role) and a migrated database. Run: npm run test:integration
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma, withTenant } from "../../src/lib/db";
import { inviteMember, acceptInvitation, changeMemberRole } from "../../src/lib/services/companies";
import { createAsset, getAsset, listAssets, addParty, uploadDocument, getDocumentForDownload, updateAssetStatus } from "../../src/lib/services/assets";
import { createLease, recordPayment } from "../../src/lib/services/leases";
import { createTask, updateTaskStatus } from "../../src/lib/services/tasks";
import { saveListingDraft, setListingStatus, reviewQueue, reviewListing, searchListings, getPublicListing, createEnquiry } from "../../src/lib/services/listings";
import { submitLead, getLeadForVisitor, withdrawLead, recordRecommendationEvent, verificationMetrics, saveProvider } from "../../src/lib/services/verification";
import { dashboard } from "../../src/lib/services/dashboard";
import { newCompany, withRole, newPlatformAdmin, PDF_BYTES, PASSWORD } from "./helpers";

// Uploaded test documents go to a throwaway folder (storage reads this lazily).
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "estate-docs-"));

after(() => prisma.$disconnect());

test("a company completes the vertical slice and another company cannot reach any of it", async () => {
  // 1. Register companies.
  const alpha = await newCompany("alpha");
  const beta = await newCompany("beta");

  // 2. Invite a staff member and assign a role.
  const token = await inviteMember(alpha, { email: `officer-${Date.now()}@example.test`, role: "OFFICER" });
  const joined = await acceptInvitation(token, { name: "Ola Officer", password: PASSWORD });
  assert.equal(joined.companyId, alpha.companyId);
  await assert.rejects(acceptInvitation(token, { name: "Again", password: PASSWORD }), /invalid or has expired/);
  const officerMembership = await withTenant(alpha.companyId, joined.userId, (tx) =>
    tx.membership.findFirstOrThrow({ where: { companyId: alpha.companyId, userId: joined.userId } }));
  assert.equal(officerMembership.role, "OFFICER");

  // 3. Register an asset (managed, not owned).
  const asset = await createAsset(alpha, {
    name: "Shop 4, Allen Avenue", assetClass: "COMMERCIAL", category: "Shop", city: "Ikeja", state: "Lagos",
    companyRelationship: "MANAGER",
  });
  assert.match(asset.ref, /^AST-\d{5}$/);

  // 4. Attach a document.
  await uploadDocument(alpha, asset.id, { title: "Management agreement", category: "MANAGEMENT_AGREEMENT" },
    { name: "agreement.pdf", type: "application/pdf", bytes: PDF_BYTES });
  await assert.rejects(
    uploadDocument(alpha, asset.id, { title: "Fake", category: "OTHER" }, { name: "x.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }),
    /do not match/);

  // 5. Record ownership separately from management.
  await addParty(alpha, asset.id, { partyName: "Mrs Adeyemi", relationship: "LEGAL_OWNER", evidenceNote: "Deed of Assignment" });

  // 6. Create a lease; the rent schedule is generated.
  const lease = await createLease(alpha, asset.id, {
    occupantName: "Corner Pharmacy Ltd", startDate: "2025-01-01", endDate: "2026-01-01", rent: "500,000", frequency: "QUARTERLY",
  });
  const full = await getAsset(alpha, asset.id);
  assert.ok(full);
  const charges = full.asset.leases.find((l) => l.id === lease.id)!.charges;
  assert.equal(charges.length, 4);
  await assert.rejects(createLease(alpha, asset.id, {
    occupantName: "Overlap", startDate: "2025-06-01", endDate: "2025-12-01", rent: "1", frequency: "MONTHLY",
  }), /already has an active lease/);

  // Payments need evidence and cannot exceed what is owed.
  await recordPayment(alpha, charges[0].id, { amount: "200,000", paidOn: "2025-01-03", evidence: "GTB transfer 0001" });
  await assert.rejects(recordPayment(alpha, charges[0].id, { amount: "300,000.01", paidOn: "2025-01-04", evidence: "GTB 0002" }), /more than the amount outstanding/);
  await assert.rejects(recordPayment(alpha, charges[0].id, { amount: "1", paidOn: "2025-01-04", evidence: "" }), /evidence/);

  // 7. Assign an inspection to the officer; the officer completes it with an outcome.
  const task = await createTask(alpha, asset.id, { kind: "INSPECTION", title: "Quarterly inspection", assigneeId: officerMembership.id });
  const officer = { userId: joined.userId, companyId: alpha.companyId, membershipId: officerMembership.id, role: "OFFICER" as const };
  await assert.rejects(updateTaskStatus(officer, task.id, "DONE", ""), /outcome/);
  await updateTaskStatus(officer, task.id, "DONE", "Roof leak above store room. Raise maintenance.");

  // 8 and 9. Activity is recorded and visible in the asset history and dashboard.
  const after1 = await getAsset(alpha, asset.id);
  const actions = after1!.history.map((h) => h.action);
  for (const a of ["asset.registered", "document.uploaded", "party.recorded", "lease.created", "payment.recorded", "task.created", "task.status_changed"]) {
    assert.ok(actions.includes(a), `history should include ${a}`);
  }
  const dash = await dashboard(alpha);
  assert.equal(dash.totalAssets, 1);
  assert.ok(dash.overdueCharges >= 1, "past-due quarters with no full payment are overdue");

  // 10. Company B cannot read, change or attach anything to company A's records.
  assert.equal(await getAsset(beta, asset.id), null);
  assert.equal((await listAssets(beta)).length, 0);
  await assert.rejects(addParty(beta, asset.id, { partyName: "Hijack", relationship: "LEGAL_OWNER" }), /not found/);
  await assert.rejects(createLease(beta, asset.id, { occupantName: "X", startDate: "2027-01-01", endDate: "2028-01-01", rent: "1", frequency: "YEARLY" }), /not found/);
  await assert.rejects(uploadDocument(beta, asset.id, { title: "X", category: "OTHER" }, { name: "a.pdf", type: "application/pdf", bytes: PDF_BYTES }), /not found/);
  await assert.rejects(recordPayment(beta, charges[1].id, { amount: "1", paidOn: "2025-04-02", evidence: "fake ref" }), /not found/);
  await assert.rejects(updateTaskStatus(beta, task.id, "CANCELLED", ""), /not found/);
  await assert.rejects(updateAssetStatus(beta, asset.id, "DISPOSED", "attempted hijack"), /not found/);
  await assert.rejects(createTask(beta, asset.id, { kind: "TASK", title: "Injected task" }), /not found/);
  const docId = after1!.asset.documents[0].id;
  assert.equal(await getDocumentForDownload(beta, docId), null);
  assert.ok(await getDocumentForDownload(alpha, docId));

  // Even a raw query in B's context sees none of A's rows (row-level security).
  const leaked = await withTenant(beta.companyId, beta.userId, (tx) => tx.asset.findMany({ where: { id: asset.id } }));
  assert.equal(leaked.length, 0);
  const leakedCharges = await withTenant(beta.companyId, beta.userId, (tx) => tx.rentCharge.findMany({ where: { leaseId: lease.id } }));
  assert.equal(leakedCharges.length, 0);
});

test("roles limit what members can do", async () => {
  const alpha = await newCompany("roles");
  await assert.rejects(createAsset(withRole(alpha, "VIEWER"), { name: "X asset", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER" }), /permission/);
  await assert.rejects(inviteMember(withRole(alpha, "MANAGER"), { email: "x@example.test", role: "VIEWER" }), /permission/);
  await assert.rejects(changeMemberRole(alpha, alpha.membershipId, "VIEWER", "ACTIVE"), /your own role/);
});

test("the audit trail is append-only for the application", async () => {
  const alpha = await newCompany("audit");
  await createAsset(alpha, { name: "Audit asset", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER" });
  await assert.rejects(
    withTenant(alpha.companyId, alpha.userId, (tx) => tx.activityLog.updateMany({ where: { companyId: alpha.companyId }, data: { action: "tampered" } })),
  );
});

test("a listing is public only after platform review, and edits take it offline again", async () => {
  const alpha = await newCompany("listing");
  const admin = await newPlatformAdmin();
  const asset = await createAsset(alpha, { name: "Duplex", assetClass: "RESIDENTIAL", category: "Duplex", companyRelationship: "OWNER", city: "Lekki", state: "Lagos" });
  await saveListingDraft(alpha, asset.id, { title: "Lovely duplex in Lekki", purpose: "SALE", price: "185,000,000", bedrooms: "4", city: "Lekki", state: "Lagos" });
  const draft = (await getAsset(alpha, asset.id))!.asset.listing!;
  assert.equal(await getPublicListing(draft.publicRef), null, "drafts are not public");

  await setListingStatus(alpha, asset.id, "PENDING_REVIEW");
  assert.equal(await getPublicListing(draft.publicRef), null, "pending listings are not public");
  assert.ok((await reviewQueue(admin.id)).some((l) => l.id === draft.id));
  await assert.rejects(reviewListing(admin.id, draft.id, "reject", ""), /reason/);
  await reviewListing(admin.id, draft.id, "approve", "");

  const live = await getPublicListing(draft.publicRef);
  assert.ok(live, "approved listing is public");
  assert.ok((await searchListings({ city: "lekki", purpose: "SALE", maxPrice: "200,000,000", minBeds: "3" })).some((l) => l.id === draft.id));
  assert.ok(!(await searchListings({ city: "lekki", maxPrice: "100,000,000" })).some((l) => l.id === draft.id));

  await createEnquiry(draft.publicRef, { name: "Buyer", contact: "08030000000", message: "Is it available?" }, `test-${Date.now()}`);
  assert.equal((await getAsset(alpha, asset.id))!.asset.listing!.enquiries.length, 1);

  await saveListingDraft(alpha, asset.id, { title: "Lovely duplex, price reduced", purpose: "SALE", price: "175,000,000", city: "Lekki", state: "Lagos" });
  assert.equal(await getPublicListing(draft.publicRef), null, "edited listing goes back to review");

  // Disposing of the asset takes any live listing down.
  await setListingStatus(alpha, asset.id, "PENDING_REVIEW");
  await reviewListing(admin.id, draft.id, "approve", "");
  await updateAssetStatus(alpha, asset.id, "DISPOSED", "Sold");
  assert.equal(await getPublicListing(draft.publicRef), null, "disposed asset is no longer listed");
});

test("verification requests need explicit consent, and preselection is never counted as interest", async () => {
  const alpha = await newCompany("verify");
  const admin = await newPlatformAdmin();
  const asset = await createAsset(alpha, { name: "Plot", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER" });
  await saveListingDraft(alpha, asset.id, { title: "Dry land in Ibeju-Lekki", purpose: "SALE", price: "25,000,000", city: "Ibeju-Lekki", state: "Lagos" });
  await setListingStatus(alpha, asset.id, "PENDING_REVIEW");
  const listing = (await getAsset(alpha, asset.id))!.asset.listing!;
  await reviewListing(admin.id, listing.id, "approve", "");

  const provider = await saveProvider(null, {
    name: "Test Verification Ltd", shortName: "TVL", services: "Title checks", status: "APPROVED", placement: "AFFILIATED", featured: false,
  });
  const before = await verificationMetrics();
  await recordRecommendationEvent({ providerId: provider.id, listingRef: listing.publicRef, userId: null, visitorKey: "v-1", trigger: "view", event: "IMPRESSION" });
  const mid = await verificationMetrics();
  assert.equal(mid.impressions, before.impressions + 1);
  assert.equal(mid.confirmedInterest, before.confirmedInterest, "an impression with Yes preselected is not interest");

  const base = { providerId: provider.id, listingRef: listing.publicRef, name: "Chi Buyer", contactMethod: "phone" as const, contactValue: "08031234567" };
  await assert.rejects(submitLead({ ...base, consent: "no" as never }, null, `k-${Date.now()}`), /agree/);
  const { ref, token } = await submitLead({ ...base, consent: "yes" }, null, `k2-${Date.now()}`);
  const lead = await getLeadForVisitor(ref, token);
  assert.ok(lead);
  assert.equal(lead.consentTextVersion.length > 0, true);
  assert.equal(await getLeadForVisitor(ref, "wrong-token"), null);

  await withdrawLead(ref, token);
  const withdrawn = await getLeadForVisitor(ref, token);
  assert.equal(withdrawn!.status, "WITHDRAWN");
  assert.equal(withdrawn!.contactValue, "[withdrawn]");
});
