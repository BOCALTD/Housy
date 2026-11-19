// Pure rules for inventory (master prompt Section 15). Nothing here touches the database.

export type MovementKind = "RECEIPT" | "ISSUE" | "TRANSFER" | "RETURN" | "CONSUMPTION" | "ADJUSTMENT" | "LOSS" | "DAMAGE" | "DISPOSAL";
export type InventoryKind = "FIXED_ASSET" | "MOVABLE" | "CONSUMABLE";

/** Movements that happen straight away. The rest change the books and need a second person to approve. */
export const DIRECT_KINDS = ["RECEIPT", "ISSUE", "TRANSFER", "RETURN", "CONSUMPTION"] as const;
export const REVIEWED_KINDS = ["ADJUSTMENT", "LOSS", "DAMAGE", "DISPOSAL"] as const;
export type DirectKind = (typeof DIRECT_KINDS)[number];
export type ReviewedKind = (typeof REVIEWED_KINDS)[number];

/** The signed change a movement makes, given a positive quantity. Transfers change location, not the balance. */
export function signedDelta(kind: MovementKind, quantity: number): number {
  switch (kind) {
    case "RECEIPT": case "RETURN": return quantity;
    case "ISSUE": case "CONSUMPTION": case "LOSS": case "DAMAGE": case "DISPOSAL": return -quantity;
    case "TRANSFER": return 0;
    case "ADJUSTMENT": return quantity;
  }
}

/** Why a direct movement cannot be recorded, or null. */
export function movementProblem(input: { kind: DirectKind; quantity: number; balance: number; toLocation: string; custodianChange: boolean }): string | null {
  if (input.kind === "TRANSFER") {
    if (input.toLocation.trim().length < 2 && !input.custodianChange) return "Say where the item is moving to, or who now holds it";
    return null;
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) return "Enter a quantity of one or more";
  const delta = signedDelta(input.kind, input.quantity);
  if (input.balance + delta < 0) return `Only ${input.balance} in stock, so ${input.quantity} cannot be taken out`;
  return null;
}

/** Why an adjustment request is not valid, or null. `delta` is the signed change requested. */
export function adjustmentProblem(input: { kind: ReviewedKind; delta: number; balance: number; reason: string }): string | null {
  if (input.reason.trim().length < 5) return "Give the reason for the change";
  if (!Number.isInteger(input.delta) || input.delta === 0) return "Enter a quantity that is not zero";
  if (input.kind !== "ADJUSTMENT" && input.delta > 0) return "A loss, damage or disposal reduces stock";
  if (input.balance + input.delta < 0) return `Only ${input.balance} in stock, so the stock cannot go down by ${-input.delta}`;
  return null;
}

/** The signed change for a reviewed kind from a positive quantity the person typed. */
export function reviewedDelta(kind: ReviewedKind, quantity: number, direction: "UP" | "DOWN" = "DOWN"): number {
  if (kind === "ADJUSTMENT") return direction === "UP" ? quantity : -quantity;
  return -quantity;
}

export function isLowStock(item: { kind: InventoryKind; status: string; quantity: number; reorderLevel: number | null }): boolean {
  return item.kind === "CONSUMABLE" && item.status === "ACTIVE" && item.reorderLevel !== null && item.quantity <= item.reorderLevel;
}

/** Counted minus expected. Zero means the count agrees with the books. */
export function varianceOf(expected: number, counted: number | null): number | null {
  return counted === null ? null : counted - expected;
}

/** Why a count cannot be submitted yet, or null. */
export function countSubmissionProblem(lines: { counted: number | null }[]): string | null {
  if (lines.length === 0) return "This count has no items";
  const missing = lines.filter((l) => l.counted === null).length;
  if (missing > 0) return `${missing} item${missing === 1 ? " has" : "s have"} not been counted yet`;
  return null;
}

/** Why a person cannot approve a count, or null. The approver must not have submitted it or counted any line. */
export function countApprovalProblem(input: { approverId: string; submittedById: string | null; counterIds: string[] }): string | null {
  if (input.approverId === input.submittedById || input.counterIds.includes(input.approverId)) {
    return "A count must be approved by someone who did not count or submit it";
  }
  return null;
}

