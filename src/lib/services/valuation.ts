import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import { nextNumber } from "../numbering";
import { readStoredFile, saveFile, validateUpload } from "../storage";
import {
  BASES, costApproach, ENTRY_KINDS, EVIDENCE_KINDS, incomeCapitalisation, METHODS, parseAreaSqm100, parsePercentToBps, PREMISES, PURPOSES,
  reportApprovalProblem, reportReadiness, salesComparison, type Calculation, type EntryKind, type Method,
} from "../valuation-rules";
import { assertCan, type Ctx } from "./context";

// Valuation support (master prompt Phase 7). The system holds the evidence and does the arithmetic.
// The opinion of value is the professional's, and a second person approves the report before it stands.
// While a report is with the reviewer, or once approved, the evidence behind it cannot change.

export { BASES, ENTRY_KINDS, EVIDENCE_KINDS, METHODS, PREMISES, PURPOSES };

const EDITABLE = ["INSTRUCTED", "IN_PROGRESS"];

const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const text = (max: number) => z.string().trim().max(max).default("");

async function lockInstruction(tx: Tx, ctx: Ctx, id: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM valuation_instructions WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, ctx.companyId);
  if (rows.length === 0) throw new Error("Valuation not found");
  return tx.valuationInstruction.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
}

async function editable(tx: Tx, ctx: Ctx, id: string) {
  const inst = await lockInstruction(tx, ctx, id);
  if (!EDITABLE.includes(inst.status)) throw new Error("This valuation is with the reviewer or is finished, so its evidence is locked. Ask for it to be returned, or start a revision.");
  return inst;
}

async function started(tx: Tx, inst: { id: string; status: string }) {
  if (inst.status === "INSTRUCTED") await tx.valuationInstruction.update({ where: { id: inst.id }, data: { status: "IN_PROGRESS" } });
}

async function activeMember(tx: Tx, companyId: string, membershipId: string | null) {
  if (!membershipId) return;
  const m = await tx.membership.findFirst({ where: { id: membershipId, companyId, status: "ACTIVE" }, select: { id: true } });
  if (!m) throw new Error("Choose an active member of your company");
}

async function nameMap(tx: Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>;
}

const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue;

// ---------- Instructions ----------

const instructionSchema = z.object({
  assetId: z.string().min(1, "Choose the asset to value"),
  clientName: z.string().trim().min(2, "Enter the client's name").max(200),
  clientReference: text(100),
  purpose: z.enum(PURPOSES),
  purposeNote: text(500),
  basis: z.enum(BASES).default("MARKET_VALUE"),
  premise: z.enum(PREMISES).default("STANDARD"),
  assetDescription: text(4000),
  scope: text(4000),
  instructionDate: optionalDate,
  valuationDate: optionalDate,
  inspectionDate: optionalDate,
  dueDate: optionalDate,
  assignedToId: z.string().optional().transform((v) => v || null),
  professionalName: text(200),
  professionalBody: text(200),
  registrationNo: text(100),
});

export async function createInstruction(ctx: Ctx, raw: z.input<typeof instructionSchema>) {
  assertCan(ctx, "valuation.manage");
  const d = instructionSchema.parse(raw);
  const today = todayInLagos();
  const instructionDate = d.instructionDate ?? today;
  if (d.dueDate && d.dueDate.getTime() < instructionDate.getTime()) throw new Error("The due date cannot be before the instruction date");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: d.assetId, companyId: ctx.companyId }, select: { id: true } });
    if (!asset) throw new Error("Asset not found");
    await activeMember(tx, ctx.companyId, d.assignedToId);
    const year = today.getUTCFullYear();
    const n = await nextNumber(tx, ctx.companyId, "VAL", year);
    const ref = `VAL-${year}-${String(n).padStart(4, "0")}`;
    const inst = await tx.valuationInstruction.create({
      data: {
        companyId: ctx.companyId, ref, assetId: d.assetId, clientName: d.clientName, clientReference: d.clientReference, purpose: d.purpose,
        purposeNote: d.purposeNote, basis: d.basis, premise: d.premise, assetDescription: d.assetDescription, scope: d.scope, instructionDate,
        valuationDate: d.valuationDate, inspectionDate: d.inspectionDate, dueDate: d.dueDate, assignedToId: d.assignedToId,
        professionalName: d.professionalName, professionalBody: d.professionalBody, registrationNo: d.registrationNo, createdById: ctx.userId,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: inst.id, action: "valuation.instructed", detail: { ref, purpose: d.purpose, premise: d.premise } });
    return inst;
  });
}

