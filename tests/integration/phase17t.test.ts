/**
 * Phase 17t: three kinds of account. An agent who works alone gets an agent workspace and profile; a company signs up with
 * its own email (or says it has no domain); each sign-in tab admits only the accounts it is for.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "../../src/lib/db";
import { membershipKinds, registerAgent, registerCompany } from "../../src/lib/services/companies";
import { registerSeeker } from "../../src/lib/services/community";
import { signInRefusal } from "../../src/lib/account-type-rules";

after(() => prisma.$disconnect());
const u = () => randomUUID().slice(0, 8);
const PW = "a long enough password";

test("an independent agent gets a workspace, a profile and the agent tab", async () => {
  const email = `agent-${u()}@example.test`;
  await assert.rejects(registerAgent({ name: "Kemi Bello", email, password: PW, phone: "" }), /phone number/);
  await assert.rejects(registerAgent({ name: "Kemi Bello", email, password: PW, phone: "123" }), /valid phone/);
  const r = await registerAgent({ name: "Kemi Bello", email, password: PW, phone: "0803 123 4567", tradingName: "Bello Homes" });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(user.phone, "+2348031234567");
  const row = await withTenant(r.companyId, r.userId, async (tx) => ({
    company: await tx.company.findUniqueOrThrow({ where: { id: r.companyId } }),
    profile: await tx.agentProfile.findFirstOrThrow({ where: { companyId: r.companyId } }),
  }));
  assert.equal(row.company.businessType, "INDEPENDENT_AGENT");
  assert.equal(row.company.name, "Bello Homes");
  assert.equal(row.profile.displayName, "Kemi Bello");
  assert.equal(row.profile.listed, false, "not in the directory until the agent finishes the profile");
  const kinds = await membershipKinds(r.userId);
  assert.equal(signInRefusal("agent", kinds), null);
  assert.match(signInRefusal("company", kinds)!, /Choose Agent/);
  assert.equal(signInRefusal("personal", kinds), null);
});

test("a company signs up with its own email unless it says it has no domain", async () => {
  const base = { companyName: `Acme Realty ${u()}`, name: "Ada Obi", password: PW, businessType: "AGENCY" as const };
  await assert.rejects(registerCompany({ ...base, email: `ada${u()}@gmail.com` }), /company email address/);
  await assert.rejects(registerCompany({ ...base, email: `ada${u()}@acme.test`, cacNumber: "nonsense" }), /CAC number/);
  const ok = await registerCompany({ ...base, email: `ada${u()}@acme.test`, cacNumber: "rc 1234567", contactPhone: "08031234567" });
  const c = await withTenant(ok.companyId, ok.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ok.companyId } }));
  assert.equal(c.businessType, "AGENCY");
  assert.equal(c.cacNumber, "RC 1234567");
  assert.equal(c.contactPhone, "+2348031234567");
  const freeMail = await registerCompany({ ...base, companyName: `Small Co ${u()}`, email: `small${u()}@gmail.com`, noCompanyDomain: true });
  const kinds = await membershipKinds(freeMail.userId);
  assert.equal(signInRefusal("company", kinds), null);
  assert.match(signInRefusal("agent", kinds)!, /Choose Company/);

  const seeker = await registerSeeker({ name: "Tolu Ade", email: `tolu${u()}@example.test`, password: PW, phone: "" });
  const none = await membershipKinds(seeker.userId);
  assert.match(signInRefusal("company", none)!, /no company account/);
  assert.equal(signInRefusal("personal", none), null);
});
