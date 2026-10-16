/**
 * Phase 16c: the rent ledger checked against an independent model. A random run of payments, reversals, late fees, waivers and
 * refused requests is applied to a real lease and, at the same time, to a small model written separately here. After every step the
 * database and the model must agree to the kobo, and the ledger's own consistency check must find nothing.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease, getLease, recordLeasePayment } from "../../src/lib/services/leases";
import { decideAdjustment, requestAdjustment, reverseReceipt, verifyLedger } from "../../src/lib/services/ledger";
import { koboToPlain } from "../../src/lib/csv";
import { addMember, newCompany } from "./helpers";

after(() => prisma.$disconnect());

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

interface Model { amount: bigint; adjusted: bigint; paid: bigint }
interface ModelReceipt { id: string; kobo: bigint; parts: [number, bigint][]; reversed: boolean }

let reversedTotal = 0;
for (const seed of [1, 2, 3]) {
  test(`random run ${seed}: payments, reversals and adjustments agree with the independent model at every step`, async () => {
    const admin = await newCompany(`model${seed}`);
    const manager = await addMember(admin, "MANAGER", "approver");
    const asset = await createAsset(admin, { name: `Model block ${seed}`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
    const created = await createLease(admin, asset.id, { occupantName: "Model Tenant Ltd", startDate: "2025-01-31", endDate: "2026-01-31", rent: "150,000.50", frequency: "MONTHLY" });
    const lease = (await getLease(admin, created.id))!.lease;
    assert.equal(lease.charges.length, 12);
    const order = lease.charges.map((c) => c.id); // due-date order
    const m: Model[] = lease.charges.map((c) => ({ amount: c.amountKobo, adjusted: 0n, paid: 0n }));
    const receipts: ModelReceipt[] = [];
    const r = rng(seed * 1009);
    let evidence = 0;

    const owed = (i: number) => m[i].amount + m[i].adjusted - m[i].paid;
    const compare = async (step: string) => {
      const now = (await getLease(admin, created.id))!.lease;
      const byId = new Map(now.charges.map((c) => [c.id, c]));
      order.forEach((id, i) => {
        assert.equal(byId.get(id)!.paidKobo, m[i].paid, `${step}: paid on charge ${i}`);
        assert.equal(byId.get(id)!.adjustedKobo, m[i].adjusted, `${step}: adjusted on charge ${i}`);
        assert.equal(byId.get(id)!.amountKobo, m[i].amount, `${step}: amount on charge ${i}`);
      });
      const problems = await verifyLedger(admin);
      assert.deepEqual(problems, [], `${step}: the ledger's own check found problems`);
      // Money in, minus money reversed, equals money applied.
      const live = receipts.filter((x) => !x.reversed).reduce((s, x) => s + x.kobo, 0n);
      assert.equal(m.reduce((s, c) => s + c.paid, 0n), live, `${step}: paid in total`);
      const stored = now.receipts.filter((x) => !x.reversal).reduce((s, x) => s + x.amountKobo, 0n);
      assert.equal(stored, live, `${step}: unreversed receipts`);
    };

    for (let step = 1; step <= 45; step++) {
      const roll = r();
      const label = `run ${seed} step ${step}`;
      if (roll < 0.5) {
        const totalOwed = m.reduce((s, _, i) => s + (owed(i) > 0n ? owed(i) : 0n), 0n);
        if (totalOwed === 0n) continue;
        // Pay a random amount: sometimes a round sum, sometimes exactly what is owed, sometimes one kobo.
        const kind = r();
        let kobo = kind < 0.15 ? 1n : kind < 0.3 ? totalOwed : BigInt(int(r, 1, Number(totalOwed > 40_000_000n ? 40_000_000n : totalOwed)));
        if (kobo > totalOwed) kobo = totalOwed;
        const rc = await recordLeasePayment(admin, created.id, { amount: koboToPlain(kobo), paidOn: "2025-02-01", evidence: `MODEL-${seed}-${++evidence}-${Math.random().toString(36).slice(2, 8)}`, method: "Bank transfer", payerName: "Model Tenant" });
        // The model: oldest charge first.
        let left = kobo; const parts: [number, bigint][] = [];
        for (let i = 0; i < m.length && left > 0n; i++) { const o = owed(i); if (o <= 0n) continue; const t = left < o ? left : o; m[i].paid += t; parts.push([i, t]); left -= t; }
        assert.equal(left, 0n);
        receipts.push({ id: rc.id, kobo, parts, reversed: false });
        // The receipt's recorded allocations are the model's.
        const rec = (await getLease(admin, created.id))!.lease.receipts.find((x) => x.id === rc.id)!;
        assert.deepEqual(rec.allocations.map((a) => [order.indexOf(a.chargeId), a.amountKobo]).sort((a, b) => (a[0] as number) - (b[0] as number)), parts, `${label}: allocations`);
      } else if (roll < 0.62) {
        const live = receipts.filter((x) => !x.reversed);
        if (!live.length) continue;
        const pick = live[int(r, 0, live.length - 1)];
        // A reversal could leave an approved reduction below what is paid; the ledger allows it because paid only goes down.
        await reverseReceipt(admin, pick.id, "Recorded against the wrong tenant");
        for (const [i, k] of pick.parts) m[i].paid -= k;
        pick.reversed = true;
        await assert.rejects(reverseReceipt(admin, pick.id, "Second reversal attempt"), /already been reversed/);
      } else if (roll < 0.8) {
        const i = int(r, 0, m.length - 1), fee = BigInt(int(r, 100, 5_000_000));
        const adj = await requestAdjustment(admin, order[i], { kind: "LATE_FEE", amount: koboToPlain(fee), reason: "Late payment fee under clause 7" });
        await assert.rejects(decideAdjustment(admin, adj.id, "approve"), /someone other than the person who requested/);
        await compare(`${label} (pending fee changes nothing)`);
        if (r() < 0.8) { await decideAdjustment(manager, adj.id, "approve"); m[i].adjusted += fee; }
        else { await decideAdjustment(manager, adj.id, "reject", "Not allowed by the lease"); }
        await assert.rejects(decideAdjustment(manager, adj.id, "approve"), /already been decided/);
      } else {
        const i = int(r, 0, m.length - 1), room = m[i].amount + m[i].adjusted - m[i].paid;
        if (room <= 0n) { await assert.rejects(requestAdjustment(admin, order[i], { kind: "WAIVER", amount: "1.00", reason: "Waiver on a paid charge" }), /more than the amount still unpaid/); continue; }
        // A waiver beyond what is unpaid is refused; one within it is applied.
        await assert.rejects(requestAdjustment(admin, order[i], { kind: "WAIVER", amount: koboToPlain(room + 1n), reason: "Waiver bigger than unpaid" }), /more than the amount still unpaid/);
        const w = BigInt(int(r, 1, Number(room > 3_000_000n ? 3_000_000n : room)));
        const adj = await requestAdjustment(admin, order[i], { kind: "WAIVER", amount: koboToPlain(w), reason: "Goodwill waiver agreed by the landlord" });
        await decideAdjustment(manager, adj.id, "approve");
        m[i].adjusted -= w;
      }
      await compare(label);
    }
    // The run did real work.
    assert.ok(receipts.length >= 5, `run ${seed}: ${receipts.length} receipts`);
    reversedTotal += receipts.filter((x) => x.reversed).length;
  });
}

test("the random runs between them reversed some receipts", () => { assert.ok(reversedTotal > 0, "no run reversed a receipt, so reversals were never exercised"); });

test("many payments at the same moment never over-apply a charge or lose a kobo", async () => {
  const admin = await newCompany("race");
  const asset = await createAsset(admin, { name: "Race block", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  const created = await createLease(admin, asset.id, { occupantName: "Race Tenant", startDate: "2025-01-01", endDate: "2025-04-01", rent: "100,000", frequency: "MONTHLY" });
  // Three charges of ₦100,000 = ₦300,000. Fifteen payers each try ₦30,000 at once: ten fit, five are refused.
  const attempts = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => recordLeasePayment(admin, created.id, { amount: "30,000", paidOn: "2025-02-01", evidence: `RACE-${i}-${Math.random().toString(36).slice(2, 8)}` })));
  const ok = attempts.filter((a) => a.status === "fulfilled").length;
  assert.equal(ok, 10);
  for (const a of attempts) if (a.status === "rejected") assert.match(String(a.reason), /more than the total outstanding|already fully paid|Nothing is outstanding/);
  const l = (await getLease(admin, created.id))!.lease;
  assert.equal(l.charges.reduce((s, c) => s + c.paidKobo, 0n), 30_000_000n);
  assert.ok(l.charges.every((c) => c.paidKobo <= c.amountKobo));
  assert.deepEqual(await verifyLedger(admin), []);
  // The same reference arriving twice at once is recorded once.
  const ref = `SAME-${Math.random().toString(36).slice(2, 8)}`;
  const l2 = await createLease(admin, (await createAsset(admin, { name: "Race block 2", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" })).id, { occupantName: "Dup Tenant", startDate: "2025-01-01", endDate: "2026-01-01", rent: "100,000", frequency: "MONTHLY" });
  const dup = await Promise.allSettled(Array.from({ length: 6 }, () => recordLeasePayment(admin, l2.id, { amount: "1,000", paidOn: "2025-02-01", evidence: ref })));
  assert.equal(dup.filter((d) => d.status === "fulfilled").length, 1);
  assert.equal((await getLease(admin, l2.id))!.lease.receipts.length, 1);
});
