import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import { nextNumber } from "../numbering";
import { can } from "../permissions";
import {
  adjustmentProblem, compareSchedules, countApprovalProblem, countSubmissionProblem, DIRECT_KINDS, isLowStock, movementProblem,
  reviewedDelta, REVIEWED_KINDS, type DirectKind, type ReviewedKind, type RoomLine,
} from "../inventory-rules";
import { savePhoto, photosFor, type Upload } from "./photos";
import { assertCan, type Ctx } from "./context";

// Inventory (master prompt Section 15): register, stock movements, adjustments, physical counts and
// room-by-room handover schedules. A balance changes only through a movement, and every movement
// records who performed it and, for changes to the books, who approved it.

export const INVENTORY_KINDS = ["FIXED_ASSET", "MOVABLE", "CONSUMABLE"] as const;
export const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR", "CRITICAL"] as const;
export { DIRECT_KINDS, REVIEWED_KINDS };

const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const optionalMoney = z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null));
const optionalInt = (label: string) =>
  z.string().trim().optional().transform((v, c): number | null => {
    if (!v) return null;
    if (!/^\d{1,7}$/.test(v)) { c.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a whole number` }); return z.NEVER; }
    return Number(v);
  });

async function lockItem(tx: Tx, id: string, companyId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM inventory_items WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, companyId);
  if (rows.length === 0) throw new Error("Inventory item not found");
}

async function activeMember(tx: Tx, companyId: string, membershipId: string | null) {
  if (!membershipId) return null;
  const m = await tx.membership.findFirst({ where: { id: membershipId, companyId, status: "ACTIVE" }, select: { id: true } });
  if (!m) throw new Error("Choose an active member of your company as the custodian");
  return m;
}

async function addMovement(
  tx: Tx, ctx: Ctx,
  m: { itemId: string; kind: DirectKind | ReviewedKind; delta: number; balanceAfter: number; fromLocation?: string; toLocation?: string;
    workOrderId?: string | null; reference?: string; note?: string; performedById?: string; approvedById?: string | null; adjustmentId?: string | null; countId?: string | null },
) {
  return tx.inventoryMovement.create({
    data: {
      companyId: ctx.companyId, itemId: m.itemId, kind: m.kind, delta: m.delta, balanceAfter: m.balanceAfter,
      fromLocation: m.fromLocation ?? "", toLocation: m.toLocation ?? "", workOrderId: m.workOrderId ?? null,
      reference: (m.reference ?? "").slice(0, 200), note: (m.note ?? "").slice(0, 1000),
      performedById: m.performedById ?? ctx.userId, approvedById: m.approvedById ?? null, adjustmentId: m.adjustmentId ?? null, countId: m.countId ?? null,
    },
  });
}

// ---------- Register ----------

const itemSchema = z.object({
  name: z.string().trim().min(2, "Enter the item's name").max(200),
  category: z.string().trim().max(100).default(""),
  kind: z.enum(INVENTORY_KINDS),
  assetId: z.string().optional().transform((v) => v || null),
  serialNumber: z.string().trim().max(100).default(""),
  model: z.string().trim().max(100).default(""),
  manufacturer: z.string().trim().max(100).default(""),
  unit: z.string().trim().max(30).default("pcs").transform((v) => v || "pcs"),
  quantity: optionalInt("The opening quantity"),
  condition: z.enum(CONDITIONS).default("GOOD"),
  location: z.string().trim().max(200).default(""),
  custodianId: z.string().optional().transform((v) => v || null),
  acquiredOn: optionalDate,
  unitCost: optionalMoney,
  ownership: z.string().trim().max(100).default("Owned").transform((v) => v || "Owned"),
  warrantyUntil: optionalDate,
  reorderLevel: optionalInt("The reorder level"),
  code: z.string().trim().max(100).default(""),
  notes: z.string().trim().max(2000).default(""),
});

export async function createItem(ctx: Ctx, input: z.input<typeof itemSchema>) {
  assertCan(ctx, "inventory.manage");
  const d = itemSchema.parse(input);
  const opening = d.quantity ?? 0;
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (d.assetId) {
      const a = await tx.asset.findFirst({ where: { id: d.assetId, companyId: ctx.companyId }, select: { id: true } });
      if (!a) throw new Error("Asset not found");
    }
    await activeMember(tx, ctx.companyId, d.custodianId);
    const n = await nextNumber(tx, ctx.companyId, "INV", 0);
    const itemNo = `INV-${String(n).padStart(4, "0")}`;
    const code = d.code || itemNo;
    const clash = await tx.inventoryItem.findFirst({ where: { companyId: ctx.companyId, OR: [{ code }, { itemNo: code }] }, select: { id: true } });
    if (clash) throw new Error("That code is already used by another item");
    const item = await tx.inventoryItem.create({
      data: {
        companyId: ctx.companyId, itemNo, code, name: d.name, category: d.category, kind: d.kind, assetId: d.assetId, serialNumber: d.serialNumber,
        model: d.model, manufacturer: d.manufacturer, unit: d.unit, quantity: opening, condition: d.condition, location: d.location,
        custodianId: d.custodianId, acquiredOn: d.acquiredOn, unitCostKobo: d.unitCost, ownership: d.ownership, warrantyUntil: d.warrantyUntil,
        reorderLevel: d.reorderLevel, notes: d.notes, createdById: ctx.userId,
      },
    });
    if (opening > 0) await addMovement(tx, ctx, { itemId: item.id, kind: "RECEIPT", delta: opening, balanceAfter: opening, toLocation: d.location, note: "Opening balance" });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_item", entityId: item.id, action: "inventory.item_created", detail: { itemNo, name: d.name, kind: d.kind, opening } });
    return item;
  });
}

const updateSchema = itemSchema.pick({
  name: true, category: true, serialNumber: true, model: true, manufacturer: true, unit: true, condition: true, location: true,
  custodianId: true, warrantyUntil: true, reorderLevel: true, code: true, notes: true, ownership: true,
});

/** Change the details of an item. The quantity is never edited here; only movements change it. */
export async function updateItem(ctx: Ctx, id: string, input: z.input<typeof updateSchema>) {
  assertCan(ctx, "inventory.manage");
  const d = updateSchema.parse(input);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockItem(tx, id, ctx.companyId);
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
    if (item.status === "DISPOSED") throw new Error("A disposed item cannot be edited");
    await activeMember(tx, ctx.companyId, d.custodianId);
    const code = d.code || item.itemNo;
    if (code !== item.code) {
      const clash = await tx.inventoryItem.findFirst({ where: { companyId: ctx.companyId, id: { not: id }, OR: [{ code }, { itemNo: code }] }, select: { id: true } });
      if (clash) throw new Error("That code is already used by another item");
    }
    await tx.inventoryItem.update({
      where: { id },
      data: {
        name: d.name, category: d.category, serialNumber: d.serialNumber, model: d.model, manufacturer: d.manufacturer, unit: d.unit,
        condition: d.condition, location: d.location, custodianId: d.custodianId, warrantyUntil: d.warrantyUntil, reorderLevel: d.reorderLevel,
        code, notes: d.notes, ownership: d.ownership,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_item", entityId: id, action: "inventory.item_updated", detail: { itemNo: item.itemNo } });
  });
}

// ---------- Movements ----------

const movementSchema = z.object({
  kind: z.enum(DIRECT_KINDS),
  quantity: z.string().trim().default("1"),
  toLocation: z.string().trim().max(200).default(""),
  custodianId: z.string().optional().transform((v) => v || null),
  reference: z.string().trim().max(200).default(""),
  note: z.string().trim().max(1000).default(""),
});

/** Receipt, issue, transfer, return or consumption. These happen at once and record who did them. */
export async function recordMovement(ctx: Ctx, itemId: string, input: z.input<typeof movementSchema>) {
  assertCan(ctx, "inventory.move");
  const d = movementSchema.parse(input);
  const quantity = d.kind === "TRANSFER" ? 0 : /^\d{1,7}$/.test(d.quantity) ? Number(d.quantity) : 0;
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockItem(tx, itemId, ctx.companyId);
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.status !== "ACTIVE") throw new Error("This item has been disposed of");
    const custodianChange = d.custodianId !== null && d.custodianId !== item.custodianId;
    const problem = movementProblem({ kind: d.kind, quantity, balance: item.quantity, toLocation: d.toLocation, custodianChange });
    if (problem) throw new Error(problem);
    await activeMember(tx, ctx.companyId, d.custodianId);
    const delta = d.kind === "RECEIPT" || d.kind === "RETURN" ? quantity : d.kind === "TRANSFER" ? 0 : -quantity;
    const balanceAfter = item.quantity + delta;
    const toLocation = d.kind === "TRANSFER" ? (d.toLocation || item.location) : d.toLocation;
    await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        quantity: balanceAfter,
        ...(d.kind === "TRANSFER" ? { location: toLocation, ...(custodianChange ? { custodianId: d.custodianId } : {}) } : {}),
      },
    });
    const mv = await addMovement(tx, ctx, {
      itemId, kind: d.kind, delta, balanceAfter, fromLocation: item.location, toLocation, reference: d.reference,
      note: d.note || (custodianChange ? "Custody changed" : ""),
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_item", entityId: itemId, action: `inventory.${d.kind.toLowerCase()}`, detail: { itemNo: item.itemNo, delta, balanceAfter } });
    return mv;
  });
}

const useSchema = z.object({ quantity: z.string().trim().regex(/^\d{1,7}$/, "Enter the quantity as a whole number") });

/** Take consumable stock out for a work order. This records the movement and the work order's material together. */
export async function useOnWorkOrder(ctx: Ctx, itemId: string, workOrderId: string, input: z.input<typeof useSchema>) {
  assertCan(ctx, "maintenance.work");
  assertCan(ctx, "inventory.move");
  const quantity = Number(useSchema.parse(input).quantity);
  if (quantity <= 0) throw new Error("Enter a quantity of one or more");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    // Always lock the work order first, then the item, so concurrent requests cannot deadlock.
    const wos = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM work_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`, workOrderId, ctx.companyId);
    if (wos.length === 0) throw new Error("Work order not found");
    await lockItem(tx, itemId, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
    if (wo.assigneeId !== ctx.membershipId && !can(ctx.role, "maintenance.manage")) throw new Error("Only the assigned officer or a manager can update this work order");
    if (["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status)) throw new Error("Materials cannot be changed once the work is completed");
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.status !== "ACTIVE") throw new Error("This item has been disposed of");
    if (item.kind !== "CONSUMABLE") throw new Error("Only consumable stock can be used on a work order");
    const problem = movementProblem({ kind: "CONSUMPTION", quantity, balance: item.quantity, toLocation: "", custodianChange: false });
    if (problem) throw new Error(problem);
    const balanceAfter = item.quantity - quantity;
    await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: balanceAfter } });
    await addMovement(tx, ctx, { itemId, kind: "CONSUMPTION", delta: -quantity, balanceAfter, fromLocation: item.location, workOrderId, reference: wo.ref, note: `Used on ${wo.ref}` });
    const material = await tx.workOrderMaterial.create({
      data: { companyId: ctx.companyId, workOrderId, description: item.name, quantity, unit: item.unit, unitCostKobo: item.unitCostKobo ?? 0n, recordedById: ctx.userId, inventoryItemId: itemId },
    });
    await tx.workOrderEvent.create({
      data: { companyId: ctx.companyId, workOrderId, kind: "MATERIAL_ADDED", fromStatus: wo.status, toStatus: wo.status, note: `${quantity} ${item.unit} ${item.name} from stock (${item.itemNo})`.slice(0, 1000), actorId: ctx.userId },
    });
    return material;
  });
}

