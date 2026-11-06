import { z } from "zod";
import { withUser } from "../db";
import { parseNairaToKobo } from "../money";
import { parseFilters, type Filters } from "../listing-rules";
import { bestMatchPage } from "./best-match";
import { listingWhere } from "./listings";

/**
 * My search: where someone wants to live, rent or buy, their budget and bedrooms, set once. It fills their home page picks,
 * starts their reels on homes that fit, and is one tap away on search. They can change or clear it at any time.
 */

import { prefLabel, prefParams, type SearchPrefView } from "../search-pref-rules";
export { prefLabel, prefParams, type SearchPrefView };

export async function getSearchPref(userId: string): Promise<SearchPrefView | null> {
  const p = await withUser(userId, (tx) => tx.searchPref.findUnique({ where: { userId } }));
  if (!p) return null;
  return { city: p.city, purpose: p.purpose === "SALE" || p.purpose === "RENT" ? p.purpose : "", maxNaira: p.maxPriceKobo !== null ? Number(p.maxPriceKobo) / 100 : null, minBeds: p.minBeds };
}

const prefSchema = z.object({
  city: z.string().trim().max(80).default(""),
  purpose: z.enum(["", "SALE", "RENT"]).default(""),
  maxPrice: z.string().trim().max(30).default(""),
  minBeds: z.string().trim().max(2).default(""),
});

export async function saveSearchPref(userId: string, input: z.input<typeof prefSchema>) {
  const d = prefSchema.parse(input);
  let max: bigint | null = null;
  if (d.maxPrice) { try { max = parseNairaToKobo(d.maxPrice); } catch { throw new Error("Enter the budget as a number of naira, for example 3,000,000"); } }
  const beds = d.minBeds ? Number.parseInt(d.minBeds, 10) : NaN;
  if (!d.city && !d.purpose && max === null && !Number.isInteger(beds)) throw new Error("Fill in at least one thing: where, rent or buy, budget or bedrooms");
  const data = { city: d.city, purpose: d.purpose, maxPriceKobo: max, minBeds: Number.isInteger(beds) && beds >= 0 && beds <= 20 ? beds : null };
  return withUser(userId, (tx) => tx.searchPref.upsert({ where: { userId }, create: { userId, ...data }, update: data }));
}

export async function clearSearchPref(userId: string) {
  return withUser(userId, (tx) => tx.searchPref.deleteMany({ where: { userId } }));
}

/** Home page picks from the saved search, best match first. */
export async function mySearchPicks(userId: string, limit = 10) {
  const p = await getSearchPref(userId);
  if (!p) return null;
  const params = prefParams(p);
  const f: Filters = parseFilters((k) => params[k] ?? null);
  const r = await bestMatchPage(listingWhere(f), 1, limit);
  return { label: prefLabel(p), rows: r.rows.map((l) => ({ publicRef: l.publicRef, why: ["Fits your search", ...l.matchWhy].slice(0, 3) })) };
}
