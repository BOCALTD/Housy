import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { lockKey } from "../locks";
import { toCsv, koboToPlain } from "../csv";
import {
  IMPORT_KINDS, MAX_IMPORT_BYTES, assetKey, checkAssetRow, checkLeaseRow, leaseKey, mapRows, parseCsv, type ImportKindName,
} from "../import-rules";
import { createSchema, insertAsset } from "./assets";
import { insertLease, leaseSchema, postOpeningReceipt } from "./leases";
import { assertCan, type Ctx } from "./context";

export const IMPORT_PAGE = 25;
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type RowPlan = { rowNo: number; status: "READY" | "DUPLICATE" | "ERROR"; message: string; payload: object };

/**
 * Read a file and decide, line by line, what would happen: create it, skip it as a duplicate, or reject it with a reason.
 * Nothing is created yet; the person looks at the preview and confirms.
 */
export async function previewImport(ctx: Ctx, kind: ImportKindName, fileName: string, text: string): Promise<{ id: string; ref: string }> {
  assertCan(ctx, "import.manage");
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) throw new Error("Choose what you are importing");
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw new Error("That file is larger than 2 MB. Split it into smaller files.");
  const name = fileName.trim().slice(0, 200) || "import.csv";
  const mapped = mapRows(kind, parseCsv(text));
  if (mapped.missing.length) throw new Error(`The file is missing these columns: ${mapped.missing.join(", ")}.`);
  if (mapped.rows.length === 0) throw new Error("The file has headings but no rows.");

  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const plans: RowPlan[] = [];
    if (kind === "ASSETS") {
      const have = await tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { ref: true, name: true, address: true, city: true } });
      const known = new Map(have.map((a) => [assetKey(a), a.ref]));
      const inFile = new Map<string, number>();
      for (const r of mapped.rows) {
        const c = checkAssetRow(r.cells);
        if (!c.ok) { plans.push({ rowNo: r.rowNo, status: "ERROR", message: c.errors.join("; "), payload: { cells: r.cells } }); continue; }
        const key = assetKey(c.input);
        if (known.has(key)) plans.push({ rowNo: r.rowNo, status: "DUPLICATE", message: `Already registered as ${known.get(key)}`, payload: c.input });
        else if (inFile.has(key)) plans.push({ rowNo: r.rowNo, status: "DUPLICATE", message: `Same as row ${inFile.get(key)} in this file`, payload: c.input });
        else { inFile.set(key, r.rowNo); plans.push({ rowNo: r.rowNo, status: "READY", message: "", payload: c.input }); }
      }
    } else {
      const assets = await tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true } });
      const byRef = new Map(assets.map((a) => [a.ref.toUpperCase(), a]));
      const byName = new Map<string, typeof assets>();
      for (const a of assets) byName.set(flat(a.name), [...(byName.get(flat(a.name)) ?? []), a]);
      const existing = await tx.lease.findMany({ where: { companyId: ctx.companyId }, select: { ref: true, assetId: true, unit: true, startDate: true, occupantName: true } });
      const known = new Map(existing.map((l) => [leaseKey({ assetId: l.assetId, unit: l.unit, startDate: l.startDate.toISOString().slice(0, 10), occupantName: l.occupantName }), l.ref]));
      const inFile = new Map<string, number>();
      for (const r of mapped.rows) {
        const c = checkLeaseRow(r.cells);
        if (!c.ok) { plans.push({ rowNo: r.rowNo, status: "ERROR", message: c.errors.join("; "), payload: { cells: r.cells } }); continue; }
        const i = c.input;
        let asset = i.assetRef ? byRef.get(i.assetRef) : undefined;
        if (!asset && i.assetRef) { plans.push({ rowNo: r.rowNo, status: "ERROR", message: `No asset has the reference ${i.assetRef}`, payload: { cells: r.cells } }); continue; }
        if (!asset) {
          const hits = byName.get(flat(i.assetName)) ?? [];
          if (hits.length === 0) { plans.push({ rowNo: r.rowNo, status: "ERROR", message: `No asset is called "${i.assetName}". Import the assets first, or use the reference`, payload: { cells: r.cells } }); continue; }
          if (hits.length > 1) { plans.push({ rowNo: r.rowNo, status: "ERROR", message: `${hits.length} assets are called "${i.assetName}". Use the asset reference instead`, payload: { cells: r.cells } }); continue; }
          asset = hits[0];
        }
        const payload = { ...i, paidKobo: i.paidKobo.toString(), totalDueKobo: i.totalDueKobo.toString(), assetId: asset!.id, assetRefResolved: asset!.ref };
        const key = leaseKey({ assetId: asset!.id, unit: i.unit, startDate: i.startDate, occupantName: i.occupantName });
        if (known.has(key)) plans.push({ rowNo: r.rowNo, status: "DUPLICATE", message: `Already recorded as ${known.get(key)}`, payload });
        else if (inFile.has(key)) plans.push({ rowNo: r.rowNo, status: "DUPLICATE", message: `Same as row ${inFile.get(key)} in this file`, payload });
        else { inFile.set(key, r.rowNo); plans.push({ rowNo: r.rowNo, status: "READY", message: "", payload }); }
      }
    }

    await lockKey(tx, `import-ref:${ctx.companyId}`);
    const count = await tx.importBatch.count({ where: { companyId: ctx.companyId } });
    const ref = `IMP-${String(count + 1).padStart(4, "0")}`;
    const batch = await tx.importBatch.create({ data: { companyId: ctx.companyId, ref, kind, fileName: name, createdById: ctx.userId } });
    await tx.importRow.createMany({
      data: plans.map((p) => ({ companyId: ctx.companyId, batchId: batch.id, rowNo: p.rowNo, status: p.status, message: p.message, payload: p.payload as unknown as Prisma.InputJsonValue })),
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "import_batch", entityId: batch.id, action: "import.previewed",
      detail: { ref, kind, fileName: name, rows: plans.length, ready: plans.filter((p) => p.status === "READY").length },
    });
    return { id: batch.id, ref };
  });
}

