import { withTenant } from "../db";
import { todayInLagos } from "../dates";
import { can } from "../permissions";
import { overallPercent } from "../project-rules";
import type { Ctx } from "./context";

/**
 * Figures for a company's own dashboard. Every number is counted from the company's records by the platform, never estimated by
 * an assistant. Each panel is returned only to roles allowed to see that kind of information; the rest come back as null.
 */

const OPEN_WORK = ["REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED"] as const;
const day = 864e5;

export interface Analytics {
  generatedOn: Date;
  occupancy: null | { leasable: number; occupied: number; vacant: number; renovating: number; ratePct: number | null; byCity: { city: string; occupied: number; vacant: number }[]; leasesEnding: { in30: number; in60: number; in90: number } };
  arrears: null | { totalKobo: bigint; charges: number; buckets: { label: string; charges: number; kobo: bigint }[]; top: { asset: string; kobo: bigint }[] };
  maintenance: null | { open: number; overdue: number; urgent: number; completed90: number; avgDaysToComplete: number | null; cost90Kobo: bigint; byStatus: { status: string; n: number }[] };
  values: null | { costKobo: bigint; valuedKobo: bigint; valuedAssets: number; assetsWithoutValuation: number; assetsWithoutCost: number };
  projects: null | { active: number; rows: { id: string; ref: string; title: string; percent: number; plannedEnd: Date; late: boolean }[] };
  compliance: null | { overdue: number; in30: number; in60: number; in90: number; documentsExpiring90: number; next: { id: string; title: string; dueDate: Date; overdue: boolean }[] };
}

