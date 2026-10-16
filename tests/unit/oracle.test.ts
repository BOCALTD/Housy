/**
 * Independent checks of the money arithmetic. Each rule is recomputed here by a different route (exact fractions, calendar counting,
 * brute-force enumeration), with no code shared with the product, over thousands of seeded random cases and some worked by hand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateRentSchedule, chargeState, daysOverdue, outstandingOf, applyPayment, type Frequency } from "../../src/lib/rent";
import { allocatePayment, allocateBudget, ageingBucket, signedAdjustment, checkAdjustmentFits } from "../../src/lib/ledger-rules";
import { commissionAmount, allocate, parsePercentToBps, splitProblem } from "../../src/lib/commission-rules";
import { salesComparison, incomeCapitalisation, costApproach, adjustedPerSqm, divRound, deviationBps } from "../../src/lib/valuation-rules";
import { REWARD_TRANSITIONS, REWARD_STATUSES, rewardMoveProblem } from "../../src/lib/reward-rules";
import { parseNairaToKobo, formatKobo } from "../../src/lib/money";
import { koboToPlain } from "../../src/lib/csv";

const J = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
/** A small seeded generator so a failure can be reproduced. */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const big = (r: () => number, lo: bigint, hi: bigint) => lo + BigInt(Math.floor(r() * Number(hi - lo + 1n)));

// ---------- rent schedules, by counting the calendar ----------
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (y: number, m: number) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
type YMD = [number, number, number];
const plusMonths = ([y, m, d]: YMD, n: number): YMD => { const total = y * 12 + (m - 1) + n; const ny = Math.floor(total / 12), nm = (total % 12) + 1; return [ny, nm, Math.min(d, dim(ny, nm))]; };
const cmp = (a: YMD, b: YMD) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const toDate = ([y, m, d]: YMD) => new Date(Date.UTC(y, m - 1, d));
const parts = (d: Date): YMD => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];

test("rent schedules match a calendar count for 3,000 random leases, including month ends and leap years", () => {
  const r = rng(11), freq: [Frequency, number][] = [["MONTHLY", 1], ["QUARTERLY", 3], ["HALF_YEARLY", 6], ["YEARLY", 12]];
  for (let i = 0; i < 3000; i++) {
    const start: YMD = [int(r, 2020, 2032), int(r, 1, 12), 0]; start[2] = r() < 0.4 ? dim(start[0], start[1]) : int(r, 1, dim(start[0], start[1]));
    const [f, step] = r() < 0.8 ? freq[int(r, 0, 3)] : (["CUSTOM", int(r, 1, 24)] as [Frequency, number]);
    const end = plusMonths(start, int(r, 1, 60)); end[2] = Math.min(int(r, 1, 31), dim(end[0], end[1]));
    if (cmp(end, start) <= 0) continue;
    const rent = big(r, 1n, 50_000_000_00n);
    const got = generateRentSchedule({ startDate: toDate(start), endDate: toDate(end), frequency: f, rentKobo: rent, intervalMonths: f === "CUSTOM" ? step : null });
    const want: YMD[] = [];
    for (let n = 0; cmp(plusMonths(start, n * step), end) < 0; n++) want.push(plusMonths(start, n * step));
    assert.deepEqual(got.map((c) => parts(c.dueDate)), want, `${J({ start, end, f, step })}`);
    assert.ok(got.every((c) => c.amountKobo === rent));
    assert.equal(got.reduce((s, c) => s + c.amountKobo, 0n), rent * BigInt(want.length));
    assert.deepEqual(got[0].dueDate, toDate(start), "rent is due in advance, on the start date");
  }
});

