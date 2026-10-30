import type { MetadataRoute } from "next";
import { withPublic } from "@/lib/db";
import { marketOverview } from "@/lib/services/market";

export const revalidate = 3600;

/** Every public page worth finding: the main pages, published properties, listed agents and companies, reels and market pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const at = (path: string, lastModified?: Date | null, priority = 0.5): MetadataRoute.Sitemap[number] => ({ url: `${base}${path}`, lastModified: lastModified ?? undefined, priority });
  const fixed = ["/", "/browse", "/browse/buy", "/browse/rent", "/browse/land", "/browse/short-let", "/map", "/reels", "/market", "/directory", "/flatmates", "/calculators", "/compare", "/pricing", "/how-it-works", "/about", "/trust", "/safety", "/faq", "/reviews", "/completed", "/awards", "/support", "/join", "/login"]
    .map((p) => at(p, null, p === "/" ? 1 : 0.7));
  try {
    const [listings, agents, companies, reels, market] = await Promise.all([
      withPublic((tx) => tx.listing.findMany({ where: { status: "PUBLISHED", platformHidden: false }, select: { publicRef: true, updatedAt: true }, orderBy: { publishedAt: "desc" }, take: 20_000 })),
      withPublic((tx) => tx.agentProfile.findMany({ where: { listed: true, platformHidden: false }, select: { userId: true, updatedAt: true }, take: 10_000 })),
      withPublic((tx) => tx.companyProfile.findMany({ where: { listed: true, platformHidden: false }, select: { companyId: true, updatedAt: true }, take: 10_000 })),
      withPublic((tx) => tx.reel.findMany({ where: { status: "PUBLISHED" }, select: { id: true, publishedAt: true }, orderBy: { publishedAt: "desc" }, take: 5_000 })),
      marketOverview().catch(() => null),
    ]);
    return [
      ...fixed,
      ...listings.map((l) => at(`/properties/${l.publicRef}`, l.updatedAt, 0.8)),
      ...agents.map((a) => at(`/agents/${a.userId}`, a.updatedAt, 0.6)),
      ...companies.map((c) => at(`/companies/${c.companyId}`, c.updatedAt, 0.6)),
      ...reels.map((r) => at(`/reels/${r.id}`, r.publishedAt, 0.4)),
      ...(market?.cities ?? []).map((c) => at(`/market/${c.slug}`, market!.generatedAt, 0.6)),
    ];
  } catch {
    return fixed; // the database is unreachable: the fixed pages still help
  }
}
