import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AWARD_CONFIG as C, configProblem, monthEnded, monthKey, monthLabel, monthRange, rankAgents, windowOver, type AgentMonthFacts } from "../../src/lib/award-rules";

const f = (id: string, sales: number, posts: number, ratings: number[], since = "2025-01-01"): AgentMonthFacts => ({ userId: id, displayName: id, companyName: "Co", since, sales, posts, ratings });
const R3 = [5, 5, 5];

test("ranking is deterministic whatever order the facts arrive in", () => {
  const facts = [f("a", 3, 10, R3), f("b", 5, 4, [4, 4, 5]), f("c", 2, 12, [5, 4, 5]), f("d", 1, 1, [3, 3, 3])];
  const one = rankAgents(facts, C), two = rankAgents([...facts].reverse(), C);
  assert.deepEqual(one, two);
  assert.deepEqual(one.map((r) => r.plaque), ["GOLD", "DIAMOND", "SILVER", null]);
  assert.deepEqual(one.map((r) => r.rank), [1, 2, 3, 4]);
});

test("a huge raw count does not overwhelm the other measures", () => {
  const r = rankAgents([f("flood", 1, 500, [3, 3, 3]), f("rounded", 4, 20, [5, 5, 5, 5, 5])], C);
  assert.equal(r[0].userId, "rounded", "500 posts cannot beat strong sales and ratings");
});

test("agents under the thresholds are listed but not ranked, with the reason", () => {
  const r = rankAgents([f("ok", 2, 3, R3), f("few", 2, 3, [5, 5]), f("nosale", 0, 9, R3)], C);
  assert.equal(r.filter((x) => x.rank).length, 1);
  assert.match(r.find((x) => x.userId === "few")!.reason, /at least 3 reviews/);
  assert.match(r.find((x) => x.userId === "nosale")!.reason, /verified sale/);
  assert.ok(r.filter((x) => !x.eligible).every((x) => x.plaque === null && x.rank === null));
});

test("ties break by sales, then rating, then reviews, then who joined first", () => {
  const same = rankAgents([f("z", 2, 2, R3, "2024-01-01"), f("y", 2, 2, R3, "2023-01-01")], C);
  assert.deepEqual(same.map((r) => r.userId), ["y", "z"], "the earlier member comes first when everything else is equal");
  const bySales = rankAgents([f("p", 2, 4, R3), f("q", 4, 2, R3)], { ...C, weights: { sales: 25, posts: 50, rating: 25 } });
  assert.ok(bySales[0].score >= bySales[1].score);
});

test("weights are configurable and must add up", () => {
  assert.equal(configProblem(C), null);
  assert.match(configProblem({ ...C, weights: { sales: 50, posts: 50, rating: 50 } })!, /add up to 100/);
  assert.match(configProblem({ ...C, minReviews: -1 })!, /Minimum reviews/);
  const sales = rankAgents([f("s", 9, 1, R3), f("r", 1, 9, R3)], { ...C, weights: { sales: 100, posts: 0, rating: 0 } });
  assert.equal(sales[0].userId, "s");
});

test("months are Lagos months and can be ranked only when finished", () => {
  const { start, end } = monthRange("2026-09");
  assert.equal(start.toISOString(), "2026-08-31T23:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-30T23:00:00.000Z");
  assert.equal(monthKey(new Date("2026-09-30T23:30:00Z")), "2026-10");
  assert.equal(monthLabel("2026-09"), "September 2026");
  assert.equal(monthEnded("2026-09", new Date("2026-09-30T22:59:00Z")), false);
  assert.equal(monthEnded("2026-09", new Date("2026-09-30T23:00:00Z")), true);
  assert.throws(() => monthRange("2026-13"), /like 2026-09/);
  assert.equal(windowOver(new Date("2026-10-01T00:00:00Z"), 7, new Date("2026-10-07T23:59:00Z")), false);
  assert.equal(windowOver(new Date("2026-10-01T00:00:00Z"), 7, new Date("2026-10-08T00:00:00Z")), true);
});
