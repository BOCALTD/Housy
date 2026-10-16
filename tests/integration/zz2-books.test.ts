/**
 * Phase 16e (runs after everything else): after every integration test has run against this one database, with thousands of
 * payments, refunds, adverts and rewards created along the way, the platform's books must still tell one story.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { reconcileFinance } from "../../src/lib/services/finance";
import { reconcile as reconcileRewards } from "../../src/lib/services/rewards";
import { newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());

// Findings that mean the books disagree with themselves. The others ask a person to act (a payment awaiting a decision, one that is old) and are expected.
const INTEGRITY = new Set([
  "PAID_WITHOUT_PAYMENT", "PAYMENT_NOT_IN_BOOKS", "PAYMENT_TOTAL_MISMATCH", "UNSETTLED_IN_BOOKS", "REFUND_MISMATCH", "REFUND_BOOKED_NOT_DONE",
  "CAMPAIGN_LEDGER_MISMATCH", "FUNDS_HELD_MISMATCH", "REWARDS_PAYOUT_TOTAL_MISMATCH", "REWARDS_LEDGER_DISAGREES", "REWARDS_PAYABLE_IN_DEAD_PAYOUT",
]);

test("the platform's books balance after the whole suite", async () => {
  const admin = await newPlatformAdmin();
  const fin = await reconcileFinance(admin.id);
  for (const f of fin.findings) console.log(`BOOKS finding ${f.code}: ${f.message} (${f.refs.length} refs)`);
  const broken = fin.findings.filter((f) => INTEGRITY.has(f.code));
  assert.deepEqual(broken, [], "the books disagree with themselves");
});

test("every reward's history ends where the reward says it does, and money paid out equals rewards marked paid", async () => {
  const admin = await newPlatformAdmin();
  const r = await reconcileRewards(admin.id);
  const broken = r.findings.filter((f) => ["PAID_WITHOUT_PAYMENT", "PAYOUT_TOTAL_MISMATCH", "PAYABLE_IN_DEAD_PAYOUT", "LEDGER_DISAGREES"].includes(f.code));
  assert.deepEqual(broken, []);
  assert.equal(r.paidOutKobo, r.paidRewardsKobo);
});