const RANK = { EXCELLENT: 0, GOOD: 1, FAIR: 2, POOR: 3, CRITICAL: 4 } as const;
export type Condition = keyof typeof RANK;
export const conditionRank = (c: Condition) => RANK[c];

export interface RoomLine { room: string; description: string; quantity: number; condition: Condition; itemId?: string | null }
export interface RoomDifference {
  room: string; description: string;
  kind: "MISSING" | "NEW" | "FEWER" | "MORE" | "WORSE" | "BETTER" | "SAME";
  before: RoomLine | null; after: RoomLine | null;
}

/** Lines that are register items are matched by item, wherever they were recorded; others by room and description. */
const key = (l: { room: string; description: string; itemId?: string | null }) => (l.itemId ? `item:${l.itemId}` : `${l.room.trim().toLowerCase()}|${l.description.trim().toLowerCase()}`);

/** Compare a move-in schedule with a move-out schedule, item by item within each room. */
export function compareSchedules(moveIn: RoomLine[], moveOut: RoomLine[]): RoomDifference[] {
  const out: RoomDifference[] = [];
  const after = new Map(moveOut.map((l) => [key(l), l]));
  const seen = new Set<string>();
  for (const b of moveIn) {
    const k = key(b);
    seen.add(k);
    const a = after.get(k) ?? null;
    let kind: RoomDifference["kind"] = "SAME";
    if (!a || a.quantity === 0) kind = "MISSING";
    else if (a.quantity < b.quantity) kind = "FEWER";
    else if (a.quantity > b.quantity) kind = "MORE";
    else if (RANK[a.condition] > RANK[b.condition]) kind = "WORSE";
    else if (RANK[a.condition] < RANK[b.condition]) kind = "BETTER";
    out.push({ room: b.room, description: b.description, kind, before: b, after: a });
  }
  for (const a of moveOut) if (!seen.has(key(a))) out.push({ room: a.room, description: a.description, kind: "NEW", before: null, after: a });
  return out;
}

// ---------- Value of lost or damaged items at move-out ----------

/** Differences that can carry a charge: missing, fewer, or handed back in worse condition. */
export const CHARGEABLE: RoomDifference["kind"][] = ["MISSING", "FEWER", "WORSE"];

/** A stable key for a difference, the same one the comparison matches lines by. */
export const chargeKey = (d: RoomDifference) => key((d.before ?? d.after)!);

/** How many items a charge is for: the ones not handed back, or (for worse condition) the ones handed back. */
export function chargeQuantity(d: RoomDifference): number {
  if (d.kind === "MISSING") return d.before?.quantity ?? 0;
  if (d.kind === "FEWER") return (d.before?.quantity ?? 0) - (d.after?.quantity ?? 0);
  if (d.kind === "WORSE") return d.after?.quantity ?? 0;
  return 0;
}

/** The share of an item's value lost for each step down in condition (excellent, good, fair, poor, critical). */
export const WEAR_SHARE_PER_STEP = 0.25;

/**
 * A starting value for a charge, from the register's unit cost: the full cost of each item not handed back, and a quarter of the
 * cost for each step down in condition for items handed back worse. Null when there is no unit cost to go on.
 */
export function suggestCharge(d: RoomDifference, unitCostKobo: bigint | null | undefined): bigint | null {
  if (!unitCostKobo || unitCostKobo <= 0n || !CHARGEABLE.includes(d.kind)) return null;
  const qty = BigInt(chargeQuantity(d));
  if (d.kind !== "WORSE") return unitCostKobo * qty;
  const steps = RANK[d.after!.condition] - RANK[d.before!.condition];
  const share = Math.min(1, steps * WEAR_SHARE_PER_STEP);
  return (unitCostKobo * qty * BigInt(Math.round(share * 100))) / 100n;
}

/** What can come out of the deposit, and what is left for the occupant to pay. */
export function splitAgainstDeposit(totalKobo: bigint, depositBalanceKobo: bigint) {
  const fromDeposit = totalKobo < depositBalanceKobo ? totalKobo : depositBalanceKobo > 0n ? depositBalanceKobo : 0n;
  return { fromDeposit, owed: totalKobo - fromDeposit };
}