/**
 * Create every READY row. Each row is its own transaction, so one bad line never blocks the others, and a row is marked
 * imported in the same transaction that creates its record. A batch can be confirmed only once.
 */
export async function commitImport(ctx: Ctx, batchId: string): Promise<{ imported: number; failed: number }> {
  assertCan(ctx, "import.manage");
  const batch = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const b = await tx.importBatch.findFirst({ where: { id: batchId, companyId: ctx.companyId } });
    if (!b) throw new Error("Import not found");
    const claimed = await tx.importBatch.updateMany({ where: { id: batchId, companyId: ctx.companyId, status: "PREVIEWED" }, data: { status: "COMMITTED", committedAt: new Date(), committedById: ctx.userId } });
    if (claimed.count === 0) throw new Error(b.status === "DISCARDED" ? "This import was discarded" : "This import has already been confirmed");
    return b;
  });
  const rows = await withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.importRow.findMany({ where: { companyId: ctx.companyId, batchId, status: "READY" }, orderBy: { rowNo: "asc" } }));
  let imported = 0, failed = 0;
  for (const row of rows) {
    try {
      await withTenant(ctx.companyId, ctx.userId, async (tx) => {
        const p = row.payload as Record<string, string>;
        let entityId: string;
        if (batch.kind === "ASSETS") {
          const asset = await insertAsset(tx, ctx, createSchema.parse(p));
          entityId = asset.id;
        } else {
          const data = leaseSchema.parse({ occupantName: p.occupantName, occupantContact: p.occupantContact, unit: p.unit, startDate: p.startDate, endDate: p.endDate, rent: p.rent, frequency: p.frequency, intervalMonths: p.intervalMonths, deposit: p.deposit, graceDays: p.graceDays, noticeDays: p.noticeDays });
          const lease = await insertLease(tx, ctx, p.assetId, data, null);
          const paid = BigInt(p.paidKobo);
          if (paid > 0n) await postOpeningReceipt(tx, ctx, lease.id, paid, `IMPORT ${batch.ref} row ${row.rowNo}`);
          entityId = lease.id;
        }
        await tx.importRow.update({ where: { id: row.id }, data: { status: "IMPORTED", entityId } });
      });
      imported++;
    } catch (e) {
      failed++;
      const message = (e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : e instanceof Error ? e.message : "Could not be created").slice(0, 900);
      await withTenant(ctx.companyId, ctx.userId, (tx) => tx.importRow.update({ where: { id: row.id }, data: { status: "FAILED", message } }));
    }
  }
  await withTenant(ctx.companyId, ctx.userId, (tx) => logActivity(tx, {
    companyId: ctx.companyId, actorId: ctx.userId, entityType: "import_batch", entityId: batchId, action: "import.committed", detail: { ref: batch.ref, imported, failed },
  }));
  return { imported, failed };
}

