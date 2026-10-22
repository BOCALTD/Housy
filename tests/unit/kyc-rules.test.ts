import { test } from "node:test";
import assert from "node:assert/strict";
import { REQUIREMENTS, checkIdNumber, checkPhone, checkRcNumber, checkSubmission, expiryFor, maskId, maxScore, requirementsFor, trustOf } from "../../src/lib/kyc-rules";

const now = new Date("2026-10-22T10:00:00Z");
const ok = (code: string, months = 12) => ({ code, verifiedAt: now, expiresAt: new Date(now.getTime() + months * 30 * 864e5) });

test("weights add up to 100 for each kind, and every requirement has a core-or-not flag and a scope", () => {
  assert.equal(maxScore("COMPANY"), 100);
  assert.equal(maxScore("AGENT"), 100);
  for (const r of REQUIREMENTS) { assert.ok(r.scope.length > 5); assert.ok(r.weight > 0); }
  assert.deepEqual(requirementsFor("COMPANY").filter((r) => r.core).map((r) => r.code), ["CAC_REGISTRATION", "DIRECTOR_ID"]);
  assert.deepEqual(requirementsFor("AGENT").filter((r) => r.core).map((r) => r.code), ["AGENT_ID"]);
});

test("trust level needs the core checks: many small checks never make an unidentified company Verified", () => {
  assert.equal(trustOf("COMPANY", [], now).level, 0);
  const small = trustOf("COMPANY", [ok("OFFICE_ADDRESS"), ok("COMPANY_CONTACT"), ok("TAX_ID"), ok("PROFESSIONAL_BODY")], now);
  assert.equal(small.score, 45);
  assert.equal(small.level, 1);
  const core = trustOf("COMPANY", [ok("CAC_REGISTRATION"), ok("DIRECTOR_ID")], now);
  assert.equal(core.score, 55);
  assert.equal(core.level, 2);
  assert.equal(core.levelName, "Verified");
  const most = trustOf("COMPANY", [ok("CAC_REGISTRATION"), ok("DIRECTOR_ID"), ok("OFFICE_ADDRESS")], now);
  assert.equal(most.score, 70);
  assert.equal(most.level, 2, "80% needed for the top level");
  const top = trustOf("COMPANY", [ok("CAC_REGISTRATION"), ok("DIRECTOR_ID"), ok("OFFICE_ADDRESS"), ok("COMPANY_CONTACT")], now);
  assert.equal(top.level, 3);
  const agent = trustOf("AGENT", [ok("AGENT_ID"), ok("AGENT_PHOTO")], now);
  assert.equal(agent.level, 2);
  // A company check never counts for an agent.
  assert.equal(trustOf("AGENT", [ok("CAC_REGISTRATION")], now).score, 0);
});

test("expired checks stop counting", () => {
  const old = { code: "AGENT_ID", verifiedAt: new Date("2023-01-01"), expiresAt: new Date("2025-01-01") };
  assert.equal(trustOf("AGENT", [old], now).level, 0);
  assert.equal(expiryFor("AGENT_ID", new Date("2026-01-15T00:00:00Z")).toISOString().slice(0, 10), "2028-01-15");
  assert.equal(expiryFor("AGENT_PHONE", new Date("2026-01-15T00:00:00Z"), 6).toISOString().slice(0, 10), "2026-07-15");
});

test("ID numbers, RC numbers and phones are checked; ID numbers are kept apart and masked", () => {
  assert.equal(checkIdNumber("NIN", "123 4567 8901"), null);
  assert.ok(checkIdNumber("NIN", "1234"));
  assert.equal(checkIdNumber("PASSPORT", "a12345678"), null);
  assert.ok(checkIdNumber("PASSPORT", "12345678"));
  assert.ok(checkIdNumber("SOMETHING", "x"));
  assert.equal(checkRcNumber("RC 1234567"), null);
  assert.equal(checkRcNumber("BN-123456"), null);
  assert.ok(checkRcNumber("hello"));
  assert.equal(checkPhone("0803 123 4567"), null);
  assert.equal(checkPhone("+234 803 123 4567"), null);
  assert.ok(checkPhone("12"));
  assert.equal(maskId("12345678901"), "••••••••901");
  const s = checkSubmission("AGENT_ID", { fullName: "Ada Obi", idType: "NIN", idNumber: "12345678901" });
  assert.deepEqual(s.errors, []);
  assert.equal(s.secret, "12345678901");
  assert.ok(!JSON.stringify(s.values).includes("12345678901"), "the ID number is never among the plain values");
  assert.equal(s.masked, "••••••••901");
  const bad = checkSubmission("COMPANY_CONTACT", { phone: "1", email: "nope" });
  assert.equal(bad.errors.length, 2);
  assert.ok(checkSubmission("NOPE", {}).errors.length);
});
