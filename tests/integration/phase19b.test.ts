/**
 * The verification network, stages 4 to 6: a customer asks for a verification, Housy ranks providers and assigns one (never
 * an ineligible one; overrides need a reason), the provider accepts, assigns an officer and a different reviewer, investigates,
 * writes the report, its reviewer approves it, Housy reviews and releases it with a fingerprint; a released report never
 * changes, a correction is a new version, and a revoked report shows as revoked. Other providers, field investigators not on
 * the case and the customer see only what they should, through the services and straight through the database.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import {
  acceptProviderInvitation, addApplicationDocument, approveApplication, inviteProviderStaff, providerContext, saveApplicationPart,
  setProviderCoverage, setProviderOfferings, setProviderSuspended, startApplication, startReview, submitApplication,
} from "../../src/lib/services/verification-network";
import {
  addEvidence, answerInformationRequest, answerOffer, assignCase, assignStaff, caseForAdmin, caseForCustomer, caseForProvider, checkReport,
  decideIntake, disputeReport, expireOffers, moveProviderCase, platformDecision, providerCases, releaseReport, reportPdf, requestVerification,
  resolveDispute, revokeReport, reviewerDecision, saveReportDraft, startPlatformReview, submitForInternalReview,
} from "../../src/lib/services/verification-cases";
import { newPlatformAdmin, PDF_BYTES } from "./helpers";

after(() => prisma.$disconnect());

const person = (label: string) => prisma.user.create({ data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, name: `${label} Person`, passwordHash: "x" } });
const pdf = (name: string) => ({ name, type: "application/pdf", bytes: PDF_BYTES });

async function approvedOrg(admin: { id: string }, label: string, opts: { offer?: boolean; cover?: boolean } = {}) {
  const applicant = await person(`${label}-owner`);
  const ref = await startApplication(applicant.id);
  await saveApplicationPart(applicant.id, ref, "corporate", { registeredName: `${label} Verification Ltd`, orgType: "DUE_DILIGENCE", cacNumber: `RC ${Math.floor(Math.random() * 9e6 + 1e6)}`, registrationType: "PRIVATE_LIMITED", yearIncorporated: "2015", country: "Nigeria", registeredAddress: "1 Marina, Lagos Island", officialEmail: "hello@org.example", officialPhone: "+234 803 000 0000", website: "", profile: "A property due diligence firm working across Lagos and Ogun since 2015." });
  await saveApplicationPart(applicant.id, ref, "ownership", { contactName: "Ada Obi", contactPosition: "Managing partner", repName: "Ada Obi", repPosition: "Managing partner", repEmail: applicant.email, repPhone: "+234 803 000 0001", directors: [{ name: "Ada Obi", position: "Director" }] });
  await saveApplicationPart(applicant.id, ref, "qualifications", { services: ["TITLE", "SITE_INSPECTION"], memberships: "NIESV", licences: [{ body: "ESVARBON", number: "A-123", expires: "2030-01-01" }], professionals: [{ name: "Ada Obi", qualification: "Estate surveyor and valuer", licenceNumber: "A-123", expires: "2030-01-01" }] });
  await saveApplicationPart(applicant.id, ref, "operations", { states: ["Lagos"], propertyTypes: ["LAND"], fieldInvestigators: "4", professionalStaff: "6", monthlyCapacity: "30", previousProjects: "Title and site checks for over 200 buyers in Lekki and Ibeju-Lekki." });
  for (const kind of ["CAC", "PROFILE", "IDENTITY", "LICENCE"]) await addApplicationDocument(applicant.id, ref, { kind, title: "", expiresOn: kind === "LICENCE" ? "2030-01-01" : "" }, pdf(`${kind}.pdf`));
  await submitApplication(applicant.id, ref);
  await startReview(admin.id, ref);
  const { token, code, providerId } = await approveApplication(admin.id, ref, { allowedServices: ["TITLE", "SITE_INSPECTION"], allowedStates: ["Lagos"], shortName: label });
  await acceptProviderInvitation(token, { existingUserId: applicant.id });
  const owner = (await providerContext(applicant.id, code))!;
  if (opts.offer !== false) await setProviderOfferings(owner, [{ categoryCode: "TITLE", active: true, priceNaira: "150,000", turnaroundDays: 7, notes: "" }, { categoryCode: "SITE_INSPECTION", active: true, priceNaira: "50,000", turnaroundDays: 5, notes: "" }]);
  if (opts.cover !== false) await setProviderCoverage(owner, ["Lagos"]);
  const staff = async (role: "INVESTIGATOR" | "REVIEWER") => {
    const u = await person(`${label}-${role.toLowerCase()}`);
    const t = await inviteProviderStaff(owner, { email: u.email, role });
    await acceptProviderInvitation(t, { existingUserId: u.id });
    return (await providerContext(u.id, code))!;
  };
  return { owner, code, providerId, staff };
}

const fullReport: Parameters<typeof saveReportDraft>[2] & { findings: { basis: string; text: string }[] } = {
  scope: "Title to the land at Plot 4 and a site visit.", documentsExamined: "Certificate of Occupancy dated 2011 (copy from the customer).",
  sourcesConsulted: "Lagos State Land Registry, Alausa.", registrySearch: "Searched 3 November 2026: registered to the seller, no encumbrance shown.",
  siteInspection: "Visited 5 November 2026; beacons in place, land vacant.", findings: [{ basis: "REGISTRY", text: "The register shows the seller as holder of the C of O." }, { basis: "PHYSICAL", text: "The land is vacant and the beacons match the survey plan." }],
  risks: "", limitations: "The original C of O was not seen; the search shows the register on the date searched only.", outstanding: "", observations: "",
  recommendations: "Inspect the original C of O before payment.", conclusion: "Nothing adverse found within the scope.", outcome: "SATISFACTORY_WITHIN_SCOPE",
};

test("a request goes from the customer through assignment, investigation, both reviews and release; released reports never change", async () => {
  const admin = await newPlatformAdmin();
  const customer = await person("customer");
  const a = await approvedOrg(admin, `Acme${randomUUID().slice(0, 4)}`);
  const b = await approvedOrg(admin, `Bravo${randomUUID().slice(0, 4)}`, { cover: false });
  const s = await approvedOrg(admin, `Sus${randomUUID().slice(0, 4)}`);
  await setProviderSuspended(admin.id, s.providerId, true, "Complaint under investigation by Housy.");

  await assert.rejects(requestVerification(customer.id, { propertyAddress: "Plot 4, Lekki", state: "Atlantis", propertyType: "LAND", services: ["TITLE"] }), /state/);
  const ref = await requestVerification(customer.id, { propertyAddress: "Plot 4, Admiralty Way, Lekki", state: "Lagos", propertyType: "LAND", services: ["TITLE", "SITE_INSPECTION"], ownerDetails: "Mr Seller" });
  assert.match(ref, /^HVR-\d{4}-\d{6}$/);
  // The customer cannot push their own case along, even straight through the database (rules trigger).
  await assert.rejects(withUser(customer.id, (tx) => tx.vpCase.updateMany({ where: { ref }, data: { status: "DELIVERED" } })));
  await assert.rejects(assignCase(admin.id, ref, { providerId: a.providerId, method: "MANUAL" }), /ready for a provider/);
  await decideIntake(admin.id, ref, "READY_FOR_ASSIGNMENT", "Paid by bank transfer, receipt 123.");

  // Ranking: A is eligible; B does not cover Lagos (an override with a reason); the suspended one can never be chosen.
  const view = (await caseForAdmin(admin.id, ref))!;
  const rank = (id: string) => view.ranked.find((r) => r.providerId === id)!;
  assert.equal(rank(a.providerId).eligible, true);
  assert.equal(rank(b.providerId).eligible, false);
  assert.match(rank(b.providerId).reasons.join(), /does not work in Lagos/);
  assert.match(rank(s.providerId).reasons.join(), /suspended/);
  await assert.rejects(assignCase(admin.id, ref, { providerId: s.providerId, method: "MANUAL", reason: "They are the best for this, really." }), /cannot take the case/);
  await assert.rejects(assignCase(admin.id, ref, { providerId: b.providerId, method: "MANUAL" }), /overrides the eligibility rules/);
  await assignCase(admin.id, ref, { providerId: a.providerId, method: "MANUAL", requiredBy: "2030-01-31" });

  // Only A sees it; B sees nothing, through the services or the database.
  assert.ok(await caseForProvider(a.owner, ref));
  assert.equal(await caseForProvider(b.owner, ref), null);
  assert.equal(await withUser(b.owner.userId, (tx) => tx.vpCase.count({ where: { ref } })), 0);
  assert.equal(await withUser(b.owner.userId, (tx) => tx.vpCaseFile.count({ where: { case: { ref } } })), 0);
  // The customer does not see who it was offered to until it is accepted.
  assert.equal((await caseForCustomer(customer.id, ref))!.provider, null);

  const inv = await a.staff("INVESTIGATOR");
  const rev = await a.staff("REVIEWER");
  const other = await a.staff("INVESTIGATOR");
  await assert.rejects(answerOffer(inv, ref, true, ""), /does not allow/);
  await answerOffer(a.owner, ref, true, "");
  assert.equal((await caseForCustomer(customer.id, ref))!.provider?.providerCode, a.code);

  await assert.rejects(assignStaff(a.owner, ref, rev.userId, rev.userId), /role can work|different people/);
  await assert.rejects(assignStaff(a.owner, ref, inv.userId, inv.userId), /reviewer must be|different people/);
  await assignStaff(a.owner, ref, inv.userId, rev.userId);
  // A field investigator sees only the cases given to them.
  assert.ok(await caseForProvider(inv, ref));
  assert.equal(await caseForProvider(other, ref), null);
  assert.ok(!(await providerCases(other)).rows.some((r) => r.ref === ref));

  await moveProviderCase(inv, ref, "DOCUMENT_REVIEW", "");
  await assert.rejects(moveProviderCase(inv, ref, "INFORMATION_REQUIRED", ""), /what you need/);
  await moveProviderCase(inv, ref, "INFORMATION_REQUIRED", "Please upload the survey plan for the plot.");
  assert.match((await caseForCustomer(customer.id, ref))!.infoRequest, /survey plan/);
  await answerInformationRequest(customer.id, ref, "Uploaded the survey plan just now.");
  await moveProviderCase(inv, ref, "INVESTIGATION_IN_PROGRESS", "");
  await addEvidence(inv, ref, { kind: "PHOTO", basis: "PHYSICAL", title: "North beacon", lat: 6.43, lng: 3.45, takenAt: "2026-11-05T10:30" }, pdf("beacon.pdf"));
  // The customer never sees the provider's evidence or drafts.
  assert.equal(await withUser(customer.id, (tx) => tx.vpCaseFile.count({ where: { case: { ref }, uploaderKind: "provider" } })), 0);

  await saveReportDraft(inv, ref, { scope: "Title only." });
  await moveProviderCase(inv, ref, "REPORT_DRAFT", "");
  await assert.rejects(submitForInternalReview(inv, ref), /not complete/);
  await saveReportDraft(inv, ref, fullReport);
  await submitForInternalReview(inv, ref);
  assert.equal(await withUser(customer.id, (tx) => tx.vpReportVersion.count({ where: { caseId: view.id } })), 0, "the customer sees no unreleased version");
  await assert.rejects(reviewerDecision(inv, ref, true, ""), /does not allow/);
  await reviewerDecision(rev, ref, true, "Checked against the evidence.");
  // Once approved by the provider's reviewer, nobody can change what it says.
  await assert.rejects(withUser(a.owner.userId, (tx) => tx.vpReportVersion.updateMany({ where: { caseId: view.id }, data: { content: { scope: "changed" } } })));

  await startPlatformReview(admin.id, ref);
  await platformDecision(admin.id, ref, true, "Scope, labels and limitations in order.");
  await releaseReport(admin.id, ref);
  const check = (await checkReport((await caseForCustomer(customer.id, ref))!.report!.publicRef))!;
  assert.equal(check.versions.length, 1);
  assert.match(check.versions[0].sha256, /^[0-9a-f]{64}$/);
  const mine = (await caseForCustomer(customer.id, ref))!;
  assert.equal(mine.status, "DELIVERED");
  const file = await reportPdf({ userId: customer.id, isAdmin: false }, mine.report!.publicRef, 1, "https://housy.example");
  assert.equal(Buffer.from(file!.bytes.slice(0, 5)).toString(), "%PDF-");
  assert.equal(await reportPdf({ userId: b.owner.userId, isAdmin: false }, mine.report!.publicRef, 1, "https://housy.example"), null, "another provider cannot open the report");
  // A released version is never altered, not even by Housy's administrators.
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.vpReportVersion.updateMany({ where: { caseId: view.id, version: 1 }, data: { content: { scope: "rewritten" } } })));
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.vpReportVersion.deleteMany({ where: { caseId: view.id } })));

  // A dispute reopens it; the correction is version 2, which records what it corrects; version 1 becomes superseded.
  await disputeReport(customer.id, ref, "The report does not mention the right-of-way along the eastern boundary.");
  await resolveDispute(admin.id, ref, true, "Reopened: the provider will check the right-of-way.");
  await platformDecision(admin.id, ref, false, "Check and report on the right-of-way along the eastern boundary.");
  await saveReportDraft(inv, ref, { ...fullReport, risks: "A drainage right-of-way runs along the eastern boundary.", outcome: "SATISFACTORY_WITH_CONDITIONS" });
  await submitForInternalReview(inv, ref);
  await reviewerDecision(rev, ref, true, "");
  await startPlatformReview(admin.id, ref);
  await platformDecision(admin.id, ref, true, "");
  await releaseReport(admin.id, ref);
  const after2 = (await checkReport(mine.report!.publicRef))!;
  assert.deepEqual(after2.versions.map((v) => [v.version, !!v.supersededAt]), [[2, false], [1, true]]);
  const v2 = await withPlatformAdmin(admin.id, (tx) => tx.vpReportVersion.findFirstOrThrow({ where: { caseId: view.id, version: 2 } }));
  assert.equal(v2.correctionOf, 1);

  await revokeReport(admin.id, ref, "Issued on a forged survey plan; under investigation.");
  assert.ok((await checkReport(mine.report!.publicRef))!.versions[0].revokedAt);
  assert.equal(await checkReport("VR-AAAAAAAAAA"), null);
});

test("a declined offer needs a reason; a conflict keeps the provider off the case; unanswered offers expire", async () => {
  const admin = await newPlatformAdmin();
  const customer = await person("customer2");
  const a = await approvedOrg(admin, `Delta${randomUUID().slice(0, 4)}`);
  const b = await approvedOrg(admin, `Echo${randomUUID().slice(0, 4)}`);
  const ref = await requestVerification(customer.id, { propertyAddress: "12 Bourdillon Road, Ikoyi", state: "Lagos", propertyType: "LAND", services: ["TITLE"] });
  await decideIntake(admin.id, ref, "READY_FOR_ASSIGNMENT", "");
  await assignCase(admin.id, ref, { providerId: a.providerId, method: "MANUAL" });
  await assert.rejects(answerOffer(a.owner, ref, false, ""), /reason/);
  await answerOffer(a.owner, ref, false, "We act for the seller of this property.", true);
  assert.equal(await caseForProvider(a.owner, ref), null, "after declining, the provider no longer sees the case");
  const view = (await caseForAdmin(admin.id, ref))!;
  assert.equal(view.status, "READY_FOR_ASSIGNMENT");
  assert.match(view.ranked.find((r) => r.providerId === a.providerId)!.reasons.join(), /conflict/);
  await assert.rejects(assignCase(admin.id, ref, { providerId: a.providerId, method: "MANUAL", reason: "Overriding the conflict on purpose." }), /cannot take the case/);

  await assignCase(admin.id, ref, { providerId: b.providerId, method: "MANUAL" });
  await withPlatformAdmin(admin.id, (tx) => tx.vpAssignment.updateMany({ where: { caseId: view.id, status: "OFFERED" }, data: { respondBy: new Date(Date.now() - 60_000) } }));
  await expireOffers();
  const again = (await caseForAdmin(admin.id, ref))!;
  assert.equal(again.status, "READY_FOR_ASSIGNMENT");
  assert.equal(again.providerId, null);
  assert.ok(again.assignments.some((x) => x.providerId === b.providerId && x.status === "EXPIRED"));
  // A provider can never hand a case to itself or move a case it does not hold, even straight through the database.
  await assert.rejects(withUser(b.owner.userId, (tx) => tx.vpCase.update({ where: { id: view.id }, data: { providerId: b.providerId, status: "ACCEPTED" } })));
});
