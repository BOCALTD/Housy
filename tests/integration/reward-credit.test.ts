/**
 * Rewards toward a plan: payable rewards come off an open plan invoice (whole rewards, oldest first, no payout threshold), are
 * recorded as a plan-credit payout so the rewards books still agree, and a balance that covers the invoice switches the plan on.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { savePlan, setPlanEntitlements, entitlementIn } from "../../src/lib/services/subscriptions";
import { createSubscriptionInvoice, startPayment, type Payer } from "../../src/lib/services/billing";
import { applyRewardCredit, pickRewards, rewardCredit } from "../../src/lib/services/reward-credit";
import { reconcile, restrictRewards } from "../../src/lib/services/rewards";
import { reconcileFinance } from "../../src/lib/services/finance";
import type { PaymentProvider } from "../../src/lib/payment-providers";
import { newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => Math.random().toString(36).slice(2, 8);
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);

async function person(): Promise<Payer & { id: string }> {
  const id = (await registerSeeker({ name: `Credit ${uid()}`, email: `rc-${uid()}@example.test`, password: PASSWORD })).userId;
  return { id, userId: id, companyId: null, role: null };
}
/** A payable reward, as the rewards engine leaves it once its safety period has passed (with its ledger entry). */
async function payable(userId: string, kobo: bigint, daysAgo = 0) {
  await sys(async (tx) => {
    const r = await tx.reward.create({ data: { ref: `RW-${uid().toUpperCase()}`, userId, programme: "REFERRAL", event: "REFERRAL_REGISTERED", amountKobo: kobo, status: "PAYABLE", sourceType: "test", sourceId: uid(), sourceLabel: "Test referral", approvedAt: new Date(), approvedById: "system", payableAt: new Date(), createdAt: new Date(Date.now() - daysAgo * 864e5) } });
    await tx.rewardLedgerEntry.create({ data: { rewardId: r.id, userId, fromStatus: "APPROVED", toStatus: "PAYABLE", amountKobo: kobo, actorName: "System", note: "Safety period passed" } });
  });
}
async function plan(admin: { id: string }, price = "10,000") {
  const p = await savePlan(admin.id, null, { code: `rc-${uid()}`, name: `Credit plan ${uid()}`, audience: "AGENT", price, billingPeriod: "MONTHLY", trialDays: 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 100, tier: "BASIC" } as never);
  await setPlanEntitlements(admin.id, p.id, [{ key: "COLLAB_SEEKER_AGENT", enabled: true, limit: 3 }]);
  return p;
}

test("whole rewards that fit are used, oldest first, and none is split", () => {
  const r = (n: number) => ({ amountKobo: BigInt(n) });
  assert.deepEqual(pickRewards([r(300), r(500), r(100)], 450n).use.map((x) => x.amountKobo), [300n, 100n]);
  assert.equal(pickRewards([r(300), r(500)], 1000n).total, 800n);
  assert.equal(pickRewards([r(900)], 500n).total, 0n);
});

test("rewards come off the invoice, the rest is left to pay, and the rewards books still agree", async () => {
  const admin = await newPlatformAdmin();
  const p = await plan(admin);
  const me = await person();
  await payable(me.id, 300_000n, 3);
  await payable(me.id, 200_000n, 2);
  assert.equal((await rewardCredit(me.id)).availableKobo, 500_000n);
  const inv = await createSubscriptionInvoice(me, p.id);
  const r = await applyRewardCredit(me, inv.id);
  assert.deepEqual(r, { usedKobo: 500_000n, leftKobo: 500_000n, paid: false });
  const after = await sys((tx) => tx.invoice.findUniqueOrThrow({ where: { id: inv.id } }));
  assert.equal(after.amountKobo, 500_000n);
  assert.equal(after.creditKobo, 500_000n);
  assert.equal(after.listAmountKobo, 1_000_000n);
  assert.equal(after.status, "OPEN");
  assert.equal((await rewardCredit(me.id)).availableKobo, 0n);
  const payout = await sys((tx) => tx.rewardPayout.findFirstOrThrow({ where: { userId: me.id } }));
  assert.equal(payout.method, "PLAN_CREDIT");
  assert.equal(payout.status, "PAID");
  assert.equal(payout.reference, inv.ref);
  const rec = await reconcile(admin.id);
  assert.deepEqual(rec.findings.filter((f) => ["PAID_WITHOUT_PAYMENT", "PAYOUT_TOTAL_MISMATCH", "LEDGER_DISAGREES"].includes(f.code)), []);
  await assert.rejects(applyRewardCredit(me, inv.id), /no rewards ready/);
});

test("a balance that covers the invoice pays it and switches the plan on, with nothing left for the books to question", async () => {
  const admin = await newPlatformAdmin();
  const p = await plan(admin, "2,000");
  const me = await person();
  await payable(me.id, 150_000n, 2);
  await payable(me.id, 50_000n, 1);
  await payable(me.id, 700_000n, 0); // too large to fit: stays payable
  const inv = await createSubscriptionInvoice(me, p.id);
  const r = await applyRewardCredit(me, inv.id);
  assert.deepEqual(r, { usedKobo: 200_000n, leftKobo: 0n, paid: true });
  const ent = await withUser(me.id, (tx) => entitlementIn(tx, { kind: "USER", userId: me.id }, "COLLAB_SEEKER_AGENT"));
  assert.equal(ent.access, "FULL");
  assert.equal((await rewardCredit(me.id)).availableKobo, 700_000n, "the larger reward is still there to use or cash out");
  const fin = await reconcileFinance(admin.id);
  assert.ok(!fin.findings.some((f) => f.code === "PAID_WITHOUT_PAYMENT" && f.refs.includes(inv.ref)));
});

test("rewards cannot be used while paused, during a card checkout, or on someone else's invoice", async () => {
  const admin = await newPlatformAdmin();
  const p = await plan(admin);
  const me = await person();
  const other = await person();
  await payable(me.id, 100_000n);
  const mine = await createSubscriptionInvoice(me, p.id);
  const theirs = await createSubscriptionInvoice(other, p.id);
  await assert.rejects(applyRewardCredit(me, theirs.id), /Invoice not found/);
  const fake: PaymentProvider = { name: "PAYSTACK", initialize: async (i) => ({ ok: true, checkoutUrl: `https://checkout.test/${i.reference}` }), verifySignature: () => true, parseEvent: () => null, verify: async () => ({ ok: true, status: "pending", amountKobo: 0n, currency: "NGN", providerTxId: "" }), refund: async () => ({ ok: false, error: "x", permanent: true }) };
  await startPayment(me, mine.id, "https://app.test/r", { provider: fake });
  await assert.rejects(applyRewardCredit(me, mine.id), /still in progress/);
  await sys((tx) => tx.payment.updateMany({ where: { invoiceId: mine.id }, data: { status: "FAILED", failureReason: "abandoned" } }));
  await restrictRewards(admin.id, me.id, "Checking unusual referrals");
  assert.equal((await rewardCredit(me.id)).paused, true);
  await assert.rejects(applyRewardCredit(me, mine.id), /paused/);
});
