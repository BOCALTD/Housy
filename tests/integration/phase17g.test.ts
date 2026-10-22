/**
 * Phase 17g: owner, vendor and professional-services portals (master prompt §39). The point of every test here is
 * that an outsider sees exactly what the grant covers and nothing else, and that only the right people can write.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import { assignWorkOrder, createContractor, reportWorkOrder } from "../../src/lib/services/maintenance";
import { registerSeeker } from "../../src/lib/services/community";
import {
  acceptPortalInvite, addProviderMember, decideSubmission, findPortalInvite, inviteOwner, inviteVendor, listGrants, myPortals, ownerPortal,
  providerLeads, reissueInvite, revokeGrant, saveVendorProfile, setGrantAssets, submissionsFor, submitVendorWork, updateProviderLead, vendorJob, vendorPortal,
} from "../../src/lib/services/portals";
import { PASSWORD, PDF_BYTES, addMember, newCompany, newPlatformAdmin, withRole } from "./helpers";

after(() => prisma.$disconnect());

async function person(label: string) {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const { userId } = await registerSeeker({ name: `${label} Person`, email, password: PASSWORD });
  return { id: userId, email };
}

const asset = (co: Awaited<ReturnType<typeof newCompany>>, name: string) =>
  createAsset(co, { name, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "MANAGER" } as never);

test("an owner sees only the properties on their grant, and loses access when it is removed", async () => {
  const co = await newCompany("own-a");
  const x = await asset(co, "Owner house X");
  const y = await asset(co, "Someone else's house Y");
  await createLease(co, x.id, { occupantName: "Tenant on X", startDate: "2026-01-01", endDate: "2027-01-01", rent: "1,200,000", frequency: "YEARLY" } as never);
  await createLease(co, y.id, { occupantName: "Tenant on Y", startDate: "2026-01-01", endDate: "2027-01-01", rent: "900,000", frequency: "YEARLY" } as never);
  const owner = await person("owner");
  const stranger = await person("stranger");

  await assert.rejects(inviteOwner(withRole(co, "OFFICER"), { email: owner.email, displayName: "Mrs Owner", assetIds: [x.id] }), /permission/);
  await assert.rejects(inviteOwner(co, { email: owner.email, displayName: "Mrs Owner", assetIds: [] }), /at least one/);
  const other = await newCompany("own-b");
  const foreign = await asset(other, "Foreign asset");
  await assert.rejects(inviteOwner(co, { email: owner.email, displayName: "Mrs Owner", assetIds: [x.id, foreign.id] }), /not found/);

  const token = await inviteOwner(co, { email: owner.email, displayName: "Mrs Owner", assetIds: [x.id] });
  assert.equal((await findPortalInvite(token))!.companyName, "Test own-a");
  await assert.rejects(acceptPortalInvite(token, stranger), /This invitation is for/);
  await acceptPortalInvite(token, owner);
  await assert.rejects(acceptPortalInvite(token, owner), /invalid|already/);
  assert.equal(await findPortalInvite(token), null, "a used link stops working");

  const grantId = (await myPortals(owner.id)).grants[0].id;
  const view = await ownerPortal(owner.id, grantId);
  assert.ok(view);
  assert.deepEqual(view.assets.map((a) => a.id), [x.id]);
  assert.deepEqual(view.leases.map((l) => l.occupantName), ["Tenant on X"]);
  assert.equal(await ownerPortal(stranger.id, grantId), null, "someone else cannot open the grant");
  assert.equal(await vendorPortal(owner.id, grantId), null, "an owner grant does not open the vendor portal");

  // The stranger's own context shows no grants at all.
  assert.equal(await withUser(stranger.id, (tx) => tx.portalGrant.count()), 0);
  assert.equal(await withUser(stranger.id, (tx) => tx.portalGrantAsset.count()), 0);

  await setGrantAssets(co, grantId, [x.id, y.id]);
  assert.equal((await ownerPortal(owner.id, grantId))!.leases.length, 2);

  await assert.rejects(reissueInvite(co, grantId), /not yet accepted/);
  await revokeGrant(co, grantId);
  assert.equal(await ownerPortal(owner.id, grantId), null);
  assert.equal((await myPortals(owner.id)).grants.length, 0);
  // The other company cannot see this company's grants.
  assert.equal((await listGrants(other)).grants.length, 0);
});

test("an invitation link can be replaced before it is used, and expires", async () => {
  const co = await newCompany("own-c");
  const x = await asset(co, "House");
  const owner = await person("owner2");
  const first = await inviteOwner(co, { email: owner.email, displayName: "Owner Two", assetIds: [x.id] });
  const grant = (await listGrants(co)).grants[0];
  const second = await reissueInvite(co, grant.id);
  assert.equal(await findPortalInvite(first), null, "the old link stops working");
  assert.ok(await findPortalInvite(second));
  await withTenant(co.companyId, co.userId, (tx) => tx.portalGrant.update({ where: { id: grant.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } }));
  assert.equal(await findPortalInvite(second), null);
  await assert.rejects(acceptPortalInvite(second, owner), /invalid/);
});

test("a vendor sees only jobs assigned to its contractor, sends work, and the company decides", async () => {
  const co = await newCompany("ven-a");
  const officer = await addMember(co, "OFFICER", "ven-officer");
  const x = await asset(co, "Block of flats");
  const mine = await createContractor(co, { name: "Mine Plumbing", trade: "Plumbing", phone: "", email: "", notes: "" });
  const theirs = await createContractor(co, { name: "Other Electric", trade: "Electrical", phone: "", email: "", notes: "" });
  const job = await reportWorkOrder(officer, x.id, { title: "Burst pipe", description: "Kitchen", priority: "EMERGENCY", riskLevel: "HIGH", safetyRisk: true } as never);
  await assignWorkOrder(co, job.id, { assigneeId: officer.membershipId, contractorId: mine.id });
  const otherJob = await reportWorkOrder(officer, x.id, { title: "Faulty socket", description: "", priority: "EMERGENCY", riskLevel: "HIGH" } as never);
  await assignWorkOrder(co, otherJob.id, { assigneeId: officer.membershipId, contractorId: theirs.id });
  const unassigned = await reportWorkOrder(officer, x.id, { title: "Paint gate", description: "", priority: "LOW", riskLevel: "LOW" } as never);

  const vendor = await person("vendor");
  const token = await inviteVendor(co, { email: vendor.email, displayName: "Mine contact", contractorId: mine.id });
  await assert.rejects(inviteVendor(co, { email: vendor.email, displayName: "Again", contractorId: mine.id }), /already has portal access/);
  await acceptPortalInvite(token, vendor);
  const grantId = (await myPortals(vendor.id)).grants[0].id;

  const portal = await vendorPortal(vendor.id, grantId);
  assert.deepEqual(portal!.jobs.map((j) => j.id), [job.id]);
  assert.equal(await vendorJob(vendor.id, grantId, otherJob.id), null, "another contractor's job is invisible");
  assert.equal(await vendorJob(vendor.id, grantId, unassigned.id), null, "an unassigned job is invisible");
  const detail = await vendorJob(vendor.id, grantId, job.id);
  assert.equal(detail!.job.title, "Burst pipe");
  assert.ok(!("requesterName" in detail!.job), "the job does not carry the requester's details");

  await assert.rejects(submitVendorWork(vendor.id, grantId, otherJob.id, { kind: "QUOTE", amount: "1000", note: "" }, null), /not found/);
  await assert.rejects(submitVendorWork(vendor.id, grantId, job.id, { kind: "QUOTE", amount: "", note: "" }, null), /amount/);
  await assert.rejects(submitVendorWork(vendor.id, grantId, job.id, { kind: "COMPLETION", amount: "", note: "done" }, null), /Describe|at this stage/);
  const quote = await submitVendorWork(vendor.id, grantId, job.id, { kind: "QUOTE", amount: "85,000", note: "Two joints" }, { type: "application/pdf", bytes: PDF_BYTES, name: "quote.pdf" });
  await assert.rejects(submitVendorWork(vendor.id, grantId, job.id, { kind: "QUOTE", amount: "90000", note: "" }, null), /already sent/);

  // The database refuses a submission written straight into someone else's grant.
  const intruder = await person("intruder");
  await assert.rejects(withUser(intruder.id, (tx) => tx.vendorSubmission.create({ data: { companyId: co.companyId, workOrderId: job.id, grantId, userId: intruder.id, kind: "QUOTE", amountKobo: 1n } })));
  await assert.rejects(withUser(vendor.id, (tx) => tx.vendorSubmission.create({ data: { companyId: co.companyId, workOrderId: job.id, grantId, userId: vendor.id, kind: "QUOTE", amountKobo: 1n, status: "ACCEPTED" } })), "a vendor cannot accept its own work");

  await saveVendorProfile(vendor.id, grantId, { serviceAreas: "Lekki", qualifications: "COREN", insuranceNote: "" }, null);
  assert.equal((await listGrants(co)).grants.find((g) => g.id === grantId)!.profile!.serviceAreas, "Lekki");

  await assert.rejects(submissionsFor(officer, job.id), /permission/);
  const subs = await submissionsFor(co, job.id);
  assert.equal(subs.length, 1);
  await assert.rejects(decideSubmission(co, quote, false, ""), /Say why/);
  await decideSubmission(co, quote, true, "Go ahead");
  const wo = await withTenant(co.companyId, co.userId, (tx) => tx.workOrder.findUniqueOrThrow({ where: { id: job.id } }));
  assert.equal(wo.estimatedCostKobo, 8_500_000n);
  await assert.rejects(decideSubmission(co, quote, true, ""), /already been decided/);
  const told = await withUser(vendor.id, (tx) => tx.notification.count({ where: { userId: vendor.id, kind: "portal.decision" } }));
  assert.equal(told, 1);

  // Another company sees none of it.
  const other = await newCompany("ven-b");
  assert.equal((await submissionsFor(other, job.id)).length, 0);

  await revokeGrant(co, grantId);
  assert.equal(await vendorPortal(vendor.id, grantId), null);
  await assert.rejects(submitVendorWork(vendor.id, grantId, job.id, { kind: "INVOICE", amount: "85000", note: "" }, null), /not found/);
});

test("a provider member sees only that provider's leads, only once it is approved, and moves them forward", async () => {
  const admin = await newPlatformAdmin();
  const tag = randomUUID().slice(0, 6);
  const provider = await prisma.serviceProvider.create({ data: { name: `Provider ${tag}`, shortName: `P${tag}`.slice(0, 12), status: "PENDING" } });
  const rival = await prisma.serviceProvider.create({ data: { name: `Rival ${tag}`, shortName: `R${tag}`.slice(0, 12), status: "APPROVED" } });
  const lead = (providerId: string, ref: string) => prisma.providerLead.create({ data: {
    ref, accessTokenHash: "x", providerId, listingRef: "PROP-TEST", name: "Buyer", contactMethod: "EMAIL", contactValue: "buyer@example.test",
    consentTextVersion: "v1", consentGivenAt: new Date(),
  } });
  await lead(provider.id, `PV-${tag}A`);
  await lead(rival.id, `PV-${tag}B`);
  const staff = await person("provider-staff");
  await assert.rejects(addProviderMember(admin.id, provider.id, "nobody-here@example.test"), /No account/);
  await addProviderMember(admin.id, provider.id, staff.email);

  assert.equal(await providerLeads(staff.id, provider.id, null), null, "a pending provider sees nothing");
  await prisma.serviceProvider.update({ where: { id: provider.id }, data: { status: "APPROVED" } });
  const view = await providerLeads(staff.id, provider.id, null);
  assert.deepEqual(view!.leads.map((l) => l.ref), [`PV-${tag}A`]);
  assert.equal(await providerLeads(staff.id, rival.id, null), null, "not a member of the rival");

  await assert.rejects(updateProviderLead(staff.id, provider.id, `PV-${tag}A`, "CLOSED", ""), /not allowed/);
  await updateProviderLead(staff.id, provider.id, `PV-${tag}A`, "CONTACTED", "Called them");
  await assert.rejects(updateProviderLead(staff.id, provider.id, `PV-${tag}B`, "CONTACTED", ""), /not found/);
  const after1 = await prisma.providerLead.findUniqueOrThrow({ where: { ref: `PV-${tag}A` } });
  assert.equal(after1.status, "CONTACTED");
  assert.equal(after1.providerNote, "Called them");
  assert.equal((await myPortals(staff.id)).providers.length, 1);
});
