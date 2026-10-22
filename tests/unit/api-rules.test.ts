import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerFrom, formatApiKey, hashApiKey, hasScope, keyUsable, money, pagedEnvelope, pagingFrom, parseApiKey, parseScopes } from "../../src/lib/api-rules";

test("a key is recognised only in its exact shape, and only from the Authorization header", () => {
  const k = formatApiKey("ABCD1234", "x".repeat(43));
  assert.equal(parseApiKey(k)?.prefix, "ABCD1234");
  for (const bad of ["", "hsy_short_x", "abc", `${k}!`, k.replace("hsy", "key")]) assert.equal(parseApiKey(bad), null, bad);
  assert.equal(parseApiKey(null), null);
  assert.equal(bearerFrom(`Bearer ${k}`), k);
  assert.equal(bearerFrom(`bearer ${k}`), k);
  assert.equal(bearerFrom(k), null);
  assert.equal(bearerFrom("Basic abc"), null);
  assert.equal(hashApiKey(k), hashApiKey(` ${k} `));
  assert.notEqual(hashApiKey(k), hashApiKey(k + "a"));
});

test("scopes are limited to the ones that exist", () => {
  assert.deepEqual(parseScopes("assets:read,admin:all,"), ["assets:read"]);
  assert.ok(hasScope("assets:read", "assets:read"));
  assert.ok(!hasScope("", "assets:read"));
});

test("a revoked or expired key never works", () => {
  const now = new Date("2026-10-18T10:00:00Z");
  assert.equal(keyUsable({ revokedAt: null, expiresAt: null }, now), "ok");
  assert.equal(keyUsable({ revokedAt: now, expiresAt: null }, now), "revoked");
  assert.equal(keyUsable({ revokedAt: null, expiresAt: now }, now), "expired");
  assert.equal(keyUsable({ revokedAt: null, expiresAt: new Date(now.getTime() + 1) }, now), "ok");
});

test("paging is bounded and falls back on nonsense", () => {
  assert.deepEqual(pagingFrom(new URLSearchParams("")), { page: 1, pageSize: 25, skip: 0 });
  assert.deepEqual(pagingFrom(new URLSearchParams("page=3&page_size=10")), { page: 3, pageSize: 10, skip: 20 });
  assert.equal(pagingFrom(new URLSearchParams("page_size=100000")).pageSize, 100);
  assert.equal(pagingFrom(new URLSearchParams("page=-4&page_size=abc")).page, 1);
  const e = pagedEnvelope([1, 2], 5, 2, 2, "/api/v1/x", new URLSearchParams("city=Lagos&page=2"));
  assert.equal(e.meta.pages, 3);
  assert.equal(e.links?.next, "/api/v1/x?city=Lagos&page=3");
  assert.equal(e.links?.prev, "/api/v1/x?city=Lagos&page=1");
  assert.equal(pagedEnvelope([], 0, 1, 25, "/p", new URLSearchParams()).links?.next, null);
});

test("money is sent as whole kobo", () => {
  assert.deepEqual(money(5_000_000_000n), { amount_kobo: "5000000000", currency: "NGN" });
  assert.equal(money(null), null);
});
