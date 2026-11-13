/**
 * Verification network, stage 10: security across every verification table, found from the database itself so a table added
 * later is covered without editing this test.
 *  - Every verification_* table has row-level security on and forced (provider_members is the one documented exception:
 *    the membership check reads it, so it is not forced; its own policies still apply to the runtime role).
 *  - The public, a signed-in stranger, and the owner of another provider see none of a provider's or a customer's rows.
 *  - The append-only history cannot be changed or deleted by the runtime role, even with Housy's context.
 *  - Nobody writes straight into the money tables, the complaints or the cases of others without Housy's context.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withPlatformAdmin, withPublic, withUser } from "../../src/lib/db";
import {
  acceptProviderInvitation, addApplicationDocument, approveApplication, providerContext, saveApplicationPart, setProviderCoverage,
  setProviderOfferings, setProviderSuspended, startApplication, startReview, submitApplication,
} from "../../src/lib/services/verification-network";
import {
  addCustomerDocument, answerOffer, assignCase, caseForCustomer, caseForProvider, decideIntake, moveProviderCase, requestVerification,
} from "../../src/lib/services/verification-cases";
import { fileComplaint } from "../../src/lib/services/verification-quality";
import { setPayoutDetails } from "../../src/lib/services/verification-finance";

const setPayoutDetailsAs = (ctx: Parameters<typeof setPayoutDetails>[0], n: string) => setPayoutDetails(ctx, { bankName: "GTBank", accountName: "Checks Ltd", accountNumber: n });
import { newPlatformAdmin, PDF_BYTES } from "./helpers";

after(() => prisma.$disconnect());

const person = (label: string) => prisma.user.create({ data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`.toLowerCase(), name: `${label} Person`, passwordHash: "x" } });
const pdf = (name: string) => ({ name, type: "application/pdf", bytes: PDF_BYTES });

async function approvedOrg(admin: { id: string }, label: string) {
  const applicant = await person(`${label}-owner`);
  const ref = await startApplication(applicant.id);
  await saveApplicationPart(applicant.id, ref, "corporate", { registeredName: `${label} Checks Ltd`, orgType: "DUE_DILIGENCE", cacNumber: `RC ${Math.floor(Math.random() * 9e6 + 1e6)}`, registrationType: "PRIVATE_LIMITED", yearIncorporated: "2016", country: "Nigeria", registeredAddress: "2 Broad Street, Lagos Island", officialEmail: "hello@org.example", officialPhone: "+234 803 000 0000", website: "", profile: "A property due diligence firm working across Lagos since 2016." });
  await saveApplicationPart(applicant.id, ref, "ownership", { contactName: "Kemi Ade", contactPosition: "Partner", repName: "Kemi Ade", repPosition: "Partner", repEmail: applicant.email, repPhone: "+234 803 000 0002", directors: [{ name: "Kemi Ade", position: "Director" }] });
  await saveApplicationPart(applicant.id, ref, "qualifications", { services: ["TITLE"], memberships: "NIESV", licences: [{ body: "ESVARBON", number: "B-9", expires: "2030-01-01" }], professionals: [{ name: "Kemi Ade", qualification: "Estate surveyor and valuer", licenceNumber: "B-9", expires: "2030-01-01" }] });
  await saveApplicationPart(applicant.id, ref, "operations", { states: ["Lagos"], propertyTypes: ["LAND"], fieldInvestigators: "2", professionalStaff: "3", monthlyCapacity: "20", previousProjects: "Title checks for buyers in Lekki and Ajah over several years." });
  for (const kind of ["CAC", "PROFILE", "IDENTITY", "LICENCE"]) await addApplicationDocument(applicant.id, ref, { kind, title: "", expiresOn: kind === "LICENCE" ? "2030-01-01" : "" }, pdf(`${kind}.pdf`));
  await submitApplication(applicant.id, ref);
  await startReview(admin.id, ref);
  const { token, code, providerId } = await approveApplication(admin.id, ref, { allowedServices: ["TITLE"], allowedStates: ["Lagos"], shortName: label });
  await acceptProviderInvitation(token, { existingUserId: applicant.id });
  const owner = (await providerContext(applicant.id, code))!;
  await setProviderOfferings(owner, [{ categoryCode: "TITLE", active: true, priceNaira: "100,000", turnaroundDays: 7, notes: "" }]);
  await setProviderCoverage(owner, ["Lagos"]);
  return { owner, providerId };
}

test("every verification table has row-level security on, and forced unless documented otherwise", async () => {
  const rows = await withPlatformAdmin("system", (tx) => tx.$queryRaw<{ t: string; rls: boolean; forced: boolean }[]>`
    SELECT c.relname::text AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND (c.relname::text LIKE 'verification%' OR c.relname::text = 'provider_members')`);
  assert.ok(rows.length >= 18, `expected the verification tables, found ${rows.length}`);
  const NOT_FORCED = new Set(["provider_members"]);
  for (const r of rows) {
    assert.ok(r.rls, `${r.t}: row-level security is off`);
    if (!NOT_FORCED.has(r.t)) assert.ok(r.forced, `${r.t}: row-level security is not forced`);
  }
});

test("outsiders see nothing of a provider's or a customer's verification records, in any table", async () => {
  const admin = await newPlatformAdmin();
  const a = await approvedOrg(admin, `kilo${randomUUID().slice(0, 4)}`);
  const b = await approvedOrg(admin, `lima${randomUUID().slice(0, 4)}`);
  const customer = await person("owner-of-case");
  const stranger = await person("stranger");
  const ref = await requestVerification(customer.id, { propertyAddress: "9 Awolowo Road, Ikoyi", state: "Lagos", propertyType: "LAND", services: ["TITLE"] });
  await addCustomerDocument(customer.id, ref, "Survey plan", pdf("survey.pdf"));
  await decideIntake(admin.id, ref, "READY_FOR_ASSIGNMENT", "Paid under a corporate agreement.");
  await assignCase(admin.id, ref, { providerId: a.providerId, method: "MANUAL" });
  await answerOffer(a.owner, ref, true, "");
  await fileComplaint(customer.id, ref, { category: "COMMUNICATION", description: "No one has told me who is handling my case yet." });

  const tables = (await withPlatformAdmin("system", (tx) => tx.$queryRaw<{ t: string }[]>`
    SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname::text LIKE 'verification%'`)).map((r) => r.t);
  const caseId = (await withPlatformAdmin(admin.id, (tx) => tx.vpCase.findUniqueOrThrow({ where: { ref }, select: { id: true } }))).id;

  // Rows tied to this case or to provider A, per table, counted through each outsider's eyes with a raw query, so no
  // service-level filter can hide a leak.
  const tiedTo = async (who: "public" | string, table: string) => {
    const cols = (await withPlatformAdmin("system", (tx) => tx.$queryRaw<{ c: string }[]>`SELECT column_name::text AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`)).map((r) => r.c);
    const conds = [cols.includes("case_id") ? `case_id = '${caseId}'` : "", table === "verification_cases" ? `id = '${caseId}'` : "", cols.includes("provider_id") ? `provider_id = '${a.providerId}'` : ""].filter(Boolean);
    if (!conds.length) return 0;
    const sql = `SELECT count(*)::int AS n FROM "${table}" WHERE ${conds.join(" OR ")}`;
    const rows = who === "public"
      ? await withPublic((tx) => tx.$queryRawUnsafe<{ n: number }[]>(sql))
      : await withUser(who, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(sql));
    return rows[0].n;
  };
  const checked: string[] = [];
  for (const t of tables) {
    // The public provider directory (services, coverage, categories) is public by design.
    if (["verification_provider_services", "verification_provider_coverage", "verification_service_categories"].includes(t)) continue;
    for (const who of ["public", stranger.id, b.owner.userId]) {
      assert.equal(await tiedTo(who, t), 0, `${t} leaks to ${who === "public" ? "the public" : who === stranger.id ? "a signed-in stranger" : "another provider's owner"}`);
    }
    checked.push(t);
  }
  assert.ok(checked.includes("verification_cases") && checked.includes("verification_case_documents") && checked.includes("verification_complaints"), `checked ${checked.join(", ")}`);
  // And the people who should see them do.
  assert.ok((await tiedTo(customer.id, "verification_cases")) > 0);
  assert.ok((await tiedTo(a.owner.userId, "verification_cases")) > 0);
});

test("the case history is append-only and the money tables are written only by Housy", async () => {
  const admin = await newPlatformAdmin();
  const a = await approvedOrg(admin, `mike${randomUUID().slice(0, 4)}`);
  const customer = await person("history");
  const ref = await requestVerification(customer.id, { propertyAddress: "3 Kingsway Road, Ikoyi", state: "Lagos", propertyType: "LAND", services: ["TITLE"] });
  const caseId = (await withPlatformAdmin(admin.id, (tx) => tx.vpCase.findUniqueOrThrow({ where: { ref }, select: { id: true } }))).id;
  // Even with Housy's context the runtime role cannot rewrite or delete history.
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.$executeRawUnsafe(`UPDATE verification_case_activities SET note = 'rewritten' WHERE case_id = '${caseId}'`)));
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.$executeRawUnsafe(`DELETE FROM verification_case_activities WHERE case_id = '${caseId}'`)));
  // Payout bank accounts: only the provider's owner and finance staff read their own; nobody writes without Housy.
  await setPayoutDetailsAs(a.owner, "0123456789");
  assert.equal(await withUser(customer.id, (tx) => tx.vpPayoutAccount.count({ where: { providerId: a.providerId } })), 0, "a stranger cannot read a provider's bank account");
  assert.equal(await withPublic((tx) => tx.vpPayoutAccount.count()), 0);
  assert.equal(await withUser(a.owner.userId, (tx) => tx.vpPayoutAccount.count({ where: { providerId: a.providerId } })), 1);
  await assert.rejects(withUser(a.owner.userId, (tx) => tx.vpPayoutAccount.update({ where: { providerId: a.providerId }, data: { accountNumber: "9999999999" } })), Error, "changes go through Housy's service, which tells everyone handling the money");
  // A provider's owner cannot create earnings or payouts for itself, or touch complaints.
  await assert.rejects(withUser(a.owner.userId, (tx) => tx.vpEarning.create({ data: { caseId, providerId: a.providerId, invoiceId: randomUUID(), grossKobo: 100n, feeKobo: 15n, netKobo: 85n } })));
  await assert.rejects(withUser(a.owner.userId, (tx) => tx.vpPayout.create({ data: { ref: `HVO-TEST-${randomUUID().slice(0, 6)}`, providerId: a.providerId, totalKobo: 100n, bankName: "X", accountName: "Y", accountNumber: "0123456789", preparedById: a.owner.userId } })));
  await assert.rejects(withUser(customer.id, (tx) => tx.vpComplaint.create({ data: { ref: `HVC-TEST-${randomUUID().slice(0, 6)}`, providerId: a.providerId, complainantId: customer.id, category: "OTHER", description: "Written straight into the table." } })));
  // A customer cannot hand their own case to a provider or move it on.
  await assert.rejects(withUser(customer.id, (tx) => tx.vpCase.update({ where: { id: caseId }, data: { providerId: a.providerId } })));
  await assert.rejects(withUser(customer.id, (tx) => tx.vpCase.update({ where: { id: caseId }, data: { status: "READY_FOR_ASSIGNMENT" } })));
});

test("suspending a provider stops new work on its cases and new assignments, and keeps every record", async () => {
  const admin = await newPlatformAdmin();
  const a = await approvedOrg(admin, `nova${randomUUID().slice(0, 4)}`);
  const customer = await person("suspension");
  const ref = await requestVerification(customer.id, { propertyAddress: "11 Bourdillon Road, Ikoyi", state: "Lagos", propertyType: "LAND", services: ["TITLE"] });
  await decideIntake(admin.id, ref, "READY_FOR_ASSIGNMENT", "Paid under a corporate agreement.");
  await assignCase(admin.id, ref, { providerId: a.providerId, method: "MANUAL" });
  await answerOffer(a.owner, ref, true, "");
  await setProviderSuspended(admin.id, a.providerId, true, "Complaint under investigation by Housy.");
  const suspended = (await providerContext(a.owner.userId, (await prisma.serviceProvider.findUniqueOrThrow({ where: { id: a.providerId } })).providerCode!))!;
  assert.equal(suspended.active, false);
  // No new work, through the service or straight through the database.
  await assert.rejects(moveProviderCase(suspended, ref, "DOCUMENT_REVIEW", ""), /suspended/);
  await assert.rejects(withUser(a.owner.userId, (tx) => tx.vpCase.updateMany({ where: { ref }, data: { status: "DOCUMENT_REVIEW" } }).then((r) => { if (!r.count) throw new Error("refused"); })));
  // No new cases.
  const ref2 = await requestVerification(customer.id, { propertyAddress: "13 Bourdillon Road, Ikoyi", state: "Lagos", propertyType: "LAND", services: ["TITLE"] });
  await decideIntake(admin.id, ref2, "READY_FOR_ASSIGNMENT", "Paid under a corporate agreement.");
  await assert.rejects(assignCase(admin.id, ref2, { providerId: a.providerId, method: "MANUAL", reason: "Overriding the suspension on purpose." }), /cannot take the case/);
  // Its records are all still there and still readable by it and by the customer.
  assert.ok(await caseForProvider(suspended, ref));
  assert.equal((await caseForCustomer(customer.id, ref))!.status, "ACCEPTED");
  // Lifting the suspension lets the work continue.
  await setProviderSuspended(admin.id, a.providerId, false, "");
  const back = (await providerContext(a.owner.userId, suspended.code))!;
  await moveProviderCase(back, ref, "DOCUMENT_REVIEW", "");
});