// ---------- Adjustments (reviewed) ----------

const adjustSchema = z.object({
  kind: z.enum(REVIEWED_KINDS),
  quantity: z.string().trim().regex(/^\d{1,7}$/, "Enter the quantity as a whole number"),
  direction: z.enum(["UP", "DOWN"]).default("DOWN"),
  reason: z.string().trim().max(1000).default(""),
});

export async function requestAdjustment(ctx: Ctx, itemId: string, input: z.input<typeof adjustSchema>) {
  assertCan(ctx, "inventory.move");
  const d = adjustSchema.parse(input);
  const delta = reviewedDelta(d.kind, Number(d.quantity), d.direction);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const item = await tx.inventoryItem.findFirst({ where: { id: itemId, companyId: ctx.companyId } });
    if (!item) throw new Error("Inventory item not found");
    if (item.status !== "ACTIVE") throw new Error("This item has been disposed of");
    const problem = adjustmentProblem({ kind: d.kind, delta, balance: item.quantity, reason: d.reason });
    if (problem) throw new Error(problem);
    const adj = await tx.inventoryAdjustment.create({ data: { companyId: ctx.companyId, itemId, kind: d.kind, delta, reason: d.reason, requestedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_item", entityId: itemId, action: "inventory.adjustment_requested", detail: { adjustmentId: adj.id, kind: d.kind, delta } });
    return adj;
  });
}

/** Approve or reject an adjustment. The approver must be someone other than the person who asked for it. */
export async function decideAdjustment(ctx: Ctx, adjustmentId: string, decision: "approve" | "reject", noteInput: string) {
  assertCan(ctx, "inventory.approve");
  const note = z.string().trim().max(1000).parse(noteInput);
  if (decision === "reject" && note.length < 3) throw new Error("Say why this is being rejected");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM inventory_adjustments WHERE id = $1 AND company_id = $2 FOR UPDATE`, adjustmentId, ctx.companyId);
    if (rows.length === 0) throw new Error("Adjustment not found");
    const adj = await tx.inventoryAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
    if (adj.status !== "PENDING") throw new Error("This adjustment has already been decided");
    if (adj.requestedById === ctx.userId) throw new Error("An adjustment must be approved by someone other than the person who asked for it");
    if (decision === "reject") {
      await tx.inventoryAdjustment.update({ where: { id: adjustmentId }, data: { status: "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
      await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_item", entityId: adj.itemId, action: "inventory.adjustment_rejected", detail: { adjustmentId, note } });
      return;
    }
    await lockItem(tx, adj.itemId, ctx.companyId);
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: adj.itemId } });
    if (item.status !== "ACTIVE") throw new Error("This item has been disposed of");
    const problem = adjustmentProblem({ kind: adj.kind as ReviewedKind, delta: adj.delta, balance: item.quantity, reason: adj.reason });
    if (problem) throw new Error(problem);
    const balanceAfter = item.quantity + adj.delta;
    await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: balanceAfter, ...(adj.kind === "DISPOSAL" && balanceAfter === 0 ? { status: "DISPOSED" } : {}) } });
    await addMovement(tx, ctx, {
      itemId: item.id, kind: adj.kind as ReviewedKind, delta: adj.delta, balanceAfter, fromLocation: item.location, note: adj.reason,
      performedById: adj.requestedById, approvedById: ctx.userId, adjustmentId,
    });
    await tx.inventoryAdjustment.update({ where: { id: adjustmentId }, data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_item", entityId: item.id, action: "inventory.adjustment_approved", detail: { adjustmentId, kind: adj.kind, delta: adj.delta, balanceAfter } });
  });
}

// ---------- Physical counts ----------

const countStartSchema = z.object({
  title: z.string().trim().min(3, "Name the count").max(200),
  assetId: z.string().optional().transform((v) => v || null),
});

export async function startCount(ctx: Ctx, input: z.input<typeof countStartSchema>) {
  assertCan(ctx, "inventory.manage");
  const d = countStartSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (d.assetId) {
      const a = await tx.asset.findFirst({ where: { id: d.assetId, companyId: ctx.companyId }, select: { id: true } });
      if (!a) throw new Error("Asset not found");
    }
    const items = await tx.inventoryItem.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE", ...(d.assetId ? { assetId: d.assetId } : {}) }, select: { id: true, quantity: true }, orderBy: { itemNo: "asc" } });
    if (items.length === 0) throw new Error("There are no items to count");
    const year = todayInLagos().getUTCFullYear();
    const n = await nextNumber(tx, ctx.companyId, "STK", year);
    const count = await tx.inventoryCount.create({ data: { companyId: ctx.companyId, ref: `STK-${year}-${String(n).padStart(4, "0")}`, title: d.title, assetId: d.assetId, startedById: ctx.userId } });
    await tx.inventoryCountLine.createMany({ data: items.map((i) => ({ companyId: ctx.companyId, countId: count.id, itemId: i.id, expectedQty: i.quantity })) });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_count", entityId: count.id, action: "inventory.count_started", detail: { ref: count.ref, lines: items.length } });
    return count;
  });
}

async function lockCount(tx: Tx, id: string, companyId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM inventory_counts WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, companyId);
  if (rows.length === 0) throw new Error("Count not found");
}

/** Record counted quantities. `entries` maps a line id to the counted number; blank values are ignored. */
export async function saveCountLines(ctx: Ctx, countId: string, entries: Record<string, { counted: string; note?: string }>) {
  assertCan(ctx, "inventory.count");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockCount(tx, countId, ctx.companyId);
    const count = await tx.inventoryCount.findUniqueOrThrow({ where: { id: countId } });
    if (count.status !== "OPEN") throw new Error("This count is no longer open for counting");
    let saved = 0;
    for (const [lineId, e] of Object.entries(entries)) {
      const text = (e.counted ?? "").trim();
      if (text === "") continue;
      if (!/^\d{1,7}$/.test(text)) throw new Error("Counted quantities must be whole numbers");
      const line = await tx.inventoryCountLine.findFirst({ where: { id: lineId, countId, companyId: ctx.companyId } });
      if (!line) throw new Error("Count line not found");
      await tx.inventoryCountLine.update({ where: { id: lineId }, data: { countedQty: Number(text), note: (e.note ?? "").trim().slice(0, 500), countedById: ctx.userId } });
      saved += 1;
    }
    return saved;
  });
}

export async function submitCount(ctx: Ctx, countId: string) {
  assertCan(ctx, "inventory.count");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockCount(tx, countId, ctx.companyId);
    const count = await tx.inventoryCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: true } });
    if (count.status !== "OPEN") throw new Error("This count has already been submitted");
    const problem = countSubmissionProblem(count.lines.map((l) => ({ counted: l.countedQty })));
    if (problem) throw new Error(problem);
    await tx.inventoryCount.update({ where: { id: countId }, data: { status: "SUBMITTED", submittedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_count", entityId: countId, action: "inventory.count_submitted", detail: { ref: count.ref } });
  });
}

/**
 * Approve a count, which writes an adjustment for every variance against the balance at that moment, or send it back.
 * The approver must not have counted any line or submitted the count.
 */
export async function decideCount(ctx: Ctx, countId: string, decision: "approve" | "return", noteInput: string) {
  assertCan(ctx, "inventory.approve");
  const note = z.string().trim().max(1000).parse(noteInput);
  if (decision === "return" && note.length < 3) throw new Error("Say what needs to be recounted");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockCount(tx, countId, ctx.companyId);
    const count = await tx.inventoryCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: { orderBy: { itemId: "asc" } } } });
    if (count.status !== "SUBMITTED") throw new Error("Only a submitted count can be decided");
    const problem = countApprovalProblem({ approverId: ctx.userId, submittedById: count.submittedById, counterIds: count.lines.map((l) => l.countedById).filter((x): x is string => !!x) });
    if (problem) throw new Error(problem);
    if (decision === "return") {
      await tx.inventoryCount.update({ where: { id: countId }, data: { status: "OPEN", submittedById: null, decisionNote: note } });
      await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_count", entityId: countId, action: "inventory.count_returned", detail: { ref: count.ref, note } });
      return 0;
    }
    const today = todayInLagos();
    let adjusted = 0;
    for (const line of count.lines) {
      await lockItem(tx, line.itemId, ctx.companyId);
      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: line.itemId } });
      if (item.status !== "ACTIVE" || line.countedQty === null) continue;
      const diff = line.countedQty - item.quantity;
      if (diff !== 0) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: line.countedQty } });
        await addMovement(tx, ctx, {
          itemId: item.id, kind: "ADJUSTMENT", delta: diff, balanceAfter: line.countedQty, fromLocation: item.location,
          note: `Count ${count.ref}: expected ${line.expectedQty}, counted ${line.countedQty}${line.note ? `. ${line.note}` : ""}`,
          performedById: line.countedById ?? count.submittedById ?? ctx.userId, approvedById: ctx.userId, countId,
        });
        adjusted += 1;
      }
      await tx.inventoryItem.update({ where: { id: item.id }, data: { lastVerifiedOn: today } });
    }
    await tx.inventoryCount.update({ where: { id: countId }, data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_count", entityId: countId, action: "inventory.count_approved", detail: { ref: count.ref, adjusted } });
    return adjusted;
  });
}

export async function cancelCount(ctx: Ctx, countId: string, reasonInput: string) {
  assertCan(ctx, "inventory.manage");
  const reason = z.string().trim().min(3, "Give the reason").max(500).parse(reasonInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockCount(tx, countId, ctx.companyId);
    const count = await tx.inventoryCount.findUniqueOrThrow({ where: { id: countId } });
    if (count.status !== "OPEN" && count.status !== "SUBMITTED") throw new Error("This count can no longer be cancelled");
    await tx.inventoryCount.update({ where: { id: countId }, data: { status: "CANCELLED", decisionNote: reason } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inventory_count", entityId: countId, action: "inventory.count_cancelled", detail: { ref: count.ref, reason } });
  });
}

// ---------- Handover inventory schedules ----------

export async function createHandoverSchedule(ctx: Ctx, leaseId: string, kind: "MOVE_IN" | "MOVE_OUT") {
  assertCan(ctx, "handover.record");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, companyId: ctx.companyId }, select: { id: true, ref: true } });
    if (!lease) throw new Error("Lease not found");
    const existing = await tx.handoverSchedule.findUnique({ where: { leaseId_kind: { leaseId, kind } } });
    if (existing) throw new Error("There is already an inventory schedule of this kind for this lease");
    const row = await tx.handoverSchedule.create({ data: { companyId: ctx.companyId, leaseId, kind, recordedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId, action: "handover_schedule.created", detail: { kind } });
    return row;
  });
}

const lineSchema = z.object({
  room: z.string().trim().min(2, "Enter the room").max(100),
  description: z.string().trim().min(2, "Describe the item").max(200),
  quantity: z.string().trim().regex(/^\d{1,5}$/, "Enter the quantity as a whole number"),
  condition: z.enum(CONDITIONS).default("GOOD"),
  notes: z.string().trim().max(500).default(""),
});

async function draftSchedule(tx: Tx, ctx: Ctx, scheduleId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM handover_schedules WHERE id = $1 AND company_id = $2 FOR UPDATE`, scheduleId, ctx.companyId);
  if (rows.length === 0) throw new Error("Schedule not found");
  const s = await tx.handoverSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
  if (s.status !== "DRAFT") throw new Error("This schedule has been acknowledged and can no longer be changed");
  return s;
}

