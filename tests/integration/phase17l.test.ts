/**
 * Phase 17l: automatic identity and business checks, with a person as the fallback.
 * With the person's agreement, an ID, CAC registration or TIN is compared with the official record through the configured
 * providers. A match is verified at once; a mismatch, a missing record, a provider that cannot answer, a passport, or no
 * agreement leaves the check waiting for the verification team, who can still decide it by hand.
 */
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import { agentKyc, autoCheckKyc, companyTrust, decideKyc, submitAgentKyc, submitCompanyKyc } from "../../src/lib/services/kyc";
import { ProviderUnavailable, setIdentityProvidersForTests, type IdentityProvider } from "../../src/lib/identity-providers";
import { PDF_BYTES, addMember, newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
afterEach(() => setIdentityProvidersForTests(null));
const pdf = () => ({ type: "application/pdf", bytes: PDF_BYTES, name: "doc.pdf" });
const item = (adminId: string, id: string) => withPlatformAdmin(adminId, (tx) => tx.kycItem.findFirstOrThrow({ where: { id } }));

/** A stand-in for a provider: NIN 11111111111 is ADA GRACE OBI; RC 1234567 is ALPHA ESTATES LIMITED with TIN 12345678-0001. */
function fake(name = "FakeID", calls: string[] = []): IdentityProvider {
  return {
    name,
    supports: (l) => ["NIN", "CAC", "TIN"].includes(l),
    async lookup(l, input) {
      calls.push(`${l}:${input.number}:${input.companyType ?? ""}`);
      if (l === "NIN") return input.number === "11111111111" ? { found: true, reference: "ref-nin", person: { first: "ADA", middle: "GRACE", last: "OBI" } } : { found: false, reference: "" };
      if (input.number !== "1234567") return { found: false, reference: "" };
      return { found: true, reference: "1234567", company: { name: "ALPHA ESTATES LIMITED", status: "ACTIVE", taxId: l === "TIN" ? "12345678-0001" : undefined } };
    },
  };
}
const down: IdentityProvider = { name: "DownID", supports: () => true, lookup: async () => { throw new ProviderUnavailable("the provider did not answer in time"); } };

test("an agent's NIN that matches the record is verified at once; a mismatch waits for a person", async () => {
  const a = await newCompany("auto-a");
  const admin = await newPlatformAdmin();
  const agent = await addMember(a, "OFFICER", "auto-ag");
  const calls: string[] = [];
  setIdentityProvidersForTests([fake("FakeID", calls)]);

  // Without the person's agreement nothing is sent anywhere.
  const shy = await addMember(a, "OFFICER", "auto-shy");
  const quiet = await submitAgentKyc(shy.userId, a.companyId, "AGENT_ID", { fullName: "Obi Ada", idType: "NIN", idNumber: "11111111111" }, pdf());
  assert.equal(calls.length, 0);
  let r = await item(admin.id, quiet);
  assert.equal(r.status, "SUBMITTED"); assert.equal(r.autoOutcome, "NO_CONSENT");

  // With agreement: the record's names in any order, titles ignored, is a match and verifies the check.
  const ok = await submitAgentKyc(agent.userId, a.companyId, "AGENT_ID", { fullName: "Mrs Obi Ada", idType: "NIN", idNumber: "111 1111 1111" }, pdf(), { autoConsent: true });
  assert.deepEqual(calls, ["NIN:11111111111:"]);
  r = await item(admin.id, ok);
  assert.equal(r.status, "VERIFIED");
  assert.equal(r.reviewedById, "system");
  assert.equal(r.autoOutcome, "MATCH"); assert.equal(r.autoProvider, "FakeID");
  assert.match(r.evidence, /FakeID NIN record \(NIMC\) lookup \(ref ref-nin\): name matches the record/);
  assert.match(r.limitations, /not inspected by a person/);
  assert.ok(r.expiresAt && r.expiresAt > new Date());
  const view = await agentKyc(agent.userId);
  assert.equal(view.items.find((i) => i.req.code === "AGENT_ID")!.status, "VERIFIED");
  const note = await prisma.notification.findFirst({ where: { userId: agent.userId, kind: "security.kyc" }, orderBy: { createdAt: "desc" } });
  assert.match(note?.title ?? "", /Government ID is verified/);
  // A reviewer can still revoke an automatic verification.
  await decideKyc(admin.id, ok, { decision: "revoke", note: "Reported by the agency" });
  assert.equal((await item(admin.id, ok)).status, "REVOKED");

  // A different person's name on the same NIN is not verified: it waits for a person, who sees why.
  const other = await addMember(a, "OFFICER", "auto-ag2");
  const bad = await submitAgentKyc(other.userId, a.companyId, "AGENT_ID", { fullName: "Bayo Okafor", idType: "NIN", idNumber: "11111111111" }, pdf(), { autoConsent: true });
  r = await item(admin.id, bad);
  assert.equal(r.status, "SUBMITTED"); assert.equal(r.autoOutcome, "NO_MATCH");
  assert.match(r.autoNote, /surname differs from the record \(record: A\*A G\*\*\*E O\*I\)/);
  assert.ok(!r.autoNote.includes("GRACE"), "the reviewer note does not copy the full record");
  // The person is told it will be checked by hand, and the team can still verify it.
  assert.ok(await prisma.notification.findFirst({ where: { userId: other.userId, title: { contains: "check it by hand" } } }));
  await decideKyc(admin.id, bad, { decision: "verify", note: "", evidence: "Name change: marriage certificate seen" });
  assert.equal((await item(admin.id, bad)).reviewedById, admin.id);

  // An unknown number, and a passport (no provider checks passports), both wait for a person.
  const third = await addMember(a, "OFFICER", "auto-ag3");
  const missing = await submitAgentKyc(third.userId, a.companyId, "AGENT_ID", { fullName: "Chi Eze", idType: "NIN", idNumber: "99999999999" }, pdf(), { autoConsent: true });
  assert.equal((await item(admin.id, missing)).autoOutcome, "NOT_FOUND");
  const fourth = await addMember(a, "OFFICER", "auto-ag4");
  const passport = await submitAgentKyc(fourth.userId, a.companyId, "AGENT_ID", { fullName: "Dayo Ade", idType: "PASSPORT", idNumber: "A12345678" }, pdf(), { autoConsent: true });
  r = await item(admin.id, passport);
  assert.equal(r.status, "SUBMITTED"); assert.equal(r.autoOutcome, "NOT_SUPPORTED");
});

test("company registration and TIN are checked against the registers; a provider that is down falls through to the next, then to a person", async () => {
  const a = await newCompany("auto-co");
  const admin = await newPlatformAdmin();
  const calls: string[] = [];
  // The first provider is down; the second answers.
  setIdentityProvidersForTests([down, fake("FakeID", calls)]);
  const cac = await submitCompanyKyc(a, "CAC_REGISTRATION", { legalName: "Alpha Estates Ltd", rcNumber: "rc-1234567" }, pdf(), { autoConsent: true });
  let r = await item(admin.id, cac);
  assert.equal(r.status, "VERIFIED"); assert.equal(r.autoProvider, "FakeID");
  assert.deepEqual(calls, ["CAC:1234567:COMPANY"]);
  // The TIN is looked up with the company's RC number and must match.
  const tin = await submitCompanyKyc(a, "TAX_ID", { tin: "12345678-0001" }, null, { autoConsent: true });
  assert.equal((await item(admin.id, tin)).status, "VERIFIED");
  assert.equal(calls[1], "TIN:1234567:COMPANY");

  // A director's NIN with every provider down waits for a person, with the reason; it can be tried again later.
  setIdentityProvidersForTests([down]);
  const dir = await submitCompanyKyc(a, "DIRECTOR_ID", { directorName: "Ada Obi", idType: "NIN", idNumber: "11111111111" }, pdf(), { autoConsent: true });
  r = await item(admin.id, dir);
  assert.equal(r.status, "SUBMITTED"); assert.equal(r.autoOutcome, "UNAVAILABLE");
  assert.match(r.autoNote, /DownID: the provider did not answer in time/);
  setIdentityProvidersForTests([fake()]);
  assert.equal(await autoCheckKyc(dir), "MATCH");
  assert.equal((await companyTrust(a.companyId)).level >= 2, true, "registration and director's ID make the company Verified");

  // A company name that is not the registered one is not verified automatically.
  const b = await newCompany("auto-co2");
  const wrong = await submitCompanyKyc(b, "CAC_REGISTRATION", { legalName: "Beta Homes Ltd", rcNumber: "RC 1234567" }, pdf(), { autoConsent: true });
  r = await item(admin.id, wrong);
  assert.equal(r.status, "SUBMITTED"); assert.equal(r.autoOutcome, "NO_MATCH");

  // The automatic result cannot be forged: an outcome other than "not tried" needs the person's agreement.
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.kycItem.update({ where: { id: wrong }, data: { autoConsent: false, autoOutcome: "MATCH" } })));
});
