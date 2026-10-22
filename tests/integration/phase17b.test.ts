/**
 * Phase 17b: the versioned API. Keys belong to one company, are stored only as a fingerprint, can be revoked and expire;
 * a key only ever reads its own company's records; only a company's top administrator can make keys.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant, withApiToken } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from "../../src/lib/services/api-keys";
import { apiAssets, apiListings } from "../../src/lib/services/api-data";
import { hashApiKey } from "../../src/lib/api-rules";
import { addMember, newCompany } from "./helpers";

after(() => prisma.$disconnect());

test("API keys: made once, stored as a fingerprint, limited to one company, revocable", async () => {
  const a = await newCompany("api-a"), b = await newCompany("api-b");
  await createAsset(a, { name: "Ikoyi tower", assetClass: "RESIDENTIAL", category: "Apartment", companyRelationship: "OWNER" } as never);
  await createAsset(b, { name: "Other company's shop", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" } as never);

  const manager = await addMember(a, "MANAGER", "apim");
  await assert.rejects(createApiKey(manager, { name: "Nope", scopes: ["assets:read"], days: 30 }), /permission/);
  await assert.rejects(createApiKey(a, { name: "Too long", scopes: ["assets:read"], days: 1000 }), /at most/);

  const { id, key } = await createApiKey(a, { name: "Accounts system", scopes: ["assets:read"], days: 30 });
  const stored = await withTenant(a.companyId, a.userId, (tx) => tx.apiKey.findFirstOrThrow({ where: { id } }));
  assert.notEqual(stored.tokenHash, key);
  assert.equal(stored.tokenHash, hashApiKey(key));
  assert.ok(!JSON.stringify(stored).includes(key.slice(13)), "the secret part is never stored"); // after "hsy_XXXXXXXX_"

  // Another company cannot see the key, and a guessed key is refused.
  assert.equal((await listApiKeys(b)).length, 0);
  assert.equal(await authenticateApiKey(key.slice(0, -1) + (key.endsWith("a") ? "b" : "a")), null);
  assert.equal(await authenticateApiKey("not a key"), null);
  // Looking a key up by its fingerprint shows only that key.
  const seen = await withApiToken(hashApiKey(key), (tx) => tx.apiKey.findMany());
  assert.deepEqual(seen.map((k) => k.id), [id]);

  const caller = await authenticateApiKey(key);
  assert.ok(caller);
  assert.equal(caller!.companyId, a.companyId);
  const page = await apiAssets(caller!, 0, 25);
  assert.equal(page.total, 1);
  assert.equal(page.rows[0].name, "Ikoyi tower");

  await assert.rejects(revokeApiKey(b, id), /not found/);
  await revokeApiKey(a, id);
  assert.equal(await authenticateApiKey(key), null, "a revoked key stops working at once");

  // An expired key does not work either.
  const second = await createApiKey(a, { name: "Short", scopes: ["assets:read"], days: 1 });
  await withTenant(a.companyId, a.userId, (tx) => tx.apiKey.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
  assert.equal(await authenticateApiKey(second.key), null);
});

test("public API: only published listings, paged", async () => {
  const r = await apiListings(new URLSearchParams("page_size=5"), 0, 5, "https://example.test");
  assert.ok(r.rows.length <= 5);
  for (const l of r.rows) assert.match(l.url, /^https:\/\/example\.test\/properties\//);
});