export async function addScheduleLine(ctx: Ctx, scheduleId: string, input: z.input<typeof lineSchema>, photo: (Upload & { caption?: string }) | null = null) {
  assertCan(ctx, "handover.record");
  const d = lineSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await draftSchedule(tx, ctx, scheduleId);
    const count = await tx.handoverScheduleLine.count({ where: { scheduleId } });
    const line = await tx.handoverScheduleLine.create({
      data: { companyId: ctx.companyId, scheduleId, room: d.room, description: d.description, quantity: Number(d.quantity), condition: d.condition, notes: d.notes, sortOrder: count },
    });
    if (photo) await savePhoto(tx, ctx, "handover_line", line.id, { phase: "EVIDENCE", caption: photo.caption ?? "" }, photo);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: s.leaseId, action: "handover_schedule.line_added", detail: { kind: s.kind, room: d.room, description: d.description } });
    return line;
  });
}

export async function removeScheduleLine(ctx: Ctx, scheduleId: string, lineId: string) {
  assertCan(ctx, "handover.record");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await draftSchedule(tx, ctx, scheduleId);
    const line = await tx.handoverScheduleLine.findFirst({ where: { id: lineId, scheduleId, companyId: ctx.companyId } });
    if (!line) throw new Error("Line not found");
    const photos = await tx.evidencePhoto.count({ where: { companyId: ctx.companyId, subjectType: "handover_line", subjectId: lineId } });
    if (photos > 0) throw new Error("This line has a photograph and cannot be removed");
    await tx.handoverScheduleLine.delete({ where: { id: lineId } });
  });
}

