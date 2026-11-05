import { test } from "node:test";
import assert from "node:assert/strict";
import { CALLING_CODES, dialCode, flag, toE164 } from "../../src/lib/phone-rules";
import { COUNTRY_NAMES } from "../../src/lib/countries";
import { namesOverlap, normalisePhone as crmPhone } from "../../src/lib/crm-rules";
import { normalisePhone } from "../../src/lib/account-type-rules";

test("every country with a phone system has its calling code", () => {
  const missing = Object.keys(COUNTRY_NAMES).filter((c) => !CALLING_CODES[c] && !["BV", "HM", "TF", "UM"].includes(c));
  assert.deepEqual(missing, []);
  assert.equal(dialCode("ng"), "234");
  assert.equal(dialCode("CA"), "1");
  assert.equal(flag("GH"), "🇬🇭");
});

test("the same number typed many ways becomes one international number", () => {
  const cases: [string, string, string | null][] = [
    ["0803 123 4567", "NG", "+2348031234567"], ["+234 (803) 123-4567", "NG", "+2348031234567"], ["8031234567", "NG", "+2348031234567"],
    ["2348031234567", "NG", "+2348031234567"], ["002348031234567", "GB", "+2348031234567"], ["12345", "NG", null],
    ["024 123 4567", "GH", "+233241234567"], ["233241234567", "GH", "+233241234567"], ["0712 345678", "KE", "+254712345678"],
    ["07700 900123", "GB", "+447700900123"], ["+447700900123", "NG", "+447700900123"], ["(415) 555-0100", "US", "+14155550100"],
    ["1 415 555 0100", "US", "+14155550100"], ["011 234 803 123 4567", "US", "+2348031234567"], ["06 12 34 56 78", "FR", "+33612345678"],
    ["06 30 123 4567", "HU", "+36301234567"], ["8 912 345 67 89", "RU", "+79123456789"], ["06 1234 5678", "IT", "+390612345678"],
    ["050 123 4567", "AE", "+971501234567"], ["082 123 4567", "ZA", "+27821234567"], ["", "NG", null], ["+999 1234 5678", "NG", null],
    ["+1 555 01", "US", null], ["0803 123 4567", "ZZ", null],
  ];
  for (const [raw, c, want] of cases) assert.equal(toE164(raw, c), want, `${raw} in ${c}`);
});

test("sign-up and client records use the country", () => {
  assert.equal(normalisePhone("0803 123 4567"), "+2348031234567");
  assert.equal(normalisePhone("024 123 4567", "GH"), "+233241234567");
  assert.equal(normalisePhone("12345"), null);
  assert.equal(crmPhone("0803 123 4567"), "2348031234567");
  assert.equal(crmPhone("024 123 4567", "GH"), "233241234567");
  assert.equal(crmPhone("+233 24 123 4567"), "233241234567");
});

test("a phone match also needs the names to agree", () => {
  assert.equal(namesOverlap("Ngozi Okafor", "Mrs. NGOZI A. Okafor"), true);
  assert.equal(namesOverlap("Ngozi Okafor", "Okafor"), true);
  assert.equal(namesOverlap("Ngozi Okafor", "Tunde Bakare"), false);
  assert.equal(namesOverlap("Ade", "Ade"), true);
  assert.equal(namesOverlap("", "Tunde"), false);
});
