import { withTenant, type Tx } from "../db";
import { todayInLagos } from "../dates";
import { checkAsset, checkValuation, type Issue } from "../ai-rules";
import { assertCan, type Ctx } from "./context";

/**
 * Finds what is missing from asset and valuation records, using the platform's own rules. It reads the company's records,
 * changes nothing and sends nothing anywhere, so it works whether or not an AI service is connected.
 */

async function assetInput(tx: Tx, ctx: Ctx, assetId: string, today: Date) {
  const a = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId }, include: { documents: { select: { category: true, expiresOn: true } }, parties: { select: { relationship: true } } } });
  if (!a) return null;
  const reports = await tx.valuationReport.findMany({ where: { companyId: ctx.companyId, status: "APPROVED", instruction: { assetId } }, select: { createdAt: true, instruction: { select: { valuationDate: true } } }, take: 20 });
  const latest = reports.map((r) => (r.instruction.valuationDate ?? r.createdAt).getTime()).sort((x, y) => y - x)[0];
  return { a, input: { asset: { name: a.name, category: a.category, description: a.description, address: a.address, city: a.city, state: a.state, lat: a.lat, acquisitionCostKobo: a.acquisitionCostKobo, acquiredOn: a.acquiredOn, companyRelationship: a.companyRelationship }, documents: a.documents, partyRoles: a.parties.map((p) => p.relationship), latestValuationOn: latest ? new Date(latest) : null, today } };
}

export async function assetCompleteness(ctx: Ctx, assetId: string): Promise<Issue[]> {
  assertCan(ctx, "asset.view");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await assetInput(tx, ctx, assetId, today);
    if (!r) throw new Error("Asset not found");
    return checkAsset(r.input);
  });
}

export interface PortfolioGap { assetId: string; ref: string; name: string; required: number; recommended: number; issues: Issue[] }

/** Every live asset with something missing, worst first, and how often each gap occurs. */
export async function portfolioCompleteness(ctx: Ctx, page = 0) {
  assertCan(ctx, "asset.view");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const assets = await tx.asset.findMany({ where: { companyId: ctx.companyId, status: { notIn: ["DISPOSED", "ARCHIVED"] } }, include: { documents: { select: { category: true, expiresOn: true } }, parties: { select: { relationship: true } } }, orderBy: { ref: "asc" }, take: 1000 });
    const vals = await tx.valuationReport.findMany({ where: { companyId: ctx.companyId, status: "APPROVED" }, select: { createdAt: true, instruction: { select: { assetId: true, valuationDate: true } } }, take: 5000 });
    const latest = new Map<string, number>();
    for (const v of vals) { const t = (v.instruction.valuationDate ?? v.createdAt).getTime(); if (t > (latest.get(v.instruction.assetId) ?? 0)) latest.set(v.instruction.assetId, t); }
    const gaps: PortfolioGap[] = [];
    const byCode = new Map<string, { code: string; message: string; severity: Issue["severity"]; n: number }>();
    for (const a of assets) {
      const issues = checkAsset({ asset: { name: a.name, category: a.category, description: a.description, address: a.address, city: a.city, state: a.state, lat: a.lat, acquisitionCostKobo: a.acquisitionCostKobo, acquiredOn: a.acquiredOn, companyRelationship: a.companyRelationship }, documents: a.documents, partyRoles: a.parties.map((p) => p.relationship), latestValuationOn: latest.has(a.id) ? new Date(latest.get(a.id) as number) : null, today });
      if (!issues.length) continue;
      gaps.push({ assetId: a.id, ref: a.ref, name: a.name, required: issues.filter((i) => i.severity === "REQUIRED").length, recommended: issues.filter((i) => i.severity === "RECOMMENDED").length, issues });
      for (const i of issues) { const x = byCode.get(i.code) ?? { code: i.code, message: i.message, severity: i.severity, n: 0 }; x.n += 1; byCode.set(i.code, x); }
    }
    gaps.sort((x, y) => y.required - x.required || y.recommended - x.recommended || x.ref.localeCompare(y.ref));
    const size = 15;
    return { checked: assets.length, complete: assets.length - gaps.length, gaps: gaps.slice(page * size, page * size + size), totalGaps: gaps.length, pageSize: size, common: [...byCode.values()].sort((a, b) => b.n - a.n).slice(0, 8) };
  });
}

export async function valuationCompleteness(ctx: Ctx, instructionId: string): Promise<Issue[]> {
  assertCan(ctx, "valuation.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const v = await tx.valuationInstruction.findFirst({ where: { id: instructionId, companyId: ctx.companyId }, include: { reports: { orderBy: { version: "desc" }, take: 1 } } });
    if (!v) throw new Error("Valuation not found");
    const comparables = await tx.valuationComparable.count({ where: { instructionId: v.id } });
    const rep = v.reports[0];
    return checkValuation({
      instruction: { clientName: v.clientName, valuationDate: v.valuationDate, inspectionDate: v.inspectionDate, basis: v.basis, premise: v.premise, purpose: v.purpose, scope: v.scope, assetDescription: v.assetDescription, professionalName: v.professionalName, professionalBody: v.professionalBody, registrationNo: v.registrationNo, assignedToId: v.assignedToId },
      comparables, report: rep ? { summary: rep.summary, conclusion: rep.conclusion, concludedValueKobo: rep.concludedValueKobo, reconciliationNote: rep.reconciliationNote } : null,
    });
  });
}