const updateSchema = instructionSchema.pick({
  purposeNote: true, basis: true, premise: true, assetDescription: true, scope: true, valuationDate: true, inspectionDate: true, dueDate: true,
  professionalName: true, professionalBody: true, registrationNo: true,
});

export async function updateInstruction(ctx: Ctx, id: string, raw: z.input<typeof updateSchema>) {
  assertCan(ctx, "valuation.prepare");
  const d = updateSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await editable(tx, ctx, id);
    if (d.dueDate && d.dueDate.getTime() < inst.instructionDate.getTime()) throw new Error("The due date cannot be before the instruction date");
    await tx.valuationInstruction.update({ where: { id }, data: d });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: id, action: "valuation.updated", detail: { premise: d.premise, basis: d.basis } });
  });
}

export async function assignValuation(ctx: Ctx, id: string, membershipId: string | null) {
  assertCan(ctx, "valuation.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await lockInstruction(tx, ctx, id);
    if (!EDITABLE.includes(inst.status)) throw new Error("This valuation can no longer be reassigned");
    await activeMember(tx, ctx.companyId, membershipId);
    await tx.valuationInstruction.update({ where: { id }, data: { assignedToId: membershipId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: id, action: "valuation.assigned", detail: { membershipId } });
  });
}

export async function cancelInstruction(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "valuation.manage");
  const why = z.string().trim().min(3, "Say why the instruction is being cancelled").max(500).parse(reason);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await lockInstruction(tx, ctx, id);
    if (!EDITABLE.includes(inst.status)) throw new Error("Only a valuation that is not yet with the reviewer can be cancelled");
    await tx.valuationInstruction.update({ where: { id }, data: { status: "CANCELLED" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: id, action: "valuation.cancelled", detail: { reason: why } });
  });
}

export async function issueValuation(ctx: Ctx, id: string, issuedOn?: string) {
  assertCan(ctx, "valuation.manage");
  const on = issuedOn ? parseDateOnly(issuedOn) : todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await lockInstruction(tx, ctx, id);
    if (inst.status !== "APPROVED") throw new Error("Only an approved valuation can be issued to the client");
    await tx.valuationInstruction.update({ where: { id }, data: { status: "ISSUED", issuedOn: on } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: id, action: "valuation.issued", detail: { issuedOn: on.toISOString().slice(0, 10) } });
  });
}

// ---------- Worksheets ----------

type WorksheetRaw = Record<string, string | undefined>;

const money = (label: string) => z.string().trim().min(1, `Enter ${label}`).transform((v) => parseNairaToKobo(v));
const percent = (label: string) => z.string().trim().min(1, `Enter ${label}`).transform((v) => parsePercentToBps(v, label));
const area = (label: string) => z.string().trim().min(1, `Enter ${label}`).transform((v) => parseAreaSqm100(v, label));

const salesInput = z.object({ subjectArea: area("the subject's area") });
const incomeInput = z.object({ grossRent: money("the gross annual rent"), vacancy: percent("the vacancy allowance"), operatingCosts: money("the operating costs"), capRate: percent("the capitalisation rate") });
const costInput = z.object({ landValue: money("the land value"), costPerSqm: money("the replacement cost per m²"), buildingArea: area("the building area"), depreciation: percent("the depreciation") });

async function loadComparables(tx: Tx, ctx: Ctx, instructionId: string) {
  return tx.valuationComparable.findMany({ where: { companyId: ctx.companyId, instructionId }, orderBy: { createdAt: "asc" } });
}

