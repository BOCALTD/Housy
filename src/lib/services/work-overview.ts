import { withTenant } from "../db";
import { todayInLagos } from "../dates";
import { can } from "../permissions";
import { procurementState, riskLevel, riskScore, warrantyState } from "../project-rules";
import { loadCostSummary } from "./project";
import type { Ctx } from "./context";

/**
 * Counts for the dashboard's "Projects and valuations" panel: what needs a decision, what is late, what is at risk.
 * Each number links to the page where it can be acted on. Returns null when the person may see neither.
 */
export async function workOverview(ctx: Ctx) {
  const projects = can(ctx.role, "project.view");
  const valuations = can(ctx.role, "valuation.view");
  if (!projects && !valuations) return null;
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const out = {
      projects: null as null | {
        active: number; planning: number; overBudget: number; lateProcurement: number; highRisks: number; failedChecks: number;
        openDefects: number; overdueDefects: number; completionWaiting: number; completionForMe: number; warrantiesEnding: number;
      },
      valuations: null as null | { open: number; inReview: number; overdue: number },
    };
    if (projects) {
      const c = ctx.companyId;
      const [active, planning, items, risks, failedChecks, defects, waiting, warranties] = await Promise.all([
        tx.project.findMany({ where: { companyId: c, status: { in: ["ACTIVE", "ON_HOLD"] } }, select: { id: true }, take: 100 }),
        tx.project.count({ where: { companyId: c, status: "PLANNING" } }),
        tx.procurementItem.findMany({ where: { companyId: c, status: { in: ["REQUIRED", "ORDERED"] }, project: { status: { in: ["ACTIVE", "ON_HOLD", "PLANNING"] } } }, select: { status: true, requiredBy: true } }),
        tx.projectRisk.findMany({ where: { companyId: c, status: { in: ["OPEN", "MITIGATING"] }, project: { status: { in: ["ACTIVE", "ON_HOLD", "PLANNING"] } } }, select: { likelihood: true, impact: true } }),
        tx.qualityCheck.count({ where: { companyId: c, result: "FAILED", project: { status: { in: ["ACTIVE", "ON_HOLD"] } } } }),
        tx.projectDefect.findMany({ where: { companyId: c, status: { not: "VERIFIED" } }, select: { dueOn: true } }),
        tx.project.findMany({ where: { companyId: c, status: "ACTIVE", completionRequestedById: { not: null } }, select: { completionRequestedById: true } }),
        tx.projectWarranty.findMany({ where: { companyId: c, endsOn: { gte: today } }, select: { startsOn: true, endsOn: true } }),
      ]);
      let overBudget = 0;
      for (const p of active) {
        const { summary } = await loadCostSummary(tx, c, p.id);
        if (summary?.overBudget) overBudget += 1;
      }
      out.projects = {
        active: active.length, planning, overBudget,
        lateProcurement: items.filter((i) => procurementState(i, today) === "LATE").length,
        highRisks: risks.filter((r) => riskLevel(riskScore(r.likelihood, r.impact)) === "HIGH").length,
        failedChecks,
        openDefects: defects.length,
        overdueDefects: defects.filter((d) => d.dueOn !== null && d.dueOn.getTime() < today.getTime()).length,
        completionWaiting: waiting.length,
        completionForMe: can(ctx.role, "project.approve") ? waiting.filter((w) => w.completionRequestedById !== ctx.userId).length : 0,
        warrantiesEnding: warranties.filter((w) => warrantyState(w, today) === "EXPIRING").length,
      };
    }
    if (valuations) {
      const rows = await tx.valuationInstruction.findMany({ where: { companyId: ctx.companyId, status: { in: ["INSTRUCTED", "IN_PROGRESS", "IN_REVIEW"] } }, select: { status: true, dueDate: true } });
      out.valuations = {
        open: rows.length,
        inReview: rows.filter((r) => r.status === "IN_REVIEW").length,
        overdue: rows.filter((r) => r.dueDate !== null && r.dueDate.getTime() < today.getTime()).length,
      };
    }
    return out;
  });
}