test("a rent schedule worked by hand", () => {
  // Monthly from 31 January 2024 (a leap year): month ends clamp but never drift.
  const s = generateRentSchedule({ startDate: toDate([2024, 1, 31]), endDate: toDate([2024, 6, 1]), frequency: "MONTHLY", rentKobo: 10_000_000n });
  assert.deepEqual(s.map((c) => parts(c.dueDate)), [[2024, 1, 31], [2024, 2, 29], [2024, 3, 31], [2024, 4, 30], [2024, 5, 31]]);
  // Quarterly for exactly one year from 1 January: four charges; the end date is exclusive.
  assert.equal(generateRentSchedule({ startDate: toDate([2025, 1, 1]), endDate: toDate([2026, 1, 1]), frequency: "QUARTERLY", rentKobo: 1n }).length, 4);
  assert.equal(generateRentSchedule({ startDate: toDate([2025, 1, 1]), endDate: toDate([2026, 1, 2]), frequency: "QUARTERLY", rentKobo: 1n }).length, 5);
  assert.throws(() => generateRentSchedule({ startDate: toDate([2025, 1, 1]), endDate: toDate([2025, 1, 1]), frequency: "MONTHLY", rentKobo: 1n }));
  assert.throws(() => generateRentSchedule({ startDate: toDate([2025, 1, 1]), endDate: toDate([2026, 1, 1]), frequency: "MONTHLY", rentKobo: 0n }));
  assert.throws(() => generateRentSchedule({ startDate: toDate([2025, 1, 1]), endDate: toDate([2026, 1, 1]), frequency: "CUSTOM", rentKobo: 1n }), /1 to 120/);
});

// ---------- arrears, by counting days ----------
const dayNumber = ([y, m, d]: YMD) => { let n = 0; for (let yy = 1970; yy < y; yy++) n += leap(yy) ? 366 : 365; for (let mm = 1; mm < m; mm++) n += dim(y, mm); return n + d - 1; };

test("charge states and days overdue match a day-by-day count for 5,000 random charges", () => {
  const r = rng(22);
  for (let i = 0; i < 5000; i++) {
    const due: YMD = [int(r, 2024, 2027), int(r, 1, 12), 1]; due[2] = int(r, 1, dim(due[0], due[1]));
    const today = plusMonths(due, 0); const offset = int(r, -40, 200);
    const todayN = dayNumber(due) + offset;
    const todayDate = new Date(todayN * 864e5);
    void today;
    const amount = big(r, 0n, 90_000_000n), adjusted = r() < 0.3 ? big(r, 0n, 5_000_000n) * (r() < 0.5 ? 1n : -1n) : 0n;
    const eff = amount + adjusted;
    if (eff < 0n) continue;
    const paid = r() < 0.4 ? 0n : r() < 0.5 ? eff : big(r, 0n, eff > 0n ? eff : 0n);
    const grace = int(r, 0, 15);
    const c = { amountKobo: amount, adjustedKobo: adjusted, paidKobo: paid, dueDate: toDate(due) };
    const lastGood = dayNumber(due) + grace;
    const want = eff <= 0n ? "WAIVED" : paid >= eff ? "PAID" : todayN > lastGood ? "OVERDUE" : paid > 0n ? "PART_PAID" : "DUE";
    assert.equal(chargeState(c, todayDate, grace), want, J({ due, offset, grace, eff, paid }));
    const wantOutstanding = eff - paid > 0n ? eff - paid : 0n;
    assert.equal(outstandingOf(c), wantOutstanding);
    const wantDays = wantOutstanding > 0n && todayN > lastGood ? todayN - lastGood : 0;
    assert.equal(daysOverdue(c, todayDate, grace), wantDays);
    if (wantDays > 0) { const b = ageingBucket(wantDays); assert.equal(b, wantDays <= 30 ? "1-30 days" : wantDays <= 60 ? "31-60 days" : wantDays <= 90 ? "61-90 days" : "Over 90 days"); }
  }
});

test("a payment is never allowed to exceed what is owed", () => {
  const r = rng(33);
  for (let i = 0; i < 2000; i++) {
    const amount = big(r, 1n, 10_000_000n), paid = big(r, 0n, amount), adj = big(r, 0n, 1_000_000n);
    const c = { amountKobo: amount, adjustedKobo: adj, paidKobo: paid };
    const owed = amount + adj - paid;
    const pay = big(r, 1n, owed + 5n);
    if (owed <= 0n) assert.throws(() => applyPayment(c, pay));
    else if (pay > owed) assert.throws(() => applyPayment(c, pay), /more than/);
    else assert.equal(applyPayment(c, pay), paid + pay);
  }
  // A reduction can never push what is owed below what was paid.
  assert.throws(() => checkAdjustmentFits({ amountKobo: 100n, adjustedKobo: 0n, paidKobo: 60n }, -41n));
  assert.doesNotThrow(() => checkAdjustmentFits({ amountKobo: 100n, adjustedKobo: 0n, paidKobo: 60n }, -40n));
  assert.equal(signedAdjustment("LATE_FEE", undefined, 5n), 5n);
  assert.equal(signedAdjustment("WAIVER", undefined, 5n), -5n);
  assert.equal(signedAdjustment("CORRECTION", "DECREASE", 5n), -5n);
  assert.throws(() => signedAdjustment("CORRECTION", undefined, 5n));
});