/** Calculate a worksheet from its stored inputs (and the comparables for a sales comparison). Never throws: a failure is stored as a warning with no result. */
async function calculateStored(tx: Tx, ctx: Ctx, instructionId: string, method: Method, inputs: Record<string, string>): Promise<{ calc: Calculation | null; problem: string | null }> {
  try {
    if (method === "SALES_COMPARISON") {
      const comps = await loadComparables(tx, ctx, instructionId);
      return {
        calc: salesComparison({
          subjectAreaSqm100: Number(inputs.subjectAreaSqm100),
          comparables: comps.map((c) => ({ priceKobo: c.priceKobo, areaSqm100: c.areaSqm100, adjustmentBps: c.adjustmentBps, weightBps: c.weightBps })),
        }),
        problem: null,
      };
    }
    if (method === "INCOME_CAPITALISATION") {
      return { calc: incomeCapitalisation({ grossRentKobo: BigInt(inputs.grossRentKobo), vacancyBps: Number(inputs.vacancyBps), operatingCostsKobo: BigInt(inputs.operatingCostsKobo), capRateBps: Number(inputs.capRateBps) }), problem: null };
    }
    return { calc: costApproach({ landValueKobo: BigInt(inputs.landValueKobo), costPerSqmKobo: BigInt(inputs.costPerSqmKobo), buildingAreaSqm100: Number(inputs.buildingAreaSqm100), depreciationBps: Number(inputs.depreciationBps) }), problem: null };
  } catch (e) {
    return { calc: null, problem: e instanceof Error ? e.message : "The calculation could not be completed" };
  }
}

async function storeResult(tx: Tx, worksheetId: string, calc: Calculation | null, problem: string | null) {
  await tx.valuationWorksheet.update({
    where: { id: worksheetId },
    data: {
      resultKobo: calc ? calc.valueKobo : null, lines: jsonSafe(calc?.lines ?? []), warnings: jsonSafe(calc ? calc.warnings : problem ? [problem] : []),
      calculatedAt: calc ? new Date() : null,
    },
  });
}

/** Re-run the sales comparison after the evidence changes. */
async function recalcSales(tx: Tx, ctx: Ctx, instructionId: string) {
  const ws = await tx.valuationWorksheet.findFirst({ where: { companyId: ctx.companyId, instructionId, method: "SALES_COMPARISON" } });
  if (!ws) return;
  const { calc, problem } = await calculateStored(tx, ctx, instructionId, "SALES_COMPARISON", ws.inputs as unknown as Record<string, string>);
  await storeResult(tx, ws.id, calc, problem);
}

export async function saveWorksheet(ctx: Ctx, instructionId: string, method: Method, raw: WorksheetRaw, note = "") {
  assertCan(ctx, "valuation.prepare");
  if (!METHODS.includes(method)) throw new Error("Choose a valuation method");
  const n = z.string().trim().max(2000).parse(note);
  let inputs: Record<string, string>;
  if (method === "SALES_COMPARISON") {
    inputs = { subjectAreaSqm100: String(salesInput.parse(raw).subjectArea) };
  } else if (method === "INCOME_CAPITALISATION") {
    const p = incomeInput.parse(raw);
    inputs = { grossRentKobo: p.grossRent.toString(), vacancyBps: String(p.vacancy), operatingCostsKobo: p.operatingCosts.toString(), capRateBps: String(p.capRate) };
    incomeCapitalisation({ grossRentKobo: p.grossRent, vacancyBps: p.vacancy, operatingCostsKobo: p.operatingCosts, capRateBps: p.capRate });
  } else {
    const p = costInput.parse(raw);
    inputs = { landValueKobo: p.landValue.toString(), costPerSqmKobo: p.costPerSqm.toString(), buildingAreaSqm100: String(p.buildingArea), depreciationBps: String(p.depreciation) };
    costApproach({ landValueKobo: p.landValue, costPerSqmKobo: p.costPerSqm, buildingAreaSqm100: p.buildingArea, depreciationBps: p.depreciation });
  }
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await editable(tx, ctx, instructionId);
    const ws = await tx.valuationWorksheet.upsert({
      where: { instructionId_method: { instructionId, method } },
      create: { companyId: ctx.companyId, instructionId, method, inputs: jsonSafe(inputs), note: n, createdById: ctx.userId },
      update: { inputs: jsonSafe(inputs), note: n },
    });
    const { calc, problem } = await calculateStored(tx, ctx, instructionId, method, inputs);
    await storeResult(tx, ws.id, calc, problem);
    await started(tx, inst);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.worksheet_saved", detail: { method, result: calc ? calc.valueKobo.toString() : null } });
    return ws;
  });
}

export async function removeWorksheet(ctx: Ctx, instructionId: string, method: Method) {
  assertCan(ctx, "valuation.prepare");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await editable(tx, ctx, instructionId);
    await tx.valuationWorksheet.deleteMany({ where: { companyId: ctx.companyId, instructionId, method } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.worksheet_removed", detail: { method } });
  });
}

