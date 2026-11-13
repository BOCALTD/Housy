/**
 * The verification network, stages 1 to 3: an organisation applies, Housy asks for more and approves, the representative
 * activates the organisation, the owner sets it up and invites staff, roles are enforced, and one provider can never
 * reach another's records, whether through the services or straight through the database.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withInviteToken, withUser } from "../../src/lib/db";
import { hashToken } from "../../src/lib/tokens";
import {
  acceptProviderInvitation, addApplicationDocument, addProviderDocument, applicationForAdmin, applicationForApplicant, approveApplication,
  changeProviderStaffRole, documentFile, findProviderInvitation, inviteProviderStaff, providerContext, providerOverview, providerStaff,
  rejectApplication, removeProviderStaff, requestInformation, saveApplicationPart, setProviderCoverage, setProviderOfferings, setProviderStaffStatus,
  setProviderSuspended, startApplication, startReview, submitApplication, updateProviderProfile, withdrawApplication,
} from "../../src/lib/services/verification-network";
import { newPlatformAdmin, PDF_BYTES } from "./helpers";

after(() => prisma.$disconnect());

const person = (label: string) => prisma.user.create({ data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, name: `${label} Person`, passwordHash: "x" } });
const pdf = (name: string) => ({ name, type: "application/pdf", bytes: PDF_BYTES });

async function filledApplication(applicantId: string, repEmail: string, name = "Ada Advisory Ltd") {
  const ref = await startApplication(applicantId);
  await saveApplicationPart(applicantId, ref, "corporate", { registeredName: name, orgType: "DUE_DILIGENCE", cacNumber: `RC ${Math.floor(Math.random() * 9e6 + 1e6)}`, registrationType: "PRIVATE_LIMITED", yearIncorporated: "2015", country: "Nigeria", registeredAddress: "1 Marina, Lagos Island", officialEmail: "hello@ada.example", officialPhone: "+234 803 000 0000", website: "", profile: "A property due diligence firm working across Lagos and Ogun since 2015." });
  await saveApplicationPart(applicantId, ref, "ownership", { contactName: "Ada Obi", contactPosition: "Managing partner", repName: "Ada Obi", repPosition: "Managing partner", repEmail, repPhone: "+234 803 000 0001", directors: [{ name: "Ada Obi", position: "Director" }] });
  await saveApplicationPart(applicantId, ref, "qualifications", { services: ["TITLE", "SITE_INSPECTION"], memberships: "NIESV", licences: [{ body: "ESVARBON", number: "A-123", expires: "2030-01-01" }], professionals: [{ name: "Ada Obi", qualification: "Estate surveyor and valuer", licenceNumber: "A-123", expires: "2030-01-01" }] });
  await saveApplicationPart(applicantId, ref, "operations", { states: ["Lagos", "Ogun"], propertyTypes: ["LAND", "RESIDENTIAL"], fieldInvestigators: "4", professionalStaff: "6", monthlyCapacity: "30", previousProjects: "Title and site checks for over 200 buyers in Lekki and Ibeju-Lekki." });
  for (const kind of ["CAC", "PROFILE", "IDENTITY", "LICENCE"]) await addApplicationDocument(applicantId, ref, { kind, title: "", expiresOn: kind === "LICENCE" ? "2030-01-01" : "" }, pdf(`${kind}.pdf`));
  return ref;
}

/** Apply, get approved and activated: an organisation with its owner, ready to work. */
async function approvedOrg(admin: { id: string }, label: string) {
  const applicant = await person(`${label}-applicant`);
  const ref = await filledApplication(applicant.id, applicant.email, `${label} Verification Ltd`);
  await submitApplication(applicant.id, ref);
  await startReview(admin.id, ref);
  const { token, code, providerId } = await approveApplication(admin.id, ref, { allowedServices: ["TITLE", "SITE_INSPECTION"], allowedStates: ["Lagos"], shortName: label });
  await acceptProviderInvitation(token, { existingUserId: applicant.id });
  const ctx = (await providerContext(applicant.id, code))!;
  return { applicant, ref, code, providerId, ctx };
}

