import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { formatKobo, parseNairaToKobo } from "../money";
import { CHARGEABLE, chargeKey, chargeQuantity, compareSchedules, splitAgainstDeposit, suggestCharge, type RoomLine } from "../inventory-rules";
import { deductDepositInTx, depositBalance } from "./ledger";
import { assertCan, type Ctx } from "./context";

// The money value of items lost or damaged between move-in and move-out. Each missing, short or worse item gets an amount, which
// starts from a suggestion based on the register's unit cost and is set by staff, with a note. A manager can then deduct the total
// from the deposit in one entry (once, up to the deposit still held); anything above the deposit is shown as still owed.

export type ChargeRow = {
  key: string; room: string; description: string; kind: "MISSING" | "FEWER" | "WORSE"; quantity: number;
  before: string; after: string; suggestedKobo: bigint | null; amountKobo: bigint | null; note: string;
};

async function load(tx: Tx, companyId: string, leaseId: string) {
  const schedules = await tx.handoverSchedule.findMany({ where: { companyId, leaseId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  const moveIn = schedules.find((s) => s.kind === "MOVE_IN") ?? null;
  const moveOut = schedules.find((s) => s.kind === "MOVE_OUT") ?? null;
  if (!moveIn || !moveOut) return null;
  const asLines = (ls: typeof moveIn.lines): RoomLine[] => ls.map((l) => ({ room: l.room, description: l.description, quantity: l.quantity, condition: l.condition, itemId: l.itemId }));
  const diffs = compareSchedules(asLines(moveIn.lines), asLines(moveOut.lines)).filter((d) => CHARGEABLE.includes(d.kind));
  const itemIds = [...new Set(diffs.map((d) => d.before?.itemId).filter((x): x is string => !!x))];
  const items = itemIds.length ? await tx.inventoryItem.findMany({ where: { companyId, id: { in: itemIds } }, select: { id: true, unitCostKobo: true } }) : [];
  const saved = await tx.handoverCharge.findMany({ where: { companyId, leaseId } });
  const show = (l: RoomLine | null) => (l ? `${l.quantity} · ${l.condition.charAt(0)}${l.condition.slice(1).toLowerCase()}` : "None");
  const rows: ChargeRow[] = diffs.map((d) => {
    const key = chargeKey(d);
    const s = saved.find((x) => x.lineKey === key);
    const cost = d.before?.itemId ? items.find((i) => i.id === d.before!.itemId)?.unitCostKobo ?? null : null;
    return {
      key, room: d.room, description: d.description, kind: d.kind as ChargeRow["kind"], quantity: chargeQuantity(d),
      before: show(d.before), after: show(d.after), suggestedKobo: suggestCharge(d, cost), amountKobo: s?.amountKobo ?? null, note: s?.note ?? "",
    };
  });
  return { moveIn, moveOut, rows };
}

/** The items that can carry a charge, their suggested and set values, the total, and how it stands against the deposit. */
export async function handoverCharges(ctx: Ctx, leaseId: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const d = await load(tx, ctx.companyId, leaseId);
    if (!d) return null;
    const total = d.rows.reduce((s, r) => s + (r.amountKobo ?? 0n), 0n);
    const balance = await depositBalance(tx, ctx.companyId, leaseId);
    const deductedEntry = d.moveOut.depositEntryId ? await tx.depositEntry.findFirst({ where: { id: d.moveOut.depositEntryId, companyId: ctx.companyId }, select: { amountKobo: true, entryDate: true } }) : null;
    return {
      rows: d.rows, totalKobo: total, depositBalanceKobo: balance, ...splitAgainstDeposit(total, balance),
      unset: d.rows.filter((r) => r.amountKobo == null).length,
      bothAcknowledged: d.moveIn.status === "ACKNOWLEDGED" && d.moveOut.status === "ACKNOWLEDGED",
      deductedAt: d.moveOut.chargesDeductedAt, deducted: deductedEntry,
    };
  });
}

/** Set the value of each item (an empty amount clears it). Not possible once the total has been deducted from the deposit. */
export async function saveHandoverCharges(ctx: Ctx, leaseId: string, entries: Record<string, { amount: string; note?: string }>) {
  assertCan(ctx, "handover.record");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, companyId: ctx.companyId }, select: { id: true } });
    if (!lease) throw new Error("Lease not found");
    const d = await load(tx, ctx.companyId, leaseId);
    if (!d) throw new Error("Record the move-in and the move-out schedules first");
    const locked = await tx.$queryRawUnsafe<{ charges_deducted_at: Date | null }[]>(`SELECT charges_deducted_at FROM handover_schedules WHERE id = $1 FOR UPDATE`, d.moveOut.id);
    if (locked[0]?.charges_deducted_at) throw new Error("These values were deducted from the deposit and can no longer be changed");
    let set = 0, cleared = 0;
    for (const [key, e] of Object.entries(entries)) {
      const row = d.rows.find((r) => r.key === key);
      if (!row) continue;
      const note = (e.note ?? "").trim().slice(0, 300);
      if (!e.amount.trim()) {
        const r = await tx.handoverCharge.deleteMany({ where: { companyId: ctx.companyId, leaseId, lineKey: key } });
        cleared += r.count;
        continue;
      }
      let amount: bigint;
      try { amount = parseNairaToKobo(e.amount); } catch { throw new Error(`Enter the value of ${row.description} as an amount, such as 15,000`); }
      if (amount < 0n) throw new Error(`The value of ${row.description} cannot be negative`);
      if (amount > 100_000_000_000n) throw new Error(`The value of ${row.description} is too large`);
      if (row.suggestedKobo != null && amount !== row.suggestedKobo && note.length < 3) throw new Error(`Add a note for ${row.description}: its value differs from the register's suggestion`);
      const data = { room: row.room, description: row.description, kind: row.kind, quantity: row.quantity, amountKobo: amount, suggestedKobo: row.suggestedKobo, note, setById: ctx.userId };
      await tx.handoverCharge.upsert({ where: { leaseId_lineKey: { leaseId, lineKey: key } }, create: { companyId: ctx.companyId, leaseId, lineKey: key, ...data }, update: data });
      set++;
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId, action: "handover.charges_set", detail: { set, cleared } });
    return { set, cleared };
  });
}