// ---------- Comparable evidence ----------

const comparableSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS).default("SALE"),
  address: z.string().trim().min(3, "Enter the comparable's address or description").max(300),
  evidenceDate: z.string().trim().min(1, "Enter the date of the evidence").transform((v) => parseDateOnly(v)),
  price: z.string().trim().min(1, "Enter the price or rent").transform((v) => parseNairaToKobo(v)),
  area: z.string().trim().min(1, "Enter the area").transform((v) => parseAreaSqm100(v, "The comparable's area")),
  adjustment: z.string().trim().optional().transform((v) => parsePercentToBps(v || "0", "The adjustment")),
  adjustmentNote: text(1000),
  weight: z.string().trim().optional().transform((v) => parsePercentToBps(v || "100", "The weight")),
  source: z.string().trim().max(300).default(""),
});

export async function addComparable(ctx: Ctx, instructionId: string, raw: z.input<typeof comparableSchema>) {
  assertCan(ctx, "valuation.prepare");
  const d = comparableSchema.parse(raw);
  if (d.price <= 0n) throw new Error("The price must be more than zero");
  if (d.adjustment <= -5000 || d.adjustment > 5000) throw new Error("An adjustment must be between -50% and 50%");
  if (d.weight < 0 || d.weight > 10000) throw new Error("The weight must be between 0% and 100%");
  if (d.adjustment !== 0 && !d.adjustmentNote) throw new Error("Say why the adjustment is made. An unexplained adjustment cannot be reviewed");
  if (!d.source) throw new Error("Record the source of the evidence, so the approver can check it");
  if (d.evidenceDate.getTime() > todayInLagos().getTime()) throw new Error("The evidence date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await editable(tx, ctx, instructionId);
    const c = await tx.valuationComparable.create({
      data: {
        companyId: ctx.companyId, instructionId, kind: d.kind, address: d.address, evidenceDate: d.evidenceDate, priceKobo: d.price, areaSqm100: d.area,
        adjustmentBps: d.adjustment, adjustmentNote: d.adjustmentNote, weightBps: d.weight, source: d.source, createdById: ctx.userId,
      },
    });
    await recalcSales(tx, ctx, instructionId);
    await started(tx, inst);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.comparable_added", detail: { comparableId: c.id, address: d.address } });
    return c;
  });
}

export async function removeComparable(ctx: Ctx, comparableId: string) {
  assertCan(ctx, "valuation.prepare");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.valuationComparable.findFirst({ where: { id: comparableId, companyId: ctx.companyId } });
    if (!c) throw new Error("Comparable not found");
    await editable(tx, ctx, c.instructionId);
    await tx.valuationComparable.delete({ where: { id: comparableId } });
    await recalcSales(tx, ctx, c.instructionId);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: c.instructionId, action: "valuation.comparable_removed", detail: { address: c.address } });
    return c.instructionId;
  });
}

/** Record that the evidence was checked against its source. Someone other than the person who recorded it should do this. */
export async function verifyComparable(ctx: Ctx, comparableId: string) {
  assertCan(ctx, "valuation.prepare");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.valuationComparable.findFirst({ where: { id: comparableId, companyId: ctx.companyId } });
    if (!c) throw new Error("Comparable not found");
    await editable(tx, ctx, c.instructionId);
    await tx.valuationComparable.update({ where: { id: comparableId }, data: { verifiedById: ctx.userId, verifiedAt: new Date() } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: c.instructionId, action: "valuation.comparable_verified", detail: { comparableId, recordedBySelf: c.createdById === ctx.userId } });
    return c.instructionId;
  });
}

// ---------- Premises, assumptions and limitations ----------

export async function addEntry(ctx: Ctx, instructionId: string, kind: EntryKind, entryText: string) {
  assertCan(ctx, "valuation.prepare");
  const k = z.enum(ENTRY_KINDS).parse(kind);
  const t = z.string().trim().min(5, "Write the statement in full").max(2000).parse(entryText);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await editable(tx, ctx, instructionId);
    const e = await tx.valuationEntry.create({ data: { companyId: ctx.companyId, instructionId, kind: k, text: t, createdById: ctx.userId } });
    await started(tx, inst);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.entry_added", detail: { kind: k } });
    return e;
  });
}