test("an organisation applies, Housy asks for more, the applicant answers, and Housy approves with a permanent provider ID", async () => {
  const admin = await newPlatformAdmin();
  const applicant = await person("applicant");
  const ref = await startApplication(applicant.id);
  assert.match(ref, /^VPA-\d{4}-\d{6}$/);
  assert.equal(await startApplication(applicant.id), ref, "one open application at a time: the same one carries on");
  // Nothing can be sent half-filled.
  await assert.rejects(submitApplication(applicant.id, ref), /Before sending/);
  await assert.rejects(saveApplicationPart(applicant.id, ref, "operations", { states: ["Atlantis"], propertyTypes: ["LAND"], professionalStaff: "1", monthlyCapacity: "1", previousProjects: "Twenty characters or more here." }), /Choose states from the list/);

  const ref2 = await filledApplication(applicant.id, applicant.email);
  const draft = await applicationForApplicant(applicant.id, ref2);
  assert.deepEqual(draft!.missing, []);
  await submitApplication(applicant.id, ref2);
  // Once sent, the applicant cannot change it, and cannot approve it themselves even straight through the database.
  await assert.rejects(saveApplicationPart(applicant.id, ref2, "corporate", draft!.answers.corporate), /cannot be changed/);
  const forged = await withUser(applicant.id, (tx) => tx.vpApplication.updateMany({ where: { ref: ref2 }, data: { status: "APPROVED" } })).catch(() => ({ count: 0 }));
  assert.equal(forged.count, 0, "an applicant can never mark their own application approved");
  // Approval needs a review first.
  await assert.rejects(approveApplication(admin.id, ref2, { allowedServices: ["TITLE"], allowedStates: ["Lagos"], shortName: "Ada" }), /under review/);
  await startReview(admin.id, ref2);
  await requestInformation(admin.id, ref2, "Please add your tax clearance certificate for this year.");
  const asked = await applicationForApplicant(applicant.id, ref2);
  assert.equal(asked!.status, "ADDITIONAL_INFORMATION_REQUIRED");
  assert.match(asked!.infoRequest, /tax clearance/);
  await addApplicationDocument(applicant.id, ref2, { kind: "TAX", title: "Tax clearance 2026", expiresOn: "" }, pdf("tcc.pdf"));
  await submitApplication(applicant.id, ref2, "Added the tax clearance certificate.");
  assert.equal((await applicationForApplicant(applicant.id, ref2))!.status, "RESUBMITTED");

  // Housy's internal notes are not shown to the applicant.
  const { addInternalNote } = await import("../../src/lib/services/verification-network");
  await addInternalNote(admin.id, ref2, "CAC number checked on the CAC portal: matches.");
  assert.ok((await applicationForAdmin(admin.id, ref2))!.events.some((e) => e.internal && /CAC portal/.test(e.note)));
  assert.ok(!(await applicationForApplicant(applicant.id, ref2))!.events.some((e) => /CAC portal/.test(e.note)));

  await startReview(admin.id, ref2);
  const { token, code, providerId } = await approveApplication(admin.id, ref2, { allowedServices: ["TITLE"], allowedStates: ["Lagos"], shortName: "Ada" });
  assert.match(code, /^HVP-\d{6}$/);
  const p = await prisma.serviceProvider.findUniqueOrThrow({ where: { id: providerId } });
  assert.ok(p.vettedAt, "approved through an application: vetted");
  assert.deepEqual(p.allowedServices, ["TITLE"]);
  // Approval comes before activation: nobody is in the organisation until the representative accepts.
  assert.equal(await prisma.providerMember.count({ where: { providerId } }), 0);
  assert.equal(await providerContext(applicant.id, code), null);
  const inv = await findProviderInvitation(token);
  assert.equal(inv!.role, "OWNER");
  assert.equal(inv!.email, applicant.email);
  // Someone else holding the link cannot take it.
  const intruder = await person("intruder");
  await assert.rejects(acceptProviderInvitation(token, { existingUserId: intruder.id }), /Sign in as/);
  await acceptProviderInvitation(token, { existingUserId: applicant.id });
  const ctx = await providerContext(applicant.id, code);
  assert.equal(ctx!.role, "OWNER");
  await assert.rejects(acceptProviderInvitation(token, { existingUserId: applicant.id }), /invalid, already used/);
  // Final: no more moves.
  await assert.rejects(rejectApplication(admin.id, ref2, "Changing my mind about this one."), /cannot be moved/);
});

