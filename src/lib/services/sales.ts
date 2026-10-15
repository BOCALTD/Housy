import { withTenant } from "../db";
import { todayInLagos } from "../dates";
import { DEAL_STAGES } from "../deal-rules";
import { rateBps } from "../commission-rules";
import { can } from "../permissions";
import { assertCan, type Ctx } from "./context";
import { visibleOwners } from "./crm";
import { dealVisibleWhere } from "./deal";

// Agent, team and branch dashboards, and company reports on conversion, pipeline and completed deals (master prompt Phase 8).
// A dashboard shows only what the person may already see: an agent their own work, a team lead their team's, a manager everything.

export interface Figures {
  openLeads: number;
  qualifiedLeads: number;
  convertedLeads: number;
  lostLeads: number;
  openDeals: number;
  completedDeals: number;
  cancelledDeals: number;
  pipelineKobo: bigint; // asking (or agreed) value of deals still in progress
  completedKobo: bigint; // agreed value of completed deals
  commissionApprovedKobo: bigint; // shares approved or paid
  commissionPaidKobo: bigint;
}

const zero = (): Figures => ({ openLeads: 0, qualifiedLeads: 0, convertedLeads: 0, lostLeads: 0, openDeals: 0, completedDeals: 0, cancelledDeals: 0, pipelineKobo: 0n, completedKobo: 0n, commissionApprovedKobo: 0n, commissionPaidKobo: 0n });
const add = (a: Figures, b: Figures): Figures => ({
  openLeads: a.openLeads + b.openLeads, qualifiedLeads: a.qualifiedLeads + b.qualifiedLeads, convertedLeads: a.convertedLeads + b.convertedLeads, lostLeads: a.lostLeads + b.lostLeads,
  openDeals: a.openDeals + b.openDeals, completedDeals: a.completedDeals + b.completedDeals, cancelledDeals: a.cancelledDeals + b.cancelledDeals,
  pipelineKobo: a.pipelineKobo + b.pipelineKobo, completedKobo: a.completedKobo + b.completedKobo,
  commissionApprovedKobo: a.commissionApprovedKobo + b.commissionApprovedKobo, commissionPaidKobo: a.commissionPaidKobo + b.commissionPaidKobo,
});

export async function salesDashboard(ctx: Ctx) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const all = owners === null;
    const ownerFilter = all ? {} : { ownerId: { in: owners } };
    const [members, teams, branches, leads, deals, splits] = await Promise.all([
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"] }, ...(all ? {} : { id: { in: owners } }) }, include: { user: { select: { name: true } } } }),
      tx.team.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } }),
      tx.branch.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } }),
      tx.lead.groupBy({ by: ["ownerId", "status"], where: { companyId: ctx.companyId, ...ownerFilter, client: { is: { archivedAt: null } } }, _count: { _all: true } }),
      tx.deal.findMany({ where: { companyId: ctx.companyId, AND: [dealVisibleWhere(ctx, owners)] }, select: { ownerId: true, status: true, stage: true, askingKobo: true, agreedKobo: true } }),
      tx.commissionSplit.findMany({
        where: { companyId: ctx.companyId, ...(all ? {} : { membershipId: { in: owners } }), commission: { is: { status: { in: ["APPROVED", "PAID"] } } } },
        select: { membershipId: true, amountKobo: true, paidAt: true },
      }),
    ]);
    const by = new Map<string, Figures>();
    const get = (id: string) => { let f = by.get(id); if (!f) { f = zero(); by.set(id, f); } return f; };
    for (const l of leads) {
      const f = get(l.ownerId);
      if (["NEW", "CONTACTED"].includes(l.status)) f.openLeads += l._count._all;
      else if (l.status === "QUALIFIED") { f.openLeads += l._count._all; f.qualifiedLeads += l._count._all; }
      else if (l.status === "CONVERTED") f.convertedLeads += l._count._all;
      else if (l.status === "LOST") f.lostLeads += l._count._all;
    }
    for (const d of deals) {
      const f = get(d.ownerId);
      if (d.stage === "COMPLETED") { f.completedDeals += 1; f.completedKobo += d.agreedKobo ?? 0n; }
      else if (d.status === "CANCELLED") f.cancelledDeals += 1;
      else { f.openDeals += 1; f.pipelineKobo += d.agreedKobo ?? d.askingKobo; }
    }
    for (const s of splits) {
      const f = get(s.membershipId);
      f.commissionApprovedKobo += s.amountKobo;
      if (s.paidAt) f.commissionPaidKobo += s.amountKobo;
    }
    const rows = members.map((m) => ({ id: m.id, name: m.user.name, role: m.role, teamId: m.teamId, branchId: m.branchId, f: get(m.id) }));
    const total = rows.reduce((n, r) => add(n, r.f), zero());
    const sum = (list: typeof rows) => list.reduce((n, r) => add(n, r.f), zero());
    const teamRows = teams.map((t) => ({ id: t.id, name: t.name, people: rows.filter((r) => r.teamId === t.id).length, f: sum(rows.filter((r) => r.teamId === t.id)) })).filter((t) => t.people > 0);
    const branchRows = all ? branches.map((b) => ({ id: b.id, name: b.name, people: rows.filter((r) => r.branchId === b.id).length, f: sum(rows.filter((r) => r.branchId === b.id)) })).filter((b) => b.people > 0) : [];
    return {
      me: get(ctx.membershipId), agents: rows.sort((a, b) => Number(b.f.completedKobo - a.f.completedKobo) || a.name.localeCompare(b.name)), teams: teamRows, branches: branchRows, total, scope: all ? "company" : owners.length > 1 ? "team" : "self",
      conversionBps: rateBps(total.convertedLeads, total.convertedLeads + total.lostLeads + total.openLeads),
    };
  });
}

