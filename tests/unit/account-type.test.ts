import { test } from "node:test";
import assert from "node:assert/strict";
import { accountTypeOf, cleanCac, isFreeMail, landingFor, normalisePhone, signInRefusal } from "../../src/lib/account-type-rules";

test("each tab signs in only the accounts it is for; personal is always open", () => {
  const staff = [{ role: "MANAGER", businessType: "" }], solo = [{ role: "COMPANY_SUPER_ADMIN", businessType: "INDEPENDENT_AGENT" }], invited = [{ role: "AGENT", businessType: "AGENCY" }];
  assert.equal(signInRefusal("company", staff), null);
  assert.equal(signInRefusal("agent", solo), null);
  assert.equal(signInRefusal("agent", invited), null);
  assert.match(signInRefusal("company", solo)!, /agent account. Choose Agent/);
  assert.match(signInRefusal("agent", staff)!, /company account. Choose Company/);
  assert.match(signInRefusal("company", [])!, /no company account/);
  for (const m of [staff, solo, invited, []]) assert.equal(signInRefusal("personal", m), null);
  assert.equal(landingFor("personal", false), "/me");
  assert.equal(landingFor("company", false), "/app");
  assert.equal(accountTypeOf("hacker"), "personal");
});

test("company email, phone and CAC number", () => {
  assert.ok(isFreeMail("ada@Gmail.com"));
  assert.ok(!isFreeMail("ada@alphaestates.ng"));
  assert.equal(normalisePhone("0803 123 4567"), "+2348031234567");
  assert.equal(normalisePhone("+234 (803) 123-4567"), "+2348031234567");
  assert.equal(normalisePhone("12345"), null);
  assert.equal(normalisePhone("+447700900123"), "+447700900123");
  assert.equal(cleanCac("rc1234567"), "RC 1234567");
  assert.equal(cleanCac("RC: 123456"), "RC 123456");
  assert.equal(cleanCac("bn 998877"), "BN 998877");
  assert.equal(cleanCac(""), "");
  assert.equal(cleanCac("hello"), null);
});