export async function removeEntry(ctx: Ctx, entryId: string) {
  assertCan(ctx, "valuation.prepare");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const e = await tx.valuationEntry.findFirst({ where: { id: entryId, companyId: ctx.companyId } });
    if (!e) throw new Error("Entry not found");
    await editable(tx, ctx, e.instructionId);
    await tx.valuationEntry.delete({ where: { id: entryId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: e.instructionId, action: "valuation.entry_removed", detail: { kind: e.kind } });
    return e.instructionId;
  });
}

// ---------- Supporting documents ----------

export interface Upload { name: string; type: string; bytes: Uint8Array }

export async function addValuationDocument(ctx: Ctx, instructionId: string, title: string, file: Upload) {
  assertCan(ctx, "valuation.prepare");
  const t = z.string().trim().min(2, "Give the document a title").max(200).parse(title);
  validateUpload(file.type, file.bytes);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await editable(tx, ctx, instructionId);
    const storageKey = await saveFile(tx, ctx.companyId, file.type, file.bytes);
    const doc = await tx.valuationDocument.create({
      data: { companyId: ctx.companyId, instructionId, title: t, fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, storageKey, uploadedById: ctx.userId },
    });
    await started(tx, inst);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.document_added", detail: { title: t } });
    return doc;
  });
}

export async function getValuationDocument(ctx: Ctx, documentId: string) {
  assertCan(ctx, "valuation.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const doc = await tx.valuationDocument.findFirst({ where: { id: documentId, companyId: ctx.companyId } });
    if (!doc) return null;
    return { doc, bytes: await readStoredFile(tx, ctx.companyId, doc.storageKey) };
  });
}

// ---------- Reports ----------

const draftSchema = z.object({
  summary: text(8000),
  conclusion: text(8000),
  concludedValue: z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null)),
  reconciliationNote: text(4000),
  aiAssisted: z.boolean().default(false),
  aiNote: text(1000),
});

async function readinessFor(tx: Tx, ctx: Ctx, instructionId: string, report: { summary: string; conclusion: string; concludedValueKobo: bigint | null; reconciliationNote: string }) {
  const inst = await tx.valuationInstruction.findFirstOrThrow({ where: { id: instructionId, companyId: ctx.companyId } });
  const [entries, worksheets, comps] = await Promise.all([
    tx.valuationEntry.findMany({ where: { companyId: ctx.companyId, instructionId }, select: { kind: true } }),
    tx.valuationWorksheet.findMany({ where: { companyId: ctx.companyId, instructionId } }),
    tx.valuationComparable.count({ where: { companyId: ctx.companyId, instructionId } }),
  ]);
  return reportReadiness({
    premise: inst.premise, valuationDate: inst.valuationDate, today: todayInLagos(), professionalName: inst.professionalName,
    professionalBody: inst.professionalBody, registrationNo: inst.registrationNo, assetDescription: inst.assetDescription, entries,
    worksheets: worksheets.map((w) => ({ method: w.method, resultKobo: w.resultKobo, comparableCount: w.method === "SALES_COMPARISON" ? comps : 0 })),
    concludedValueKobo: report.concludedValueKobo, reconciliationNote: report.reconciliationNote, summary: report.summary, conclusion: report.conclusion,
  });
}

/** Create or update the open draft. The draft is the professional's text; AI help must be declared. */
export async function saveReportDraft(ctx: Ctx, instructionId: string, raw: z.input<typeof draftSchema>) {
  assertCan(ctx, "valuation.prepare");
  const d = draftSchema.parse(raw);
  if (d.aiAssisted && d.aiNote.length < 5) throw new Error("Describe what the AI assistant was used for, so the approver knows what to check");
  if (d.concludedValue !== null && d.concludedValue <= 0n) throw new Error("The concluded value must be more than zero");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await editable(tx, ctx, instructionId);
    const last = await tx.valuationReport.findFirst({ where: { companyId: ctx.companyId, instructionId }, orderBy: { version: "desc" } });
    const data = { summary: d.summary, conclusion: d.conclusion, concludedValueKobo: d.concludedValue, reconciliationNote: d.reconciliationNote, aiAssisted: d.aiAssisted, aiNote: d.aiAssisted ? d.aiNote : "" };
    let report;
    if (last && (last.status === "DRAFT" || last.status === "REJECTED")) {
      report = await tx.valuationReport.update({ where: { id: last.id }, data: { ...data, status: "DRAFT", decidedById: null, decidedAt: null, decisionNote: "", reviewConfirmed: false } });
    } else {
      report = await tx.valuationReport.create({ data: { companyId: ctx.companyId, instructionId, version: (last?.version ?? 0) + 1, authorId: ctx.userId, ...data } });
    }
    await started(tx, inst);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.report_drafted", detail: { version: report.version, aiAssisted: d.aiAssisted } });
    return report;
  });
}