test("a payment is spread over the oldest charges first, to the kobo, for 3,000 random ledgers", () => {
  const r = rng(44);
  for (let i = 0; i < 3000; i++) {
    const n = int(r, 1, 14);
    const charges = Array.from({ length: n }, (_, k) => ({ id: `c${String(k).padStart(2, "0")}`, dueDate: new Date(Date.UTC(2025, k, 1)), outstandingKobo: r() < 0.25 ? 0n : big(r, 1n, 80_000_000n) }));
    const shuffled = [...charges].sort(() => r() - 0.5);
    const total = charges.reduce((s, c) => s + c.outstandingKobo, 0n);
    if (total === 0n) { assert.throws(() => allocatePayment(shuffled, 1n)); continue; }
    const pay = big(r, 1n, total);
    const got = allocatePayment(shuffled, pay);
    assert.equal(got.reduce((s, a) => s + a.amountKobo, 0n), pay);
    // Brute-force reference: walk the charges in date order and take as much as is owed.
    let left = pay; const want: [string, bigint][] = [];
    for (const c of charges) { if (left === 0n) break; if (c.outstandingKobo === 0n) continue; const t = left < c.outstandingKobo ? left : c.outstandingKobo; want.push([c.id, t]); left -= t; }
    assert.deepEqual(got.map((a) => [a.chargeId, a.amountKobo]), want);
    assert.ok(got.every((a) => a.amountKobo > 0n && a.amountKobo <= charges.find((c) => c.id === a.chargeId)!.outstandingKobo));
  }
  assert.throws(() => allocatePayment([{ id: "a", dueDate: new Date(), outstandingKobo: 10n }], 11n), /more than the total/);
});

// ---------- service charges, by exact fractions ----------
test("a service charge budget is shared to the kobo: each share is the exact fraction rounded down or up, and nothing is lost", () => {
  const r = rng(55);
  for (let i = 0; i < 3000; i++) {
    const n = int(r, 1, 12), budget = big(r, 1n, 900_000_000n);
    const method = (["EQUAL", "FLOOR_AREA"] as const)[int(r, 0, 1)];
    const shares = Array.from({ length: n }, (_, k) => ({ id: `L${String(k).padStart(2, "0")}`, floorAreaSqm: int(r, 5, 900) }));
    const got = allocateBudget(budget, method, shares);
    const w = shares.map((s) => (method === "EQUAL" ? 1n : BigInt(s.floorAreaSqm)));
    const W = w.reduce((a, b) => a + b, 0n);
    assert.equal(got.reduce((s, x) => s + x.amountKobo, 0n), budget, "the shares add up to the budget exactly");
    const exact = w.map((wi) => ({ floor: (budget * wi) / W, rem: (budget * wi) % W }));
    let extras = 0n;
    got.forEach((g, k) => {
      const diff = g.amountKobo - exact[k].floor;
      assert.ok(diff === 0n || diff === 1n, `share ${k} is off by ${diff}`);
      if (exact[k].rem === 0n) assert.equal(diff, 0n, "an exact share is never rounded up");
      extras += diff;
    });
    // Whoever was rounded up had a remainder at least as large as everyone who was not.
    const up = got.map((g, k) => (g.amountKobo > exact[k].floor ? exact[k].rem : -1n)).filter((x) => x >= 0n);
    const down = got.map((g, k) => (g.amountKobo === exact[k].floor && exact[k].rem > 0n ? exact[k].rem : -1n)).filter((x) => x >= 0n);
    if (up.length && down.length) assert.ok(up.reduce((a, b) => (a < b ? a : b)) >= down.reduce((a, b) => (a > b ? a : b)));
    assert.equal(extras, budget - exact.reduce((s, e) => s + e.floor, 0n));
  }
  // By hand: ₦100.00 between three equal leases is 33.34, 33.33, 33.33.
  assert.deepEqual(allocateBudget(10_000n, "EQUAL", [{ id: "a", floorAreaSqm: null }, { id: "b", floorAreaSqm: null }, { id: "c", floorAreaSqm: null }]).map((x) => x.amountKobo), [3334n, 3333n, 3333n]);
  assert.throws(() => allocateBudget(100n, "FIXED", [{ id: "a", floorAreaSqm: null, fixedKobo: 40n }, { id: "b", floorAreaSqm: null, fixedKobo: 50n }]), /exactly the budget/);
  assert.throws(() => allocateBudget(100n, "FLOOR_AREA", [{ id: "a", floorAreaSqm: null }]), /floor area/);
});

