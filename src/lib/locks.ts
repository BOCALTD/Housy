import type { Tx } from "./db";

/**
 * Serialise work on a named resource until the end of the current transaction. Used where a rule must
 * hold across rows that do not exist yet (for example "this payment reference is used only once").
 */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
