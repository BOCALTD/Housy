import { test } from "node:test";
import assert from "node:assert/strict";
import { dealSnapshot, inviteExpired, inviteExpiry, participantActive, participantCan, propertySnapshot, transitionProblem, workspaceEnded, workspaceMode } from "../../src/lib/collab-rules";

const money = (k: bigint) => `₦${(k / 100n).toString()}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

test("an invitation moves draft, pending, active or declined, and finished workspaces stay finished", () => {
  assert.equal(transitionProblem("DRAFT", "PENDING"), null);
  assert.equal(transitionProblem("PENDING", "ACTIVE"), null);
  assert.equal(transitionProblem("PENDING", "DECLINED"), null);
  assert.equal(transitionProblem("PENDING", "EXPIRED"), null);
  assert.equal(transitionProblem("ACTIVE", "SUSPENDED"), null);
  assert.equal(transitionProblem("SUSPENDED", "ACTIVE"), null);
  assert.equal(transitionProblem("ACTIVE", "COMPLETED"), null);
  assert.match(transitionProblem("DRAFT", "ACTIVE")!, /cannot become/);
  assert.match(transitionProblem("DECLINED", "ACTIVE")!, /cannot become/);
  assert.match(transitionProblem("COMPLETED", "ACTIVE")!, /cannot become/);
  assert.match(transitionProblem("ACTIVE", "ACTIVE")!, /already/);
  assert.match(transitionProblem("ACTIVE", "PENDING")!, /cannot become/);
});

test("an invitation expires on its date, and a workspace ends when its last day is over", () => {
  const sent = new Date("2026-10-01T09:00:00Z");
  const exp = inviteExpiry(sent, 14);
  assert.equal(exp.toISOString(), "2026-10-15T09:00:00.000Z");
  assert.equal(inviteExpired("PENDING", exp, new Date("2026-10-15T08:59:00Z")), false);
  assert.equal(inviteExpired("PENDING", exp, new Date("2026-10-15T09:00:00Z")), true);
  assert.equal(inviteExpired("ACTIVE", exp, new Date("2027-01-01T00:00:00Z")), false);
  const end = new Date("2026-12-31T00:00:00Z");
  assert.equal(workspaceEnded("ACTIVE", end, new Date("2026-12-31T00:00:00Z")), false);
  assert.equal(workspaceEnded("ACTIVE", end, new Date("2027-01-01T00:00:00Z")), true);
  assert.equal(workspaceEnded("ACTIVE", null, new Date("2030-01-01T00:00:00Z")), false);
});

test("a participant counts only while not revoked and not expired", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  assert.equal(participantActive({ revokedAt: null, expiresAt: null }, now), true);
  assert.equal(participantActive({ revokedAt: null, expiresAt: new Date("2026-10-16T00:00:00Z") }, now), true);
  assert.equal(participantActive({ revokedAt: null, expiresAt: new Date("2026-10-15T12:00:00Z") }, now), false);
  assert.equal(participantActive({ revokedAt: new Date("2026-10-01T00:00:00Z"), expiresAt: null }, now), false);
  const p = { canComment: true, canTasks: false, canShare: false, canDocuments: true };
  assert.deepEqual((["VIEW", "COMMENT", "TASKS", "SHARE", "DOCUMENTS"] as const).map((n) => participantCan(p, n)), [true, true, false, false, true]);
});

test("the plan decides whether a workspace can be used, only looked at, or is suspended", () => {
  assert.deepEqual(workspaceMode("ACTIVE", "FULL"), { view: true, write: true, reason: "" });
  assert.equal(workspaceMode("ACTIVE", "READ_ONLY").write, false);
  assert.equal(workspaceMode("ACTIVE", "READ_ONLY").view, true);
  assert.equal(workspaceMode("ACTIVE", "NONE").view, false);
  assert.match(workspaceMode("ACTIVE", "NONE").reason, /Nothing has been deleted/);
  assert.equal(workspaceMode("SUSPENDED", "FULL").view, false);
  assert.equal(workspaceMode("PENDING", "FULL").view, false);
  assert.deepEqual([workspaceMode("COMPLETED", "NONE").view, workspaceMode("COMPLETED", "NONE").write], [true, false]);
});

test("a deal is shared as a copy of the ticked fields only, with nothing about the client or the other deal terms", () => {
  const deal = { title: "Sale of the terrace house", type: "SALE", stage: "NEGOTIATION", askingKobo: 8_500_000_000n, agreedKobo: 8_000_000_000n, expectedCloseOn: new Date("2026-11-30T00:00:00Z") };
  const property = { name: "Ikeja terrace house", assetClass: "RESIDENTIAL", category: "House", city: "Ikeja", state: "Lagos", address: "12 Hidden Close" };
  const none = dealSnapshot(deal, property, { stage: false, asking: false, agreed: false, expectedClose: false, propertyAddress: false, note: "" }, money, day);
  assert.deepEqual(none.fields.map((f) => f.label), ["Type", "Property", "Location"]);
  const text = JSON.stringify(none);
  assert.ok(!text.includes("Hidden Close"));
  assert.ok(!text.includes("85000000"));
  const named = dealSnapshot({ ...deal, title: "Ikeja terrace house for Chinedu Client" }, property, { stage: false, asking: false, agreed: false, expectedClose: false, propertyAddress: false, note: "" }, money, day);
  assert.ok(!JSON.stringify(named).includes("Chinedu"), "the deal's own title can name the client, so it is never copied");
  const all = dealSnapshot(deal, property, { stage: true, asking: true, agreed: true, expectedClose: true, propertyAddress: true, note: "  Please keep this between us  " }, money, day);
  assert.deepEqual(all.fields.map((f) => f.label), ["Type", "Property", "Location", "Address", "Stage", "Asking price", "Expected closing", "Note from the sharer"]);
  assert.ok(!all.fields.some((f) => f.label === "Agreed price"), "no price has been agreed at the negotiation stage");
  const agreed = dealSnapshot({ ...deal, stage: "AGREED" }, property, { stage: true, asking: false, agreed: true, expectedClose: false, propertyAddress: false, note: "" }, money, day);
  assert.equal(agreed.fields.find((f) => f.label === "Agreed price")!.value, "₦80000000");
  assert.equal(all.fields.find((f) => f.label === "Note from the sharer")!.value, "Please keep this between us");
  assert.equal(dealSnapshot(deal, property, { stage: false, asking: false, agreed: false, expectedClose: false, propertyAddress: false, note: "x".repeat(900) }, money, day).fields.pop()!.value.length, 500);
});

test("a property is shared with the address and price only when ticked", () => {
  const p = { name: "Plot in Epe", assetClass: "LAND", category: "Plot", city: "Epe", state: "Lagos", address: "Plot 4 Secret Road", priceKobo: 1_200_000_000n, purpose: "SALE", bedrooms: null, bathrooms: null };
  const bare = propertySnapshot(p, { address: false, price: false, note: "" }, money);
  assert.ok(!JSON.stringify(bare).includes("Secret Road"));
  assert.ok(!bare.fields.some((f) => f.label === "Price"));
  const full = propertySnapshot(p, { address: true, price: true, note: "" }, money);
  assert.ok(full.fields.some((f) => f.label === "Address" && f.value === "Plot 4 Secret Road"));
  assert.ok(full.fields.some((f) => f.label === "Price" && f.value === "₦12000000"));
});