export async function addSchedulePhoto(ctx: Ctx, scheduleId: string, lineId: string, meta: { caption?: string }, file: Upload) {
  assertCan(ctx, "handover.record");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await draftSchedule(tx, ctx, scheduleId);
    const line = await tx.handoverScheduleLine.findFirst({ where: { id: lineId, scheduleId, companyId: ctx.companyId } });
    if (!line) throw new Error("Line not found");
    return savePhoto(tx, ctx, "handover_line", lineId, { phase: "EVIDENCE", caption: meta.caption ?? "" }, file);
  });
}

const ackSchema = z.object({
  acknowledgedBy: z.string().trim().min(2, "Enter the name of the person acknowledging").max(200),
  acknowledgedOn: z.string().transform((v) => parseDateOnly(v)),
});

/** Record that the tenant or occupant has seen and accepted the schedule. After this it cannot change. */
export async function acknowledgeSchedule(ctx: Ctx, scheduleId: string, input: z.input<typeof ackSchema>) {
  assertCan(ctx, "handover.record");
  const d = ackSchema.parse(input);
  if (d.acknowledgedOn > todayInLagos()) throw new Error("The acknowledgement date cannot be in the future");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await draftSchedule(tx, ctx, scheduleId);
    const lines = await tx.handoverScheduleLine.count({ where: { scheduleId } });
    if (lines === 0) throw new Error("Add at least one item before the schedule is acknowledged");
    await tx.handoverSchedule.update({ where: { id: scheduleId }, data: { status: "ACKNOWLEDGED", acknowledgedBy: d.acknowledgedBy, acknowledgedOn: d.acknowledgedOn } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: s.leaseId, action: "handover_schedule.acknowledged", detail: { kind: s.kind, by: d.acknowledgedBy, lines } });
  });
}

