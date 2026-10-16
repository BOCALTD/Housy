import { withPublic, withPlatformAdmin, type Tx } from "../db";
import { effectiveTier, type TierName } from "../tier-rules";

// A company's perks level. It is derived from the company's subscription and kept in company_tiers so the public pages can show the
// badge without reading anyone's subscription.

/** Bring a company's tier into line with its subscription. Called inside the transaction that changed the subscription. */
export async function syncCompanyTier(tx: Tx, companyId: string): Promise<void> {
  const sub = await tx.subscription.findFirst({ where: { ownerCompanyId: companyId }, include: { plan: { select: { tier: true } } } });
  if (!sub || sub.periodEnd.getTime() <= Date.now()) {
    await tx.companyTier.deleteMany({ where: { companyId } });
    return;
  }
  await tx.companyTier.upsert({
    where: { companyId },
    create: { companyId, tier: sub.plan.tier, validUntil: sub.periodEnd },
    update: { tier: sub.plan.tier, validUntil: sub.periodEnd },
  });
}

export async function syncTiersForPlan(tx: Tx, planId: string): Promise<void> {
  const subs = await tx.subscription.findMany({ where: { planId, ownerCompanyId: { not: null } }, select: { ownerCompanyId: true } });
  for (const s of subs) if (s.ownerCompanyId) await syncCompanyTier(tx, s.ownerCompanyId);
}

/** Tiers for several companies at once, as the public sees them. */
export async function tiersFor(companyIds: string[]): Promise<Map<string, TierName>> {
  const ids = [...new Set(companyIds)];
  if (!ids.length) return new Map();
  const rows = await withPublic((tx) => tx.companyTier.findMany({ where: { companyId: { in: ids } } }));
  const now = new Date();
  return new Map(ids.map((id) => [id, effectiveTier(rows.find((r) => r.companyId === id), now)]));
}
export async function tierOf(companyId: string): Promise<TierName> {
  return (await tiersFor([companyId])).get(companyId) ?? "BASIC";
}

/** After the clock moves past a subscription's end, stale rows are simply ignored by effectiveTier; this tidies them away. */
export async function tidyExpiredTiers(adminId: string): Promise<number> {
  return withPlatformAdmin(adminId, async (tx) => (await tx.companyTier.deleteMany({ where: { validUntil: { lte: new Date() } } })).count);
}