// ---------- commissions ----------
test("commission is the exact percentage rounded half-up, and a split loses and invents no kobo", () => {
  const r = rng(66);
  for (let i = 0; i < 4000; i++) {
    const price = big(r, 1n, 90_000_000_000_00n), bps = int(r, 1, 10_000);
    const got = commissionAmount({ method: "PERCENT", rateBps: bps, fixedKobo: null }, price);
    const num = price * BigInt(bps), floor = num / 10_000n, rem = num % 10_000n;
    assert.equal(got, rem >= 5_000n ? floor + 1n : floor, J({ price, bps }));
  }
  // By hand: 5% of ₦185,000,000 is ₦9,250,000; 2.5% of ₦33.33 is ₦0.83 (83.325 kobo rounds to 83).
  assert.equal(commissionAmount({ method: "PERCENT", rateBps: 500, fixedKobo: null }, 18_500_000_000n), 925_000_000n);
  assert.equal(commissionAmount({ method: "PERCENT", rateBps: 250, fixedKobo: null }, 3_333n), 83n);
  assert.equal(commissionAmount({ method: "PERCENT", rateBps: 5000, fixedKobo: null }, 1n), 1n, "a half rounds up");
  assert.equal(commissionAmount({ method: "FIXED", rateBps: null, fixedKobo: 777n }, 1n), 777n);
  assert.equal(parsePercentToBps("2.5%"), 250); assert.equal(parsePercentToBps("100"), 10_000);
  for (const bad of ["0", "100.01", "-1", "2.555", "abc", ""]) assert.throws(() => parsePercentToBps(bad), undefined, bad);

  for (let i = 0; i < 4000; i++) {
    const n = int(r, 1, 7); let left = 10_000; const bpsList: number[] = [];
    for (let k = 0; k < n - 1; k++) { const take = int(r, 1, Math.max(1, left - (n - 1 - k))); bpsList.push(take); left -= take; }
    bpsList.push(left); if (bpsList.some((b) => b < 1)) continue;
    const total = big(r, 0n, 5_000_000_000_00n);
    const got = allocate(total, bpsList);
    assert.equal(got.reduce((a, b) => a + b, 0n), total);
    got.forEach((g, k) => { const exactFloor = (total * BigInt(bpsList[k])) / 10_000n; assert.ok(g === exactFloor || g === exactFloor + 1n); });
    assert.equal(splitProblem(bpsList.map((bps, k) => ({ key: `p${k}`, bps }))), null);
  }
  assert.match(splitProblem([{ key: "a", bps: 6000 }, { key: "b", bps: 3999 }]) ?? "", /exactly 100%/);
  assert.match(splitProblem([{ key: "a", bps: 5000 }, { key: "a", bps: 5000 }]) ?? "", /only once/);
  assert.deepEqual(allocate(100n, [3333, 3333, 3334]), [33n, 33n, 34n]);
});

