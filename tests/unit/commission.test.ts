import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, bpsToPercent, commissionAmount, parsePercentToBps, payoutStatus, rateBps, rulesApplyTo, splitProblem } from "../../src/lib/commission-rules";

test("percentages parse to basis points and show back unchanged", () => {
  assert.equal(parsePercentToBps("5"), 500);
  assert.equal(parsePercentToBps("2.5%"), 250);
  assert.equal(parsePercentToBps(" 0.01 "), 1);
  assert.equal(parsePercentToBps("100"), 10000);
  for (const bad of ["", "abc", "0", "0.00", "100.01", "1.234", "-5", "150"]) assert.throws(() => parsePercentToBps(bad), /percentage|between/);
  assert.equal(bpsToPercent(250), "2.5");
  assert.equal(bpsToPercent(500), "5");
  assert.equal(bpsToPercent(1), "0.01");
  assert.equal(bpsToPercent(1234), "12.34");
});

test("commission is a percentage of the agreed price rounded to the nearest kobo, or a fixed sum", () => {
  assert.equal(commissionAmount({ method: "PERCENT", rateBps: 500, fixedKobo: null }, 10_000_000_000n), 500_000_000n);
  assert.equal(commissionAmount({ method: "PERCENT", rateBps: 250, fixedKobo: null }, 12_345n), 309n); // 308.625
  assert.equal(commissionAmount({ method: "PERCENT", rateBps: 1, fixedKobo: null }, 5_000n), 1n); // 0.5 rounds up
  assert.equal(commissionAmount({ method: "PERCENT", rateBps: 1, fixedKobo: null }, 4_999n), 0n);
  assert.equal(commissionAmount({ method: "FIXED", rateBps: null, fixedKobo: 7_500_000n }, 1n), 7_500_000n);
  assert.throws(() => commissionAmount({ method: "PERCENT", rateBps: null, fixedKobo: null }, 100n), /no rate/);
  assert.throws(() => commissionAmount({ method: "FIXED", rateBps: null, fixedKobo: null }, 100n), /fixed amount/);
  assert.throws(() => commissionAmount({ method: "PERCENT", rateBps: 500, fixedKobo: null }, 0n), /agreed price/);
  assert.equal(rulesApplyTo("ALL", "RENT"), true);
  assert.equal(rulesApplyTo("SALE", "RENT"), false);
});

test("splits must be whole, positive, unique and add up to exactly 100%", () => {
  assert.equal(splitProblem([{ key: "a", bps: 6000 }, { key: "b", bps: 4000 }]), null);
  assert.match(splitProblem([])!, /at least one/);
  assert.match(splitProblem([{ key: "a", bps: 6000 }, { key: "b", bps: 3000 }])!, /add up to 90%/);
  assert.match(splitProblem([{ key: "a", bps: 5000 }, { key: "a", bps: 5000 }])!, /only once/);
  assert.match(splitProblem([{ key: "a", bps: 0 }, { key: "b", bps: 10000 }])!, /between/);
  assert.match(splitProblem([{ key: "a", bps: 5000.5 }, { key: "b", bps: 5000 }])!, /between/);
});

test("allocation never loses or invents a kobo, whatever the numbers", () => {
  assert.deepEqual(allocate(100n, [3333, 3333, 3334]), [33n, 33n, 34n]);
  assert.deepEqual(allocate(100n, [5000, 5000]), [50n, 50n]);
  assert.deepEqual(allocate(1n, [5000, 5000]), [1n, 0n]);
  assert.deepEqual(allocate(0n, [7000, 3000]), [0n, 0n]);
  assert.throws(() => allocate(100n, [5000, 4000]), /100%/);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 500; n++) {
    const parts = 1 + Math.floor(rnd() * 6);
    const cuts = Array.from({ length: parts - 1 }, () => 1 + Math.floor(rnd() * 9998)).sort((a, b) => a - b);
    const bps: number[] = [];
    let last = 0;
    for (const c of [...cuts, 10000]) { bps.push(c - last); last = c; }
    if (bps.some((b) => b < 1)) continue;
    const total = BigInt(Math.floor(rnd() * 1e12));
    const out = allocate(total, bps);
    assert.equal(out.reduce((a, b) => a + b, 0n), total);
    out.forEach((v, i) => assert.ok(v >= (total * BigInt(bps[i])) / 10000n && v <= (total * BigInt(bps[i])) / 10000n + 1n));
  }
});

test("payment status follows the splits and rates are rounded to the nearest basis point", () => {
  const d = new Date();
  assert.equal(payoutStatus("SUBMITTED", [{ paidAt: null }]), "NOT_DUE");
  assert.equal(payoutStatus("APPROVED", [{ paidAt: null }, { paidAt: null }]), "UNPAID");
  assert.equal(payoutStatus("APPROVED", [{ paidAt: d }, { paidAt: null }]), "PART_PAID");
  assert.equal(payoutStatus("PAID", [{ paidAt: d }, { paidAt: d }]), "PAID");
  assert.equal(rateBps(1, 3), 3333);
  assert.equal(rateBps(2, 3), 6667);
  assert.equal(rateBps(1, 0), 0);
});
