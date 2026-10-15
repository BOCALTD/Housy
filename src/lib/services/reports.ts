import { withTenant } from "../db";
import { todayInLagos } from "../dates";
import { ageingBucket, AGEING_BUCKETS, type AgeingBucket } from "../ledger-rules";
import { lastOnTimeDay } from "../rent";
import { assertCan, type Ctx } from "./context";

// Rent dashboard and property / portfolio reports (master prompt Section 13.3).
// "Billed" is rent charged for charges falling due in the period (with approved adjustments).
// "Collected" is money received in the period on receipts that have not been reversed.
// "Arrears" is what is overdue today, after each lease's grace period.

export interface PropertyRentRow {
  assetId: string;
  assetRef: string;
  assetName: string;
  billedKobo: bigint;
  collectedKobo: bigint;
  arrearsKobo: bigint;
  activeLeases: number;
}

export interface RentReport {
  from: Date;
  to: Date;
  today: Date;
  rows: PropertyRentRow[];
  totals: { billedKobo: bigint; collectedKobo: bigint; arrearsKobo: bigint; activeLeases: number };
  ageing: { bucket: AgeingBucket; kobo: bigint; charges: number }[];
  expiries: { leaseId: string; ref: string; occupant: string; assetRef: string; assetName: string; endDate: Date; days: number }[];
  leadDays: number;
}

export async function rentReport(ctx: Ctx, range: { from: Date; to: Date }): Promise<RentReport> {
  assertCan(ctx, "finance.view");
  if (range.to < range.from) throw new Error("The end date must not be before the start date");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { reminderLeadDays: true } });
    const assets = await tx.asset.findMany({
      where: { companyId: ctx.companyId, leases: { some: {} } }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" },
    });
    const rows = new Map<string, PropertyRentRow>(assets.map((a) => [a.id, {
      assetId: a.id, assetRef: a.ref, assetName: a.name, billedKobo: 0n, collectedKobo: 0n, arrearsKobo: 0n, activeLeases: 0,
    }]));

    const billed = await tx.$queryRaw<{ asset_id: string; total: bigint }[]>`
      SELECT l.asset_id, sum(c.amount_kobo + c.adjusted_kobo)::bigint AS total
      FROM rent_charges c JOIN leases l ON l.id = c.lease_id
      WHERE c.company_id = ${ctx.companyId} AND c.due_date >= ${range.from} AND c.due_date <= ${range.to}
      GROUP BY l.asset_id`;
    for (const b of billed) { const r = rows.get(b.asset_id); if (r) r.billedKobo = b.total; }

    const collected = await tx.$queryRaw<{ asset_id: string; total: bigint }[]>`
      SELECT l.asset_id, sum(r.amount_kobo)::bigint AS total
      FROM receipts r JOIN leases l ON l.id = r.lease_id
      LEFT JOIN receipt_reversals v ON v.receipt_id = r.id
      WHERE r.company_id = ${ctx.companyId} AND v.id IS NULL AND r.paid_on >= ${range.from} AND r.paid_on <= ${range.to}
      GROUP BY l.asset_id`;
    for (const c of collected) { const r = rows.get(c.asset_id); if (r) r.collectedKobo = c.total; }

    const open = await tx.$queryRaw<{ asset_id: string; due_date: Date; grace_days: number; owed: bigint }[]>`
      SELECT l.asset_id, c.due_date, l.grace_days, (c.amount_kobo + c.adjusted_kobo - c.paid_kobo)::bigint AS owed
      FROM rent_charges c JOIN leases l ON l.id = c.lease_id
      WHERE c.company_id = ${ctx.companyId} AND c.paid_kobo < c.amount_kobo + c.adjusted_kobo AND c.due_date <= ${today}`;
    const ageing = new Map<AgeingBucket, { kobo: bigint; charges: number }>(AGEING_BUCKETS.map((b) => [b, { kobo: 0n, charges: 0 }]));
    for (const o of open) {
      const late = Math.floor((today.getTime() - lastOnTimeDay(o.due_date, o.grace_days).getTime()) / 864e5);
      if (late <= 0) continue;
      const r = rows.get(o.asset_id);
      if (r) r.arrearsKobo += o.owed;
      const bucket = ageing.get(ageingBucket(late))!;
      bucket.kobo += o.owed;
      bucket.charges += 1;
    }

    const active = await tx.lease.groupBy({ by: ["assetId"], where: { companyId: ctx.companyId, status: "ACTIVE" }, _count: { _all: true } });
    for (const a of active) { const r = rows.get(a.assetId); if (r) r.activeLeases = a._count._all; }

    const horizon = new Date(today.getTime() + company.reminderLeadDays * 864e5);
    const expiring = await tx.lease.findMany({
      where: { companyId: ctx.companyId, status: "ACTIVE", endDate: { gte: today, lte: horizon }, renewedTo: { is: null } },
      include: { asset: { select: { ref: true, name: true } } }, orderBy: { endDate: "asc" },
    });

    const list = Array.from(rows.values());
    return {
      from: range.from, to: range.to, today, rows: list,
      totals: list.reduce((t, r) => ({
        billedKobo: t.billedKobo + r.billedKobo, collectedKobo: t.collectedKobo + r.collectedKobo,
        arrearsKobo: t.arrearsKobo + r.arrearsKobo, activeLeases: t.activeLeases + r.activeLeases,
      }), { billedKobo: 0n, collectedKobo: 0n, arrearsKobo: 0n, activeLeases: 0 }),
      ageing: AGEING_BUCKETS.map((bucket) => ({ bucket, ...ageing.get(bucket)! })),
      expiries: expiring.map((l) => ({
        leaseId: l.id, ref: l.ref, occupant: l.occupantName, assetRef: l.asset.ref, assetName: l.asset.name, endDate: l.endDate,
        days: Math.round((l.endDate.getTime() - today.getTime()) / 864e5),
      })),
      leadDays: company.reminderLeadDays,
    };
  });
}
