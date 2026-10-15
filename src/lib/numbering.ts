import type { Tx } from "./db";

/**
 * Next number in a per-company, per-kind, per-year sequence. The upsert is atomic, so two requests
 * at the same moment never receive the same number.
 */
export async function nextNumber(tx: Tx, companyId: string, kind: string, year: number): Promise<number> {
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO number_counters (company_id, kind, year, last_number) VALUES (${companyId}, ${kind}, ${year}, 1)
    ON CONFLICT (company_id, kind, year) DO UPDATE SET last_number = number_counters.last_number + 1
    RETURNING last_number`;
  return Number(rows[0].last_number);
}
