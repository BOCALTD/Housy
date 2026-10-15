import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateReasons, leadTransitionProblem, matchScore, normaliseEmail, normaliseName, normalisePhone, qualificationProblem, qualificationScore } from "../../src/lib/crm-rules";

test("phone numbers are compared in one form", () => {
  assert.equal(normalisePhone("0803 123 4567"), "2348031234567");
  assert.equal(normalisePhone("+234 803 123 4567"), "2348031234567");
  assert.equal(normalisePhone("8031234567"), "2348031234567");
  assert.equal(normalisePhone("(0803)-123-4567"), "2348031234567");
  assert.equal(normalisePhone("abc"), "");
  assert.equal(normaliseEmail("  Ada@Example.COM "), "ada@example.com");
  assert.equal(normaliseName("Chief Ada Obi, Ltd"), "ada obi");
});

test("duplicates are found by email, phone or name, and different people are not matched", () => {
  const a = { name: "Ada Obi", emailNorm: "ada@example.com", phoneNorm: "2348031234567", city: "Lagos" };
  assert.deepEqual(duplicateReasons(a, { ...a, name: "Someone Else", phoneNorm: "", emailNorm: "ada@example.com" }), ["same email address"]);
  assert.deepEqual(duplicateReasons(a, { name: "Different", emailNorm: "", phoneNorm: "2348031234567", city: "Abuja" }), ["same phone number"]);
  assert.deepEqual(duplicateReasons(a, { name: "Mrs Ada Obi", emailNorm: "", phoneNorm: "", city: "lagos" }), ["same name"]);
  assert.deepEqual(duplicateReasons(a, { name: "Ada Obi", emailNorm: "", phoneNorm: "", city: "Abuja" }), []);
  assert.deepEqual(duplicateReasons(a, { name: "Bola Ade", emailNorm: "b@example.com", phoneNorm: "2348099999999", city: "Lagos" }), []);
  assert.deepEqual(duplicateReasons({ name: "A", emailNorm: "", phoneNorm: "", city: "" }, { name: "A", emailNorm: "", phoneNorm: "", city: "" }), []);
});

test("qualification needs budget, timeline and contact, and the score reflects what is known", () => {
  const base = { budgetMaxKobo: 5_000_000_000n, timeline: "IMMEDIATE", financing: "CASH", decisionMaker: true, hasContact: true };
  assert.equal(qualificationProblem(base), null);
  assert.equal(qualificationScore(base), 100);
  assert.match(qualificationProblem({ ...base, budgetMaxKobo: null }) ?? "", /budget/);
  assert.match(qualificationProblem({ ...base, timeline: "UNKNOWN" }) ?? "", /when the client wants to move/);
  assert.match(qualificationProblem({ ...base, hasContact: false }) ?? "", /phone number or email/);
  assert.equal(qualificationScore({ budgetMaxKobo: null, timeline: "UNKNOWN", financing: "UNKNOWN", decisionMaker: false, hasContact: false }), 0);
  assert.equal(qualificationScore({ ...base, timeline: "WITHIN_6_MONTHS", financing: "MORTGAGE_PENDING", decisionMaker: false }), 25 + 10 + 10 + 10);
});

test("lead stages move forward, or to lost, and a converted lead is final", () => {
  assert.equal(leadTransitionProblem("NEW", "CONTACTED"), null);
  assert.equal(leadTransitionProblem("CONTACTED", "QUALIFIED"), null);
  assert.equal(leadTransitionProblem("QUALIFIED", "CONVERTED"), null);
  assert.equal(leadTransitionProblem("LOST", "CONTACTED"), null);
  assert.match(leadTransitionProblem("NEW", "CONVERTED") ?? "", /cannot move/);
  assert.match(leadTransitionProblem("CONVERTED", "LOST") ?? "", /cannot move/);
  assert.match(leadTransitionProblem("NEW", "NEW") ?? "", /already/);
});

test("listings match a stated need by purpose, budget, bedrooms and place", () => {
  const need = { purpose: "RENT", city: "Lagos", state: "Lagos", assetClass: "RESIDENTIAL", bedroomsMin: 3, budgetMinKobo: null, budgetMaxKobo: 500_000_000n };
  const good = { purpose: "RENT", city: "Lagos", state: "Lagos", priceKobo: 450_000_000n, bedrooms: 3, assetClass: "RESIDENTIAL" };
  const m = matchScore(need, good)!;
  assert.equal(m.score, 100);
  assert.ok(m.reasons.includes("same city"));
  assert.equal(matchScore(need, { ...good, purpose: "SALE" }), null);
  assert.equal(matchScore(need, { ...good, priceKobo: 500_000_001n }), null);
  assert.equal(matchScore(need, { ...good, bedrooms: 2 }), null);
  assert.equal(matchScore(need, { ...good, bedrooms: null }), null);
  assert.equal(matchScore(need, { ...good, city: "Ikeja" })!.score, 30 + 15 + 15 + 15);
  assert.equal(matchScore(need, { ...good, city: "Abuja", state: "FCT" }), null);
  assert.equal(matchScore({ ...need, budgetMinKobo: 460_000_000n }, good), null);
  assert.equal(matchScore({ ...need, city: "", state: "", bedroomsMin: null, assetClass: "" }, { ...good, city: "Abuja" })!.score, 30);
});
