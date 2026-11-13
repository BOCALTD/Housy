import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canMoveEarning, EARNING_MOVES, maskAccount, payableFrom, payoutDetailsProblem, payoutRef, splitPrice } from "../../src/lib/verification-finance-rules";

test("the fee and the provider's share always add up to the price", () => {
  assert.deepEqual(splitPrice(20_000_000n), { feeKobo: 3_000_000n, netKobo: 17_000_000n });
  assert.deepEqual(splitPrice(333n, 1500), { feeKobo: 50n, netKobo: 283n });
  assert.deepEqual(splitPrice(10n, 1500), { feeKobo: 2n, netKobo: 8n }, "1.5 kobo rounds up");
  for (const p of [1n, 7n, 99_999n, 123_456_789n]) { const s = splitPrice(p); assert.equal(s.feeKobo + s.netKobo, p); }
  assert.deepEqual(splitPrice(5_000n, 0), { feeKobo: 0n, netKobo: 5_000n });
  assert.throws(() => splitPrice(0n));
  assert.throws(() => splitPrice(100n, 10_001));
});

test("earnings move only forward; paid and cancelled are final", () => {
  assert.ok(canMoveEarning("PENDING", "PAYABLE"));
  assert.ok(canMoveEarning("PAYABLE", "HELD"));
  assert.ok(canMoveEarning("IN_PAYOUT", "PAYABLE"), "a cancelled payout returns its earnings");
  assert.ok(!canMoveEarning("PAID", "PAYABLE"));
  assert.ok(!canMoveEarning("VOID", "PENDING"));
  assert.ok(!canMoveEarning("PENDING", "PAID"), "nothing is paid without going through a payout");
  assert.ok(!canMoveEarning("PAYABLE", "VOID"), "once it is the provider's money it is not cancelled by a refund");
});

test("the database trigger allows exactly the moves in the rules", () => {
  const sql = readFileSync(new URL("../../prisma/migrations/20270101000000_verification_finance/migration.sql", import.meta.url), "utf8");
  const pairs = [...sql.matchAll(/\('([A-Z_]+)','([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  assert.deepEqual(pairs, EARNING_MOVES.map(([a, b]) => `${a}>${b}`).sort());
});

test("payout details, references and waiting time", () => {
  assert.equal(payoutDetailsProblem({ bankName: "GTBank", accountName: "Acme Verification Ltd", accountNumber: "0123456789" }), null);
  assert.match(payoutDetailsProblem({ bankName: "GTBank", accountName: "Acme", accountNumber: "12345" })!, /10-digit/);
  assert.match(payoutDetailsProblem({ bankName: "", accountName: "Acme", accountNumber: "0123456789" })!, /bank/);
  assert.equal(maskAccount("0123456789"), "•••••• 6789");
  assert.equal(payoutRef(2027, 12), "HVO-2027-000012");
  assert.equal(payableFrom(new Date("2027-01-01T00:00:00Z")).toISOString(), "2027-01-08T00:00:00.000Z");
});
