import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRecord, progress, resolveConflicts, type FieldRecord } from "../../src/lib/field-merge";

const rec = (o: Partial<FieldRecord> = {}): FieldRecord => ({
  conductedOn: "", conditionRating: "", summary: "", recommendedActions: "", location: "", participants: "", technicalNotes: "",
  responses: { a: { result: "PENDING", note: "" }, b: { result: "PENDING", note: "" } }, ...o,
});

test("changes made only on the device are applied", () => {
  const base = rec(), mine = rec({ summary: "Roof sound", responses: { a: { result: "PASS", note: "" }, b: { result: "FAIL", note: "Leak" } } });
  const r = mergeRecord(base, mine, rec());
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.applied, 3);
  assert.equal(r.merged.summary, "Roof sound");
  assert.deepEqual(r.merged.responses.b, { result: "FAIL", note: "Leak" });
});

test("changes made only in the office stay, and the same change in both is not a conflict", () => {
  const base = rec(), office = rec({ location: "Block A", summary: "Roof sound" });
  const r = mergeRecord(base, rec({ summary: "Roof sound" }), office);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.merged.location, "Block A");
  assert.equal(r.applied, 0);
});

test("different changes in both keep the office value and ask the inspector", () => {
  const base = rec();
  const office = rec({ conditionRating: "GOOD", responses: { a: { result: "PASS", note: "" }, b: { result: "PENDING", note: "" } } });
  const mine = rec({ conditionRating: "POOR", responses: { a: { result: "FAIL", note: "Cracked" }, b: { result: "PASS", note: "" } } });
  const r = mergeRecord(base, mine, office, { a: "Walls" });
  assert.equal(r.merged.conditionRating, "GOOD");
  assert.equal(r.merged.responses.a.result, "PASS");
  assert.equal(r.merged.responses.b.result, "PASS", "the other item still applies");
  assert.deepEqual(r.conflicts.map((c) => c.key), ["conditionRating", "item:a"]);
  assert.equal(r.conflicts[1].label, "Walls");
  assert.equal(r.conflicts[1].mine, "Fail: Cracked");

  const chosen = resolveConflicts(r.merged, mine, ["item:a"]);
  assert.equal(chosen.responses.a.result, "FAIL");
  assert.equal(chosen.conditionRating, "GOOD");
  // Sent again with the office copy as the base, the chosen value applies cleanly.
  const again = mergeRecord(r.merged, chosen, r.merged);
  assert.equal(again.conflicts.length, 0);
  assert.equal(again.merged.responses.a.note, "Cracked");
});

test("items the office removed are ignored and progress counts answered items", () => {
  const r = mergeRecord(rec(), rec({ responses: { a: { result: "PASS", note: "" }, b: { result: "PENDING", note: "" }, zz: { result: "FAIL", note: "" } } }), rec());
  assert.ok(!("zz" in r.merged.responses));
  assert.deepEqual(progress(r.merged), { done: 1, total: 2, failed: 0 });
});

import { sameOriginRequest } from "../../src/lib/security";
test("only the site's own pages may send field records", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.equal(sameOriginRequest(h({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(sameOriginRequest(h({ "sec-fetch-site": "cross-site", origin: "https://housy.ng", host: "housy.ng" })), false);
  assert.equal(sameOriginRequest(h({ origin: "https://housy.ng", host: "housy.ng" })), true);
  assert.equal(sameOriginRequest(h({ origin: "https://evil.example", host: "housy.ng" })), false);
  assert.equal(sameOriginRequest(h({ host: "housy.ng" })), false);
});
