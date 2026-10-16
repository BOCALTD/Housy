// Who a new property is relevant to. Pure, so the matching can be tested without a database.

export interface ListingFacts { purpose: string; city: string; state: string; title: string; priceKobo: bigint | number; bedrooms: number | null }
export interface SearchFacts { purpose: string; city: string; q: string; maxKobo: bigint | number | null; minBeds: number | null }

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.trim().toLowerCase());

/** A saved search matches when every filter it sets is met. A search with no filters at all matches nothing, so it can never mean "everything". */
export function matchSearch(l: ListingFacts, s: SearchFacts): boolean {
  const set = !!(s.purpose || s.city.trim() || s.q.trim() || s.maxKobo != null || s.minBeds != null);
  if (!set) return false;
  if (s.purpose && s.purpose !== l.purpose) return false;
  if (s.city.trim() && !has(l.city, s.city) && !has(l.state, s.city)) return false;
  if (s.q.trim() && !has(l.title, s.q)) return false;
  if (s.maxKobo != null && Number(l.priceKobo) > Number(s.maxKobo)) return false;
  if (s.minBeds != null && (l.bedrooms ?? -1) < s.minBeds) return false;
  return true;
}

/** Areas a person chose (lowercase) against the property's city or state. */
export const areaKeys = (l: { city: string; state: string }) => [l.city.trim().toLowerCase(), l.state.trim().toLowerCase()].filter(Boolean);

export interface AlertConfig { maxRecipients: number; savedSearches: boolean; followers: boolean; areas: boolean }
export const DEFAULT_ALERT_CONFIG: AlertConfig = { maxRecipients: 300, savedSearches: true, followers: true, areas: true };
export function alertConfigProblem(c: AlertConfig): string | null {
  if (!Number.isInteger(c.maxRecipients) || c.maxRecipients < 1 || c.maxRecipients > 1000) return "The most people one property can reach must be a whole number from 1 to 1000";
  return null;
}

export type Reason = "SAVED_SEARCH" | "FOLLOW" | "AREA";
/** First reason wins, in the order a person is most likely to want it, and the list is cut at the limit. */
export function pickRecipients(groups: { reason: Reason; label: string; userIds: string[] }[], exclude: Set<string>, max: number) {
  const out = new Map<string, { reason: Reason; label: string }>();
  for (const g of groups) for (const id of g.userIds) {
    if (out.size >= max) return out;
    if (!exclude.has(id) && !out.has(id)) out.set(id, { reason: g.reason, label: g.label });
  }
  return out;
}