/** Send the draft for approval. The worksheets, evidence and assumptions as they stand are frozen into the report. */
export async function submitReport(ctx: Ctx, instructionId: string) {
  assertCan(ctx, "valuation.prepare");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await editable(tx, ctx, instructionId);
    const report = await tx.valuationReport.findFirst({ where: { companyId: ctx.companyId, instructionId, status: "DRAFT" }, orderBy: { version: "desc" } });
    if (!report) throw new Error("There is no draft report to submit");
    const readiness = await readinessFor(tx, ctx, instructionId, report);
    if (readiness.blockers.length > 0) throw new Error(`The report is not ready: ${readiness.blockers.join("; ")}.`);
    const [worksheets, comparables, entries, documents] = await Promise.all([
      tx.valuationWorksheet.findMany({ where: { companyId: ctx.companyId, instructionId }, orderBy: { method: "asc" } }),
      loadComparables(tx, ctx, instructionId),
      tx.valuationEntry.findMany({ where: { companyId: ctx.companyId, instructionId }, orderBy: { createdAt: "asc" } }),
      tx.valuationDocument.findMany({ where: { companyId: ctx.companyId, instructionId }, select: { id: true, title: true, fileName: true } }),
    ]);
    const snapshot = jsonSafe({
      instruction: {
        ref: inst.ref, clientName: inst.clientName, purpose: inst.purpose, basis: inst.basis, premise: inst.premise, valuationDate: inst.valuationDate,
        assetDescription: inst.assetDescription, professionalName: inst.professionalName, professionalBody: inst.professionalBody, registrationNo: inst.registrationNo,
      },
      worksheets, comparables, entries, documents, warnings: readiness.warnings,
    });
    await tx.valuationReport.update({ where: { id: report.id }, data: { status: "IN_REVIEW", submittedAt: new Date(), authorId: ctx.userId, snapshot } });
    await tx.valuationInstruction.update({ where: { id: instructionId }, data: { status: "IN_REVIEW" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.report_submitted", detail: { version: report.version, aiAssisted: report.aiAssisted } });
    return report;
  });
}

export async function decideReport(ctx: Ctx, instructionId: string, decision: "approve" | "reject", note: string, confirmReviewed: boolean) {
  assertCan(ctx, "valuation.approve");
  const n = z.string().trim().max(2000).parse(note);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await lockInstruction(tx, ctx, instructionId);
    if (inst.status !== "IN_REVIEW") throw new Error("This valuation is not waiting for a decision");
    const report = await tx.valuationReport.findFirst({ where: { companyId: ctx.companyId, instructionId, status: "IN_REVIEW" }, orderBy: { version: "desc" } });
    if (!report) throw new Error("There is no report waiting for a decision");
    const problem = reportApprovalProblem({ authorId: report.authorId, approverId: ctx.userId, aiAssisted: report.aiAssisted, confirmedReviewed: confirmReviewed });
    if (problem) throw new Error(problem);
    if (decision === "reject") {
      if (n.length < 3) throw new Error("Say what needs to change");
      await tx.valuationReport.update({ where: { id: report.id }, data: { status: "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: n } });
      await tx.valuationInstruction.update({ where: { id: instructionId }, data: { status: "IN_PROGRESS" } });
    } else {
      await tx.valuationReport.updateMany({ where: { companyId: ctx.companyId, instructionId, status: "APPROVED" }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
      await tx.valuationReport.update({ where: { id: report.id }, data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: n, reviewConfirmed: confirmReviewed } });
      await tx.valuationInstruction.update({ where: { id: instructionId }, data: { status: "APPROVED" } });
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: decision === "approve" ? "valuation.report_approved" : "valuation.report_rejected", detail: { version: report.version, authorId: report.authorId, note: n } });
  });
}

/** Start a new version of a report that was approved or issued. The approved version stands until the new one is approved. */
export async function reviseReport(ctx: Ctx, instructionId: string, reason: string) {
  assertCan(ctx, "valuation.manage");
  const why = z.string().trim().min(3, "Say why the report is being revised").max(500).parse(reason);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await lockInstruction(tx, ctx, instructionId);
    if (inst.status !== "APPROVED" && inst.status !== "ISSUED") throw new Error("Only an approved or issued valuation can be revised");
    const last = await tx.valuationReport.findFirstOrThrow({ where: { companyId: ctx.companyId, instructionId }, orderBy: { version: "desc" } });
    await tx.valuationReport.create({
      data: {
        companyId: ctx.companyId, instructionId, version: last.version + 1, authorId: ctx.userId, summary: last.summary, conclusion: last.conclusion,
        concludedValueKobo: last.concludedValueKobo, reconciliationNote: last.reconciliationNote,
      },
    });
    await tx.valuationInstruction.update({ where: { id: instructionId }, data: { status: "IN_PROGRESS" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "valuation", entityId: instructionId, action: "valuation.revision_started", detail: { fromVersion: last.version, reason: why } });
  });
}

// ---------- Reading ----------

export async function listValuations(ctx: Ctx) {
  assertCan(ctx, "valuation.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [rows, assets, members] = await Promise.all([
      tx.valuationInstruction.findMany({
        where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 300,
        include: { asset: { select: { id: true, ref: true, name: true } }, reports: { orderBy: { version: "desc" }, take: 1 } },
      }),
      tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
    ]);
    const today = todayInLagos();
    const overdue = rows.filter((r) => EDITABLE.includes(r.status) && r.dueDate && r.dueDate.getTime() < today.getTime());
    const waiting = rows.filter((r) => r.status === "IN_REVIEW");
    return { rows, assets, members: members.map((m) => ({ id: m.id, name: m.user.name })), overdue, waiting };
  });
}