// ---------- Reading ----------

async function nameMap(tx: Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>;
}

export async function listInventory(ctx: Ctx, filter: { assetId?: string; q?: string } = {}) {
  assertCan(ctx, "asset.view");
  const q = (filter.q ?? "").trim();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [items, assets, members, pending, counts] = await Promise.all([
      tx.inventoryItem.findMany({
        where: {
          companyId: ctx.companyId, ...(filter.assetId ? { assetId: filter.assetId } : {}),
          ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { equals: q, mode: "insensitive" } }, { itemNo: { equals: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }] } : {}),
        },
        orderBy: { itemNo: "asc" }, take: 500,
        include: { asset: { select: { id: true, ref: true, name: true } }, custodian: { select: { user: { select: { name: true } } } } },
      }),
      tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
      tx.inventoryAdjustment.findMany({ where: { companyId: ctx.companyId, status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { item: { select: { id: true, itemNo: true, name: true, quantity: true, unit: true } } } }),
      tx.inventoryCount.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const names = await nameMap(tx, pending.map((p) => p.requestedById));
    return {
      items, assets, members: members.map((m) => ({ id: m.id, name: m.user.name })), pending, names, counts,
      lowStock: items.filter((i) => isLowStock({ kind: i.kind, status: i.status, quantity: i.quantity, reorderLevel: i.reorderLevel })),
    };
  });
}

