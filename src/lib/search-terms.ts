// Shared helpers for server-side list search: a typed search is trimmed and capped, and people are found by name or email.
import type { Tx } from "./db";

/** A search as typed: trimmed, at most 120 characters, empty when there is nothing to look for. */
export const searchText = (q: string | null | undefined) => (q ?? "").trim().slice(0, 120);

/** Ids of people whose name or email contains the search (at most 200), for lists that store only a person's id. */
export async function peopleMatching(tx: Tx, q: string): Promise<string[]> {
  if (!q) return [];
  const rows = await tx.user.findMany({ where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }, select: { id: true }, take: 200 });
  return rows.map((r) => r.id);
}
