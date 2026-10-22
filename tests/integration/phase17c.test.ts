/**
 * Phase 17c: company and agent identity checks (KYC) and trust levels.
 * Only the company's top administrator submits company checks; an agent's checks are visible to the agent and reviewers only
 * (not the employer); nobody but a reviewer can mark a check Verified; ID numbers are stored encrypted; the public sees the result only.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPublic, withTenant, withUser } from "../../src/lib/db";
import { agentKyc, agentTrust, companyKyc, companyTrust, decideKyc, kycDocument, revealKycSecret, submitAgentKyc, submitCompanyKyc } from "../../src/lib/services/kyc";
import { PDF_BYTES, addMember, newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const pdf = (name = "doc.pdf") => ({ type: "application/pdf", bytes: PDF_BYTES, name });

test("company checks: permission, privacy, reviewer-only verification and the trust level", async () => {
  const a = await newCompany("kyc-a"), b = await newCompany("kyc-b");
  const admin = await newPlatformAdmin();
  const manager = await addMember(a, "MANAGER", "kycm");

  await assert.rejects(submitCompanyKyc(manager, "CAC_REGISTRATION", { legalName: "A Ltd", rcNumber: "RC 123456" }, pdf()), /permission/);
  await assert.rejects(submitCompanyKyc(a, "CAC_REGISTRATION", { legalName: "A Ltd", rcNumber: "nope" }, pdf()), /RC or BN/);
  await assert.rejects(submitCompanyKyc(a, "CAC_REGISTRATION", { legalName: "A Ltd", rcNumber: "RC 123456" }, null), /Attach/);
  await assert.rejects(submitCompanyKyc(a, "AGENT_ID", { fullName: "X" }, pdf()), /Unknown check/);

  const cac = await submitCompanyKyc(a, "CAC_REGISTRATION", { legalName: "A Ltd", rcNumber: "RC 123456" }, pdf("cac.pdf"));
  const dir = await submitCompanyKyc(a, "DIRECTOR_ID", { directorName: "Ada Obi", idType: "NIN", idNumber: "12345678901" }, pdf("id.pdf"));
  await assert.rejects(submitCompanyKyc(a, "CAC_REGISTRATION", { legalName: "A Ltd", rcNumber: "RC 123456" }, pdf()), /already waiting/);

  // The ID number is stored encrypted, shown masked, and readable only by a reviewer.
  const stored = await withTenant(a.companyId, a.userId, (tx) => tx.kycItem.findFirstOrThrow({ where: { id: dir } }));
  assert.ok(stored.secretSealed && !stored.secretSealed.includes("12345678901"));
  assert.equal(stored.secretMasked, "••••••••901");
  assert.equal(await revealKycSecret(admin.id, dir), "12345678901");

  // Another company, a signed-in stranger and the public see nothing.
  assert.equal(await withTenant(b.companyId, b.userId, (tx) => tx.kycItem.count({ where: { companyId: a.companyId } })), 0);
  assert.equal(await withUser(b.userId, (tx) => tx.kycItem.count()), 0);
  assert.equal(await withPublic((tx) => tx.kycItem.count()), 0);
  assert.equal(await kycDocument({ userId: b.userId, companyId: b.companyId, canManageCompany: true, platformAdmin: false }, cac), null);

  // The company cannot mark its own check verified, even by going round the service.
  await assert.rejects(withTenant(a.companyId, a.userId, (tx) => tx.kycItem.update({ where: { id: cac }, data: { status: "VERIFIED", reviewedById: a.userId, verifiedAt: new Date(), scope: "x" } })));
  // A reviewer cannot review what they submitted, and must record what they relied on.
  await assert.rejects(decideKyc(admin.id, cac, { decision: "verify", note: "" }), /relied on/);
  await assert.rejects(decideKyc(admin.id, cac, { decision: "needs_info", note: "" }), /at least a few words/);

  assert.equal((await companyTrust(a.companyId)).level, 0);
  await decideKyc(admin.id, cac, { decision: "verify", note: "", evidence: "CAC public search matched" });
  let t = await companyTrust(a.companyId);
  assert.equal(t.level, 1, "registration alone is not Verified");
  assert.equal(t.checks[0].scope, "CAC registration checked");
  await decideKyc(admin.id, dir, { decision: "verify", note: "", evidence: "Original ID seen on video call" });
  t = await companyTrust(a.companyId);
  assert.equal(t.level, 2);
  assert.equal(t.levelName, "Verified");
  assert.equal((await companyKyc(a)).trust.level, 2);

  // Revoking a core check drops the level at once.
  await decideKyc(admin.id, dir, { decision: "revoke", note: "The ID was reported stolen" });
  assert.equal((await companyTrust(a.companyId)).level, 1);
  const notes = await withUser(a.userId, (tx) => tx.notification.findMany({ where: { userId: a.userId, kind: "security.kyc" } }));
  assert.ok(notes.length >= 3);
});

test("agent checks: private to the agent and reviewers, not the employer", async () => {
  const a = await newCompany("kyc-ag");
  const agent = await addMember(a, "AGENT", "kycagent");
  const admin = await newPlatformAdmin();
  const outsider = await newCompany("kyc-out");
  await assert.rejects(submitAgentKyc(agent.userId, outsider.companyId, "AGENT_ID", { fullName: "Tolu", idType: "NIN", idNumber: "12345678901" }, pdf()), /registered company/);
  const id = await submitAgentKyc(agent.userId, a.companyId, "AGENT_ID", { fullName: "Tolu Ade", idType: "PASSPORT", idNumber: "A12345678" }, pdf("passport.pdf"));
  assert.equal(await withTenant(a.companyId, a.userId, (tx) => tx.kycItem.count({ where: { subjectUserId: agent.userId } })), 0, "the employer cannot read the agent's ID");
  assert.equal(await kycDocument({ userId: a.userId, companyId: a.companyId, canManageCompany: true, platformAdmin: false }, id), null);
  assert.ok(await kycDocument({ userId: agent.userId, companyId: a.companyId, canManageCompany: false, platformAdmin: false }, id));
  assert.equal((await agentKyc(agent.userId)).items.find((i) => i.req.code === "AGENT_ID")?.status, "SUBMITTED");
  await decideKyc(admin.id, id, { decision: "verify", note: "", evidence: "Passport checked against the original" });
  const t = await agentTrust(agent.userId);
  assert.equal(t.level, 2);
  // The public sees the trust result, never the check itself.
  assert.equal((await withPublic((tx) => tx.trustScore.findMany({ where: { subjectUserId: agent.userId } }))).length, 1);
});