export async function getItem(ctx: Ctx, id: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const item = await tx.inventoryItem.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { asset: { select: { id: true, ref: true, name: true } }, custodian: { select: { user: { select: { name: true } } } } },
    });
    if (!item) return null;
    const [movements, adjustments, members, workOrders] = await Promise.all([
      tx.inventoryMovement.findMany({ where: { companyId: ctx.companyId, itemId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
      tx.inventoryAdjustment.findMany({ where: { companyId: ctx.companyId, itemId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
      tx.workOrder.findMany({ where: { companyId: ctx.companyId, status: { in: ["REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED"] }, assigneeId: ctx.membershipId }, select: { id: true, ref: true, title: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const names = await nameMap(tx, [...movements.flatMap((m) => [m.performedById, m.approvedById]), ...adjustments.flatMap((a) => [a.requestedById, a.decidedById])]);
    const woRefs = Object.fromEntries((await tx.workOrder.findMany({ where: { id: { in: movements.map((m) => m.workOrderId).filter((x): x is string => !!x) } }, select: { id: true, ref: true } })).map((w) => [w.id, w.ref]));
    return { item, movements, adjustments, names, members: members.map((m) => ({ id: m.id, name: m.user.name })), myWorkOrders: workOrders, woRefs };
  });
}

/** Find an item by the code on its label (the item number, the code or the serial number). */
export async function findItemByCode(ctx: Ctx, codeInput: string) {
  assertCan(ctx, "asset.view");
  const code = codeInput.trim();
  if (!code) return null;
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.inventoryItem.findFirst({
      where: { companyId: ctx.companyId, OR: [{ code: { equals: code, mode: "insensitive" } }, { itemNo: { equals: code, mode: "insensitive" } }, { serialNumber: { equals: code, mode: "insensitive" } }] },
      select: { id: true, itemNo: true, name: true },
    }));
}

export async function getCount(ctx: Ctx, id: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const count = await tx.inventoryCount.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { lines: { include: { item: { select: { id: true, itemNo: true, name: true, unit: true, location: true, quantity: true } } }, orderBy: { item: { itemNo: "asc" } } } },
    });
    if (!count) return null;
    const names = await nameMap(tx, [count.startedById, count.submittedById, count.decidedById, ...count.lines.map((l) => l.countedById)]);
    return { count, names };
  });
}

export async function getHandoverInventory(ctx: Ctx, leaseId: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, companyId: ctx.companyId }, select: { id: true, ref: true, occupantName: true, asset: { select: { id: true, ref: true, name: true } } } });
    if (!lease) return null;
    const schedules = await tx.handoverSchedule.findMany({ where: { companyId: ctx.companyId, leaseId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    const photos = await photosFor(tx, ctx.companyId, "handover_line", schedules.flatMap((s) => s.lines.map((l) => l.id)));
    const moveIn = schedules.find((s) => s.kind === "MOVE_IN") ?? null;
    const moveOut = schedules.find((s) => s.kind === "MOVE_OUT") ?? null;
    const asLines = (s: typeof moveIn): RoomLine[] => (s ? s.lines.map((l) => ({ room: l.room, description: l.description, quantity: l.quantity, condition: l.condition })) : []);
    return { lease, moveIn, moveOut, photos, comparison: moveIn && moveOut ? compareSchedules(asLines(moveIn), asLines(moveOut)) : null };
  });
}

/** Figures for the maintenance and inventory dashboard. */
export async function inventorySummary(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [items, pending, openCounts] = await Promise.all([
      tx.inventoryItem.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, select: { kind: true, status: true, quantity: true, reorderLevel: true, unitCostKobo: true } }),
      tx.inventoryAdjustment.count({ where: { companyId: ctx.companyId, status: "PENDING" } }),
      tx.inventoryCount.count({ where: { companyId: ctx.companyId, status: { in: ["OPEN", "SUBMITTED"] } } }),
    ]);
    return {
      items: items.length, lowStock: items.filter((i) => isLowStock(i)).length, pendingAdjustments: pending, openCounts,
      stockValueKobo: items.reduce((s, i) => s + BigInt(i.quantity) * (i.unitCostKobo ?? 0n), 0n),
    };
  });
}