test("Housy can reject with a reason the applicant sees, and an applicant can withdraw", async () => {
  const admin = await newPlatformAdmin();
  const a = await person("rejected");
  const ref = await filledApplication(a.id, a.email, "Not Yet Ltd");
  await submitApplication(a.id, ref);
  await startReview(admin.id, ref);
  await assert.rejects(rejectApplication(admin.id, ref, "no"), /reason/);
  await rejectApplication(admin.id, ref, "The professional licence supplied has expired.");
  const seen = await applicationForApplicant(a.id, ref);
  assert.equal(seen!.status, "REJECTED");
  assert.match(seen!.decisionReason, /expired/);
  const b = await person("withdrawer");
  const ref2 = await filledApplication(b.id, b.email, "Changed Mind Ltd");
  await submitApplication(b.id, ref2);
  await withdrawApplication(b.id, ref2, "We are not ready yet.");
  assert.equal((await applicationForApplicant(b.id, ref2))!.status, "WITHDRAWN");
});

test("the owner sets up the profile, services and coverage only within what Housy approved, and invites staff in roles that are enforced", async () => {
  const admin = await newPlatformAdmin();
  const { ctx, providerId } = await approvedOrg(admin, "setup");
  await updateProviderProfile(ctx, { name: "Setup Verification", shortName: "Setup", profile: "We verify property titles and inspect sites across Lagos for buyers.", contactEmail: "ops@setup.example", contactPhone: "+234 803 111 2222", link: "" }, null);
  await setProviderOfferings(ctx, [{ categoryCode: "TITLE", active: true, priceNaira: "150,000", turnaroundDays: 7, notes: "" }]);
  await assert.rejects(setProviderOfferings(ctx, [{ categoryCode: "VALUATION", active: true, priceNaira: "", turnaroundDays: 7, notes: "" }]), /not approved this organisation/);
  await setProviderCoverage(ctx, ["Lagos"]);
  await assert.rejects(setProviderCoverage(ctx, ["Lagos", "Kano"]), /not approved this organisation/);
  // Even straight through the database, an organisation cannot offer what it is not approved for.
  const sneaky = await withUser(ctx.userId, (tx) => tx.vpProviderService.create({ data: { providerId, categoryCode: "VALUATION" } })).then(() => true, () => false);
  assert.equal(sneaky, false);
  const svc = await prisma.vpProviderService.findFirstOrThrow({ where: { providerId, categoryCode: "TITLE" } });
  assert.equal(svc.priceKobo, 15_000_000n);

  // Staff: an investigator and an administrator.
  const inv1 = await inviteProviderStaff(ctx, { email: `inv-${randomUUID().slice(0, 6)}@example.test`, role: "INVESTIGATOR" });
  const { userId: investigatorId, code } = await acceptProviderInvitation(inv1, { name: "Ivy Investigator", password: "a-long-password-1" });
  const inv2 = await inviteProviderStaff(ctx, { email: `adm-${randomUUID().slice(0, 6)}@example.test`, role: "ADMIN" });
  const { userId: adminMemberId } = await acceptProviderInvitation(inv2, { name: "Abe Administrator", password: "a-long-password-2" });
  const investigator = (await providerContext(investigatorId, code))!;
  const orgAdmin = (await providerContext(adminMemberId, code))!;
  assert.equal(investigator.role, "INVESTIGATOR");
  // An investigator cannot see staff, change the profile, or invite anyone.
  await assert.rejects(providerStaff(investigator), /role in this organisation does not allow/);
  await assert.rejects(updateProviderProfile(investigator, { name: "X Y", shortName: "XY", profile: "x".repeat(50), contactEmail: "a@b.example", contactPhone: "+2348030000000", link: "" }, null), /does not allow/);
  await assert.rejects(inviteProviderStaff(investigator, { email: "z@example.test", role: "INVESTIGATOR" }), /does not allow/);
  // An administrator manages staff but cannot create or touch owners and administrators, in the service or in the database.
  await assert.rejects(inviteProviderStaff(orgAdmin, { email: "boss@example.test", role: "OWNER" }), /Only an organisation owner/);
  const ownerRow = await prisma.providerMember.findFirstOrThrow({ where: { providerId, role: "OWNER" } });
  await assert.rejects(setProviderStaffStatus(orgAdmin, ownerRow.id, false), /Only an organisation owner/);
  const dbTry = await withUser(adminMemberId, (tx) => tx.providerMember.updateMany({ where: { id: ownerRow.id }, data: { status: "SUSPENDED" } }));
  assert.equal(dbTry.count, 0, "the database refuses an administrator changing an owner");
  const invRow = await prisma.providerMember.findFirstOrThrow({ where: { providerId, userId: investigatorId } });
  await changeProviderStaffRole(orgAdmin, invRow.id, "REVIEWER");
  assert.equal((await providerContext(investigatorId, code))!.role, "REVIEWER");
  // The last owner stays.
  await assert.rejects(changeProviderStaffRole(ctx, ownerRow.id, "ADMIN"), /at least one active owner/);
  // A suspended member can do nothing; a removed one is gone.
  await setProviderStaffStatus(ctx, invRow.id, false);
  assert.equal(await providerContext(investigatorId, code), null);
  await removeProviderStaff(ctx, invRow.id);
  const overview = await providerOverview(ctx);
  assert.equal(overview.offerings, 1);
  assert.equal(overview.coverage, 1);
});