export async function companyAnalytics(ctx: Ctx, now = new Date()): Promise<Analytics | null> {
  const r = ctx.role;
  if (!can(r, "asset.view")) return null;
  const today = todayInLagos(now);
  const plus = (d: number) => new Date(today.getTime() + d * day);
  const c = ctx.companyId;
  return withTenant(c, ctx.userId, async (tx) => {
    const out: Analytics = { generatedOn: now, occupancy: null, arrears: null, maintenance: null, values: null, projects: null, compliance: null };

    const assets = await tx.asset.findMany({ where: { companyId: c, status: { notIn: ["DISPOSED", "ARCHIVED"] } }, select: { id: true, status: true, city: true, acquisitionCostKobo: true }, take: 20000 });
    {
      const n = (s: string) => assets.filter((a) => a.status === s).length;
      const occupied = n("OCCUPIED"), vacant = n("VACANT");
      const cities = new Map<string, { occupied: number; vacant: number }>();
      for (const a of assets) if (a.status === "OCCUPIED" || a.status === "VACANT") {
        const k = a.city.trim() || "Not stated";
        const x = cities.get(k) ?? { occupied: 0, vacant: 0 };
        if (a.status === "OCCUPIED") x.occupied += 1; else x.vacant += 1;
        cities.set(k, x);
      }
      const ends = (d: number) => tx.lease.count({ where: { companyId: c, status: "ACTIVE", endDate: { gte: today, lte: plus(d) } } });
      const [e30, e60, e90] = await Promise.all([ends(30), ends(60), ends(90)]);
      out.occupancy = {
        leasable: occupied + vacant, occupied, vacant, renovating: n("UNDER_RENOVATION"),
        ratePct: occupied + vacant === 0 ? null : Math.round((occupied / (occupied + vacant)) * 100),
        byCity: [...cities].map(([city, v]) => ({ city, ...v })).sort((a, b) => b.occupied + b.vacant - (a.occupied + a.vacant)).slice(0, 8),
        leasesEnding: { in30: e30, in60: e60, in90: e90 },
      };
    }

    if (can(r, "payment.record")) {
      const rows = await tx.$queryRaw<{ b: string; n: bigint; kobo: bigint }[]>`
        SELECT CASE WHEN d <= 30 THEN '1' WHEN d <= 60 THEN '2' WHEN d <= 90 THEN '3' ELSE '4' END AS b, count(*)::bigint AS n, sum(o)::bigint AS kobo
        FROM (SELECT (${today}::date - (ch.due_date + l.grace_days)) AS d, (ch.amount_kobo + ch.adjusted_kobo - ch.paid_kobo) AS o
              FROM rent_charges ch JOIN leases l ON l.id = ch.lease_id
              WHERE ch.company_id = ${c} AND (ch.due_date + l.grace_days) < ${today} AND ch.paid_kobo < ch.amount_kobo + ch.adjusted_kobo) x
        GROUP BY 1`;
      const top = await tx.$queryRaw<{ asset: string; kobo: bigint }[]>`
        SELECT a.name AS asset, sum(ch.amount_kobo + ch.adjusted_kobo - ch.paid_kobo)::bigint AS kobo
        FROM rent_charges ch JOIN leases l ON l.id = ch.lease_id JOIN assets a ON a.id = l.asset_id
        WHERE ch.company_id = ${c} AND (ch.due_date + l.grace_days) < ${today} AND ch.paid_kobo < ch.amount_kobo + ch.adjusted_kobo
        GROUP BY a.name ORDER BY 2 DESC LIMIT 5`;
      const label: Record<string, string> = { "1": "1 to 30 days late", "2": "31 to 60 days", "3": "61 to 90 days", "4": "Over 90 days" };
      const buckets = ["1", "2", "3", "4"].map((k) => { const x = rows.find((y) => y.b === k); return { label: label[k], charges: Number(x?.n ?? 0n), kobo: x?.kobo ?? 0n }; });
      out.arrears = { totalKobo: buckets.reduce((s, b) => s + b.kobo, 0n), charges: buckets.reduce((s, b) => s + b.charges, 0), buckets, top };
    }

    if (can(r, "maintenance.request")) {
      const open = await tx.workOrder.findMany({ where: { companyId: c, status: { in: [...OPEN_WORK] } }, select: { status: true, targetDate: true, priority: true }, take: 5000 });
      const done = await tx.workOrder.findMany({ where: { companyId: c, completedOn: { gte: plus(-90) } }, select: { createdAt: true, completedOn: true, actualCostKobo: true }, take: 5000 });
      // The completion date has no time of day, so count whole days from the date the job was reported (Lagos time); never below zero.
      const reportedDay = (d: Date) => Date.parse(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d)}T00:00:00Z`);
      const spans = done.filter((w) => w.completedOn).map((w) => Math.max(0, ((w.completedOn as Date).getTime() - reportedDay(w.createdAt)) / day));
      const by = new Map<string, number>();
      for (const w of open) by.set(w.status, (by.get(w.status) ?? 0) + 1);
      out.maintenance = {
        open: open.length, overdue: open.filter((w) => w.targetDate && w.targetDate.getTime() < today.getTime()).length,
        urgent: open.filter((w) => w.priority === "EMERGENCY" || w.priority === "HIGH").length,
        completed90: done.length, avgDaysToComplete: spans.length ? Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10 : null,
        cost90Kobo: done.reduce((s, w) => s + (w.actualCostKobo ?? 0n), 0n), byStatus: [...by].map(([status, n]) => ({ status, n })),
      };
    }

    if (can(r, "valuation.view")) {
      const reports = await tx.valuationReport.findMany({ where: { companyId: c, status: "APPROVED", concludedValueKobo: { not: null } }, select: { concludedValueKobo: true, createdAt: true, instruction: { select: { assetId: true, valuationDate: true } } }, take: 5000 });
      const latest = new Map<string, { at: number; v: bigint }>();
      const live = new Set(assets.map((a) => a.id));
      for (const rep of reports) {
        const id = rep.instruction.assetId;
        if (!live.has(id)) continue;
        const at = (rep.instruction.valuationDate ?? rep.createdAt).getTime();
        const cur = latest.get(id);
        if (!cur || at > cur.at) latest.set(id, { at, v: rep.concludedValueKobo as bigint });
      }
      out.values = {
        costKobo: assets.reduce((s, a) => s + (a.acquisitionCostKobo ?? 0n), 0n),
        valuedKobo: [...latest.values()].reduce((s, x) => s + x.v, 0n), valuedAssets: latest.size,
        assetsWithoutValuation: assets.length - latest.size, assetsWithoutCost: assets.filter((a) => a.acquisitionCostKobo === null).length,
      };
    }

    if (can(r, "project.view")) {
      const projects = await tx.project.findMany({ where: { companyId: c, status: { in: ["ACTIVE", "ON_HOLD"] } }, select: { id: true, ref: true, title: true, plannedEnd: true, workPackages: { select: { percentComplete: true, budgetKobo: true } } }, orderBy: { plannedEnd: "asc" }, take: 50 });
      out.projects = { active: projects.length, rows: projects.slice(0, 8).map((p) => ({ id: p.id, ref: p.ref, title: p.title, percent: overallPercent(p.workPackages), plannedEnd: p.plannedEnd, late: p.plannedEnd.getTime() < today.getTime() })) };
    }

    {
      const obs = await tx.obligation.findMany({ where: { companyId: c, status: "OPEN" }, select: { id: true, title: true, dueDate: true }, orderBy: { dueDate: "asc" }, take: 2000 });
      const within = (d: number) => obs.filter((o) => o.dueDate.getTime() >= today.getTime() && o.dueDate.getTime() <= plus(d).getTime()).length;
      const docs = await tx.assetDocument.count({ where: { companyId: c, expiresOn: { gte: today, lte: plus(90) } } });
      out.compliance = {
        overdue: obs.filter((o) => o.dueDate.getTime() < today.getTime()).length, in30: within(30), in60: within(60), in90: within(90), documentsExpiring90: docs,
        next: obs.slice(0, 6).map((o) => ({ id: o.id, title: o.title, dueDate: o.dueDate, overdue: o.dueDate.getTime() < today.getTime() })),
      };
    }
    return out;
  });
}