// ---------- valuation, by exact fractions ----------
test("income capitalisation matches the exact result within the rounding the method states, and a worked example", () => {
  // Gross rent ₦10,000,000, 10% vacancy, ₦1,000,000 costs, 8% cap rate: (9,000,000 - 1,000,000) / 0.08 = ₦100,000,000.
  assert.equal(incomeCapitalisation({ grossRentKobo: 1_000_000_000n, vacancyBps: 1000, operatingCostsKobo: 100_000_000n, capRateBps: 800 }).valueKobo, 10_000_000_000n);
  const r = rng(77);
  for (let i = 0; i < 4000; i++) {
    const gross = big(r, 100_000n, 900_000_000_00n), vac = int(r, 0, 4000), cap = int(r, 100, 5000);
    const costs = big(r, 0n, gross / 2n);
    const eff = (gross * BigInt(10_000 - vac)); // exact effective income × 10,000
    const noiX = eff - costs * 10_000n;           // exact NOI × 10,000
    if (noiX <= 0n) { assert.throws(() => incomeCapitalisation({ grossRentKobo: gross, vacancyBps: vac, operatingCostsKobo: costs, capRateBps: cap }), /not positive|Net operating/); continue; }
    const got = incomeCapitalisation({ grossRentKobo: gross, vacancyBps: vac, operatingCostsKobo: costs, capRateBps: cap }).valueKobo;
    // Exact value = noiX / cap. Income is rounded to a kobo (up to half a kobo, which the division by the cap rate magnifies to 5,000/cap) and the value is rounded too (half a kobo).
    const diff = got * BigInt(cap) - noiX, abs = diff < 0n ? -diff : diff;
    assert.ok(abs <= 5_000n + BigInt(cap) / 2n + 1n, `income value off by more than its rounding: ${J({ gross, vac, cap, costs, got })}`);
  }
});

test("the cost approach and the sales comparison match the exact result within a kobo per square metre", () => {
  // Cost: ₦500,000/m² × 200 m² = ₦100,000,000, less 20% = ₦80,000,000, plus ₦30,000,000 land = ₦110,000,000.
  assert.equal(costApproach({ landValueKobo: 3_000_000_000n, costPerSqmKobo: 50_000_000n, buildingAreaSqm100: 20_000, depreciationBps: 2000 }).valueKobo, 11_000_000_000n);
  // Sales: three comparables at ₦300,000/m², ₦320,000/m² (+5%) and ₦280,000/m² (-5%), equal weight, 100 m² subject.
  const ws = salesComparison({ subjectAreaSqm100: 10_000, comparables: [
    { priceKobo: 30_000_000n * 100n, areaSqm100: 10_000, adjustmentBps: 0, weightBps: 3333 },
    { priceKobo: 32_000_000n * 100n, areaSqm100: 10_000, adjustmentBps: 500, weightBps: 3333 },
    { priceKobo: 28_000_000n * 100n, areaSqm100: 10_000, adjustmentBps: -500, weightBps: 3334 },
  ] });
  // Adjusted per m²: 30,000,000 / 33,600,000 / 26,600,000 kobo; the weighted mean is about 30,066,..., times 100 m².
  const per = [30_000_000n, 33_600_000n, 26_600_000n], wts = [3333n, 3333n, 3334n];
  const exactPerSqmX = per.reduce((s, p, k) => s + p * wts[k], 0n); // × 10,000
  assert.ok(ws.valueKobo * 10_000n - exactPerSqmX * 100n <= 100n * 10_000n / 2n + 10_000n, "within rounding");
  const r = rng(88);
  for (let i = 0; i < 3000; i++) {
    const n = int(r, 1, 6), area = int(r, 2_000, 5_000_000);
    const cs = Array.from({ length: n }, () => ({ priceKobo: big(r, 100_000_00n, 90_000_000_000_00n), areaSqm100: int(r, 2_000, 5_000_000), adjustmentBps: int(r, -4900, 5000), weightBps: int(r, 1, 10_000) }));
    const got = salesComparison({ subjectAreaSqm100: area, comparables: cs }).valueKobo;
    // Exact: Σ w·(price·100·(10,000+adj)/(10,000·areaC)) / Σ w × area/100, as one fraction.
    let num = 0n, den = 1n; // sum of fractions over a common denominator
    let W = 0n;
    for (const c of cs) { const nC = c.priceKobo * 100n * BigInt(10_000 + c.adjustmentBps) * BigInt(c.weightBps), dC = 10_000n * BigInt(c.areaSqm100); num = num * dC + nC * den; den *= dC; W += BigInt(c.weightBps); }
    // value = num/den/W × area/100
    const exactNum = num * BigInt(area), exactDen = den * W * 100n;
    const lowest = exactNum / exactDen;
    // Each adjusted price is rounded to a kobo per m² and so is their average: at most one kobo per m² of the subject, plus one.
    const tolerance = BigInt(Math.ceil(area / 100)) + 2n;
    const diff = got > lowest ? got - lowest : lowest - got;
    assert.ok(diff <= tolerance, `sales value off by ${diff} kobo (allowed ${tolerance}): ${J({ area, cs: cs.length })}`);
  }
  for (let i = 0; i < 3000; i++) {
    const land = big(r, 0n, 90_000_000_000n), per = big(r, 1n, 900_000_000n), area = int(r, 1, 5_000_000), dep = int(r, 0, 10_000);
    const got = costApproach({ landValueKobo: land, costPerSqmKobo: per, buildingAreaSqm100: area, depreciationBps: dep }).valueKobo;
    const exactNum = per * BigInt(area) * BigInt(10_000 - dep), exactDen = 100n * 10_000n;
    const floor = land + exactNum / exactDen;
    assert.ok(got - floor >= 0n && got - floor <= 2n, `cost value off by ${got - floor}`);
  }
});