export interface ReportInput { from: Date; to: Date }

/** Company reporting on conversion, pipeline and completed deals. Managers only. */
export async function companyReport(ctx: Ctx, input: ReportInput) {
  assertCan(ctx, "crm.report");
  if (input.to.getTime() < input.from.getTime()) throw new Error("The end date is before the start date");
  const end = new Date(input.to.getTime() + 864e5);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [leads, sources, deals, completed, cancelled, commissions, members] = await Promise.all([
      tx.lead.findMany({ where: { companyId: ctx.companyId, createdAt: { gte: input.from, lt: end } }, select: { status: true, sourceId: true } }),
      tx.leadSource.findMany({ where: { companyId: ctx.companyId } }),
      tx.deal.findMany({ where: { companyId: ctx.companyId, status: { in: ["OPEN", "ON_HOLD", "DISPUTED"] }, stage: { not: "COMPLETED" } }, select: { stage: true, status: true, askingKobo: true, agreedKobo: true } }),
      tx.deal.findMany({
        where: { companyId: ctx.companyId, stage: "COMPLETED", completedAt: { gte: input.from, lt: end } }, orderBy: { completedAt: "desc" },
        include: { client: { select: { ref: true, name: true } }, asset: { select: { ref: true, name: true } }, commission: { select: { totalKobo: true, status: true } } },
      }),
      tx.deal.findMany({ where: { companyId: ctx.companyId, status: "CANCELLED", cancelledAt: { gte: input.from, lt: end } }, select: { cancelReason: true, stage: true } }),
      tx.dealCommission.findMany({ where: { companyId: ctx.companyId, deal: { is: { completedAt: { gte: input.from, lt: end } } } }, select: { status: true, totalKobo: true } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } }),
    ]);
    const names = Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>;
    const sourceName = new Map(sources.map((s) => [s.id, s.name]));
    const qualified = leads.filter((l) => ["QUALIFIED", "CONVERTED"].includes(l.status)).length;
    const converted = leads.filter((l) => l.status === "CONVERTED").length;
    const bySource = new Map<string, { name: string; leads: number; qualified: number; converted: number }>();
    for (const l of leads) {
      const key = l.sourceId ?? "none";
      const row = bySource.get(key) ?? { name: l.sourceId ? sourceName.get(l.sourceId) ?? "Unknown" : "No source", leads: 0, qualified: 0, converted: 0 };
      row.leads += 1;
      if (["QUALIFIED", "CONVERTED"].includes(l.status)) row.qualified += 1;
      if (l.status === "CONVERTED") row.converted += 1;
      bySource.set(key, row);
    }
    const pipeline = DEAL_STAGES.filter((s) => s !== "COMPLETED").map((stage) => {
      const rows = deals.filter((d) => d.stage === stage);
      return { stage, count: rows.length, disputed: rows.filter((d) => d.status === "DISPUTED").length, valueKobo: rows.reduce((n, d) => n + (d.agreedKobo ?? d.askingKobo), 0n) };
    });
    const reasons = new Map<string, number>();
    for (const c of cancelled) reasons.set(c.cancelReason, (reasons.get(c.cancelReason) ?? 0) + 1);
    const sumCom = (st: string[]) => commissions.filter((c) => st.includes(c.status)).reduce((n, c) => n + c.totalKobo, 0n);
    return {
      period: input,
      leads: { total: leads.length, qualified, converted, lost: leads.filter((l) => l.status === "LOST").length, qualifiedBps: rateBps(qualified, leads.length), convertedBps: rateBps(converted, leads.length) },
      bySource: [...bySource.values()].sort((a, b) => b.leads - a.leads).map((s) => ({ ...s, convertedBps: rateBps(s.converted, s.leads) })),
      pipeline,
      pipelineTotals: { count: deals.length, valueKobo: pipeline.reduce((n, p) => n + p.valueKobo, 0n) },
      completed: completed.map((d) => ({ id: d.id, ref: d.ref, title: d.title, type: d.type, client: `${d.client.ref} ${d.client.name}`, asset: `${d.asset.ref} ${d.asset.name}`, owner: names[d.ownerId] ?? "unknown", agreedKobo: d.agreedKobo ?? 0n, completedAt: d.completedAt!, commissionKobo: d.commission?.totalKobo ?? null, commissionStatus: d.commission?.status ?? null })),
      completedTotals: { count: completed.length, valueKobo: completed.reduce((n, d) => n + (d.agreedKobo ?? 0n), 0n) },
      cancelled: { count: cancelled.length, reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) },
      commission: { proposedKobo: sumCom(["SUBMITTED"]), approvedKobo: sumCom(["APPROVED"]), paidKobo: sumCom(["PAID"]) },
      canSeeAll: can(ctx.role, "crm.report"),
      today: todayInLagos(),
    };
  });
}