test("one provider cannot reach another's staff, invitations, documents or application, by service or by database", async () => {
  const admin = await newPlatformAdmin();
  const a = await approvedOrg(admin, "alpha");
  const b = await approvedOrg(admin, "bravo");
  await addProviderDocument(b.ctx, { kind: "LICENCE", title: "Bravo licence", expiresOn: "2031-01-01" }, pdf("bravo.pdf"));
  const bDoc = await prisma.vpDocument.findFirstOrThrow({ where: { providerId: b.providerId, title: "Bravo licence" } });
  await inviteProviderStaff(b.ctx, { email: `b-${randomUUID().slice(0, 6)}@example.test`, role: "MANAGER" });

  // Using Bravo's provider ID with Alpha's owner gets nothing.
  assert.equal(await providerContext(a.applicant.id, b.code), null);
  // A forged context (Alpha's owner claiming Bravo's provider) is refused by the database.
  const forged = { ...a.ctx, providerId: b.providerId, code: b.code };
  const staff = await providerStaff(forged);
  assert.equal(staff.members.length, 0, "no rows of another provider's staff");
  assert.equal(staff.invitations.length, 0);
  assert.equal(await documentFile(a.applicant.id, bDoc.id, false), null, "another provider's document is not found");
  // Straight through the database, as Alpha's owner.
  const seen = await withUser(a.applicant.id, async (tx) => ({
    members: await tx.providerMember.count({ where: { providerId: b.providerId } }),
    invites: await tx.vpInvitation.count({ where: { providerId: b.providerId } }),
    docs: await tx.vpDocument.count({ where: { providerId: b.providerId } }),
    apps: await tx.vpApplication.count({ where: { providerId: b.providerId } }),
    events: await tx.vpApplicationEvent.count({ where: { application: { providerId: b.providerId } } }),
  }));
  assert.deepEqual(seen, { members: 0, invites: 0, docs: 0, apps: 0, events: 0 });
  const writes = await withUser(a.applicant.id, async (tx) => ({
    join: await tx.providerMember.create({ data: { providerId: b.providerId, userId: a.applicant.id, role: "OWNER", addedById: a.applicant.id } }).then(() => true, () => false),
    invite: await tx.vpInvitation.create({ data: { providerId: b.providerId, email: "x@example.test", role: "OWNER", tokenHash: hashToken(randomUUID()), invitedById: a.applicant.id, expiresAt: new Date(Date.now() + 864e5) } }).then(() => true, () => false),
  }));
  assert.deepEqual(writes, { join: false, invite: false }, "nobody joins or invites into another provider");
  // A stranger sees nothing of either.
  const stranger = await person("stranger");
  const strangerSees = await withUser(stranger.id, async (tx) => (await tx.providerMember.count({ where: { providerId: { in: [a.providerId, b.providerId] } } })) + (await tx.vpDocument.count()) + (await tx.vpInvitation.count()));
  assert.equal(strangerSees, 0);
  // An invitation link only shows its own invitation.
  const linkSees = await withInviteToken(hashToken("not-a-real-token"), (tx) => tx.vpInvitation.count());
  assert.equal(linkSees, 0);
});