export async function getValuation(ctx: Ctx, id: string) {
  assertCan(ctx, "valuation.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inst = await tx.valuationInstruction.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { asset: { select: { id: true, ref: true, name: true } } },
    });
    if (!inst) return null;
    const [worksheets, comparables, entries, documents, reports, members] = await Promise.all([
      tx.valuationWorksheet.findMany({ where: { companyId: ctx.companyId, instructionId: id } }),
      loadComparables(tx, ctx, id),
      tx.valuationEntry.findMany({ where: { companyId: ctx.companyId, instructionId: id }, orderBy: { createdAt: "asc" } }),
      tx.valuationDocument.findMany({ where: { companyId: ctx.companyId, instructionId: id }, orderBy: { createdAt: "asc" } }),
      tx.valuationReport.findMany({ where: { companyId: ctx.companyId, instructionId: id }, orderBy: { version: "desc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
    ]);
    const openReport = reports.find((r) => r.status === "DRAFT" || r.status === "IN_REVIEW" || r.status === "REJECTED") ?? null;
    const readiness = openReport && openReport.status !== "IN_REVIEW"
      ? await readinessFor(tx, ctx, id, openReport)
      : await readinessFor(tx, ctx, id, { summary: "", conclusion: "", concludedValueKobo: null, reconciliationNote: "" });
    const names = await nameMap(tx, [...reports.flatMap((r) => [r.authorId, r.decidedById]), ...comparables.map((c) => c.verifiedById), ...comparables.map((c) => c.createdById), ...entries.map((e) => e.createdById)]);
    return {
      inst, worksheets, comparables, entries, documents, reports, openReport, readiness, names, editable: EDITABLE.includes(inst.status),
      members: members.map((m) => ({ id: m.id, name: m.user.name })),
    };
  });
}

/** The latest approved or issued valuation for an asset (null if none). Shown on the asset and used by later reports. */
export async function latestValuationForAsset(tx: Tx, companyId: string, assetId: string) {
  const inst = await tx.valuationInstruction.findFirst({
    where: { companyId, assetId, status: { in: ["APPROVED", "ISSUED"] } }, orderBy: { valuationDate: "desc" },
    include: { reports: { where: { status: "APPROVED" }, take: 1 } },
  });
  if (!inst || inst.reports.length === 0) return null;
  return { id: inst.id, ref: inst.ref, valuationDate: inst.valuationDate, basis: inst.basis, valueKobo: inst.reports[0].concludedValueKobo };
}
