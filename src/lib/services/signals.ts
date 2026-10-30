/**
 * What a signed-in person does, kept to shape their own suggestions (suggest-rules.ts). Never shared, never shown to
 * companies or agents, kept 180 days, and the person can see it, clear it or turn it off on their privacy page.
 * Visitors who are not signed in are never recorded.
 */
import { prisma, withPublic, withUser } from "../db";
import { KEEP_DAYS, rankSuggestions, tasteOf, tasteSummary, type SignalKind } from "../suggest-rules";

type SignalInput = { kind: SignalKind; listingId?: string; publicRef?: string; reelId?: string; agentId?: string; companyId?: string; city?: string; purpose?: string };
const REPEAT_MINUTES = 30;

/** Record one thing someone did. Quietly does nothing for people who turned suggestions off, and never fails the page. */
export async function recordSignal(userId: string, s: SignalInput) {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { personalise: true } });
    if (!u?.personalise) return;
    // What the thing is about comes from the record itself, never from what the browser says.
    let row: { listingId?: string | null; reelId?: string | null; agentId?: string | null; companyId?: string | null; city: string; propertyType: string; purpose: string; priceKobo: bigint | null; bedrooms: number | null } = { city: (s.city ?? "").slice(0, 80), propertyType: "", purpose: (s.purpose ?? "").slice(0, 10), priceKobo: null, bedrooms: null, agentId: s.agentId ?? null, companyId: s.companyId ?? null };
    if (s.listingId || s.publicRef) {
      const l = await withPublic((tx) => tx.listing.findFirst({ where: { ...(s.listingId ? { id: s.listingId } : { publicRef: s.publicRef }), status: "PUBLISHED" }, select: { id: true, city: true, propertyType: true, purpose: true, priceKobo: true, pricePeriod: true, bedrooms: true, postedById: true, companyId: true } }));
      if (!l) return;
      const yearly = l.purpose !== "SALE" && l.pricePeriod === "MONTH" ? l.priceKobo * 12n : l.pricePeriod === "NIGHT" ? null : l.priceKobo;
      row = { listingId: l.id, city: l.city, propertyType: l.propertyType, purpose: l.purpose, priceKobo: yearly, bedrooms: l.bedrooms, agentId: l.postedById, companyId: l.companyId };
    } else if (s.reelId) {
      const r = await withPublic((tx) => tx.reel.findFirst({ where: { id: s.reelId, status: "PUBLISHED" }, select: { id: true, city: true, authorId: true, companyId: true, listingId: true } }));
      if (!r) return;
      row = { ...row, reelId: r.id, city: r.city, agentId: r.authorId, companyId: r.companyId, listingId: r.listingId };
    }
    await withUser(userId, async (tx) => {
      const since = new Date(Date.now() - REPEAT_MINUTES * 60_000);
      const same = await tx.userSignal.findFirst({ where: { userId, kind: s.kind, listingId: row.listingId ?? null, reelId: row.reelId ?? null, agentId: s.kind === "AGENT_VIEW" ? row.agentId : undefined, city: s.kind === "SEARCH" ? row.city : undefined, createdAt: { gte: since } }, select: { id: true } });
      if (same) return;
      await tx.userSignal.create({ data: { userId, kind: s.kind, listingId: row.listingId ?? null, reelId: row.reelId ?? null, agentId: row.agentId ?? null, companyId: row.companyId ?? null, city: row.city, propertyType: row.propertyType, purpose: row.purpose, priceKobo: row.priceKobo, bedrooms: row.bedrooms } });
      // Keep only 180 days, trimmed now and then rather than on every page.
      if (Math.random() < 0.05) await tx.userSignal.deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 864e5) } } });
    });
  } catch (e) { console.error("signal not recorded", e); }
}

async function tasteFor(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { personalise: true } });
  if (!u?.personalise) return null;
  const rows = await withUser(userId, (tx) => tx.userSignal.findMany({ where: { userId, createdAt: { gte: new Date(Date.now() - KEEP_DAYS * 864e5) } }, orderBy: { createdAt: "desc" }, take: 600 }));
  return rows.length ? tasteOf(rows) : null;
}

/** Published properties that fit what this person has been doing, each with why. Null when there is nothing to go on. */
export async function suggestedListings(userId: string, limit = 8) {
  const t = await tasteFor(userId);
  if (!t || t.total < 1) return null;
  const cities = [...t.cities].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
  const agents = [...t.agents].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => a);
  const pool = await withPublic((tx) => tx.listing.findMany({
    where: { status: "PUBLISHED", platformHidden: false, OR: [{ city: { in: cities, mode: "insensitive" } }, { postedById: { in: agents } }] },
    orderBy: { publishedAt: "desc" }, take: 400,
    select: { id: true, publicRef: true, title: true, city: true, state: true, propertyType: true, purpose: true, pricePeriod: true, priceKobo: true, bedrooms: true, postedById: true, companyId: true, publishedAt: true },
  }));
  const ranked = rankSuggestions(pool, t, new Date(), limit);
  return ranked.map((r) => ({ ...pool.find((p) => p.id === r.id)!, why: r.why }));
}

/** Reel authors and areas this person engages with, to blend into the reels "For you" ranking. */
export async function reelTaste(userId: string) {
  const t = await tasteFor(userId);
  if (!t) return null;
  return { cities: new Set([...t.cities.keys()]), authors: new Set([...t.agents.keys()]) };
}

/** What shapes this person's suggestions, for their privacy page. */
export async function mySignals(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { personalise: true } });
  const rows = await withUser(userId, (tx) => tx.userSignal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 600 }));
  const t = tasteOf(rows);
  return { on: u.personalise, count: rows.length, since: rows.at(-1)?.createdAt ?? null, summary: tasteSummary(t), recent: rows.slice(0, 10) };
}

export async function setPersonalise(userId: string, on: boolean) {
  await prisma.user.update({ where: { id: userId }, data: { personalise: on } });
  if (!on) await clearSignals(userId);
}
export async function clearSignals(userId: string) {
  await withUser(userId, (tx) => tx.userSignal.deleteMany({ where: { userId } }));
}
