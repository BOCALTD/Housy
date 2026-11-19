import { test } from "node:test";
import assert from "node:assert/strict";

test("value of lost or damaged items: suggested from the unit cost, and split against the deposit", async () => {
  const { suggestCharge, splitAgainstDeposit, chargeQuantity } = await import("../../src/lib/inventory-rules");
  const line = (quantity: number, condition: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "CRITICAL") => ({ room: "Kitchen", description: "Fridge", quantity, condition, itemId: "i1" });
  const missing = { room: "Kitchen", description: "Fridge", kind: "MISSING" as const, before: line(2, "GOOD"), after: null };
  const fewer = { room: "Kitchen", description: "Fridge", kind: "FEWER" as const, before: line(4, "GOOD"), after: line(3, "GOOD") };
  const worse = { room: "Kitchen", description: "Fridge", kind: "WORSE" as const, before: line(1, "EXCELLENT"), after: line(1, "CRITICAL") };
  const better = { room: "Kitchen", description: "Fridge", kind: "BETTER" as const, before: line(1, "POOR"), after: line(1, "GOOD") };
  assert.equal(chargeQuantity(missing), 2);
  assert.equal(chargeQuantity(fewer), 1);
  assert.equal(suggestCharge(missing, 1000n), 2000n);
  assert.equal(suggestCharge(fewer, 1000n), 1000n);
  assert.equal(suggestCharge(worse, 1000n), 1000n, "four steps down is the whole value, never more");
  assert.equal(suggestCharge({ ...worse, after: line(1, "FAIR") }, 1000n), 500n);
  assert.equal(suggestCharge(better, 1000n), null);
  assert.equal(suggestCharge(missing, null), null);
  assert.equal(suggestCharge(missing, 0n), null);
  assert.deepEqual(splitAgainstDeposit(500n, 1000n), { fromDeposit: 500n, owed: 0n });
  assert.deepEqual(splitAgainstDeposit(1500n, 1000n), { fromDeposit: 1000n, owed: 500n });
  assert.deepEqual(splitAgainstDeposit(500n, 0n), { fromDeposit: 0n, owed: 500n });
});
