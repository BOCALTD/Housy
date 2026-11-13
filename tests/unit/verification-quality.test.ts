import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPLAINT_MOVES, canMoveComplaint, complaintRef, credentialState, expiredKinds, providerKpis, type CaseRecord } from "../../src/lib/verification-quality-rules";
import { isHardReason, rankProviders, type Candidate } from "../../src/lib/verification-case-rules";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test("a credential kind is expired only when no document of that kind is current", () => {
  const today = d("2027-03-01");
  assert.deepEqual(expiredKinds([{ kind: "LICENCE", expiresOn: d("2027-01-01") }], today), ["LICENCE"]);
  assert.deepEqual(expiredKinds([{ kind: "LICENCE", expiresOn: d("2027-01-01") }, { kind: "LICENCE", expiresOn: d("2028-01-01") }], today), [], "a renewed licence counts");
  assert.deepEqual(expiredKinds([{ kind: "LICENCE", expiresOn: d("2027-03-01") }], today), [], "valid on its expiry day");
  assert.deepEqual(expiredKinds([{ kind: "CERTIFICATE", expiresOn: null }, { kind: "PROFILE", expiresOn: d("2020-01-01") }], today), [], "no expiry date, or a kind that does not expire");
  assert.equal(credentialState(d("2027-03-20"), today), "expiring");
  assert.equal(credentialState(d("2027-05-01"), today), "valid");
  assert.equal(credentialState(d("2027-02-28"), today), "expired");
  assert.equal(credentialState(null, today), "none");
});

test("an expired credential makes a provider ineligible, and no override sets it aside", () => {
  const base: Candidate = { providerId: "p", name: "P", vetted: true, active: true, allowedServices: ["TITLE"], offeredServices: ["TITLE"], allowedStates: ["Lagos"], coveredStates: ["Lagos"], conflict: false, openCases: 0, monthlyCapacity: 10, completed: 0, onTime: 0, declined: 0, offered: 0, priceKobo: null, turnaroundDays: 7 };
  const [ok] = rankProviders({ services: ["TITLE"], state: "Lagos" }, [base]);
  assert.equal(ok.eligible, true);
  const [bad] = rankProviders({ services: ["TITLE"], state: "Lagos" }, [{ ...base, expiredCredentials: 1 }]);
  assert.equal(bad.eligible, false);
  assert.ok(bad.reasons.some(isHardReason));
  assert.ok(!isHardReason("does not work in Lagos"));
});

test("complaints move only forward, and the database allows the same moves", () => {
  assert.ok(canMoveComplaint("OPEN", "INVESTIGATING"));
  assert.ok(!canMoveComplaint("UPHELD", "OPEN"));
  assert.ok(!canMoveComplaint("NOT_UPHELD", "UPHELD"));
  assert.equal(complaintRef(2027, 3), "HVC-2027-000003");
  const sql = readFileSync(new URL("../../prisma/migrations/20270102000000_verification_quality/migration.sql", import.meta.url), "utf8");
  const pairs = [...sql.matchAll(/\('([A-Z_]+)','([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  assert.deepEqual(pairs, COMPLAINT_MOVES.map(([a, b]) => `${a}>${b}`).sort());
});

test("performance indicators and flags", () => {
  const rec = (o: Partial<CaseRecord>): CaseRecord => ({ offeredAt: d("2027-01-01"), answer: "ACCEPTED", answeredAt: new Date(d("2027-01-01").getTime() + 6 * 3_600_000), acceptedAt: d("2027-01-01"), deliveredAt: d("2027-01-08"), requiredBy: d("2027-01-10"), housyCorrections: 0, disputed: false, disputeReopened: false, revoked: false, rating: 5, ...o });
  const none = providerKpis([], []);
  assert.equal(none.acceptanceRate, null);
  assert.equal(none.onTimeRate, null);
  assert.deepEqual(none.flags, []);
  const late = Array.from({ length: 5 }, (_, i) => rec({ deliveredAt: d(i < 2 ? "2027-01-08" : "2027-01-20") }));
  const k = providerKpis([...late, rec({ answer: "DECLINED", acceptedAt: null, deliveredAt: null, rating: null })], [{ status: "UPHELD" }, { status: "UPHELD" }, { status: "OPEN" }]);
  assert.equal(k.offered, 6);
  assert.equal(k.acceptanceRate, 83.3);
  assert.equal(k.onTimeRate, 40);
  assert.equal(k.medianHoursToAnswer, 6);
  assert.equal(k.medianDaysToDeliver, 19);
  assert.equal(k.complaintsUpheld, 2);
  assert.ok(k.flags.some((f) => /on time/.test(f)));
  assert.ok(k.flags.some((f) => /complaints upheld/.test(f)));
  assert.ok(!providerKpis(late.slice(0, 4), []).flags.length, "no flags on too few cases");
});