export async function discardImport(ctx: Ctx, batchId: string) {
  assertCan(ctx, "import.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.importBatch.updateMany({ where: { id: batchId, companyId: ctx.companyId, status: "PREVIEWED" }, data: { status: "DISCARDED" } });
    if (r.count === 0) throw new Error("Only an import that has not been confirmed can be discarded");
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "import_batch", entityId: batchId, action: "import.discarded", detail: {} });
  });
}

export async function listImports(ctx: Ctx) {
  assertCan(ctx, "import.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.importBatch.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 30 }));
}

export interface Check { label: string; expected: string; actual: string; ok: boolean }
export interface Reconciliation { counts: Record<string, number>; total: number; checks: Check[]; balanced: boolean }

/**
 * Prove that what went in matches the file. Every line is accounted for exactly once; for leases, the rent and the money already
 * paid are added up from the database and compared with the same sums from the file.
 */
export async function reconcileImport(ctx: Ctx, batchId: string): Promise<Reconciliation | null> {
  assertCan(ctx, "import.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, companyId: ctx.companyId } });
    if (!batch) return null;
    const rows = await tx.importRow.findMany({ where: { companyId: ctx.companyId, batchId }, select: { rowNo: true, status: true, payload: true, entityId: true } });
    const counts: Record<string, number> = { READY: 0, DUPLICATE: 0, ERROR: 0, IMPORTED: 0, FAILED: 0 };
    for (const r of rows) counts[r.status]++;
    const checks: Check[] = [];
    const imported = rows.filter((r) => r.status === "IMPORTED");
    const ids = imported.map((r) => r.entityId!) ;
    const kobo = (k: bigint) => koboToPlain(k);
    const lastLine = rows.reduce((m, r) => Math.max(m, r.rowNo), 1);
    checks.push({ label: "Every line of the file has exactly one outcome", expected: String(lastLine - 1), actual: String(rows.length), ok: lastLine - 1 === rows.length });
    if (batch.kind === "ASSETS") {
      const found = await tx.asset.count({ where: { companyId: ctx.companyId, id: { in: ids } } });
      checks.push({ label: "Assets created match the lines imported", expected: String(imported.length), actual: String(found), ok: found === imported.length });
      const aggr = await tx.asset.aggregate({ where: { companyId: ctx.companyId, id: { in: ids } }, _sum: { acquisitionCostKobo: true } });
      let want = 0n;
      for (const r of imported) { const v = (r.payload as Record<string, string>).acquisitionCost; if (v) { const [w, f = ""] = v.split("."); want += BigInt(w) * 100n + BigInt((f + "00").slice(0, 2)); } }
      const got = aggr._sum.acquisitionCostKobo ?? 0n;
      checks.push({ label: "Total acquisition cost, naira", expected: kobo(want), actual: kobo(got), ok: want === got });
    } else {
      const leases = await tx.lease.findMany({ where: { companyId: ctx.companyId, id: { in: ids } }, select: { id: true } });
      checks.push({ label: "Leases created match the lines imported", expected: String(imported.length), actual: String(leases.length), ok: leases.length === imported.length });
      let wantDue = 0n, wantPaid = 0n;
      for (const r of imported) { const p = r.payload as Record<string, string>; wantDue += BigInt(p.totalDueKobo); wantPaid += BigInt(p.paidKobo); }
      const due = await tx.rentCharge.aggregate({ where: { companyId: ctx.companyId, leaseId: { in: ids } }, _sum: { amountKobo: true } });
      const paidOnCharges = await tx.rentCharge.aggregate({ where: { companyId: ctx.companyId, leaseId: { in: ids } }, _sum: { paidKobo: true } });
      const receipts = await tx.receipt.aggregate({ where: { companyId: ctx.companyId, leaseId: { in: ids }, evidence: { startsWith: `IMPORT ${batch.ref} row ` } }, _sum: { amountKobo: true } });
      const gotDue = due._sum.amountKobo ?? 0n, gotPaid = paidOnCharges._sum.paidKobo ?? 0n, gotReceipts = receipts._sum.amountKobo ?? 0n;
      checks.push({ label: "Total rent scheduled, naira", expected: kobo(wantDue), actual: kobo(gotDue), ok: wantDue === gotDue });
      checks.push({ label: "Total already paid, on the rent charges, naira", expected: kobo(wantPaid), actual: kobo(gotPaid), ok: wantPaid === gotPaid });
      checks.push({ label: "Total already paid, on opening receipts, naira", expected: kobo(wantPaid), actual: kobo(gotReceipts), ok: wantPaid === gotReceipts });
      checks.push({ label: "Total still owed, naira", expected: kobo(wantDue - wantPaid), actual: kobo(gotDue - gotPaid), ok: wantDue - wantPaid === gotDue - gotPaid });
    }
    const balanced = checks.every((c) => c.ok);
    return { counts, total: rows.length, checks, balanced };
  });
}

