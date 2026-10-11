import { withTenant } from "../db";
import { todayInLagos } from "../dates";
import { assertCan, type Ctx } from "./context";

export async function dashboard(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  const today = todayInLagos();
  const in90 = new Date(today.getTime() + 90 * 864e5);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const where = { companyId: ctx.companyId };
    const [byStatus, openTasks, overdueTasks, overdueCharges, expiring, recent, enquiries] = await Promise.all([
      tx.asset.groupBy({ by: ["status"], where, _count: { _all: true } }),
      tx.task.count({ where: { ...where, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      tx.task.count({ where: { ...where, status: { in: ["OPEN", "IN_PROGRESS"] }, dueOn: { lt: today } } }),
      tx.$queryRaw<{ n: bigint; outstanding: bigint | null }[]>`
        SELECT count(*)::bigint AS n, sum(amount_kobo - paid_kobo)::bigint AS outstanding
        FROM rent_charges WHERE company_id = ${ctx.companyId} AND due_date < ${today} AND paid_kobo < amount_kobo`,
      tx.lease.findMany({
        where: { ...where, status: "ACTIVE", endDate: { gte: today, lte: in90 } },
        include: { asset: { select: { id: true, name: true, ref: true } } },
        orderBy: { endDate: "asc" }, take: 10,
      }),
      tx.activityLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 12 }),
      tx.enquiry.count({ where: { ...where, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } } }),
    ]);
    const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const totalAssets = byStatus.reduce((sum, s) => sum + s._count._all, 0);
    return {
      totalAssets,
      statusCounts,
      openTasks,
      overdueTasks,
      overdueCharges: Number(overdueCharges[0]?.n ?? 0n),
      overdueKobo: overdueCharges[0]?.outstanding ?? 0n,
      expiring,
      recent,
      enquiries30d: enquiries,
    };
  });
}