/**
 * Deduct the value of lost and damaged items from the deposit, in one entry, once. Both schedules must be acknowledged, every item
 * must have a value, and the tenancy must have ended. Only the part the deposit covers is deducted; the rest is reported as owed.
 */
export async function deductHandoverCharges(ctx: Ctx, leaseId: string) {
  assertCan(ctx, "deposit.settle");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const d = await load(tx, ctx.companyId, leaseId);
    if (!d) throw new Error("Record the move-in and the move-out schedules first");
    if (d.moveIn.status !== "ACKNOWLEDGED" || d.moveOut.status !== "ACKNOWLEDGED") throw new Error("Both the move-in and the move-out schedules must be acknowledged first");
    const locked = await tx.$queryRawUnsafe<{ charges_deducted_at: Date | null }[]>(`SELECT charges_deducted_at FROM handover_schedules WHERE id = $1 FOR UPDATE`, d.moveOut.id);
    if (locked[0]?.charges_deducted_at) throw new Error("The value of these items has already been deducted from the deposit");
    const unset = d.rows.filter((r) => r.amountKobo == null);
    if (unset.length) throw new Error(`Set a value for every item first (${unset.length} left; enter 0 for none)`);
    const charged = d.rows.filter((r) => (r.amountKobo ?? 0n) > 0n);
    const total = charged.reduce((s, r) => s + r.amountKobo!, 0n);
    if (total <= 0n) throw new Error("Nothing to deduct: every value is zero");
    const balance = await depositBalance(tx, ctx.companyId, leaseId);
    const { fromDeposit, owed } = splitAgainstDeposit(total, balance);
    if (fromDeposit <= 0n) throw new Error("No deposit is held on this lease to deduct from");
    const list = charged.map((r) => `${r.description} (${r.room}) ${formatKobo(r.amountKobo!)}`).join("; ");
    const reason = `Lost or damaged at move-out: ${list}`;
    const { entry } = await deductDepositInTx(tx, ctx, leaseId, fromDeposit, reason.length > 500 ? `${reason.slice(0, 480)}… (${charged.length} items)` : reason, "Handover inventory, move-in compared with move-out");
    await tx.handoverSchedule.update({ where: { id: d.moveOut.id }, data: { chargesDeductedAt: new Date(), depositEntryId: entry.id } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId, action: "handover.charges_deducted", detail: { totalKobo: total.toString(), fromDepositKobo: fromDeposit.toString(), owedKobo: owed.toString(), items: charged.length } });
    return { totalKobo: total, fromDeposit, owed };
  });
}
