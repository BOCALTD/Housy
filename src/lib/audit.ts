import { Prisma } from "@prisma/client";
import type { Tx } from "./db";

export type ActivityInput = {
  companyId: string | null;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  detail?: Record<string, unknown>;
};

/**
 * Append to the audit trail. Uses createMany (no RETURNING) because the runtime role
 * may write audit rows it is not allowed to read back. The table is append-only.
 */
export async function logActivity(tx: Tx, entry: ActivityInput) {
  await tx.activityLog.createMany({
    data: [{
      companyId: entry.companyId,
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      detail: (entry.detail ?? {}) as Prisma.InputJsonValue,
    }],
  });
}
