import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReputation, inputsHash, reviewSignals, textHash, type ReputationInputs, type ReviewFact } from "../../src/lib/reputation-rules";

const base = (over: Partial<ReputationInputs> = {}): ReputationInputs => ({ asOf: "2026-10-15", reviews: [], conversations: 0, repliedWithin24h: 0, completedDeals: 0, upheldComplaints: 0, ...over });
const rv = (o: number, d: string, b: ReviewFact["b"] = "TRANSACTION", l = 80): ReviewFact => ({ o, b, d, l });

test("a newcomer with no evidence sits in the middle, not at zero or at the top", () => {
  const r = computeReputation(base());
  assert.equal(r.reviewCount, 0);
  assert.equal(r.weightedAverage, 3.5);
  assert.ok(r.score > 20 && r.score < 60);
  assert.deepEqual(r.badges, []);
});

test("one perfect review does not beat a long record of strong ones", () => {
  const one = computeReputation(base({ reviews: [rv(5, "2026-10-01")] }));
  const many = computeReputation(base({ reviews: Array.from({ length: 12 }, (_, i) => rv(i % 3 === 0 ? 4 : 5, `2026-0${(i % 9) + 1}-10`)) }));
  assert.ok(many.score > one.score);
  assert.ok(one.weightedAverage < 4.3, "a single review is pulled toward the prior");
});

test("recent evidence outweighs old; stronger proof outweighs weaker", () => {
  const old = computeReputation(base({ reviews: [rv(5, "2024-01-01"), rv(5, "2024-01-02"), rv(5, "2024-01-03"), rv(2, "2026-10-10")] }));
  const fresh = computeReputation(base({ reviews: [rv(2, "2024-01-01"), rv(2, "2024-01-02"), rv(2, "2024-01-03"), rv(5, "2026-10-10")] }));
  assert.ok(fresh.weightedAverage > old.weightedAverage);
  const strong = computeReputation(base({ reviews: [rv(5, "2026-10-01", "TRANSACTION"), rv(1, "2026-10-01", "ENQUIRY")] }));
  assert.ok(strong.weightedAverage > 3.5, "a verified transaction counts for more than an enquiry");
});

test("upheld complaints cost points and block the top badges", () => {
  const reviews = Array.from({ length: 16 }, (_, i) => rv(5, `2026-09-${String((i % 20) + 1).padStart(2, "0")}`));
  const clean = computeReputation(base({ reviews }));
  const dirty = computeReputation(base({ reviews, upheldComplaints: 2 }));
  assert.ok(clean.badges.includes("TOP_RATED") && clean.badges.includes("HIGHLY_RATED") && clean.badges.includes("TRUSTED"));
  assert.ok(!dirty.badges.includes("TOP_RATED") && !dirty.badges.includes("TRUSTED"));
  assert.equal(clean.score - dirty.score, 20);
});

test("response and experience badges follow the facts", () => {
  const r = computeReputation(base({ conversations: 12, repliedWithin24h: 11, completedDeals: 12 }));
  assert.ok(r.badges.includes("FAST_RESPONDER") && r.badges.includes("EXPERIENCED"));
  const few = computeReputation(base({ conversations: 3, repliedWithin24h: 0 }));
  assert.equal(few.components.responsiveness, 50, "too few conversations to judge, so neither rewarded nor punished");
  const rising = computeReputation(base({ reviews: [rv(5, "2026-09-20"), rv(5, "2026-10-01"), rv(4, "2026-10-05")], completedDeals: 2 }));
  assert.ok(rising.badges.includes("RISING"));
});

test("the same facts always give the same figure, whatever order they arrive in", () => {
  const a = base({ reviews: [rv(5, "2026-10-01"), rv(3, "2026-09-01", "ENQUIRY", 10), rv(4, "2026-08-01", "INSPECTION")] });
  const b = base({ reviews: [...a.reviews].reverse() });
  assert.deepEqual(computeReputation(a), computeReputation(b));
  assert.equal(inputsHash(a), inputsHash(b));
  assert.notEqual(inputsHash(a), inputsHash(base()));
});

test("manipulation signals", () => {
  const calm = { reviewerAgeHours: 500, referredByTarget: false, reviewsForTargetLast48h: 0, reviewerReviewsLast24h: 0, sameTextElsewhere: false };
  assert.deepEqual(reviewSignals(calm), []);
  assert.deepEqual(reviewSignals({ ...calm, reviewerAgeHours: 0.2, referredByTarget: true, reviewsForTargetLast48h: 3, reviewerReviewsLast24h: 3, sameTextElsewhere: true }), ["NEW_ACCOUNT", "REFERRED_BY_TARGET", "BURST", "REVIEW_SPREE", "DUPLICATE_TEXT"]);
  assert.equal(textHash("Great, service!!  Really great."), textHash("great service really great"));
  assert.equal(textHash("ok"), "", "very short text is not fingerprinted");
});