export async function importRowsPage(ctx: Ctx, batchId: string, o: { status?: string; page?: number } = {}) {
  assertCan(ctx, "import.manage");
  const status = ["READY", "DUPLICATE", "ERROR", "IMPORTED", "FAILED"].includes(o.status ?? "") ? (o.status as "READY") : undefined;
  const page = Math.max(1, Math.floor(o.page ?? 1));
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, companyId: ctx.companyId } });
    if (!batch) return null;
    const where = { companyId: ctx.companyId, batchId, ...(status ? { status } : {}) };
    const [total, rows] = await Promise.all([
      tx.importRow.count({ where }),
      tx.importRow.findMany({ where, orderBy: { rowNo: "asc" }, skip: (page - 1) * IMPORT_PAGE, take: IMPORT_PAGE }),
    ]);
    return { batch, rows, total, page, pageSize: IMPORT_PAGE };
  });
}

/** The whole outcome as a spreadsheet: every line, what happened and why. */
export async function importReportCsv(ctx: Ctx, batchId: string): Promise<{ csv: string; ref: string } | null> {
  assertCan(ctx, "import.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, companyId: ctx.companyId } });
    if (!batch) return null;
    const rows = await tx.importRow.findMany({ where: { companyId: ctx.companyId, batchId }, orderBy: { rowNo: "asc" } });
    const label = (p: Record<string, unknown>) => String(p.name ?? p.occupantName ?? ((p.cells as Record<string, string> | undefined)?.name ?? (p.cells as Record<string, string> | undefined)?.occupantName ?? ""));
    return { ref: batch.ref, csv: toCsv(["Line in file", "Result", "Name", "Reason"], rows.map((r) => [r.rowNo, r.status, label(r.payload as Record<string, unknown>), r.message])) };
  });
}
