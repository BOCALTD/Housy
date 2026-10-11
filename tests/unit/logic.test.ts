import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNairaToKobo, formatKobo } from "../../src/lib/money";
import { parseDateOnly, addMonthsClamped, toDateOnlyString, todayInLagos } from "../../src/lib/dates";
import { generateRentSchedule, chargeState, applyPayment } from "../../src/lib/rent";
import { can } from "../../src/lib/permissions";

const d = parseDateOnly;
const s = toDateOnlyString;

test("parses naira into kobo without floating point", () => {
  assert.equal(parseNairaToKobo("185,000,000"), 18_500_000_000n);
  assert.equal(parseNairaToKobo("₦1,500.5"), 150_050n);
  assert.equal(parseNairaToKobo("0.07"), 7n);
  assert.equal(parseNairaToKobo("NGN 2,000"), 200_000n);
  assert.throws(() => parseNairaToKobo("12.345"));
  assert.throws(() => parseNairaToKobo("-5"));
  assert.throws(() => parseNairaToKobo("abc"));
});

test("formats kobo as naira", () => {
  assert.equal(formatKobo(18_500_000_000n), "₦185,000,000");
  assert.equal(formatKobo(150_050n), "₦1,500.50");
  assert.equal(formatKobo(5n), "₦0.05");
  assert.equal(formatKobo("650000000"), "₦6,500,000");
});

test("rejects impossible dates", () => {
  assert.throws(() => d("2026-02-30"));
  assert.throws(() => d("26-1-1"));
  assert.equal(s(d("2028-02-29")), "2028-02-29");
});

test("month addition clamps to month end without drifting", () => {
  assert.equal(s(addMonthsClamped(d("2026-01-31"), 1)), "2026-02-28");
  assert.equal(s(addMonthsClamped(d("2026-01-31"), 2)), "2026-03-31");
  assert.equal(s(addMonthsClamped(d("2027-11-30"), 3)), "2028-02-29");
  assert.equal(s(addMonthsClamped(d("2026-12-15"), 1)), "2027-01-15");
});

test("yearly lease produces one charge per year, in advance", () => {
  const charges = generateRentSchedule({ startDate: d("2026-03-01"), endDate: d("2028-03-01"), frequency: "YEARLY", rentKobo: 650_000_000n });
  assert.deepEqual(charges.map((c) => s(c.dueDate)), ["2026-03-01", "2027-03-01"]);
  assert.ok(charges.every((c) => c.amountKobo === 650_000_000n));
});

test("monthly lease from the 31st keeps month-end due dates", () => {
  const charges = generateRentSchedule({ startDate: d("2026-01-31"), endDate: d("2026-05-01"), frequency: "MONTHLY", rentKobo: 100n });
  assert.deepEqual(charges.map((c) => s(c.dueDate)), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("quarterly and half-yearly schedules", () => {
  assert.equal(generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2027-01-01"), frequency: "QUARTERLY", rentKobo: 1n }).length, 4);
  assert.equal(generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2027-01-01"), frequency: "HALF_YEARLY", rentKobo: 1n }).length, 2);
  assert.equal(generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2026-01-02"), frequency: "YEARLY", rentKobo: 1n }).length, 1);
});

test("schedule rejects invalid terms", () => {
  assert.throws(() => generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2026-01-01"), frequency: "MONTHLY", rentKobo: 1n }));
  assert.throws(() => generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2027-01-01"), frequency: "MONTHLY", rentKobo: 0n }));
});

test("charge states and overdue detection", () => {
  const today = d("2026-06-15");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 100n, dueDate: d("2026-01-01") }, today), "PAID");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 40n, dueDate: d("2026-06-01") }, today), "OVERDUE");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 40n, dueDate: d("2026-07-01") }, today), "PART_PAID");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 0n, dueDate: d("2026-06-15") }, today), "DUE");
});

test("payments cannot exceed the outstanding amount", () => {
  assert.equal(applyPayment({ amountKobo: 100n, paidKobo: 40n }, 60n), 100n);
  assert.throws(() => applyPayment({ amountKobo: 100n, paidKobo: 40n }, 61n));
  assert.throws(() => applyPayment({ amountKobo: 100n, paidKobo: 100n }, 1n));
  assert.throws(() => applyPayment({ amountKobo: 100n, paidKobo: 0n }, 0n));
});

test("today is computed in West Africa Time", () => {
  // 23:30 UTC on 31 Dec is already 1 Jan in Lagos (UTC+1).
  assert.equal(s(todayInLagos(new Date("2026-12-31T23:30:00Z"))), "2027-01-01");
});

test("permission matrix keeps viewers read-only and team management with the super admin", () => {
  assert.equal(can("VIEWER", "asset.view"), true);
  assert.equal(can("VIEWER", "task.create"), false);
  assert.equal(can("OFFICER", "payment.record"), false);
  assert.equal(can("MANAGER", "team.manage"), false);
  assert.equal(can("COMPANY_SUPER_ADMIN", "team.manage"), true);
});

test("hosted deployments connect as the restricted runtime role", async () => {
  const { runtimeDatabaseUrl } = await import("../../src/lib/db-url");
  const url = runtimeDatabaseUrl("postgresql://neondb_owner:ownerpw@ep-cool-1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require", "p@ss/word");
  const u = new URL(url!);
  assert.equal(u.username, "estate_app");
  assert.equal(decodeURIComponent(u.password), "p@ss/word");
  assert.equal(u.searchParams.get("pgbouncer"), "true");
  assert.equal(u.searchParams.get("sslmode"), "require");
  assert.equal(runtimeDatabaseUrl("postgresql://a:b@localhost/db", undefined), undefined);
});