test("a suspended provider keeps its records but can change nothing and take on no one, until Housy lifts it", async () => {
  const admin = await newPlatformAdmin();
  const { ctx, providerId, code, applicant } = await approvedOrg(admin, "suspend");
  await addProviderDocument(ctx, { kind: "LICENCE", title: "Licence", expiresOn: "" }, pdf("l.pdf"));
  const pending = await inviteProviderStaff(ctx, { email: `p-${randomUUID().slice(0, 6)}@example.test`, role: "INVESTIGATOR" });
  await setProviderSuspended(admin.id, providerId, true, "Complaint under investigation by Housy.");
  const susp = (await providerContext(applicant.id, code))!;
  assert.equal(susp.active, false);
  await assert.rejects(setProviderCoverage(susp, ["Lagos"]), /suspended/);
  await assert.rejects(inviteProviderStaff(susp, { email: "n@example.test", role: "INVESTIGATOR" }), /suspended/);
  await assert.rejects(acceptProviderInvitation(pending, { name: "Late Joiner", password: "a-long-password-3" }), /cannot take on staff/);
  // The records are still there and readable.
  assert.equal((await providerOverview(susp)).docs, 5, "the application's four documents and the licence");
  // Even straight through the database, a suspended provider's owner cannot add documents.
  const dbAdd = await withUser(applicant.id, (tx) => tx.vpDocument.create({ data: { providerId, kind: "OTHER", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 1, bytes: Buffer.from("x"), sha256: "x", uploadedById: applicant.id } })).then(() => true, () => false);
  assert.equal(dbAdd, false);
  await setProviderSuspended(admin.id, providerId, false, "");
  await setProviderCoverage((await providerContext(applicant.id, code))!, ["Lagos"]);
});

test("a provider listed before the network (like BOCA) is not marked vetted until it applies and is approved, then keeps its record", async () => {
  const admin = await newPlatformAdmin();
  const listed = await prisma.serviceProvider.create({ data: { name: `Listed Firm ${randomUUID().slice(0, 4)}`, shortName: "LF", status: "APPROVED" } });
  assert.equal(listed.vettedAt, null);
  assert.equal(listed.providerCode, null);
  const rep = await person("listed-rep");
  const ref = await filledApplication(rep.id, rep.email, listed.name);
  await submitApplication(rep.id, ref);
  await startReview(admin.id, ref);
  const r = await approveApplication(admin.id, ref, { allowedServices: ["TITLE"], allowedStates: ["Lagos"], shortName: "LF", linkProviderId: listed.id });
  assert.equal(r.providerId, listed.id, "the existing record is kept and linked, not duplicated");
  const after = await prisma.serviceProvider.findUniqueOrThrow({ where: { id: listed.id } });
  assert.ok(after.vettedAt && after.providerCode);
});
