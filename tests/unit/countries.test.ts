import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRY_GROUPS, COUNTRY_NAMES, countryName } from "../../src/lib/countries";

test("every country is offered, named properly, Nigeria first", () => {
  const codes = Object.keys(COUNTRY_NAMES);
  assert.ok(codes.length >= 249, `${codes.length} countries`);
  assert.equal(codes[0], "NG");
  assert.equal(countryName("NG"), "Nigeria");
  assert.equal(countryName("JP"), "Japan");
  assert.equal(countryName("BR"), "Brazil");
  assert.equal(COUNTRY_GROUPS.popular.length + COUNTRY_GROUPS.all.length, codes.length);
  const names = COUNTRY_GROUPS.all.map(([, n]) => n);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "the rest A to Z");
});
