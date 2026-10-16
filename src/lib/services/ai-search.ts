import { withPublic } from "../db";
import { SAFETY_RULES, asData, cleanIntent, hasIntent, KEYWORDS, matchScore, mergeIntent, parseSearchText, type SearchIntent } from "../ai-rules";
import { jsonFrom } from "../ai-provider";
import { runAi, type Deps } from "./ai";

/**
 * Find properties from a sentence. The only data involved is what the public marketplace already shows: published listings.
 * The assistant turns the sentence into search settings; the platform's own query and scoring do the finding and ranking.
 */

export interface Found { listing: { publicRef: string; title: string; description: string; city: string; state: string; purpose: string; priceKobo: bigint; bedrooms: number | null; bathrooms: number | null }; score: number; reasons: string[]; misses: string[]; exact: boolean }
export interface SmartResult { understood: SearchIntent; found: Found[]; source: "AI" | "RULES"; notice: string; nothingUnderstood: boolean }

const SYSTEM = `${SAFETY_RULES}
Read the person's request for a property and reply with JSON only, with these keys: purpose ("SALE", "RENT", "LEASE" or null), city (a Nigerian city or area, or null), minBeds (whole number or null), maxPriceNaira (number or null), minPriceNaira (number or null), keywords (a list chosen only from: ${KEYWORDS.join(", ")}). Prices are in naira. Leave a key null when the request does not say.`;

export async function understand(text: string, who: { userId?: string | null; companyId?: string | null; visitorKey?: string }, deps?: Deps) {
  const t = text.trim().slice(0, 300);
  const rules = parseSearchText(t);
  return runAi<SearchIntent>({
    actor: who, feature: "SEARCH", inputChars: t.length, deps,
    rules: () => rules,
    assist: async (provider, signal) => {
      const r = await provider.complete({ system: SYSTEM, user: asData("request", t, 400), maxTokens: 250, signal });
      if (!r.ok) throw new Error(r.error);
      const cleaned = cleanIntent(jsonFrom(r.text));
      return cleaned ? mergeIntent(rules, cleaned) : null;
    },
  });
}

export async function smartSearch(text: string, visitorKey: string, deps?: Deps): Promise<SmartResult> {
  const t = text.trim();
  if (t.length < 3) return { understood: { keywords: [] }, found: [], source: "RULES", notice: "", nothingUnderstood: true };
  const u = await understand(t, { visitorKey }, deps);
  const want = u.result;
  if (!hasIntent(want)) return { understood: want, found: [], source: u.source, notice: u.notice, nothingUnderstood: true };
  const rows = await withPublic((tx) => tx.listing.findMany({
    where: {
      status: "PUBLISHED",
      ...(want.purpose ? { purpose: want.purpose } : {}),
      ...(want.city ? { OR: [{ city: { equals: want.city, mode: "insensitive" } }, { state: { equals: want.state ?? want.city, mode: "insensitive" } }] } : want.state ? { state: { equals: want.state, mode: "insensitive" } } : {}),
    },
    orderBy: { publishedAt: "desc" }, take: 300,
  }));
  const scored: Found[] = rows.map((l) => {
    const m = matchScore(l, want);
    return { listing: { publicRef: l.publicRef, title: l.title, description: l.description, city: l.city, state: l.state, purpose: l.purpose, priceKobo: l.priceKobo, bedrooms: l.bedrooms, bathrooms: l.bathrooms }, score: m.score, reasons: m.reasons, misses: m.misses, exact: m.misses.length === 0 };
  });
  const exact = scored.filter((x) => x.exact).sort((a, b) => b.score - a.score);
  const near = scored.filter((x) => !x.exact && x.score >= 40).sort((a, b) => b.score - a.score);
  return { understood: want, found: [...exact, ...near].slice(0, 24), source: u.source, notice: u.notice, nothingUnderstood: false };
}

/** Other published properties like this one: same purpose and area, close in price and size. */
export async function similarListings(publicRef: string, limit = 4) {
  return withPublic(async (tx) => {
    const base = await tx.listing.findFirst({ where: { publicRef, status: "PUBLISHED" } });
    if (!base) return [];
    const others = await tx.listing.findMany({ where: { status: "PUBLISHED", purpose: base.purpose, publicRef: { not: publicRef }, state: base.state }, take: 100, orderBy: { publishedAt: "desc" } });
    const p = Number(base.priceKobo);
    return others
      .map((o) => ({ o, d: (o.city === base.city ? 0 : 1) * 2 + Math.abs(Math.log((Number(o.priceKobo) || 1) / (p || 1))) + (base.bedrooms !== null && o.bedrooms !== null ? Math.abs(base.bedrooms - o.bedrooms) * 0.3 : 0.3) }))
      .sort((a, b) => a.d - b.d).slice(0, limit).map((x) => x.o);
  });
}
