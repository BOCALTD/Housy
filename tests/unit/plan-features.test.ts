import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURES, includes, missing } from "../../src/lib/plan-features";

test("a plan includes its entitlements, the perks of its tier and everything every plan has", () => {
  const free = { tier: "BASIC", entitlements: [] };
  const silver = { tier: "SILVER", entitlements: [{ key: "CONTACT_DETAILS", limit: null }, { key: "COLLAB_COMPANY", limit: 10 }] };
  const top = { tier: "GOLD", entitlements: ["CONTACT_DETAILS", "COLLAB_COMPANY", "BULK_MESSAGING", "ADVERTISING"].map((key) => ({ key, limit: null })) };
  const f = (id: string) => FEATURES.COMPANY.find((x) => x.id === id)!;
  assert.equal(includes(free, f("workspace")).yes, true);
  assert.equal(includes(free, f("contact")).yes, false);
  assert.deepEqual(includes(silver, f("collab")), { yes: true, limit: 10 });
  assert.equal(includes(silver, f("promos")).yes, true);
  assert.equal(includes(silver, f("gold")).yes, false);
  assert.deepEqual(missing("COMPANY", top), []);
  assert.deepEqual(missing("COMPANY", free).map((x) => x.id), ["contact", "collab", "bulk", "ads", "promos", "gold", "boost"]);
});