test("rounding half away from zero, the spread between methods, and the per-square-metre figure", () => {
  assert.deepEqual([divRound(5n, 2n), divRound(-5n, 2n), divRound(4n, 3n), divRound(-4n, 3n), divRound(7n, 14n), divRound(0n, 5n)], [3n, -3n, 1n, -1n, 1n, 0n]);
  assert.throws(() => divRound(1n, 0n));
  assert.equal(adjustedPerSqm({ priceKobo: 10_000n, areaSqm100: 10_000, adjustmentBps: 1000, weightBps: 1 }), 110n);
  assert.equal(deviationBps([100n, 300n], 200n), 0);
  assert.equal(deviationBps([100n, 300n], 220n), 1000);
  assert.equal(deviationBps([], 5n), 0);
});

// ---------- rewards ----------
test("a reward can only move along the allowed paths, money is never un-paid, and every state can reach an end", () => {
  const states = [...REWARD_STATUSES];
  for (const from of states) for (const to of states) {
    const allowed = REWARD_TRANSITIONS[from].includes(to);
    assert.equal(rewardMoveProblem(from, to) === null, allowed, `${from} -> ${to}`);
  }
  assert.deepEqual(REWARD_TRANSITIONS.PAID, [], "a paid reward cannot change");
  assert.deepEqual(REWARD_TRANSITIONS.CANCELLED, []);
  // Nothing can reach PAID without passing through PAYABLE (which comes only after APPROVED).
  const into = (s: string) => states.filter((f) => REWARD_TRANSITIONS[f].includes(s as never));
  assert.deepEqual(into("PAID"), ["PAYABLE"]);
  assert.deepEqual(into("PAYABLE"), ["APPROVED"]);
  assert.ok(!into("APPROVED").includes("REJECTED") && !into("APPROVED").includes("PAID"));
  // From every state, some path leads to a state with no way out (nothing is stuck in a loop with no exit).
  for (const s of states) {
    const seen = new Set<string>([s]); const q = [s]; let end = REWARD_TRANSITIONS[s as never].length === 0;
    while (q.length) { const x = q.shift()!; for (const y of REWARD_TRANSITIONS[x as never]) { if (!seen.has(y)) { seen.add(y); q.push(y); } if (REWARD_TRANSITIONS[y as never].length === 0) end = true; } }
    assert.ok(end, `${s} has no way to finish`);
  }
  // Random walks never leave the table.
  const r = rng(99);
  for (let i = 0; i < 1000; i++) { let s = "UNDER_REVIEW"; for (let k = 0; k < 30; k++) { const next = REWARD_TRANSITIONS[s as never]; if (!next.length) break; s = next[int(r, 0, next.length - 1)]; assert.ok(states.includes(s as never)); } }
});

// ---------- money text ----------
test("money text round-trips without floating point", () => {
  const r = rng(123);
  for (let i = 0; i < 3000; i++) {
    const k = big(r, 0n, 99_999_999_999_999n);
    assert.equal(parseNairaToKobo(koboToPlain(k)), k);
    assert.equal(parseNairaToKobo(formatKobo(k)), k);
  }
  assert.equal(parseNairaToKobo("₦1,234.5"), 123_450n);
  assert.equal(parseNairaToKobo("NGN 10"), 1000n);
  for (const bad of ["1.234", "-5", "1e3", "", "abc", "1,2,3.456"]) assert.throws(() => parseNairaToKobo(bad), undefined, bad);
  assert.equal(formatKobo(-12_345n), "-₦123.45");
});
