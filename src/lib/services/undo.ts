import type { Prisma } from "@prisma/client";
import { withPlatformAdmin, withUser } from "../db";
import type { Ctx } from "./context";

// Undo for everyday actions. After an action, the service records how to reverse it; the toast shows "Undo" for a few seconds.
// Undoing runs as the same person, in the same workspace, through the normal services and database rules, so it can never do
// anything the person could not do themselves. Each entry works once and expires after two minutes.
//
// Never undoable (deliberately): payments, refunds and anything in the books; approvals and decisions; verifications; account
// removal and data deletion requests; legal and financial records; messages and emails already sent.

export const UNDO_SECONDS = 120;

export type UndoActor = { userId: string; member: Ctx | null };
type Handler = (actor: UndoActor, payload: Prisma.JsonValue) => Promise<void>;
const handlers = new Map<string, Handler>();

/** Register how to reverse one kind of action. */
export function undoable(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

/** Remember how to reverse what just happened. Returns the id the Undo button sends back. */
export async function recordUndo(o: { userId: string; companyId?: string | null; kind: string; label: string; payload: Prisma.InputJsonValue; seconds?: number }): Promise<string> {
  const row = await withUser(o.userId, (tx) => tx.undoEntry.create({
    data: { userId: o.userId, companyId: o.companyId ?? null, kind: o.kind, label: o.label.slice(0, 200), payload: o.payload, expiresAt: new Date(Date.now() + (o.seconds ?? UNDO_SECONDS) * 1000) },
    select: { id: true },
  }));
  return row.id;
}

/**
 * Reverse an action. Only the person who did it, only once, only in time, and for workspace actions only while they are in the same
 * workspace. Returns what was undone, for the message.
 */
export async function runUndo(actor: UndoActor, id: string, now = new Date()): Promise<string> {
  // Claim the entry first so a double click undoes once.
  const entry = await withUser(actor.userId, async (tx) => {
    const e = await tx.undoEntry.findFirst({ where: { id, userId: actor.userId } });
    if (!e) return null;
    const claimed = await tx.undoEntry.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    return claimed.count ? e : { ...e, gone: true as const };
  });
  if (!entry) throw new Error("There is nothing to undo.");
  if ("gone" in entry) throw new Error(entry.usedAt ? "That was already undone." : "It is too late to undo that.");
  if (entry.companyId && entry.companyId !== actor.member?.companyId) {
    await withUser(actor.userId, (tx) => tx.undoEntry.update({ where: { id }, data: { usedAt: null } }));
    throw new Error("Switch back to the workspace where you did this, then undo it.");
  }
  const handler = handlers.get(entry.kind);
  if (!handler) throw new Error("This can no longer be undone.");
  try {
    await handler(actor, entry.payload);
  } catch (e) {
    // Leave it claimed: the state has moved on, and trying again would not help.
    throw e instanceof Error ? e : new Error("This could not be undone.");
  }
  return entry.label;
}

/** Old entries are of no use once expired; the scheduled job clears them. */
export async function purgeUndo(now = new Date()) {
  return withPlatformAdmin("system", (tx) => tx.undoEntry.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 3600_000) } } })).then((r) => r.count);
}
